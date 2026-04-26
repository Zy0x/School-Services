const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "dist");

fs.mkdirSync(distDir, { recursive: true });

const vbsPath = path.join(distDir, "run-agent-hidden.vbs");
const adminVbsPath = path.join(distDir, "run-agent-admin-hidden.vbs");
const ps1Path = path.join(distDir, "run-agent-hidden.ps1");
const adminPs1Path = path.join(distDir, "run-agent-admin.ps1");
const stopPs1Path = path.join(distDir, "stop-agent.ps1");
const watchLogPs1Path = path.join(distDir, "watch-agent-log.ps1");
const resetCloudflaredPs1Path = path.join(distDir, "reset-cloudflared.ps1");

const vbsContent = [
  'Set shell = CreateObject("WScript.Shell")',
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  'currentDir = fso.GetParentFolderName(WScript.ScriptFullName)',
  'shell.Run Chr(34) & currentDir & "\\e-rapor-agent.exe" & Chr(34), 0, False',
  "",
].join("\r\n");

const adminVbsContent = [
  'Set shellApp = CreateObject("Shell.Application")',
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  'currentDir = fso.GetParentFolderName(WScript.ScriptFullName)',
  'shellApp.ShellExecute currentDir & "\\e-rapor-agent.exe", "", currentDir, "runas", 0',
  "",
].join("\r\n");

const ps1Content = [
  '$exePath = Join-Path $PSScriptRoot "e-rapor-agent.exe"',
  'Start-Process -FilePath $exePath -WindowStyle Hidden',
  "",
].join("\r\n");

const adminPs1Content = [
  '$exePath = Join-Path $PSScriptRoot "e-rapor-agent.exe"',
  'Start-Process -FilePath $exePath -Verb RunAs -WindowStyle Hidden',
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

fs.writeFileSync(vbsPath, vbsContent, "ascii");
fs.writeFileSync(adminVbsPath, adminVbsContent, "ascii");
fs.writeFileSync(ps1Path, ps1Content, "ascii");
fs.writeFileSync(adminPs1Path, adminPs1Content, "ascii");
fs.writeFileSync(stopPs1Path, stopPs1Content, "ascii");
fs.writeFileSync(watchLogPs1Path, watchLogPs1Content, "ascii");
fs.writeFileSync(resetCloudflaredPs1Path, resetCloudflaredPs1Content, "ascii");

console.log(`Wrote launcher files to ${distDir}`);
