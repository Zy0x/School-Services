#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { CommandProgress } = require("./commandProgress");
const { loadConfig } = require("./config");
const { createDeviceMetadata } = require("./device");
const logger = require("./logger");
const {
  getCacheDir,
  getInstallDir,
  getStateDir,
} = require("./paths");
const ServiceManager = require("./serviceManager");
const ShortcutManager = require("./shortcutManager");
const { createSupabaseApi } = require("./supabase");
const TunnelManager = require("./tunnel");
const UrlCache = require("./urlCache");
const { sleep } = require("./utils");
const SelfUpdater = require("./selfUpdater");
const {
  getDesiredAgentState,
  normalizeTime,
  readSupervisorState,
  shouldClaimCommand,
  writeSupervisorState,
} = require("./supervisorState");
const {
  isAgentRunning,
  runInstalledStopCleanup,
  runUpdateScript,
  startAgentProcess,
  stopAgentProcess,
  waitForAgentStarted,
  waitForAgentStopped,
} = require("./supervisorProcess");

const SUPERVISOR_POLL_MS = 2000;
const PROCESS_TIMEOUT_MS = 60000;
const HEARTBEAT_TIMEOUT_MS = 120000;
const SERVICE_RESTORE_TIMEOUT_MS = 180000;
const SERVICE_RESTORE_POLL_MS = 3000;
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
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

async function stopAgentForLifecycle(progress, percent, message) {
  let stopError = null;
  await progress.step("stopping_agent", percent, message);
  try {
    await stopAgentProcess();
  } catch (error) {
    stopError = error;
    logger.warn(`Primary agent stop failed: ${error.message}`, {
      serviceName: null,
    });
  }

  if (await waitForAgentStopped(PROCESS_TIMEOUT_MS)) {
    return;
  }

  await progress.step(
    "cleanup_runtime",
    Math.min(58, percent + 18),
    "Agent belum berhenti normal. Menjalankan cleanup paksa runtime terpasang."
  );
  try {
    await runInstalledStopCleanup();
  } catch (error) {
    logger.warn(`Installed stop cleanup failed after primary stop: ${error.message}`, {
      serviceName: null,
    });
    if (!stopError) {
      stopError = error;
    }
  }

  if (await waitForAgentStopped(Math.max(15000, Math.round(PROCESS_TIMEOUT_MS / 2)))) {
    return;
  }

  throw new Error(
    stopError
      ? `Timeout menghentikan proses School Services Agent setelah cleanup paksa. Error awal: ${stopError.message}`
      : "Timeout menghentikan proses School Services Agent setelah cleanup paksa."
  );
}

async function createTunnelManager(config) {
  return new TunnelManager({
    cloudflaredPath: config.cloudflaredPath,
    ngrokPath: config.tunnel.ngrokPath,
    ngrokAuthtoken: config.tunnel.ngrokAuthtoken,
    ngrokUrl: config.tunnel.ngrokUrl,
    mode: config.tunnel.mode,
    providerOrder: config.tunnel.providerOrder,
    startSpacingMs: config.tunnel.startSpacingMs,
    startupTimeoutMs: config.tunnel.startupTimeoutMs,
    publicProbeFailureThreshold: config.tunnel.publicProbeFailureThreshold,
    publicProbeRestartMs: config.tunnel.publicProbeRestartMs,
    retryDelaysMs: config.tunnel.retryDelaysMs,
    globalCooldownMs: config.tunnel.globalCooldownMs,
    onUrl: () => {},
  });
}

async function buildServiceLocationPayload(serviceManager, serviceName) {
  try {
    const diagnostics = await serviceManager.getLocationDiagnostics(serviceName, {
      forceRefresh: true,
    });
    return {
      locationStatus: diagnostics.status,
      resolvedPath: diagnostics.resolvedPath,
      locationDetails: {
        message: diagnostics.message,
        ...(diagnostics.details || {}),
      },
    };
  } catch (error) {
    logger.warn(`Supervisor failed to resolve location diagnostics for ${serviceName}: ${error.message}`, {
      serviceName,
    });
    return {
      locationStatus: "unknown",
      resolvedPath: null,
      locationDetails: { message: error.message },
    };
  }
}

async function stopManagedResourcesForAgentStop(config, supabaseApi, device, progress) {
  const serviceManager = new ServiceManager(config.services);
  const tunnelManager = createTunnelManager(config);
  const urlCache = new UrlCache();
  const shortcutManager = new ShortcutManager({
    cachePath: path.join(getCacheDir(), "public-urls.json"),
    shortcuts: config.shortcuts,
    guestPortal: config.guestPortal,
    baseDir: getStateDir(),
  });
  const services = serviceManager.list();
  let stoppedCount = 0;
  let failedCount = 0;

  await progress.step("stopping_tunnels", 44, "Membersihkan tunnel publik Rapor/Dapodik.");
  try {
    await tunnelManager.stopAll();
  } catch (error) {
    logger.warn(`Supervisor tunnel cleanup reported an error: ${error.message}`, {
      serviceName: null,
    });
  }

  try {
    await runInstalledStopCleanup();
  } catch (error) {
    logger.warn(`Installed stop cleanup reported an error: ${error.message}`, {
      serviceName: null,
    });
  }

  for (const [index, service] of services.entries()) {
    const serviceName = service.serviceName;
    const percent = Math.min(92, 52 + Math.round((index / Math.max(services.length, 1)) * 36));
    await progress.step(
      "stopping_services",
      percent,
      `Menghentikan layanan ${serviceName} dan menonaktifkan link publik.`
    );

    serviceManager.setDesiredState(serviceName, "stopped", "agent-stop");
    let snapshot = null;
    let stopError = null;
    try {
      snapshot = await serviceManager.stopService(serviceName);
    } catch (error) {
      stopError = error;
      logger.warn(`Supervisor failed to stop service ${serviceName}: ${error.message}`, {
        serviceName,
      });
      snapshot = await serviceManager.refreshService(serviceName).catch(() => ({
        serviceName,
        port: service.port,
        status: "error",
        desiredState: "stopped",
        lastError: error.message,
      }));
    }

    try {
      await tunnelManager.stopTunnel(serviceName);
    } catch (error) {
      logger.warn(`Supervisor failed to stop tunnel for ${serviceName}: ${error.message}`, {
        serviceName,
      });
    }

    urlCache.clear(serviceName);
    shortcutManager.syncServiceUrl(serviceName, null);

    const stopped = snapshot.status !== "running" && !stopError;
    if (stopped) {
      stoppedCount += 1;
    } else {
      failedCount += 1;
    }

    const locationPayload = await buildServiceLocationPayload(serviceManager, serviceName);
    await supabaseApi.upsertServiceStatus({
      deviceId: device.deviceId,
      serviceName,
      port: snapshot.port || service.port,
      status: stopped ? "stopped" : "error",
      publicUrl: null,
      desiredState: "stopped",
      lastError: stopped
        ? null
        : stopError?.message || snapshot.lastError || "Service masih berjalan setelah agent dihentikan.",
      tunnelState: "stopped",
      tunnelProvider: null,
      lastPublicUrl: null,
      tunnelLastError: null,
      ...locationPayload,
    });
  }

  await progress.step(
    failedCount > 0 ? "services_stopped_with_warnings" : "services_stopped",
    96,
    failedCount > 0
      ? `${stoppedCount}/${services.length} layanan berhenti. ${failedCount} layanan perlu dicek. Link publik sudah dinonaktifkan.`
      : "Semua layanan dan tunnel publik sudah berhenti.",
    { stopped: stoppedCount, failed: failedCount }
  );
}

async function processSupervisorCommand(command, supabaseApi, device, config) {
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
      await stopAgentForLifecycle(progress, 25, "Menghentikan proses School Services Agent.");
      await stopManagedResourcesForAgentStop(config, supabaseApi, device, progress);
      await progress.done("School Services Agent, layanan Rapor/Dapodik, dan tunnel publik sudah berhenti.");
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
      await stopAgentForLifecycle(progress, 18, "Menghentikan proses agent lama.");
      await progress.step("cleanup_runtime", 36, "Membersihkan proses bootstrap dan tunnel lama sebelum start ulang.");
      await runInstalledStopCleanup();
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
        await processSupervisorCommand(command, supabaseApi, device, config);
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
