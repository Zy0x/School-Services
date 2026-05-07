#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { AGENT_EXE_NAME } = require("./appConstants");
const { CommandProgress } = require("./commandProgress");
const { loadConfig } = require("./config");
const { createDeviceMetadata } = require("./device");
const logger = require("./logger");
const {
  getAgentExePath,
  getInstallDir,
  getStateDir,
} = require("./paths");
const { createSupabaseApi } = require("./supabase");
const { getPowerShellPath } = require("./windows");
const { sleep } = require("./utils");
const SelfUpdater = require("./selfUpdater");

const SUPERVISOR_POLL_MS = 2000;
const PROCESS_TIMEOUT_MS = 60000;
const HEARTBEAT_TIMEOUT_MS = 120000;
const SERVICE_RESTORE_TIMEOUT_MS = 180000;
const SERVICE_RESTORE_POLL_MS = 3000;
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const COMMAND_STALE_MS = 5 * 60 * 1000;
const SUPERVISOR_ACTIONS = new Set(["agent_start", "agent_stop", "agent_restart", "update"]);

function writeBootstrapLog(message) {
  const line = `[${new Date().toISOString()}] [supervisor-bootstrap] ${message}\n`;
  const candidates = [
    path.join(process.env.ProgramData || "C:\\ProgramData", "School Services", "logs", "school-services.log"),
    path.join(getInstallDir(), "logs", "school-services.log"),
  ];

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(path.dirname(candidate), { recursive: true });
      fs.appendFileSync(candidate, line, "utf8");
      return;
    } catch (_error) {
      // Try the next location.
    }
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function getAgentLockPath() {
  return path.join(getStateDir(), "agent.lock");
}

function getSupervisorStatePath() {
  return path.join(getStateDir(), "supervisor-state.json");
}

function readSupervisorState() {
  return readJsonFile(getSupervisorStatePath()) || { desiredAgentState: "running" };
}

function writeSupervisorState(patch) {
  const statePath = getSupervisorStatePath();
  const next = {
    ...readSupervisorState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function getDesiredAgentState() {
  const value = String(readSupervisorState().desiredAgentState || "running").toLowerCase();
  return value === "stopped" ? "stopped" : "running";
}

function getLockedAgentPid() {
  const lock = readJsonFile(getAgentLockPath());
  const pid = Number(lock?.pid);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function normalizeTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function shouldClaimCommand(command) {
  if (command.status === "pending") {
    return true;
  }
  if (command.claimed_by === "supervisor" || command.claimed_by === "school-services-supervisor") {
    return true;
  }
  return Date.now() - normalizeTime(command.updated_at || command.started_at) > COMMAND_STALE_MS;
}

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

async function waitForHeartbeat(supabaseApi, deviceId, afterMs, timeoutMs = HEARTBEAT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastDevice = null;
  while (Date.now() < deadline) {
    lastDevice = await supabaseApi.fetchDevice(deviceId);
    const lastSeenMs = normalizeTime(lastDevice?.last_seen);
    if (lastSeenMs >= afterMs) {
      return lastDevice;
    }
    await sleep(2500);
  }
  throw new Error(`Timeout menunggu heartbeat agent baru. Last seen terakhir: ${lastDevice?.last_seen || "unknown"}.`);
}

function hasVersionChanged(before, after) {
  return Boolean(
    after &&
      (String(before?.app_version || "") !== String(after.app_version || "") ||
        String(before?.release_tag || "") !== String(after.release_tag || "") ||
        String(before?.build_commit || "") !== String(after.build_commit || ""))
  );
}

function normalizeServiceLabel(row) {
  return String(row?.service_name || row?.serviceName || "service");
}

function isSkippableServiceRestore(row) {
  const status = String(row?.status || "").toLowerCase();
  const desiredState = String(row?.desired_state || row?.desiredState || "").toLowerCase();
  const locationStatus = String(row?.location_status || row?.locationStatus || "").toLowerCase();
  const lastError = String(row?.last_error || row?.lastError || row?.tunnel_last_error || row?.tunnelLastError || "").toLowerCase();

  if (desiredState === "stopped" || status === "stopped" || status === "blocked") {
    return true;
  }
  if (["missing", "partial"].includes(locationStatus)) {
    return true;
  }
  return /not installed|no matching|requires administrator|requires elevation|missing|config|konfigurasi|lokasi|path/.test(lastError);
}

function isServiceLinkReady(row) {
  const status = String(row?.status || "").toLowerCase();
  const desiredState = String(row?.desired_state || row?.desiredState || "").toLowerCase();
  const publicUrl = String(row?.public_url || row?.publicUrl || "").trim();
  const tunnelState = String(row?.tunnel_state || row?.tunnelState || "").toLowerCase();

  if (desiredState !== "running") {
    return false;
  }
  if (status !== "running" || !publicUrl) {
    return false;
  }
  return !tunnelState || tunnelState === "running";
}

function isFreshServiceRow(row, afterMs) {
  if (!afterMs) {
    return true;
  }
  return normalizeTime(row?.last_ping || row?.lastPing || row?.updated_at || row?.updatedAt) >= afterMs;
}

function summarizeServiceRestore(rows, afterMs = 0) {
  const ready = [];
  const pending = [];
  const skipped = [];

  for (const row of rows || []) {
    const label = normalizeServiceLabel(row);
    const desiredState = String(row?.desired_state || row?.desiredState || "").toLowerCase();
    const status = String(row?.status || "").toLowerCase();
    const fresh = isFreshServiceRow(row, afterMs);

    if ((desiredState === "stopped" || status === "blocked" || (status === "stopped" && desiredState !== "running")) && !fresh) {
      skipped.push(label);
    } else if (!fresh) {
      pending.push(label);
    } else if (isServiceLinkReady(row)) {
      ready.push(label);
    } else if (isSkippableServiceRestore(row)) {
      skipped.push(label);
    } else {
      pending.push(label);
    }
  }

  return { ready, pending, skipped };
}

async function waitForServicesRestored(supabaseApi, deviceId, progress, startPercent = 78, afterMs = 0) {
  const deadline = Date.now() + SERVICE_RESTORE_TIMEOUT_MS;
  let lastRows = [];
  let lastSummary = { ready: [], pending: [], skipped: [] };

  while (Date.now() < deadline) {
    lastRows = await supabaseApi.fetchServiceStates(deviceId);
    lastSummary = summarizeServiceRestore(lastRows, afterMs);
    const total = lastRows.length;

    if (total === 0) {
      await progress.step(
        "restoring_services",
        startPercent,
        "Menunggu agent melaporkan status layanan E-Rapor/Dapodik.",
        { serviceCount: 0 }
      );
      await sleep(SERVICE_RESTORE_POLL_MS);
      continue;
    }

    const resolvedCount = lastSummary.ready.length + lastSummary.skipped.length;
    const percent = Math.min(98, startPercent + Math.round((resolvedCount / Math.max(total, 1)) * (98 - startPercent)));

    if (lastSummary.pending.length === 0) {
      const readyText = lastSummary.ready.length ? `Link siap: ${lastSummary.ready.join(", ")}.` : "";
      const skippedText = lastSummary.skipped.length ? `Dilewati karena tidak aktif/konfigurasi bermasalah: ${lastSummary.skipped.join(", ")}.` : "";
      await progress.step(
        "services_ready",
        98,
        [readyText, skippedText].filter(Boolean).join(" ") || "Status layanan stabil.",
        lastSummary
      );
      return lastSummary;
    }

    await progress.step(
      "restoring_services",
      percent,
      `Menunggu link publik siap untuk: ${lastSummary.pending.join(", ")}.`,
      lastSummary
    );
    await sleep(SERVICE_RESTORE_POLL_MS);
  }

  throw new Error(
    `Timeout menunggu link layanan siap. Belum stabil: ${lastSummary.pending.join(", ") || "unknown"}.`
  );
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

async function processSupervisorCommand(command, supabaseApi, device) {
  if (!SUPERVISOR_ACTIONS.has(command.action) || !shouldClaimCommand(command)) {
    return;
  }

  const progress = new CommandProgress({
    command,
    supabaseApi,
    workerId: "supervisor",
    logger,
  });
  const action = command.action;
  const startedMs = Date.now();

  try {
    await progress.claim("Supervisor menerima command lifecycle agent.");

    if (action === "agent_stop") {
      writeSupervisorState({ desiredAgentState: "stopped" });
      await progress.step("stopping_agent", 25, "Menghentikan proses School Services Agent.");
      await stopAgentProcess();
      const stopped = await waitForAgentStopped(PROCESS_TIMEOUT_MS);
      if (!stopped) {
        throw new Error("Timeout menghentikan proses School Services Agent.");
      }
      await progress.done("School Services Agent sudah berhenti. Layanan E-Rapor/Dapodik tidak ikut dimatikan.");
      return;
    }

    if (action === "agent_start") {
      writeSupervisorState({ desiredAgentState: "running" });
      await progress.step("starting_agent", 20, "Memulai proses School Services Agent.");
      if (!(await isAgentRunning())) {
        startAgentProcess();
      }
      if (!(await waitForAgentStarted(PROCESS_TIMEOUT_MS))) {
        throw new Error("Timeout memulai proses School Services Agent.");
      }
      await progress.step("waiting_heartbeat", 62, "Menunggu heartbeat agent baru masuk ke dashboard.");
      await waitForHeartbeat(supabaseApi, device.deviceId, startedMs);
      await progress.step("restoring_services", 76, "Heartbeat diterima. Menunggu service dan tunnel publik stabil.");
      const restoreSummary = await waitForServicesRestored(supabaseApi, device.deviceId, progress, 76, startedMs);
      await progress.done(
        restoreSummary.ready.length
          ? `Agent hidup dan link layanan siap: ${restoreSummary.ready.join(", ")}.`
          : "Agent hidup. Tidak ada layanan aktif yang membutuhkan link publik."
      );
      return;
    }

    if (action === "agent_restart") {
      writeSupervisorState({ desiredAgentState: "running" });
      await progress.step("stopping_agent", 18, "Menghentikan proses agent lama.");
      await stopAgentProcess();
      if (!(await waitForAgentStopped(PROCESS_TIMEOUT_MS))) {
        throw new Error("Timeout menghentikan proses agent lama.");
      }
      await progress.step("starting_agent", 45, "Memulai ulang School Services Agent.");
      startAgentProcess();
      if (!(await waitForAgentStarted(PROCESS_TIMEOUT_MS))) {
        throw new Error("Timeout memulai ulang School Services Agent.");
      }
      await progress.step("waiting_heartbeat", 70, "Menunggu heartbeat baru setelah restart.");
      await waitForHeartbeat(supabaseApi, device.deviceId, startedMs);
      await progress.step("restoring_services", 78, "Heartbeat baru diterima. Menunggu service dan tunnel publik stabil.");
      const restoreSummary = await waitForServicesRestored(supabaseApi, device.deviceId, progress, 78, startedMs);
      await progress.done(
        restoreSummary.ready.length
          ? `Restart agent selesai. Link layanan siap: ${restoreSummary.ready.join(", ")}.`
          : "Restart agent selesai. Tidak ada layanan aktif yang membutuhkan link publik."
      );
      return;
    }

    if (action === "update") {
      writeSupervisorState({ desiredAgentState: "running" });
      const beforeDevice = await supabaseApi.fetchDevice(device.deviceId).catch(() => null);
      const selfUpdater = new SelfUpdater({ enabled: true, logger });
      await progress.step("checking_update", 8, "Memeriksa rilis GitHub dan asset installer.");
      const check = await selfUpdater.checkForUpdate(true);
      await supabaseApi.updateDeviceUpdateState({
        deviceId: device.deviceId,
        latestReleaseTag: check.latestReleaseTag || null,
        latestVersion: check.latestReleaseVersion || null,
        updateAvailable: Boolean(check.updateAvailable),
        updateStatus: check.updateAvailable ? "updating" : "current",
        updateCheckedAt: new Date().toISOString(),
        updateStartedAt: check.updateAvailable ? new Date().toISOString() : null,
        updateError: null,
        updateAssetName: check.matchingAssetName || null,
      });
      if (!check.updateAvailable) {
        await progress.done("Agent sudah memakai versi terbaru. Tidak ada update yang perlu dipasang.");
        return;
      }

      await progress.step("downloading", 22, `Menjalankan updater untuk asset ${check.matchingAssetName}.`);
      await runUpdateScript();
      await progress.step("installing", 42, "Installer silent sedang berjalan lewat supervisor.");
      const updateDeadline = Date.now() + UPDATE_TIMEOUT_MS;
      await progress.step("restarting_agent", 58, "Menunggu agent berhenti dan hidup kembali setelah installer.");
      while (Date.now() < updateDeadline) {
        try {
          if (await isAgentRunning()) {
            const heartbeat = await waitForHeartbeat(supabaseApi, device.deviceId, startedMs, 15000);
            await progress.step("verifying_version", 82, "Heartbeat baru diterima. Memverifikasi versi agent.");
            if (hasVersionChanged(beforeDevice, heartbeat) || String(heartbeat?.release_tag || "") === String(check.latestReleaseTag || "")) {
              await supabaseApi.updateDeviceUpdateState({
                deviceId: device.deviceId,
                latestReleaseTag: check.latestReleaseTag || null,
                latestVersion: check.latestReleaseVersion || null,
                updateAvailable: false,
                updateStatus: "current",
                updateCheckedAt: new Date().toISOString(),
                updateStartedAt: null,
                updateError: null,
                updateAssetName: check.matchingAssetName || null,
              });
              await progress.step("restoring_services", 90, "Agent baru aktif. Menunggu service dan tunnel publik stabil.");
              const restoreSummary = await waitForServicesRestored(supabaseApi, device.deviceId, progress, 90, startedMs);
              await progress.done(
                restoreSummary.ready.length
                  ? `Update agent selesai. Link layanan siap: ${restoreSummary.ready.join(", ")}.`
                  : "Update agent selesai. Tidak ada layanan aktif yang membutuhkan link publik."
              );
              return;
            }
          }
        } catch (_error) {
          // Keep waiting until the global update timeout expires.
        }
        await sleep(5000);
      }
      throw new Error("Timeout update. Agent tidak melaporkan versi baru sebelum batas 10 menit.");
    }
  } catch (error) {
    if (action === "update") {
      await supabaseApi.updateDeviceUpdateState({
        deviceId: device.deviceId,
        updateAvailable: false,
        updateStatus: "failed",
        updateCheckedAt: new Date().toISOString(),
        updateStartedAt: null,
        updateError: error.message,
      }).catch(() => {});
    }
    await progress.failed(error);
  }
}

async function main() {
  const config = loadConfig();
  logger.setLogFile(config.localLogPath, { maxBytes: config.localLogMaxBytes });
  const device = createDeviceMetadata({ deviceName: config.deviceName });
  const supabaseApi = createSupabaseApi(config.supabase);

  logger.info("School Services Supervisor started.", {
    serviceName: null,
    deviceId: device.deviceId,
    pid: process.pid,
  });

  if (getDesiredAgentState() === "stopped") {
    logger.warn("Supervisor startup found desiredAgentState=stopped; resetting to running so startup can recover the agent.", {
      serviceName: null,
    });
    writeSupervisorState({ desiredAgentState: "running" });
  }

  logger.addSink((entry) =>
    supabaseApi.insertAgentLog({
      deviceId: device.deviceId,
      serviceName: entry.details?.serviceName || null,
      commandId: entry.details?.commandId || null,
      level: entry.level,
      message: entry.message,
      details: entry.details,
      timestamp: entry.timestamp,
    })
  );

  while (true) {
    try {
      await supabaseApi.heartbeatSupervisor(device, readSupervisorState());
      const commands = await supabaseApi.fetchSupervisorCommands(device.deviceId);
      for (const command of commands) {
        await processSupervisorCommand(command, supabaseApi, device);
      }

      if (getDesiredAgentState() === "running" && !(await isAgentRunning())) {
        logger.warn("Main agent is not running; supervisor is starting it.", {
          serviceName: null,
        });
        startAgentProcess();
      }
    } catch (error) {
      logger.warn(`Supervisor loop failed: ${error.message}`, { serviceName: null });
    }
    await sleep(SUPERVISOR_POLL_MS);
  }
}

main().catch((error) => {
  writeBootstrapLog(`Supervisor fatal error: ${error.stack || error.message}`);
  logger.error(error.stack || error.message, { serviceName: null });
  process.exit(1);
});
