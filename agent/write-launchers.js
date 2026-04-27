const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const dotenv = require("dotenv");
const packageJson = require("./package.json");

const distDir = path.join(__dirname, "dist");
const repoRoot = path.join(__dirname, "..");
const runtimeConfigOutputPath = path.join(distDir, "agent.runtime.json");

fs.mkdirSync(distDir, { recursive: true });

const vbsPath = path.join(distDir, "run-agent-hidden.vbs");
const adminVbsPath = path.join(distDir, "run-agent-admin-hidden.vbs");
const ps1Path = path.join(distDir, "run-agent-hidden.ps1");
const adminPs1Path = path.join(distDir, "run-agent-admin.ps1");
const stopPs1Path = path.join(distDir, "stop-agent.ps1");
const watchLogPs1Path = path.join(distDir, "watch-agent-log.ps1");
const resetCloudflaredPs1Path = path.join(distDir, "reset-cloudflared.ps1");
const updateAndRunPs1Path = path.join(distDir, "update-and-run.ps1");
const buildInfoPath = path.join(distDir, "agent-build.json");
const legacyShortcutPaths = [
  path.join(distDir, "E-Rapor SD.url"),
  path.join(distDir, "e-Rapor SD.url"),
];

function safeExec(command) {
  try {
    return execSync(command, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch (error) {
    return "";
  }
}

function loadPackagedRuntimeConfig() {
  const envPath = path.join(repoRoot, ".env");
  const runtimeConfigPath = path.join(repoRoot, "agent.runtime.json");
  const envValues = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath, "utf8"))
    : {};
  const runtimeConfig = fs.existsSync(runtimeConfigPath)
    ? JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"))
    : {};

  const packaged = JSON.parse(JSON.stringify(runtimeConfig));
  packaged.supabase = {
    ...(packaged.supabase || {}),
    url:
      envValues.SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      packaged.supabase?.url ||
      "https://fgimyyicixazygairmsa.supabase.co",
    anonKey:
      envValues.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      packaged.supabase?.anonKey ||
      "",
  };

  const eraporEnvPath =
    envValues.ERAPOR_ENV_PATH ||
    process.env.ERAPOR_ENV_PATH ||
    (envValues.ERAPOR_ROOT
      ? path.join(envValues.ERAPOR_ROOT, "wwwroot", ".env")
      : process.env.ERAPOR_ROOT
        ? path.join(process.env.ERAPOR_ROOT, "wwwroot", ".env")
        : "C:\\newappraporsd2025\\wwwroot\\.env");

  if (!packaged.services) {
    packaged.services = {};
  }

  if (!packaged.services.rapor) {
    packaged.services.rapor = {};
  }

  packaged.services.rapor.path = eraporEnvPath;

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
    owner: "Zy0x",
    repo: "School-Services",
  };
}

function parseVersionTag(tag) {
  const match = String(tag || "").trim().match(/^v(\d+)\.(\d+)\.(\d+)$/i);
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

const remoteUrl = safeExec("git remote get-url origin");
const gitCommit = safeExec("git rev-parse HEAD");
const gitBranch = safeExec("git rev-parse --abbrev-ref HEAD") || "main";
const githubRemote = parseGitHubRemote(remoteUrl);
const buildVersionInfo = resolveBuildVersionInfo(gitCommit);
const buildInfo = {
  owner: githubRemote.owner,
  repo: githubRemote.repo,
  branch: gitBranch === "HEAD" ? "main" : gitBranch || "main",
  version: buildVersionInfo.version,
  commit: gitCommit || null,
  releaseChannel: "latest",
  assetName: "e-rapor-agent-win-x64.zip",
  releaseTag: buildVersionInfo.releaseTag,
  builtAt: new Date().toISOString(),
};

const vbsContent = [
  'Set shell = CreateObject("WScript.Shell")',
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  'currentDir = fso.GetParentFolderName(WScript.ScriptFullName)',
  'command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & currentDir & "\\update-and-run.ps1" & Chr(34)',
  'shell.Run command, 0, False',
  "",
].join("\r\n");

const adminVbsContent = [
  'Set shellApp = CreateObject("Shell.Application")',
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  'currentDir = fso.GetParentFolderName(WScript.ScriptFullName)',
  'args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & currentDir & "\\update-and-run.ps1" & Chr(34)',
  'shellApp.ShellExecute "powershell.exe", args, currentDir, "runas", 0',
  "",
].join("\r\n");

const ps1Content = [
  '& (Join-Path $PSScriptRoot "update-and-run.ps1")',
  "",
].join("\r\n");

const adminPs1Content = [
  '$scriptPath = Join-Path $PSScriptRoot "update-and-run.ps1"',
  'Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File",$scriptPath) -Verb RunAs -WindowStyle Hidden',
  "",
].join("\r\n");

const stopPs1Content = [
  '$lockPath = Join-Path $PSScriptRoot ".state\\agent.lock"',
  'if (-not (Test-Path $lockPath)) {',
  '  Write-Host "Agent lock file not found. Nothing to stop."',
  '  exit 0',
  '}',
  '$payload = Get-Content $lockPath -Raw | ConvertFrom-Json',
  'if (-not $payload.pid) {',
  '  Write-Host "Agent lock file is invalid."',
  '  exit 1',
  '}',
  'taskkill /PID $payload.pid /T /F',
  "",
].join("\r\n");

const watchLogPs1Content = [
  '$candidateDirs = @(',
  '  (Join-Path $PSScriptRoot "logs"),',
  '  (Join-Path (Split-Path $PSScriptRoot -Parent) "logs")',
  ')',
  '$latest = $null',
  'foreach ($dir in $candidateDirs) {',
  '  $match = Get-ChildItem -Path $dir -Filter "agent*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1',
  '  if ($match) {',
  '    $latest = $match',
  '    break',
  '  }',
  '}',
  'if ($latest) {',
  '  Get-Content -Path $latest.FullName -Wait',
  '} else {',
  '  Write-Host "No agent log file found yet."',
  '}',
  "",
].join("\r\n");

const resetCloudflaredPs1Content = [
  '$stateDir = Join-Path $PSScriptRoot ".state\\tunnels"',
  'taskkill /F /IM cloudflared.exe /T > $null 2>&1',
  'if (Test-Path $stateDir) {',
  '  Remove-Item -LiteralPath (Join-Path $stateDir "*") -Force -ErrorAction SilentlyContinue',
  '}',
  'Write-Host "Cloudflared processes and tunnel state have been reset."',
  "",
].join("\r\n");

const updateAndRunPs1Content = [
  '$ErrorActionPreference = "Stop"',
  '$distDir = $PSScriptRoot',
  '$agentDir = Split-Path $distDir -Parent',
  '$repoRoot = Split-Path $agentDir -Parent',
  '$exePath = Join-Path $distDir "e-rapor-agent.exe"',
  '$buildInfoPath = Join-Path $distDir "agent-build.json"',
  '$logDir = Join-Path $distDir "logs"',
  '$logPath = Join-Path $logDir "updater.log"',
  'if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }',
  'function Write-UpdaterLog([string]$message) {',
  '  $timestamp = (Get-Date).ToString("s")',
  '  Add-Content -Path $logPath -Value "[$timestamp] $message"',
  '}',
  'function Stop-AgentProcess {',
  '  $lockPath = Join-Path $distDir ".state\\agent.lock"',
  '  if (-not (Test-Path $lockPath)) { return }',
  '  try {',
  '    $payload = Get-Content $lockPath -Raw | ConvertFrom-Json',
  '    if ($payload.pid) { taskkill /PID $payload.pid /T /F *> $null }',
  '  } catch {',
  '    Write-UpdaterLog "Failed to stop previous agent from lock file: $($_.Exception.Message)"',
  '  }',
  '}',
  'function Get-BuildInfo {',
  '  if (-not (Test-Path $buildInfoPath)) { return $null }',
  '  try { return Get-Content $buildInfoPath -Raw | ConvertFrom-Json } catch { return $null }',
  '}',
  'function Save-BuildInfo($buildInfo) {',
  '  $buildInfo | ConvertTo-Json -Depth 5 | Set-Content -Path $buildInfoPath -Encoding UTF8',
  '}',
  'function Set-BuildInfoValue($buildInfo, [string]$name, $value) {',
  '  $property = $buildInfo.PSObject.Properties[$name]',
  '  if ($property) {',
  '    $property.Value = $value',
  '    return',
  '  }',
  '  $buildInfo | Add-Member -NotePropertyName $name -NotePropertyValue $value',
  '}',
  'function Get-RequestHeaders {',
  '  $headers = @{ "User-Agent" = "e-rapor-agent-updater" }',
  '  $token = $env:GITHUB_TOKEN',
  '  if (-not $token) { $token = $env:GH_TOKEN }',
  '  if ($token) { $headers["Authorization"] = "Bearer $token" }',
  '  return $headers',
  '}',
  'function Normalize-VersionToken([string]$value) {',
  '  if (-not $value) { return "" }',
  '  $normalized = $value.Trim()',
  '  if ($normalized.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) {',
  '    $normalized = $normalized.Substring(1)',
  '  }',
  '  return $normalized.ToLowerInvariant()',
  '}',
  'function Get-ReleaseVersion([object]$release) {',
  '  return Normalize-VersionToken([string]$release.tag_name)',
  '}',
  'function Start-AgentDeferred {',
  '  $launcherPath = Join-Path ([System.IO.Path]::GetTempPath()) ("e-rapor-agent-relaunch-" + [guid]::NewGuid().ToString("N") + ".ps1")',
  "  $launcherContent = @'",
  'Start-Sleep -Seconds 2',
  "$exePath = '{0}'",
  "$workingDir = '{1}'",
  'Start-Process -FilePath $exePath -WorkingDirectory $workingDir -WindowStyle Hidden',
  'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
  "'@ -f ($exePath -replace \"'\", \"''\"), ($distDir -replace \"'\", \"''\")",
  '  Set-Content -Path $launcherPath -Value $launcherContent -Encoding UTF8',
  '  Write-UpdaterLog "Starting deferred relaunch helper."',
  '  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File",$launcherPath) -WindowStyle Hidden',
  '}',
  'function Start-AgentNow {',
  '  Write-UpdaterLog "Starting agent immediately."',
  '  Start-Process -FilePath $exePath -WorkingDirectory $distDir -WindowStyle Hidden',
  '}',
  'function Invoke-Robocopy($source, $destination) {',
  '  & robocopy $source $destination /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XF "agent.runtime.json" "agent-build.json" | Out-Null',
  '  $code = $LASTEXITCODE',
  '  if ($code -gt 7) { throw "robocopy failed with exit code $code" }',
  '}',
  'function Get-LatestRelease {',
  '  $buildInfo = Get-BuildInfo',
  `  $owner = "${buildInfo.owner}"`,
  `  $repo = "${buildInfo.repo}"`,
  `  $releaseChannel = "${buildInfo.releaseChannel}"`,
  '  $headers = Get-RequestHeaders',
  '  if ($releaseChannel -eq "latest") {',
  '    return Invoke-RestMethod -Uri ("https://api.github.com/repos/$owner/$repo/releases/latest") -Headers $headers',
  '  }',
  '  return Invoke-RestMethod -Uri ("https://api.github.com/repos/$owner/$repo/releases/tags/" + $releaseChannel) -Headers $headers',
  '}',
  'function Update-FromRelease {',
  '  $buildInfo = Get-BuildInfo',
  '  if (-not $buildInfo) { throw "agent-build.json is missing or invalid." }',
  '  $release = Get-LatestRelease',
  '  $releaseTag = [string]$release.tag_name',
  '  $releaseVersion = Get-ReleaseVersion $release',
  '  $currentReleaseTag = [string]$buildInfo.releaseTag',
  '  if (-not $currentReleaseTag -and $buildInfo.version) { $currentReleaseTag = "v" + [string]$buildInfo.version }',
  '  $currentVersion = Normalize-VersionToken([string]$buildInfo.version)',
  '  $currentReleaseVersion = Normalize-VersionToken($currentReleaseTag)',
  '  if (($currentReleaseTag -and $currentReleaseTag -eq $releaseTag) -or ($currentVersion -and $releaseVersion -and $currentVersion -eq $releaseVersion) -or ($currentReleaseVersion -and $releaseVersion -and $currentReleaseVersion -eq $releaseVersion)) {',
  '    Write-UpdaterLog ("Agent already latest. currentVersion={0}; currentReleaseTag={1}; latestReleaseTag={2}" -f $currentVersion, $currentReleaseTag, $releaseTag)',
  '    return $false',
  '  }',
  '  $assetName = [string]$buildInfo.assetName',
  '  $asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1',
  '  if (-not $asset) {',
  '    throw "Release $releaseTag does not contain asset $assetName."',
  '  }',
  '  Write-UpdaterLog "Updating agent from release $currentReleaseTag to $releaseTag using asset $assetName"',
  '  Stop-AgentProcess',
  '  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("e-rapor-update-" + [guid]::NewGuid().ToString("N"))',
  '  $zipPath = Join-Path $tempRoot $asset.name',
  '  $extractPath = Join-Path $tempRoot "extract"',
  '  $headers = Get-RequestHeaders',
  '  New-Item -ItemType Directory -Path $extractPath -Force | Out-Null',
  '  Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $zipPath',
  '  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force',
  '  $packageRoot = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1',
  '  if (-not $packageRoot) { $packageRoot = $extractPath }',
  '  $packageDist = Join-Path $packageRoot "dist"',
  '  if (-not (Test-Path $packageDist)) { $packageDist = $packageRoot }',
  '  if (-not (Test-Path (Join-Path $packageDist "e-rapor-agent.exe"))) {',
  '    throw "Downloaded package does not contain e-rapor-agent.exe."',
  '  }',
  '  Invoke-Robocopy $packageDist $distDir',
  '  Set-BuildInfoValue $buildInfo "releaseTag" $releaseTag',
  '  Set-BuildInfoValue $buildInfo "version" $releaseVersion',
  '  $nextCommit = $buildInfo.commit',
  '  if ($release.target_commitish) { $nextCommit = [string]$release.target_commitish }',
  '  Set-BuildInfoValue $buildInfo "commit" $nextCommit',
  '  Set-BuildInfoValue $buildInfo "builtAt" ((Get-Date).ToString("o"))',
  '  Save-BuildInfo $buildInfo',
  '  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue',
  '  Write-UpdaterLog "Agent updated successfully to release $releaseTag"',
  '  return $true',
  '}',
  '$didUpdate = $false',
  'try {',
  '  $didUpdate = Update-FromRelease',
  '} catch {',
  '  Write-UpdaterLog "Auto-update failed: $($_.Exception.Message)"',
  '}',
  'if ($didUpdate) {',
  '  Start-AgentDeferred',
  '} else {',
  '  Start-AgentNow',
  '}',
  "",
].join("\r\n");

fs.writeFileSync(vbsPath, vbsContent, "ascii");
fs.writeFileSync(adminVbsPath, adminVbsContent, "ascii");
fs.writeFileSync(ps1Path, ps1Content, "ascii");
fs.writeFileSync(adminPs1Path, adminPs1Content, "ascii");
fs.writeFileSync(stopPs1Path, stopPs1Content, "ascii");
fs.writeFileSync(watchLogPs1Path, watchLogPs1Content, "ascii");
fs.writeFileSync(resetCloudflaredPs1Path, resetCloudflaredPs1Content, "ascii");
fs.writeFileSync(updateAndRunPs1Path, updateAndRunPs1Content, "utf8");
fs.writeFileSync(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");
fs.writeFileSync(
  runtimeConfigOutputPath,
  `${JSON.stringify(loadPackagedRuntimeConfig(), null, 2)}\n`,
  "utf8"
);

for (const legacyPath of legacyShortcutPaths) {
  try {
    if (fs.existsSync(legacyPath)) {
      fs.unlinkSync(legacyPath);
    }
  } catch (error) {
    // Best-effort cleanup for old shortcut artifacts in dist.
  }
}

console.log(`Wrote launcher files to ${distDir}`);
