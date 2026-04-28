#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const TASK_NAME = "School Services Agent Startup";
const TASK_DESCRIPTION =
  "Starts School Services agent automatically at system startup with highest privileges.";

function getDistDir() {
  return process.pkg ? path.dirname(process.execPath) : path.join(__dirname, "dist");
}

function getPowerShellPath() {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
}

function escapePowerShellSingleQuotedString(value) {
  return String(value || "").replace(/'/g, "''");
}

function runPowerShellScript(script, { hidden = true } = {}) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass"];
  if (hidden) {
    args.push("-WindowStyle", "Hidden");
  }
  args.push("-Command", script);

  const result = spawnSync(getPowerShellPath(), args, {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new Error(stderr || stdout || "PowerShell command failed.");
  }

  return String(result.stdout || "").trim();
}

function runPowerShellFile(filePath, { hidden = true } = {}) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass"];
  if (hidden) {
    args.push("-WindowStyle", "Hidden");
  }
  args.push("-File", filePath);

  const result = spawnSync(getPowerShellPath(), args, {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new Error(stderr || stdout || `Failed to run ${filePath}`);
  }
}

function isProcessElevated() {
  const output = runPowerShellScript(
    [
      "$identity = [Security.Principal.WindowsIdentity]::GetCurrent()",
      "$principal = New-Object Security.Principal.WindowsPrincipal($identity)",
      "Write-Output ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))",
    ].join("; "),
    { hidden: true }
  );

  return String(output).trim().toLowerCase() === "true";
}

function relaunchElevated() {
  const currentExe = process.execPath;
  const script = [
    `$exe = '${escapePowerShellSingleQuotedString(currentExe)}'`,
    `$args = @('--elevated')`,
    "Start-Process -FilePath $exe -ArgumentList $args -Verb RunAs -WindowStyle Normal",
  ].join("; ");

  runPowerShellScript(script, { hidden: false });
}

function ensureRequiredFiles(distDir) {
  const requiredFiles = [
    path.join(distDir, "e-rapor-agent.exe"),
    path.join(distDir, "start-agent-clean.ps1"),
    path.join(distDir, "update-and-run.ps1"),
  ];

  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Required file not found: ${filePath}`);
    }
  }
}

function registerStartupTask(distDir) {
  const startScriptPath = path.join(distDir, "start-agent-clean.ps1");
  const powerShellPath = getPowerShellPath();
  const script = [
    `$taskName = '${escapePowerShellSingleQuotedString(TASK_NAME)}'`,
    `$description = '${escapePowerShellSingleQuotedString(TASK_DESCRIPTION)}'`,
    `$powerShellPath = '${escapePowerShellSingleQuotedString(powerShellPath)}'`,
    `$startScriptPath = '${escapePowerShellSingleQuotedString(startScriptPath)}'`,
    "$argument = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $startScriptPath + '\"'",
    "$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $argument",
    "$trigger = New-ScheduledTaskTrigger -AtStartup",
    "$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest",
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable",
    "if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }",
    "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $description -Force | Out-Null",
  ].join("; ");

  runPowerShellScript(script, { hidden: true });
}

function startCleanAgent(distDir) {
  const startScriptPath = path.join(distDir, "start-agent-clean.ps1");
  runPowerShellFile(startScriptPath, { hidden: true });
}

function main() {
  const elevatedFlag = process.argv.includes("--elevated");

  if (!elevatedFlag && !isProcessElevated()) {
    relaunchElevated();
    return;
  }

  const distDir = getDistDir();
  ensureRequiredFiles(distDir);
  registerStartupTask(distDir);
  startCleanAgent(distDir);
  process.stdout.write(
    `Startup task "${TASK_NAME}" installed for system startup and School Services agent started cleanly.\n`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

module.exports = {
  TASK_DESCRIPTION,
  TASK_NAME,
};
