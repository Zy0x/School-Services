const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const distDir = path.join(__dirname, "dist");

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
      cwd: path.join(__dirname, ".."),
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch (error) {
    return "";
  }
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

const remoteUrl = safeExec("git remote get-url origin");
const gitCommit = safeExec("git rev-parse HEAD");
const gitBranch = safeExec("git rev-parse --abbrev-ref HEAD") || "main";
const githubRemote = parseGitHubRemote(remoteUrl);
const buildInfo = {
  owner: githubRemote.owner,
  repo: githubRemote.repo,
  branch: gitBranch === "HEAD" ? "main" : gitBranch || "main",
  commit: gitCommit || null,
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
  'function Get-RequestHeaders {',
  '  $headers = @{ "User-Agent" = "e-rapor-agent-updater" }',
  '  $token = $env:GITHUB_TOKEN',
  '  if (-not $token) { $token = $env:GH_TOKEN }',
  '  if ($token) { $headers["Authorization"] = "Bearer $token" }',
  '  return $headers',
  '}',
  'function Invoke-Robocopy($source, $destination) {',
  '  & robocopy $source $destination /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD ".git" "node_modules" "dist" ".state" ".temp" | Out-Null',
  '  $code = $LASTEXITCODE',
  '  if ($code -gt 7) { throw "robocopy failed with exit code $code" }',
  '}',
  'function Update-FromGit {',
  '  $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue',
  '  if (-not $gitCommand) { return $null }',
  '  if (-not (Test-Path (Join-Path $repoRoot ".git"))) { return $null }',
  '  $buildInfo = Get-BuildInfo',
  `  $branch = "${buildInfo.branch}"`,
  '  Push-Location $repoRoot',
  '  try {',
  '    & $gitCommand.Source fetch origin $branch --quiet',
  '    if ($LASTEXITCODE -ne 0) { throw "git fetch failed with exit code $LASTEXITCODE" }',
  '    $localCommit = (& $gitCommand.Source rev-parse HEAD).Trim()',
  '    $remoteCommit = (& $gitCommand.Source rev-parse ("origin/" + $branch)).Trim()',
  '    if ($localCommit -and $localCommit -eq $remoteCommit) {',
  '      Write-UpdaterLog "Agent source is already on latest git commit $remoteCommit"',
  '      return $false',
  '    }',
  '    Write-UpdaterLog "Updating agent from git commit $localCommit to $remoteCommit"',
  '    Stop-AgentProcess',
  '    & $gitCommand.Source pull --ff-only origin $branch | Out-Null',
  '    if ($LASTEXITCODE -ne 0) { throw "git pull failed with exit code $LASTEXITCODE" }',
  '    & npm.cmd install | Out-Null',
  '    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }',
  '    & npm.cmd --workspace agent run build | Out-Null',
  '    if ($LASTEXITCODE -ne 0) { throw "agent build failed with exit code $LASTEXITCODE" }',
  '    Write-UpdaterLog "Agent updated successfully from git to $remoteCommit"',
  '    return $true',
  '  } finally {',
  '    Pop-Location',
  '  }',
  '}',
  'function Update-FromGitHub {',
  '  $buildInfo = Get-BuildInfo',
  `  $owner = "${buildInfo.owner}"`,
  `  $repo = "${buildInfo.repo}"`,
  `  $branch = "${buildInfo.branch}"`,
  '  $headers = Get-RequestHeaders',
  '  $commitUrl = "https://api.github.com/repos/$owner/$repo/commits/$branch"',
  '  $remote = Invoke-RestMethod -Uri $commitUrl -Headers $headers',
  '  $remoteCommit = [string]$remote.sha',
  '  $localCommit = if ($buildInfo) { [string]$buildInfo.commit } else { "" }',
  '  if ($localCommit -and $localCommit -eq $remoteCommit) {',
  '    Write-UpdaterLog "Agent is already on latest commit $remoteCommit"',
  '    return $false',
  '  }',
  '  Write-UpdaterLog "Updating agent from $localCommit to $remoteCommit"',
  '  Stop-AgentProcess',
  '  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("e-rapor-update-" + [guid]::NewGuid().ToString("N"))',
  '  $zipPath = Join-Path $tempRoot "source.zip"',
  '  $extractPath = Join-Path $tempRoot "extract"',
  '  New-Item -ItemType Directory -Path $extractPath -Force | Out-Null',
  '  $archiveUrl = "https://codeload.github.com/$owner/$repo/zip/refs/heads/$branch"',
  '  Invoke-WebRequest -Uri $archiveUrl -Headers $headers -OutFile $zipPath',
  '  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force',
  '  $sourceRoot = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1',
  '  if (-not $sourceRoot) { throw "Downloaded archive did not contain a source directory." }',
  '  Invoke-Robocopy $sourceRoot.FullName $repoRoot',
  '  Push-Location $repoRoot',
  '  try {',
  '    & npm.cmd install | Out-Null',
  '    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }',
  '    & npm.cmd --workspace agent run build | Out-Null',
  '    if ($LASTEXITCODE -ne 0) { throw "agent build failed with exit code $LASTEXITCODE" }',
  '  } finally {',
  '    Pop-Location',
  '  }',
  '  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue',
  '  Write-UpdaterLog "Agent updated successfully to $remoteCommit"',
  '  return $true',
  '}',
  'try {',
  '  if ((Test-Path (Join-Path $repoRoot "package.json")) -and (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {',
  '    $gitUpdateResult = Update-FromGit',
  '    if ($gitUpdateResult -eq $null) {',
  '      Update-FromGitHub | Out-Null',
  '    }',
  '  } else {',
  '    Write-UpdaterLog "Skipping auto-update because local repo or npm was not available."',
  '  }',
  '} catch {',
  '  Write-UpdaterLog "Auto-update failed: $($_.Exception.Message)"',
  '}',
  'Start-Process -FilePath $exePath -WorkingDirectory $distDir -WindowStyle Hidden',
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
