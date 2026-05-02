const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const dotenv = require("dotenv");
const {
  AGENT_EXE_NAME,
  APP_NAME,
  LAUNCHER_EXE_NAME,
  LEGACY_GUEST_SHORTCUT_NAME,
  STARTUP_TASK_DESCRIPTION,
  STARTUP_TASK_NAME,
} = require("./appConstants");
const packageJson = require("./package.json");

const repoRoot = path.join(__dirname, "..");
const distDir = path.join(__dirname, "dist");
const payloadDir = path.join(distDir, "payload");
const runtimeConfigOutputPath = path.join(payloadDir, "agent.runtime.json");
const buildInfoPath = path.join(payloadDir, "agent-build.json");
const faviconSourcePath = path.join(repoRoot, "favicon.ico");
const faviconOutputPath = path.join(payloadDir, "favicon.ico");

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function safeExec(command) {
  try {
    return execSync(command, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch (_error) {
    return "";
  }
}

function loadPackagedRuntimeConfig() {
  const envPath = path.join(repoRoot, ".env");
  const runtimeConfigPath = path.join(repoRoot, "agent.runtime.json");
  const runtimeTemplatePath = path.join(repoRoot, "agent.runtime.example.json");
  const envValues = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath, "utf8"))
    : {};
  const runtimeConfigSource = fs.existsSync(runtimeConfigPath)
    ? runtimeConfigPath
    : fs.existsSync(runtimeTemplatePath)
      ? runtimeTemplatePath
      : null;
  const runtimeConfig = runtimeConfigSource
    ? JSON.parse(fs.readFileSync(runtimeConfigSource, "utf8"))
    : {};

  const packaged = JSON.parse(JSON.stringify(runtimeConfig));
  packaged.supabase = {
    ...(packaged.supabase || {}),
    url:
      envValues.SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      packaged.supabase?.url ||
      "",
    anonKey:
      envValues.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      packaged.supabase?.anonKey ||
      "",
  };
  const packagedLogPath = String(packaged.localLogPath || "").replace(/\//g, "\\").toLowerCase();
  if (!packaged.localLogPath || packagedLogPath.endsWith("\\logs\\agent.log")) {
    packaged.localLogPath = ".\\logs\\school-services.log";
  }
  packaged.localLogMaxBytes = Number(packaged.localLogMaxBytes || 5 * 1024 * 1024);

  return packaged;
}

function parseGitHubRemote(remoteUrl) {
  const value = String(remoteUrl || "").trim();
  const match =
    value.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i) || [];
  if (match.length >= 3) {
    return {
      owner: match[1],
      repo: match[2],
    };
  }

  return {
    owner: null,
    repo: null,
  };
}

function parseVersionTag(tag) {
  const match = String(tag || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) {
    return null;
  }

  return {
    raw: `v${match[1]}.${match[2]}.${match[3]}`,
    version: `${match[1]}.${match[2]}.${match[3]}`,
    parts: match.slice(1).map((value) => Number.parseInt(value, 10)),
  };
}

function compareVersionParts(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function resolveBuildVersionInfo(currentCommit) {
  const fallback = {
    version: packageJson.version,
    releaseTag: `v${packageJson.version}`,
  };
  const gitStatus = safeExec("git status --porcelain");
  if (gitStatus) {
    return fallback;
  }
  const packageTag = parseVersionTag(fallback.releaseTag);
  const remoteTagsOutput = safeExec("git ls-remote --tags --refs origin");

  if (!remoteTagsOutput || !currentCommit) {
    return fallback;
  }

  const matchingTags = remoteTagsOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split(/\s+/);
      const tagName = ref?.replace(/^refs\/tags\//, "");
      const parsed = parseVersionTag(tagName);

      if (!parsed || sha !== currentCommit) {
        return null;
      }

      return parsed;
    })
    .filter(Boolean)
    .sort((left, right) => compareVersionParts(right.parts, left.parts));

  const selected = matchingTags[0];

  if (!selected) {
    return fallback;
  }

  if (
    packageTag &&
    compareVersionParts(packageTag.parts, selected.parts) > 0
  ) {
    return fallback;
  }

  return {
    version: selected.version,
    releaseTag: selected.raw,
  };
}

function buildInfoPayload() {
  const remoteUrl = safeExec("git remote get-url origin");
  const gitCommit = safeExec("git rev-parse HEAD");
  const gitBranch = safeExec("git rev-parse --abbrev-ref HEAD") || "main";
  const githubRemote = parseGitHubRemote(remoteUrl);
  const buildVersionInfo = resolveBuildVersionInfo(gitCommit);

  return {
    owner: githubRemote.owner,
    repo: githubRemote.repo,
    branch: gitBranch === "HEAD" ? "main" : gitBranch || "main",
    version: buildVersionInfo.version,
    commit: gitCommit || null,
    releaseChannel: "latest",
    releaseTag: buildVersionInfo.releaseTag,
    builtAt: new Date().toISOString(),
  };
}

function writeTextFile(filePath, content, encoding = "utf8") {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content, encoding);
}

function createElevatedVbsScript(targetScriptName) {
  return [
    'Set shellApp = CreateObject("Shell.Application")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'currentDir = fso.GetParentFolderName(WScript.ScriptFullName)',
    `args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & currentDir & "\\${targetScriptName}" & Chr(34)`,
    'shellApp.ShellExecute "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", args, currentDir, "runas", 0',
    "",
  ].join("\r\n");
}

function createSilentPowerShellVbsScript(targetScriptName) {
  return [
    'Set shellApp = CreateObject("Shell.Application")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'currentDir = fso.GetParentFolderName(WScript.ScriptFullName)',
    `args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & currentDir & "\\${targetScriptName}" & Chr(34)`,
    'shellApp.ShellExecute "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", args, currentDir, "", 0',
    "",
  ].join("\r\n");
}

function createRollingLogFunction(functionName, prefix) {
  return [
    '$maxLogBytes = 5242880',
    'function Limit-LogFile([string]$path) {',
    '  try {',
    '    if (-not (Test-Path $path)) { return }',
    '    $item = Get-Item -LiteralPath $path -ErrorAction Stop',
    '    if ($item.Length -le $maxLogBytes) { return }',
    '    $bytes = [System.IO.File]::ReadAllBytes($path)',
    '    $keep = [Math]::Min($maxLogBytes, $bytes.Length)',
    '    $tail = New-Object byte[] $keep',
    '    [Array]::Copy($bytes, $bytes.Length - $keep, $tail, 0, $keep)',
    '    [System.IO.File]::WriteAllBytes($path, $tail)',
    '  } catch {}',
    '}',
    `function ${functionName}([string]$message) {`,
    '  try {',
    '    New-Item -ItemType Directory -Path $installLogsDir -Force | Out-Null',
    `    $entry = "[{0}] ${prefix} {1}" -f (Get-Date).ToString("s"), $message`,
    '    Add-Content -Path $logPath -Value $entry -ErrorAction Stop',
    '    Limit-LogFile $logPath',
    '  } catch {}',
    '}',
  ];
}

function createFirewallRuleFunctions() {
  return [
    "function Remove-FirewallRuleGroup([string]$displayNamePrefix) {",
    "  try {",
    "    Get-NetFirewallRule -DisplayName ($displayNamePrefix + ' *') -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue",
    "  } catch {}",
    "}",
    "function Ensure-FirewallRule([string]$displayName, [string]$programPath, [string]$direction) {",
    "  if (-not $programPath -or -not (Test-Path $programPath)) { return }",
    "  try {",
    "    Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue",
    "  } catch {}",
    "  New-NetFirewallRule -DisplayName $displayName -Direction $direction -Program $programPath -Action Allow -Profile Private,Public -ErrorAction SilentlyContinue | Out-Null",
    "}",
    "function Ensure-SilentFirewallAccess([string]$installDir, [string]$runtimeDir) {",
    `  $appName = '${APP_NAME.replace(/'/g, "''")}'`,
    `  $agentExeName = '${AGENT_EXE_NAME.replace(/'/g, "''")}'`,
    `  $launcherExeName = '${LAUNCHER_EXE_NAME.replace(/'/g, "''")}'`,
    "  $agentExePath = Join-Path $installDir $agentExeName",
    "  $launcherExePath = Join-Path $installDir $launcherExeName",
    "  $bundledCloudflaredPath = Join-Path $installDir 'cloudflared.exe'",
    "  $runtimeCloudflaredPath = Join-Path $runtimeDir 'cloudflared.exe'",
    "  if (Test-Path $bundledCloudflaredPath) {",
    "    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null",
    "    Copy-Item -LiteralPath $bundledCloudflaredPath -Destination $runtimeCloudflaredPath -Force",
    "  }",
    "  Remove-FirewallRuleGroup ($appName + ' ')",
    "  Ensure-FirewallRule ($appName + ' Agent Inbound') $agentExePath 'Inbound'",
    "  Ensure-FirewallRule ($appName + ' Agent Outbound') $agentExePath 'Outbound'",
    "  Ensure-FirewallRule ($appName + ' Launcher Outbound') $launcherExePath 'Outbound'",
    "  Ensure-FirewallRule ($appName + ' Cloudflared Inbound') $runtimeCloudflaredPath 'Inbound'",
    "  Ensure-FirewallRule ($appName + ' Cloudflared Outbound') $runtimeCloudflaredPath 'Outbound'",
    "}",
  ];
}

function createPowerShellScripts() {
  const registerStartupPs1 = [
    '$ErrorActionPreference = "Stop"',
    `$taskName = '${STARTUP_TASK_NAME.replace(/'/g, "''")}'`,
    `$description = '${STARTUP_TASK_DESCRIPTION.replace(/'/g, "''")}'`,
    `$installDir = $PSScriptRoot`,
    '$installLogsDir = Join-Path $installDir "logs"',
    '$logPath = Join-Path $installLogsDir "school-services.log"',
    ...createRollingLogFunction("Write-StartupLog", "[startup]"),
    `$appName = '${APP_NAME.replace(/'/g, "''")}'`,
    '$programData = $env:ProgramData',
    'if (-not $programData) { $programData = "C:\\ProgramData" }',
    '$dataDir = Join-Path $programData $appName',
    '$startScriptPath = Join-Path $installDir "start-agent-clean.ps1"',
    '$powerShellPath = Join-Path $env:SystemRoot "System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
    'New-Item -ItemType Directory -Path $dataDir -Force | Out-Null',
    '$argument = \'-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "\' + $startScriptPath + \'"\'',
    '$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $argument',
    '$trigger = New-ScheduledTaskTrigger -AtStartup',
    "$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest",
    '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable',
    'if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {',
    '  Write-StartupLog ("Replacing existing scheduled task " + $taskName)',
    '  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false',
    '}',
    'Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $description -Force | Out-Null',
    'Write-StartupLog ("Registered scheduled task " + $taskName + " -> " + $startScriptPath)',
    '',
  ].join("\r\n");

  const stopAgentPs1 = [
    '$ErrorActionPreference = "Continue"',
    '$installDir = $PSScriptRoot',
    '$installLogsDir = Join-Path $installDir "logs"',
    '$logPath = Join-Path $installLogsDir "school-services.log"',
    ...createRollingLogFunction("Write-StopLog", "[stop]"),
    `$agentExeName = '${AGENT_EXE_NAME.replace(/'/g, "''")}'`,
    `$legacyAgentExeName = 'e-rapor-agent.exe'`,
    `$taskName = '${STARTUP_TASK_NAME.replace(/'/g, "''")}'`,
    '$programData = $env:ProgramData',
    'if (-not $programData) { $programData = "C:\\ProgramData" }',
    `$dataDir = Join-Path $programData '${APP_NAME.replace(/'/g, "''")}'`,
    '$stateDir = Join-Path $dataDir "state"',
    '$lockPath = Join-Path $stateDir "agent.lock"',
    'function Stop-ByLockFile {',
    '  if (-not (Test-Path $lockPath)) { return }',
    '  try {',
    '    $payload = Get-Content $lockPath -Raw | ConvertFrom-Json',
    '    if ($payload.pid) { taskkill /PID $payload.pid /T /F *> $null }',
    '  } catch {}',
    '}',
    'Write-StopLog "Stopping existing agent, launcher, and tunnel processes."',
    'Stop-ByLockFile',
    'taskkill /F /IM $agentExeName /T *> $null',
    'taskkill /F /IM $legacyAgentExeName /T *> $null',
    'taskkill /F /IM cloudflared.exe /T *> $null',
    'Get-CimInstance Win32_Process -Filter "Name = \'powershell.exe\'" -ErrorAction SilentlyContinue |',
    '  Where-Object {',
    '    $commandLine = [string]$_.CommandLine',
    '    $commandLine -like "*update-and-run.ps1*" -or',
    '    $commandLine -like "*start-agent-clean.ps1*" -or',
    '    $commandLine -like "*post-install.ps1*"',
    '  } | ForEach-Object {',
    '    if ($_.ProcessId -and $_.ProcessId -ne $PID) { taskkill /PID $_.ProcessId /T /F *> $null }',
    '  }',
    'if (Test-Path $lockPath) { Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue }',
    'Write-StopLog "Stop cleanup completed."',
    '',
  ].join("\r\n");

  const startAgentCleanPs1 = [
    '$ErrorActionPreference = "Stop"',
    '$installDir = $PSScriptRoot',
    '$installLogsDir = Join-Path $installDir "logs"',
    '$logPath = Join-Path $installLogsDir "school-services.log"',
    ...createRollingLogFunction("Write-BootstrapLog", "[bootstrap]"),
    `$agentExeName = '${AGENT_EXE_NAME.replace(/'/g, "''")}'`,
    `$appName = '${APP_NAME.replace(/'/g, "''")}'`,
    '$programData = $env:ProgramData',
    'if (-not $programData) { $programData = "C:\\ProgramData" }',
    '$dataDir = Join-Path $programData $appName',
    '$stateDir = Join-Path $dataDir "state"',
    '$tunnelStateDir = Join-Path $stateDir "tunnels"',
    '$runtimeDir = Join-Path $dataDir "runtime"',
    '$cacheDir = Join-Path $dataDir "cache"',
    '$logsDir = Join-Path $dataDir "logs"',
    '$updatesDir = Join-Path $dataDir "updates"',
    '$stopScriptPath = Join-Path $installDir "stop-agent.ps1"',
    ...createFirewallRuleFunctions(),
    'Write-BootstrapLog ("Starting clean bootstrap from " + $installDir)',
    '& $stopScriptPath',
    'foreach ($dir in @($dataDir, $stateDir, $runtimeDir, $cacheDir, $logsDir, $updatesDir, $tunnelStateDir)) {',
    '  New-Item -ItemType Directory -Path $dir -Force | Out-Null',
    '}',
    'if (Test-Path $tunnelStateDir) {',
    '  Remove-Item -LiteralPath (Join-Path $tunnelStateDir "*") -Recurse -Force -ErrorAction SilentlyContinue',
    '}',
    'Ensure-SilentFirewallAccess $installDir $runtimeDir',
    '$agentExePath = Join-Path $installDir $agentExeName',
    'Write-BootstrapLog ("Launching agent executable " + $agentExePath)',
    '$agentProcess = Start-Process -FilePath $agentExePath -WorkingDirectory $installDir -WindowStyle Hidden -PassThru',
    'Write-BootstrapLog ("Agent process started with PID " + $agentProcess.Id)',
    '',
  ].join("\r\n");

  const watchAgentLogPs1 = [
    '$installDir = $PSScriptRoot',
    '$logDir = Join-Path $installDir "logs"',
    '$latest = Get-ChildItem -Path $logDir -Filter "school-services.log" -ErrorAction SilentlyContinue |',
    '  Sort-Object LastWriteTime -Descending |',
    '  Select-Object -First 1',
    'if ($latest) {',
    '  Get-Content -Path $latest.FullName -Wait',
    '} else {',
    '  Write-Host "No agent log file found yet."',
    '}',
    '',
  ].join("\r\n");

  const openGuestDashboardPs1 = [
    '$ErrorActionPreference = "Stop"',
    '$installDir = $PSScriptRoot',
    '$installLogsDir = Join-Path $installDir "logs"',
    '$logPath = Join-Path $installLogsDir "school-services.log"',
    ...createRollingLogFunction("Write-GuestLaunchLog", "[guest-launcher]"),
    '$programData = $env:ProgramData',
    'if (-not $programData) { $programData = "C:\\ProgramData" }',
    `$appName = '${APP_NAME.replace(/'/g, "''")}'`,
    '$dataDir = Join-Path $programData $appName',
    '$stateDir = Join-Path $dataDir "state"',
    '$deviceStatePath = Join-Path $stateDir "device.json"',
    '$runtimeConfigPath = Join-Path $dataDir "agent.runtime.json"',
    '$defaultBaseUrl = "https://school-services.netlify.app"',
    'function Get-GuestBaseUrl {',
    '  $baseUrl = $env:GUEST_PORTAL_BASE_URL',
    '  if (-not $baseUrl -and (Test-Path $runtimeConfigPath)) {',
    '    try {',
    '      $runtimeConfig = Get-Content $runtimeConfigPath -Raw | ConvertFrom-Json',
    '      $baseUrl = $runtimeConfig.guestPortal.baseUrl',
    '    } catch {}',
    '  }',
    '  if (-not $baseUrl) { $baseUrl = $defaultBaseUrl }',
    '  return ([string]$baseUrl).TrimEnd("/")',
    '}',
    'function Get-DeviceId {',
    '  if (Test-Path $deviceStatePath) {',
    '    try {',
    '      $deviceState = Get-Content $deviceStatePath -Raw | ConvertFrom-Json',
    '      if ($deviceState.deviceId) {',
    '        Write-GuestLaunchLog ("Using deviceId from state file " + $deviceStatePath)',
    '        return [string]$deviceState.deviceId',
    '      }',
    '    } catch {',
    '      Write-GuestLaunchLog ("Could not read device state file: " + $_.Exception.Message)',
    '    }',
    '  }',
    '  $hostname = [string]$env:COMPUTERNAME',
    '  if (-not $hostname) { $hostname = [System.Net.Dns]::GetHostName() }',
    '  $seed = "$($hostname):win32"',
    '  $sha = [System.Security.Cryptography.SHA256]::Create()',
    '  try {',
    '    $bytes = [System.Text.Encoding]::UTF8.GetBytes($seed)',
    '    $hash = $sha.ComputeHash($bytes)',
    '  } finally {',
    '    $sha.Dispose()',
    '  }',
    '  return ([System.BitConverter]::ToString($hash).Replace("-", "").ToLowerInvariant()).Substring(0, 24)',
    '}',
    'try {',
    '  $baseUrl = Get-GuestBaseUrl',
    '  $deviceId = Get-DeviceId',
    '  $guestUrl = "$baseUrl/guest/$([uri]::EscapeDataString($deviceId))"',
    '  Write-GuestLaunchLog ("Opening guest dashboard " + $guestUrl)',
    '  Start-Process $guestUrl',
    '} catch {',
    '  Write-GuestLaunchLog ("Guest dashboard launch failed: " + $_.Exception.Message)',
    '  throw',
    '}',
    '',
  ].join("\r\n");

  const adminStartServicePs1 = [
    '$ErrorActionPreference = "Stop"',
    '$installDir = $PSScriptRoot',
    '& (Join-Path $installDir "register-startup.ps1")',
    '& (Join-Path $installDir "start-agent-clean.ps1")',
    '',
  ].join("\r\n");

  const adminStopServicePs1 = [
    '$ErrorActionPreference = "Stop"',
    '$installDir = $PSScriptRoot',
    '& (Join-Path $installDir "stop-agent.ps1")',
    '',
  ].join("\r\n");

  const adminRestartServicePs1 = [
    '$ErrorActionPreference = "Stop"',
    '$installDir = $PSScriptRoot',
    '& (Join-Path $installDir "stop-agent.ps1")',
    'Start-Sleep -Seconds 2',
    '& (Join-Path $installDir "register-startup.ps1")',
    '& (Join-Path $installDir "start-agent-clean.ps1")',
    '',
  ].join("\r\n");

  const updateAndRunPs1 = [
    '$ErrorActionPreference = "Stop"',
    '$installDir = $PSScriptRoot',
    '$installLogsDir = Join-Path $installDir "logs"',
    '$logPath = Join-Path $installLogsDir "school-services.log"',
    '$buildInfoPath = Join-Path $installDir "agent-build.json"',
    '$programData = $env:ProgramData',
    'if (-not $programData) { $programData = "C:\\ProgramData" }',
    `$dataDir = Join-Path $programData '${APP_NAME.replace(/'/g, "''")}'`,
    '$updatesDir = Join-Path $dataDir "updates"',
    'New-Item -ItemType Directory -Path $updatesDir -Force | Out-Null',
    'New-Item -ItemType Directory -Path $installLogsDir -Force | Out-Null',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls',
    ...createRollingLogFunction("Write-UpdaterLog", "[updater]"),
    'function Normalize-VersionToken([string]$value) {',
    '  if (-not $value) { return "" }',
    '  $normalized = $value.Trim()',
    '  if ($normalized.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) {',
    '    $normalized = $normalized.Substring(1)',
    '  }',
    '  return $normalized',
    '}',
    'function Read-BuildInfo {',
    '  if (-not (Test-Path $buildInfoPath)) { throw "agent-build.json is missing." }',
    '  return Get-Content $buildInfoPath -Raw | ConvertFrom-Json',
    '}',
    'function Get-RequestHeaders {',
    '  $headers = @{ "User-Agent" = "school-services-updater" }',
    '  $token = $env:GITHUB_TOKEN',
    '  if (-not $token) { $token = $env:GH_TOKEN }',
    '  if ($token) { $headers["Authorization"] = "Bearer $token" }',
    '  return $headers',
    '}',
    'function Get-LatestRelease($buildInfo) {',
    '  $owner = [string]$buildInfo.owner',
    '  $repo = [string]$buildInfo.repo',
    '  if (-not $owner -or -not $repo) { throw "GitHub owner/repo is missing from build metadata." }',
    '  $releaseChannel = [string]$buildInfo.releaseChannel',
    '  if (-not $releaseChannel) { $releaseChannel = "latest" }',
    '  $headers = Get-RequestHeaders',
    '  if ($releaseChannel -eq "latest") {',
    '    return Invoke-RestMethod -Uri ("https://api.github.com/repos/$owner/$repo/releases/latest") -Headers $headers',
    '  }',
    '  return Invoke-RestMethod -Uri ("https://api.github.com/repos/$owner/$repo/releases/tags/" + $releaseChannel) -Headers $headers',
    '}',
    'function Stop-ExistingAgent {',
    '  & (Join-Path $installDir "stop-agent.ps1")',
    '}',
    '$buildInfo = Read-BuildInfo',
    '$release = Get-LatestRelease $buildInfo',
    '$releaseTag = [string]$release.tag_name',
    '$releaseVersion = Normalize-VersionToken $releaseTag',
    '$currentVersion = Normalize-VersionToken ([string]$buildInfo.version)',
    'if (-not $releaseVersion) { throw "Latest release tag is not a semantic version." }',
    'if ($currentVersion) {',
    '  try {',
    '    if ([version]$releaseVersion -le [version]$currentVersion) {',
    '      Write-UpdaterLog ("Skipping update because current version is newer or equal. currentVersion={0}; latestReleaseTag={1}" -f $currentVersion, $releaseTag)',
    '      exit 0',
    '    }',
    '  } catch {}',
    '}',
    '$assetNames = @(',
    "  'School Services v' + $releaseVersion + '.exe',",
    "  'School.Services.v' + $releaseVersion + '.exe'",
    ')',
    '$asset = $release.assets | Where-Object { $assetNames -contains $_.name } | Select-Object -First 1',
    'if (-not $asset) { throw ("Release does not contain a supported installer asset for version " + $releaseVersion + ".") }',
    '$installerPath = Join-Path $updatesDir $asset.name',
    'Write-UpdaterLog ("Downloading installer " + $asset.name)',
    'Invoke-WebRequest -Uri $asset.browser_download_url -Headers (Get-RequestHeaders) -OutFile $installerPath',
    'Stop-ExistingAgent',
    '$helperPath = Join-Path $updatesDir ("apply-update-" + [guid]::NewGuid().ToString("N") + ".ps1")',
    '$powerShellPath = Join-Path $env:SystemRoot "System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
    "$helperContent = @'",
    '$ErrorActionPreference = "Stop"',
    'Start-Sleep -Seconds 3',
    "$installerPath = '{0}'",
    "$logPath = '{1}'",
    'function Write-HelperLog([string]$message) {',
    '  try {',
    '    $timestamp = (Get-Date).ToString("s")',
    '    Add-Content -Path $logPath -Value "[$timestamp] [apply-update] $message"',
    '  } catch {}',
    '}',
    'Write-HelperLog ("Running silent installer " + $installerPath)',
    '$process = Start-Process -FilePath $installerPath -ArgumentList @("/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART") -WindowStyle Hidden -PassThru -Wait',
    'if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)." }',
    'Write-HelperLog "Update completed successfully."',
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
    "'@ -f ($installerPath -replace \"'\", \"''\"), ($logPath -replace \"'\", \"''\")",
    'Set-Content -Path $helperPath -Value $helperContent -Encoding UTF8',
    'Write-UpdaterLog ("Starting detached update helper " + $helperPath)',
    'Start-Process -FilePath $powerShellPath -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File",$helperPath) -WindowStyle Hidden',
    '',
  ].join("\r\n");

  const postInstallPs1 = [
    '$ErrorActionPreference = "Stop"',
    '$installDir = $PSScriptRoot',
    '$installLogsDir = Join-Path $installDir "logs"',
    '$logPath = Join-Path $installLogsDir "school-services.log"',
    ...createRollingLogFunction("Write-PostInstallLog", "[post-install]"),
    '$programData = $env:ProgramData',
    'if (-not $programData) { $programData = "C:\\ProgramData" }',
    `$appName = '${APP_NAME.replace(/'/g, "''")}'`,
    '$dataDir = Join-Path $programData $appName',
    '$configTargetPath = Join-Path $dataDir "agent.runtime.json"',
    '$legacyConfigCandidates = New-Object System.Collections.Generic.List[string]',
    'function Test-IsAdministrator {',
    '  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
    '  $principal = New-Object Security.Principal.WindowsPrincipal($identity)',
    '  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    '}',
    'function Ensure-Elevated {',
    '  if (Test-IsAdministrator) { return }',
    '  Write-PostInstallLog "Post-install is not elevated. Relaunching with RunAs."',
    '  $powerShellPath = Join-Path $env:SystemRoot "System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
    '  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath)',
    '  $process = Start-Process -FilePath $powerShellPath -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru -Wait',
    '  exit $process.ExitCode',
    '}',
    'function Add-Candidate([string]$candidate) {',
    '  if (-not $candidate) { return }',
    '  if ($legacyConfigCandidates.Contains($candidate)) { return }',
    '  $legacyConfigCandidates.Add($candidate)',
    '}',
    'function Get-LegacyTaskScriptPath {',
    `  $taskName = '${STARTUP_TASK_NAME.replace(/'/g, "''")}'`,
    '  try {',
    '    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue',
    '    if (-not $task) { return $null }',
    '    $action = @($task.Actions | Select-Object -First 1)[0]',
    '    if (-not $action) { return $null }',
    '    $arguments = [string]$action.Arguments',
    '    $match = [regex]::Match($arguments, \'-File\\s+"([^"]+)"\')',
    '    if ($match.Success) { return $match.Groups[1].Value }',
    '  } catch {}',
    '  return $null',
    '}',
    'function Migrate-LegacyConfig {',
    '  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null',
    '  Add-Candidate (Join-Path $installDir "agent.runtime.json")',
    '  Add-Candidate (Join-Path (Split-Path $installDir -Parent) "agent.runtime.json")',
    '  $legacyTaskScriptPath = Get-LegacyTaskScriptPath',
    '  if ($legacyTaskScriptPath) {',
    '    $legacyDistDir = Split-Path $legacyTaskScriptPath -Parent',
    '    Add-Candidate (Join-Path $legacyDistDir "agent.runtime.json")',
    '    Add-Candidate (Join-Path (Split-Path $legacyDistDir -Parent) "agent.runtime.json")',
    '  }',
    '  if (-not (Test-Path $configTargetPath)) {',
    '    foreach ($candidate in $legacyConfigCandidates) {',
    '      if (Test-Path $candidate) {',
    '        Copy-Item -LiteralPath $candidate -Destination $configTargetPath -Force',
    '        break',
    '      }',
    '    }',
    '  }',
    '}',
    'function Remove-LegacyGuestShortcuts {',
    `  $shortcutName = '${LEGACY_GUEST_SHORTCUT_NAME.replace(/'/g, "''")}'`,
    '  $usersRoot = "C:\\Users"',
    '  if (-not (Test-Path $usersRoot)) { return }',
    '  Get-ChildItem -Path $usersRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {',
    '    $desktopPath = Join-Path $_.FullName "Desktop"',
    '    $oneDriveDesktopPath = Join-Path $_.FullName "OneDrive\\Desktop"',
    '    foreach ($candidate in @((Join-Path $desktopPath $shortcutName), (Join-Path $oneDriveDesktopPath $shortcutName))) {',
    '      if (Test-Path $candidate) { Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue }',
    '    }',
    '  }',
    '}',
    ...createFirewallRuleFunctions(),
    'Ensure-Elevated',
    'try {',
    '  Write-PostInstallLog "Post-install started."',
    '  Migrate-LegacyConfig',
    '  Remove-LegacyGuestShortcuts',
    '  Ensure-SilentFirewallAccess $installDir (Join-Path $dataDir "runtime")',
    '  Write-PostInstallLog "Registering startup task."',
    '  & (Join-Path $installDir "register-startup.ps1")',
    '  Write-PostInstallLog "Starting clean agent bootstrap."',
    '  & (Join-Path $installDir "start-agent-clean.ps1")',
    '  Write-PostInstallLog "Post-install completed successfully."',
    '} catch {',
    '  Write-PostInstallLog ("Post-install failed: " + $_.Exception.Message)',
    '  throw',
    '}',
    '',
  ].join("\r\n");

  const uninstallCleanupPs1 = [
    '$ErrorActionPreference = "Continue"',
    `try { Unregister-ScheduledTask -TaskName '${STARTUP_TASK_NAME.replace(/'/g, "''")}' -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch {}`,
    `try { Get-NetFirewallRule -DisplayName '${APP_NAME.replace(/'/g, "''")} *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue } catch {}`,
    '& (Join-Path $PSScriptRoot "stop-agent.ps1")',
    '',
  ].join("\r\n");

  return {
    "register-startup.ps1": registerStartupPs1,
    "stop-agent.ps1": stopAgentPs1,
    "start-agent-clean.ps1": startAgentCleanPs1,
    "watch-agent-log.ps1": watchAgentLogPs1,
    "open-guest-dashboard.ps1": openGuestDashboardPs1,
    "School Services Guest Web.vbs": createSilentPowerShellVbsScript(
      "open-guest-dashboard.ps1"
    ),
    "School Services Start Service.ps1": adminStartServicePs1,
    "School Services Stop Service.ps1": adminStopServicePs1,
    "School Services Restart Service.ps1": adminRestartServicePs1,
    "School Services Start Service.vbs": createElevatedVbsScript(
      "School Services Start Service.ps1"
    ),
    "School Services Stop Service.vbs": createElevatedVbsScript(
      "School Services Stop Service.ps1"
    ),
    "School Services Restart Service.vbs": createElevatedVbsScript(
      "School Services Restart Service.ps1"
    ),
    "update-and-run.ps1": updateAndRunPs1,
    "post-install.ps1": postInstallPs1,
    "uninstall-cleanup.ps1": uninstallCleanupPs1,
  };
}

function main() {
  ensureDirectory(payloadDir);

  const scripts = createPowerShellScripts();
  for (const [fileName, content] of Object.entries(scripts)) {
    writeTextFile(path.join(payloadDir, fileName), content, "utf8");
  }

  writeTextFile(
    runtimeConfigOutputPath,
    `${JSON.stringify(loadPackagedRuntimeConfig(), null, 2)}\n`,
    "utf8"
  );
  writeTextFile(
    buildInfoPath,
    `${JSON.stringify(buildInfoPayload(), null, 2)}\n`,
    "utf8"
  );

  if (fs.existsSync(faviconSourcePath)) {
    fs.copyFileSync(faviconSourcePath, faviconOutputPath);
  }

  console.log(`Wrote installer payload files to ${payloadDir}`);
}

main();
