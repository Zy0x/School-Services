const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function getExistingProcessInfo(pid) {
  const script = [
    `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" -ErrorAction SilentlyContinue`,
    "if ($process) {",
    "  [pscustomobject]@{",
    "    ProcessId = $process.ProcessId",
    "    Name = $process.Name",
    "    ExecutablePath = $process.ExecutablePath",
    "    CommandLine = $process.CommandLine",
    "  } | ConvertTo-Json -Compress",
    "}",
  ].join("; ");
  const result = spawnSync(
    path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    ),
    ["-NoProfile", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
    }
  );

  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return null;
  }
}

function looksLikeSameAgent(processInfo) {
  if (!processInfo) {
    return true;
  }

  const executablePath = String(processInfo.ExecutablePath || "").toLowerCase();
  const commandLine = String(processInfo.CommandLine || "").toLowerCase();
  const currentExecPath = String(process.execPath || "").toLowerCase();
  const currentEntry = String(process.argv[1] || "").toLowerCase();

  if (process.pkg) {
    return executablePath === currentExecPath;
  }

  return (
    executablePath.endsWith("\\node.exe") &&
    currentEntry &&
    commandLine.includes(currentEntry)
  );
}

function terminateExistingInstance(pid) {
  const taskkill = spawnSync(
    "cmd.exe",
    ["/c", `taskkill /PID ${Number(pid)} /T /F`],
    {
      encoding: "utf8",
      windowsHide: true,
    }
  );

  if (taskkill.status !== 0 && isPidAlive(pid)) {
    const message = taskkill.stderr || taskkill.stdout || "taskkill failed";
    throw new Error(`Failed to stop previous agent process ${pid}: ${message.trim()}`);
  }

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return;
    }

    sleepSync(200);
  }

  throw new Error(`Previous agent process ${pid} did not exit within timeout.`);
}

function acquireProcessLock(lockPath) {
  ensureParentDirectory(lockPath);

  if (fs.existsSync(lockPath)) {
    try {
      const payload = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (payload?.pid && payload.pid !== process.pid && isPidAlive(payload.pid)) {
        const processInfo = getExistingProcessInfo(payload.pid);
        if (!looksLikeSameAgent(processInfo)) {
          throw new Error(
            `Lock file points to PID ${payload.pid}, but that process does not match this agent runtime.`
          );
        }

        console.log(
          `[processLock] Stopping previous agent instance PID ${payload.pid} before starting the new one.`
        );
        terminateExistingInstance(payload.pid);
      }
    } catch (error) {
      if (
        error.message.startsWith("Failed to stop previous agent process") ||
        error.message.includes("does not match this agent runtime")
      ) {
        throw error;
      }
    }
  }

  fs.writeFileSync(
    lockPath,
    `${JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        execPath: process.execPath,
        argv: process.argv,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function releaseProcessLock(lockPath) {
  if (!lockPath || !fs.existsSync(lockPath)) {
    return;
  }

  try {
    const payload = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (payload?.pid && payload.pid !== process.pid) {
      return;
    }
  } catch (error) {
    // Ignore malformed lock payloads and remove the file.
  }

  fs.unlinkSync(lockPath);
}

module.exports = {
  acquireProcessLock,
  releaseProcessLock,
};
