const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { AGENT_EXE_NAME } = require("./appConstants");
const { getAgentExePath, getInstallDir } = require("./paths");
const { getPowerShellPath } = require("./windows");
const { sleep } = require("./utils");
const { getLockedAgentPid } = require("./supervisorState");

const PROCESS_TIMEOUT_MS = 60000;

function runPowerShellCapture(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      getPowerShellPath(),
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || code === null) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `PowerShell exited with code ${code}.`));
    });
  });
}

async function isPidAlive(pid) {
  if (!pid) {
    return false;
  }
  const script = `$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if ($p) { "true" } else { "false" }`;
  const stdout = await runPowerShellCapture(script);
  return stdout.trim().toLowerCase() === "true";
}

async function listAgentProcesses() {
  const escapedName = AGENT_EXE_NAME.replace(/'/g, "''");
  const script = [
    `$items = @(Get-CimInstance Win32_Process -Filter "Name = '${escapedName}'" -ErrorAction SilentlyContinue | Select-Object ProcessId, Name, ExecutablePath, CommandLine)`,
    "if ($items.Count -eq 0) { '[]' } else { $items | ConvertTo-Json -Compress }",
  ].join("; ");
  const stdout = await runPowerShellCapture(script);
  if (!stdout) {
    return [];
  }
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function isAgentRunning() {
  const lockedPid = getLockedAgentPid();
  if (lockedPid && (await isPidAlive(lockedPid))) {
    return true;
  }
  const processes = await listAgentProcesses();
  return processes.length > 0;
}

function startAgentProcess() {
  const agentPath = getAgentExePath();
  if (!fs.existsSync(agentPath) && process.pkg) {
    throw new Error(`Agent executable not found: ${agentPath}`);
  }
  const entryPath = process.pkg ? agentPath : path.join(__dirname, "index.js");
  const child = process.pkg
    ? spawn(entryPath, [], {
        cwd: getInstallDir(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      })
    : spawn(process.execPath, [entryPath], {
        cwd: getInstallDir(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
  child.unref();
  return child.pid || null;
}

async function stopAgentProcess() {
  const pids = new Set();
  const lockedPid = getLockedAgentPid();
  if (lockedPid) {
    pids.add(lockedPid);
  }
  for (const item of await listAgentProcesses()) {
    const pid = Number(item.ProcessId);
    if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
      pids.add(pid);
    }
  }
  if (!pids.size) {
    return;
  }
  const pidList = Array.from(pids)
    .filter((pid) => Number.isFinite(pid) && pid > 0)
    .join(",");
  const script = [
    `$pids = @(${pidList})`,
    "$taskkill = Join-Path $env:SystemRoot 'System32\\taskkill.exe'",
    "$errors = New-Object System.Collections.Generic.List[string]",
    "foreach ($targetPid in $pids) {",
    "  try {",
    "    Stop-Process -Id $targetPid -Force -ErrorAction Stop",
    "  } catch {",
    "    $errors.Add(\"Stop-Process PID ${targetPid}: $($_.Exception.Message)\") | Out-Null",
    "  }",
    "}",
    "Start-Sleep -Milliseconds 900",
    "$remaining = @($pids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })",
    "foreach ($targetPid in $remaining) {",
    "  try {",
    "    & $taskkill /PID $targetPid /T /F | Out-Null",
    "    if ($LASTEXITCODE -ne 0) { $errors.Add(\"taskkill PID $targetPid exited with code $LASTEXITCODE\") | Out-Null }",
    "  } catch {",
    "    $errors.Add(\"taskkill PID ${targetPid}: $($_.Exception.Message)\") | Out-Null",
    "  }",
    "}",
    "Start-Sleep -Milliseconds 900",
    "$stillRunning = @($pids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })",
    "if ($stillRunning.Count -gt 0) {",
    "  $detail = if ($errors.Count -gt 0) { $errors -join '; ' } else { 'no process termination error was reported' }",
    "  throw \"Agent PID(s) still running after stop attempts: $($stillRunning -join ', '). $detail\"",
    "}",
  ].join("\n");

  await runPowerShellCapture(script);
}

async function waitForAgentStopped(timeoutMs = PROCESS_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isAgentRunning())) {
      return true;
    }
    await sleep(1000);
  }
  return false;
}

async function waitForAgentStarted(timeoutMs = PROCESS_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAgentRunning()) {
      return true;
    }
    await sleep(1000);
  }
  return false;
}

async function runUpdateScript() {
  const updateScriptPath = path.join(getInstallDir(), "update-and-run.ps1");
  if (!fs.existsSync(updateScriptPath)) {
    throw new Error(`Update script not found: ${updateScriptPath}`);
  }
  const child = spawn(
    getPowerShellPath(),
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", updateScriptPath],
    {
      cwd: getInstallDir(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }
  );
  child.unref();
}

async function runInstalledStopCleanup() {
  const stopScriptPath = path.join(getInstallDir(), "stop-agent.ps1");
  if (!fs.existsSync(stopScriptPath)) {
    return;
  }

  await runPowerShellCapture(
    `& '${stopScriptPath.replace(/'/g, "''")}'`
  );
}

module.exports = {
  isAgentRunning,
  isPidAlive,
  listAgentProcesses,
  runInstalledStopCleanup,
  runPowerShellCapture,
  runUpdateScript,
  startAgentProcess,
  stopAgentProcess,
  waitForAgentStarted,
  waitForAgentStopped,
};
