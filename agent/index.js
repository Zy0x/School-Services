#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./config");
const { updateMappedConfig } = require("./configManager");
const { executeCommands } = require("./commands");
const { createDeviceMetadata } = require("./device");
const { ensureProcessPathEntries } = require("./environment");
const FileWorker = require("./fileWorker");
const logger = require("./logger");
const { getCacheDir, getDataDir, getInstallDir, getStateDir } = require("./paths");
const { acquireProcessLock, releaseProcessLock } = require("./processLock");
const { getConfigTargetsForService } = require("./serviceConfigs");
const ServiceManager = require("./serviceManager");
const SelfUpdater = require("./selfUpdater");
const { createSupabaseApi } = require("./supabase");
const ShortcutManager = require("./shortcutManager");
const TunnelManager = require("./tunnel");
const UrlCache = require("./urlCache");
const { sleep } = require("./utils");

function buildPendingCommandState(commands) {
  const latestByService = new Map();

  for (const command of commands) {
    if (!command.service_name) {
      continue;
    }

    latestByService.set(command.service_name, command);
  }

  return latestByService;
}

function derivePublishedStatus(serviceSnapshot, tunnelSnapshot) {
  if (serviceSnapshot.status === "stopped") {
    return serviceSnapshot.desiredState === "running" ? "starting" : "stopped";
  }

  if (serviceSnapshot.desiredState === "stopped") {
    return "stopped";
  }

  if (!tunnelSnapshot) {
    return serviceSnapshot.status;
  }

  if (tunnelSnapshot.state === "running") {
    return "running";
  }

  if (tunnelSnapshot.state === "waiting_retry") {
    return "waiting_retry";
  }

  if (tunnelSnapshot.state === "error") {
    return "error";
  }

  if (tunnelSnapshot.state === "starting" || tunnelSnapshot.state === "idle") {
    return "starting";
  }

  return serviceSnapshot.status;
}

function isSupabaseConnectivityError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return [
    "fetch failed",
    "network request failed",
    "timed out",
    "econnreset",
    "enotfound",
    "getaddrinfo",
    "failed to fetch",
    "socket hang up",
    "network",
    "temporarily unavailable",
  ].some((token) => message.includes(token));
}

function writeDeviceState(device, config) {
  const statePath = path.join(getStateDir(), "device.json");
  const payload = {
    ...device,
    guestPortalBaseUrl: config.guestPortal.baseUrl,
    installDir: getInstallDir(),
    dataDir: getDataDir(),
    stateDir: getStateDir(),
    updatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return statePath;
}

async function main() {
  const environmentBootstrap = ensureProcessPathEntries();
  if (environmentBootstrap.changed) {
    logger.info("Normalized PATH for current agent process.", {
      serviceName: null,
      requiredEntries: environmentBootstrap.required,
    });
  }

  const config = loadConfig();
  const stateDir = getStateDir();
  const lockPath = path.join(stateDir, "agent.lock");
  acquireProcessLock(lockPath);
  logger.setLogFile(config.localLogPath, { maxBytes: config.localLogMaxBytes });
  logger.info(`Writing local logs to ${config.localLogPath}`, {
    serviceName: null,
    maxBytes: config.localLogMaxBytes,
  });
  const device = createDeviceMetadata({ deviceName: config.deviceName });
  const deviceStatePath = writeDeviceState(device, config);
  logger.info("Agent bootstrap metadata resolved.", {
    serviceName: null,
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    hostname: device.hostname,
    platform: device.platform,
    runtimeConfigPath: config.runtimeConfigPath,
    installDir: getInstallDir(),
    dataDir: getDataDir(),
    stateDir,
    deviceStatePath,
    pid: process.pid,
  });
  const supabaseApi = createSupabaseApi(config.supabase);
  let removeLogSink = null;
  const serviceManager = new ServiceManager(config.services);
  const selfUpdater = new SelfUpdater({
    enabled: config.selfUpdate.enabled,
    intervalMs: config.selfUpdate.intervalMs,
    logger,
  });
  await serviceManager.warnIfWindowsServiceControlNeedsElevation();
  await serviceManager.initializeDesiredStates();
  const urlCache = new UrlCache();
  const shortcutManager = new ShortcutManager({
    cachePath: path.join(getCacheDir(), "public-urls.json"),
    shortcuts: config.shortcuts,
    guestPortal: config.guestPortal,
    baseDir: stateDir,
  });
  shortcutManager.syncGuestPortalUrl(device.deviceId, null);
  const guestPortalUrl = shortcutManager.getGuestPortalUrl(device.deviceId);
  const guestPortalPath = guestPortalUrl
    ? `/guest/${encodeURIComponent(device.deviceId)}`
    : null;
  const fileWorker = new FileWorker({
    device,
    supabaseApi,
    serviceManager,
    workspaceRoot: config.fileAccess.workspaceRoot,
    maxArtifactBytes: config.fileAccess.maxArtifactBytes,
    previewInlineBytes: config.fileAccess.previewInlineBytes,
    previewTextExtensions: config.fileAccess.previewTextExtensions,
  });
  const publishedServiceState = new Map();
  let lastLoopAt = Date.now();
  let remoteDisconnectedAt = null;
  let fileWorkerRun = null;
  let updateInProgress = false;
  const remoteState = {
    connected: true,
    registered: false,
    deviceBlocked: false,
  };

  function markSupabaseDisconnected(error, context) {
    const message = error instanceof Error ? error.message : String(error);
    if (remoteState.connected) {
      logger.warn(`Supabase connection lost during ${context}: ${message}`, {
        serviceName: null,
        context,
      });
    }
    remoteState.connected = false;
    remoteDisconnectedAt = remoteDisconnectedAt || Date.now();
  }

  function markSupabaseConnected() {
    if (!remoteState.connected) {
      logger.info("Supabase connection restored.", {
        serviceName: null,
      });
    }
    remoteState.connected = true;
  }

  async function trySupabase(context, operation, fallback = null) {
    try {
      const result = await operation();
      markSupabaseConnected();
      return result;
    } catch (error) {
      if (isSupabaseConnectivityError(error)) {
        markSupabaseDisconnected(error, context);
        return fallback;
      }

      throw error;
    }
  }

  async function buildLocationPayload(serviceName) {
    try {
      const diagnostics = await serviceManager.getLocationDiagnostics(serviceName);

      return {
        locationStatus: diagnostics.status,
        resolvedPath: diagnostics.resolvedPath,
        locationDetails: {
          message: diagnostics.message,
          ...(diagnostics.details || {}),
        },
      };
    } catch (error) {
      logger.warn(
        `Failed to resolve location diagnostics for ${serviceName}: ${error.message}`,
        { serviceName }
      );
      return {
        locationStatus: "unknown",
        resolvedPath: null,
        locationDetails: {
          message: error.message,
        },
      };
    }
  }

  async function handleResumeRecovery() {
    logger.warn(
      "Agent detected a long execution gap. The device likely resumed from sleep or standby, so tunnels and remote state will be reinitialized.",
      {
        serviceName: null,
        resumeGapMs: Date.now() - lastLoopAt,
      }
    );

    remoteState.connected = false;
    remoteState.registered = false;
    remoteDisconnectedAt = Date.now();
    tunnelManager.requestFreshStartAll("resume-recovery");

    for (const service of serviceManager.list()) {
      publishedServiceState.delete(service.serviceName);
    }

    try {
      await fileWorker.syncRootsIfNeeded(true);
    } catch (error) {
      logger.warn(`File roots sync after resume failed: ${error.message}`);
    }
  }

  function rememberPublishedServiceState(serviceName, payload) {
    const previous = publishedServiceState.get(serviceName);
    const next = JSON.stringify(payload);

    if (previous !== next) {
      const logDetails = {
        serviceName,
        status: payload.status,
        desiredState: payload.desiredState,
        publicUrl: payload.publicUrl,
        lastError: payload.lastError,
      };

      if (payload.status === "running" && payload.desiredState === "stopped") {
        logger.warn(
          `Service ${serviceName} is still running locally while desired state is stopped. Public URL remains disabled until the service is stopped successfully.`,
          logDetails
        );
      } else {
        logger.info(`Service state changed for ${serviceName}`, logDetails);
      }

      publishedServiceState.set(serviceName, next);
    }
  }

  const tunnelManager = new TunnelManager({
    cloudflaredPath: config.cloudflaredPath,
    mode: config.tunnel.mode,
    startSpacingMs: config.tunnel.startSpacingMs,
    startupTimeoutMs: config.tunnel.startupTimeoutMs,
    retryDelaysMs: config.tunnel.retryDelaysMs,
    globalCooldownMs: config.tunnel.globalCooldownMs,
    async onUrl(service, publicUrl) {
      if (!urlCache.hasChanged(service.serviceName, publicUrl)) {
        return;
      }

      logger.info(`Detected new public URL for ${service.serviceName}: ${publicUrl}`);
      let configTargets = getConfigTargetsForService(service);
      if (configTargets.length > 0) {
        configTargets = await serviceManager.getResolvedConfigTargets(service.serviceName);
      }

      urlCache.remember(service.serviceName, publicUrl);
      shortcutManager.syncServiceUrl(service.serviceName, publicUrl, {
        skipDiscoveryIfPriorityMissing: service.serviceName === "rapor",
      });
      shortcutManager.syncGuestPortalUrl(device.deviceId, publicUrl);

      if (configTargets.length === 0) {
        logger.info(
          `Skipping config update for ${service.serviceName}: needsConfigUpdate is false`
        );
      } else {
        for (const target of configTargets) {
          try {
            const result = updateMappedConfig(target, publicUrl);
            if (result.changed) {
              logger.info(`Updated ${result.path} for ${service.serviceName}`);
            }
          } catch (error) {
            logger.warn(
              `Config update failed for ${service.serviceName}: ${error.message}`
            );
          }
        }
      }
      const locationPayload = await buildLocationPayload(service.serviceName);
      await trySupabase(
        `publish-public-url:${service.serviceName}`,
        () =>
          supabaseApi.upsertServiceStatus({
            deviceId: device.deviceId,
            serviceName: service.serviceName,
            port: service.port,
            status: "running",
            publicUrl,
            desiredState: serviceManager.getDesiredState(service.serviceName),
            lastError: null,
            ...locationPayload,
          }),
        null
      );
    },
  });

  let shuttingDown = false;

  async function shutdown(options = {}) {
    const preserveManagedResources = options.preserveManagedResources === true;
    const stopLocalServices = options.stopLocalServices !== false;
    const skipRemotePublish = options.skipRemotePublish === true;

    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    if (preserveManagedResources) {
      for (const service of serviceManager.list()) {
        shortcutManager.syncServiceUrl(service.serviceName, null);
      }
      logger.info(
        "Stopping agent process and preserving running services and Cloudflare tunnels"
      );
      releaseProcessLock(lockPath);
      return;
    }

    logger.info(
      stopLocalServices
        ? "Stopping tunnels and managed services"
        : "Stopping tunnels and agent process"
    );
    await tunnelManager.stopAll();
    if (stopLocalServices) {
      await serviceManager.stopAll();
    }

    for (const service of serviceManager.list()) {
      try {
        shortcutManager.syncServiceUrl(service.serviceName, null);
        if (!skipRemotePublish) {
          await supabaseApi.upsertServiceStatus({
            deviceId: device.deviceId,
            serviceName: service.serviceName,
            port: service.port,
            status: stopLocalServices ? "stopped" : "offline",
            publicUrl: null,
            desiredState: serviceManager.getDesiredState(service.serviceName),
            lastError: stopLocalServices ? null : "Agent stopped.",
          });
        }
      } catch (error) {
        logger.warn(
          `Failed to publish shutdown status for ${service.serviceName}: ${error.message}`
        );
      }
    }

    releaseProcessLock(lockPath);
  }

  process.once("SIGINT", async () => {
    await shutdown({ preserveManagedResources: true });
    process.exit(0);
  });

  process.once("SIGTERM", async () => {
    await shutdown({ preserveManagedResources: true });
    process.exit(0);
  });

  logger.info(`Registering device ${device.deviceId} (${device.deviceName})`);
  const registrationResult = await trySupabase(
    "register-device",
    () => supabaseApi.registerDevice(device),
    false
  );
  remoteState.registered = registrationResult !== false;
  if (guestPortalUrl) {
    await trySupabase(
      "upsert-guest-shortcut",
      () =>
        supabaseApi.upsertGuestShortcut({
          deviceId: device.deviceId,
          guestPath: guestPortalPath,
          guestUrl: guestPortalUrl,
        }),
      false
    );
  }
  removeLogSink = logger.addSink((entry) =>
    supabaseApi.insertAgentLog({
      deviceId: device.deviceId,
      serviceName: entry.details?.serviceName || null,
      level: entry.level,
      message: entry.message,
      details: entry.details,
      timestamp: entry.timestamp,
    })
  );

  async function bootstrapRemoteDesiredStates() {
    const [remoteServices, pendingCommands] = await Promise.all([
      trySupabase(
        "bootstrap-fetch-services",
        () => supabaseApi.fetchServiceStates(device.deviceId),
        []
      ),
      trySupabase(
        "bootstrap-fetch-commands",
        () => supabaseApi.fetchPendingCommands(device.deviceId),
        []
      ),
    ]);
    const remoteServiceByName = new Map(
      remoteServices.map((service) => [service.service_name, service])
    );
    const pendingCommandByService = buildPendingCommandState(pendingCommands);

    for (const service of serviceManager.list()) {
      const pendingCommand = pendingCommandByService.get(service.serviceName);
      if (pendingCommand) {
        const desiredState =
          pendingCommand.action === "start" ? "running" : "stopped";
        serviceManager.setDesiredState(
          service.serviceName,
          desiredState,
          "startup-pending-command"
        );
        continue;
      }

      const remoteService = remoteServiceByName.get(service.serviceName);
      if (!remoteService?.desired_state) {
        continue;
      }

      serviceManager.setDesiredState(
        service.serviceName,
        remoteService.desired_state,
        "startup-remote-desired-state"
      );
    }
  }

  async function publishStartupState(serviceName) {
    const snapshot = await serviceManager.refreshService(serviceName);
    const tunnelSnapshot = tunnelManager.getStatusSnapshot(serviceName);
    const locationPayload = await buildLocationPayload(serviceName);
    await trySupabase(
      `publish-startup-state:${serviceName}`,
      () =>
        supabaseApi.upsertServiceStatus({
          deviceId: device.deviceId,
          serviceName,
          port: snapshot.port,
          status: derivePublishedStatus(snapshot, tunnelSnapshot),
          publicUrl: tunnelManager.getPublicUrl(serviceName),
          desiredState: snapshot.desiredState,
          lastError: tunnelSnapshot.lastError || snapshot.lastError,
          ...locationPayload,
        }),
      null
    );
  }

  async function prepareCleanOnlineStartup() {
    logger.info(
      "Preparing clean startup: resetting tracked tunnels and reinitializing services"
    );
    await tunnelManager.resetAll();

    for (const service of serviceManager.list()) {
      try {
        await serviceManager.stopService(service.serviceName);
      } catch (error) {
        logger.warn(
          `Startup cleanup could not stop ${service.serviceName}: ${error.message}`,
          { serviceName: service.serviceName }
        );
      }

      serviceManager.setDesiredState(
        service.serviceName,
        service.autoStart ? "running" : "stopped",
        "startup-clean-online"
      );
      await publishStartupState(service.serviceName);
    }
  }

  if (config.startup.mode === "respect-remote") {
    await bootstrapRemoteDesiredStates();
  } else {
    await prepareCleanOnlineStartup();
  }

  try {
    await fileWorker.syncRootsIfNeeded(true);
  } catch (error) {
    logger.warn(`Initial file roots sync failed: ${error.message}`);
  }

  function kickFileWorker() {
    if (!remoteState.connected || fileWorkerRun) {
      return;
    }

    fileWorkerRun = (async () => {
      try {
        await fileWorker.processNextJob();
      } catch (error) {
        if (isSupabaseConnectivityError(error)) {
          markSupabaseDisconnected(error, "file-worker-loop");
        } else {
          logger.error(`File worker loop failed: ${error.message}`);
        }
      } finally {
        fileWorkerRun = null;
      }
    })();
  }

  async function maybeRunSelfUpdate() {
    if (
      updateInProgress ||
      !config.selfUpdate.enabled ||
      !remoteState.connected ||
      fileWorkerRun
    ) {
      return false;
    }

    try {
      const check = await selfUpdater.checkForUpdate(false);
      if (!check.checked || !check.updateAvailable) {
        return false;
      }

      updateInProgress = true;
      logger.warn("A newer GitHub release is available. Stopping local services and relaunching updater.", {
        serviceName: null,
        currentVersion: check.currentVersion,
        currentReleaseTag: check.currentReleaseTag,
        latestReleaseTag: check.latestReleaseTag,
      });
      await shutdown({ stopLocalServices: true, skipRemotePublish: true });
      selfUpdater.launchUpdater();
      return true;
    } catch (error) {
      logger.warn(`Automatic update check failed: ${error.message}`, {
        serviceName: null,
      });
      return false;
    }
  }

  while (true) {
    const loopStartedAt = Date.now();
    const disconnectedAtBeforeLoop = remoteDisconnectedAt;
    if (loopStartedAt - lastLoopAt > config.recovery.resumeGapMs) {
      await handleResumeRecovery();
    }

    const wasConnected = remoteState.connected;

    if (!remoteState.registered) {
      const registered = await trySupabase(
        "register-device-retry",
        () => supabaseApi.registerDevice(device),
        false
      );
      remoteState.registered = registered !== false;
    }

    const heartbeatOk = await trySupabase(
      "heartbeat-device",
      async () => {
        await supabaseApi.heartbeatDevice(device);
        return true;
      },
      false
    );

    if (heartbeatOk && !remoteState.registered) {
      remoteState.registered = true;
    }

    const deviceRow = await trySupabase(
      "fetch-device",
      () => supabaseApi.fetchDevice(device.deviceId),
      null
    );
    if (deviceRow) {
      remoteState.deviceBlocked = deviceRow.status === "blocked";
    }

    if (!wasConnected && remoteState.connected) {
      if (disconnectedAtBeforeLoop && Date.now() - disconnectedAtBeforeLoop > 10000) {
        tunnelManager.requestFreshStartAll("network-reconnect");
      }
      try {
        await fileWorker.syncRootsIfNeeded(true);
      } catch (error) {
        logger.warn(`File roots resync after reconnect failed: ${error.message}`);
      }
      remoteDisconnectedAt = null;
    }

    const deviceBlocked = remoteState.deviceBlocked;

    const commands =
      (await trySupabase(
        "fetch-pending-commands",
        () => supabaseApi.fetchPendingCommands(device.deviceId),
        []
      )) || [];
    const executableCommands = deviceBlocked
      ? commands.filter((command) => command.action === "kill")
      : commands;

    if (executableCommands.length > 0) {
      const result = await executeCommands({
        commands: executableCommands,
        serviceManager,
        tunnelManager,
        supabaseApi,
        shortcutManager,
        urlCache,
      });

      if (result.shouldExit) {
        await shutdown({ stopLocalServices: false });
        return;
      }
    }

    for (const service of serviceManager.list()) {
      try {
        const desiredState = serviceManager.getDesiredState(service.serviceName);
        let publishedStatus = "stopped";
        let publicUrl = null;
        let lastError = null;

        if (deviceBlocked) {
          await tunnelManager.stopTunnel(service.serviceName);
          urlCache.clear(service.serviceName);
          shortcutManager.syncServiceUrl(service.serviceName, null);
          const snapshot = await serviceManager.refreshService(service.serviceName);
          const locationPayload = await buildLocationPayload(service.serviceName);
          publishedStatus = "blocked";
          lastError = snapshot.lastError || null;
          rememberPublishedServiceState(service.serviceName, {
            status: publishedStatus,
            desiredState: snapshot.desiredState,
            publicUrl,
            lastError,
          });

          await trySupabase(
            `publish-service-state:${service.serviceName}`,
            () =>
              supabaseApi.upsertServiceStatus({
                deviceId: device.deviceId,
                serviceName: service.serviceName,
                port: service.port,
                status: publishedStatus,
                publicUrl,
                desiredState: snapshot.desiredState,
                lastError,
                ...locationPayload,
              }),
            null
          );
          continue;
        }

        if (desiredState === "running") {
          await serviceManager.startService(service.serviceName);
        }

        const snapshot = await serviceManager.refreshService(service.serviceName);

        if (snapshot.status === "running" && desiredState === "running") {
          await tunnelManager.ensureTunnel(service);
          publicUrl =
            tunnelManager.getPublicUrl(service.serviceName) ||
            tunnelManager.getLastKnownPublicUrl(service.serviceName);
        } else if (snapshot.status === "stopped" && desiredState === "stopped") {
          await tunnelManager.suspendTunnel(service.serviceName);
        } else {
          await tunnelManager.stopTunnel(service.serviceName);
          urlCache.clear(service.serviceName);
        }

        const refreshedTunnelSnapshot =
          tunnelManager.getStatusSnapshot(service.serviceName);
        const locationPayload = await buildLocationPayload(service.serviceName);
        publishedStatus = derivePublishedStatus(
          snapshot,
          refreshedTunnelSnapshot
        );
        lastError =
          refreshedTunnelSnapshot.lastError || snapshot.lastError || null;
        shortcutManager.syncServiceUrl(service.serviceName, publicUrl);
        shortcutManager.syncGuestPortalUrl(device.deviceId, publicUrl);

        rememberPublishedServiceState(service.serviceName, {
          status: publishedStatus,
          desiredState: snapshot.desiredState,
          publicUrl,
          lastError,
        });

        await trySupabase(
          `publish-service-state:${service.serviceName}`,
          () =>
            supabaseApi.upsertServiceStatus({
              deviceId: device.deviceId,
              serviceName: service.serviceName,
              port: service.port,
              status: publishedStatus,
              publicUrl,
              desiredState: snapshot.desiredState,
              lastError,
              ...locationPayload,
            }),
          null
        );
      } catch (error) {
        logger.error(`Service loop failed for ${service.serviceName}: ${error.message}`);
        const locationPayload = await buildLocationPayload(service.serviceName);
        await trySupabase(
          `publish-service-error:${service.serviceName}`,
          () =>
            supabaseApi.upsertServiceStatus({
              deviceId: device.deviceId,
              serviceName: service.serviceName,
              port: service.port,
              status: "error",
              publicUrl:
                tunnelManager.getPublicUrl(service.serviceName) ||
                tunnelManager.getLastKnownPublicUrl(service.serviceName),
              desiredState: serviceManager.getDesiredState(service.serviceName),
              lastError: error.message,
              ...locationPayload,
            }),
          null
        );
      }
    }

    kickFileWorker();
    const updateTriggered = await maybeRunSelfUpdate();
    if (updateTriggered) {
      return;
    }

    await sleep(config.loopIntervalMs);
    lastLoopAt = Date.now();
  }
}

main().catch(async (error) => {
  releaseProcessLock(path.join(getStateDir(), "agent.lock"));
  logger.error(error.stack || error.message);
  process.exit(1);
});
