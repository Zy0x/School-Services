const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

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

function spawnPowerShellFile(filePath, extraArgs = [], { hidden = true } = {}) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass"];
  if (hidden) {
    args.push("-WindowStyle", "Hidden");
  }
  args.push("-File", filePath, ...extraArgs);

  const child = spawn(getPowerShellPath(), args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
  return child;
}

function startDetachedHidden(filePath, argumentList = [], workingDirectory = null) {
  const args = argumentList
    .map((value) => `'${escapePowerShellSingleQuotedString(value)}'`)
    .join(", ");
  const script = [
    `$filePath = '${escapePowerShellSingleQuotedString(filePath)}'`,
    `$argumentList = @(${args})`,
    workingDirectory
      ? `$workingDirectory = '${escapePowerShellSingleQuotedString(workingDirectory)}'`
      : "$workingDirectory = $null",
    "Start-Process -FilePath $filePath -ArgumentList $argumentList -WorkingDirectory $workingDirectory -WindowStyle Hidden",
  ].join("; ");

  runPowerShellScript(script, { hidden: true });
}

function startUrlInBrowser(url) {
  const script = `Start-Process '${escapePowerShellSingleQuotedString(url)}'`;
  runPowerShellScript(script, { hidden: true });
}

function fileExists(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath);
  } catch (_error) {
    return false;
  }
}

module.exports = {
  escapePowerShellSingleQuotedString,
  fileExists,
  getPowerShellPath,
  runPowerShellScript,
  spawnPowerShellFile,
  startDetachedHidden,
  startUrlInBrowser,
};
