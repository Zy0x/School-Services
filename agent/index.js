#!/usr/bin/env node

const path = require("path");
const { loadConfig } = require("./config");
const { updateMappedConfig } = require("./configManager");
const { executeCommands } = require("./commands");
const { createDeviceMetadata } = require("./device");
const logger = require("./logger");
const { acquireProcessLock, releaseProcessLock } = require("./processLock");
const { getConfigTargetsForService } = require("./serviceConfigs");
const ServiceManager = require("./serviceManager");
const { createSupabaseApi } = require("./supabase");
const ShortcutManager = require("./shortcutManager");
const TunnelManager = require("./tunnel");
const UrlCache = require("./urlCache");
const { getBaseDir, sleep } = require("./utils");

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

async function main() {
  const config = loadConfig();
  const lockPath = path.join(getBaseDir(), ".state", "agent.lock");
  acquireProcessLock(lockPath);
  logger.setLogFile(config.localLogPath);
  logger.info(`Writing local logs to ${config.localLogPath}`);
  const device = createDeviceMetadata({ deviceName: config.deviceName });
  const supabaseApi = createSupabaseApi(config.supabase);
  let removeLogSink = null;
  const serviceManager = new ServiceManager(config.services);
  await serviceManager.warnIfWindowsServiceControlNeedsElevation();
  await serviceManager.initializeDesiredStates();
  const urlCache = new UrlCache();
  const shortcutManager = new ShortcutManager({
    cachePath: path.join(getBaseDir(), ".state", "public-urls.json"),
    shortcuts: config.shortcuts,
  });
  const publishedServiceState = new Map();

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
      const configTargets = getConfigTargetsForService(service);

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

      urlCache.remember(service.serviceName, publicUrl);
      shortcutManager.syncServiceUrl(service.serviceName, publicUrl);
      await supabaseApi.upsertServiceStatus({
        deviceId: device.deviceId,
        serviceName: service.serviceName,
        port: service.port,
        status: "running",
        publicUrl,
        desiredState: serviceManager.getDesiredState(service.serviceName),
        lastError: null,
      });
    },
  });

  let shuttingDown = false;

  async function shutdown(options = {}) {
    const preserveManagedResources = options.preserveManagedResources === true;
    const stopLocalServices = options.stopLocalServices !== false;

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
        await supabaseApi.upsertServiceStatus({
          deviceId: device.deviceId,
          serviceName: service.serviceName,
          port: service.port,
          status: stopLocalServices ? "stopped" : "offline",
          publicUrl: null,
          desiredState: serviceManager.getDesiredState(service.serviceName),
          lastError: stopLocalServices ? null : "Agent stopped.",
        });
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
  await supabaseApi.registerDevice(device);
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
      supabaseApi.fetchServiceStates(device.deviceId),
      supabaseApi.fetchPendingCommands(device.deviceId),
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
    await supabaseApi.upsertServiceStatus({
      deviceId: device.deviceId,
      serviceName,
      port: snapshot.port,
      status: derivePublishedStatus(snapshot, tunnelSnapshot),
      publicUrl: tunnelManager.getPublicUrl(serviceName),
      desiredState: snapshot.desiredState,
      lastError: tunnelSnapshot.lastError || snapshot.lastError,
    });
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

  while (true) {
    await supabaseApi.heartbeatDevice(device);

    const deviceRow = await supabaseApi.fetchDevice(device.deviceId);
    const deviceBlocked = deviceRow.status === "blocked";

    const commands = await supabaseApi.fetchPendingCommands(device.deviceId);
    const executableCommands = deviceBlocked
      ? commands.filter((command) => command.action === "kill")
      : commands;

    if (executableCommands.length > 0) {
      const result = await executeCommands({
        commands: executableCommands,
        serviceManager,
        tunnelManager,
        supabaseApi,
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
          publishedStatus = "blocked";
          lastError = snapshot.lastError || null;
          rememberPublishedServiceState(service.serviceName, {
            status: publishedStatus,
            desiredState: snapshot.desiredState,
            publicUrl,
            lastError,
          });

          await supabaseApi.upsertServiceStatus({
            deviceId: device.deviceId,
            serviceName: service.serviceName,
            port: service.port,
            status: publishedStatus,
            publicUrl,
            desiredState: snapshot.desiredState,
            lastError,
          });
          continue;
        }

        if (desiredState === "running") {
          await serviceManager.startService(service.serviceName);
        }

        const snapshot = await serviceManager.refreshService(service.serviceName);

        if (snapshot.status === "running" && desiredState === "running") {
          await tunnelManager.ensureTunnel(service);
          publicUrl = tunnelManager.getPublicUrl(service.serviceName);
        } else if (snapshot.status === "stopped" && desiredState === "stopped") {
          await tunnelManager.suspendTunnel(service.serviceName);
        } else {
          await tunnelManager.stopTunnel(service.serviceName);
          urlCache.clear(service.serviceName);
        }

        const refreshedTunnelSnapshot =
          tunnelManager.getStatusSnapshot(service.serviceName);
        publishedStatus = derivePublishedStatus(
          snapshot,
          refreshedTunnelSnapshot
        );
        lastError =
          refreshedTunnelSnapshot.lastError || snapshot.lastError || null;
        shortcutManager.syncServiceUrl(service.serviceName, publicUrl);

        rememberPublishedServiceState(service.serviceName, {
          status: publishedStatus,
          desiredState: snapshot.desiredState,
          publicUrl,
          lastError,
        });

        await supabaseApi.upsertServiceStatus({
          deviceId: device.deviceId,
          serviceName: service.serviceName,
          port: service.port,
          status: publishedStatus,
          publicUrl,
          desiredState: snapshot.desiredState,
          lastError,
        });
      } catch (error) {
        logger.error(`Service loop failed for ${service.serviceName}: ${error.message}`);
        await supabaseApi.upsertServiceStatus({
          deviceId: device.deviceId,
          serviceName: service.serviceName,
          port: service.port,
          status: "error",
          publicUrl: tunnelManager.getPublicUrl(service.serviceName),
          desiredState: serviceManager.getDesiredState(service.serviceName),
          lastError: error.message,
        });
      }
    }

    await sleep(config.loopIntervalMs);
  }
}

main().catch(async (error) => {
  releaseProcessLock(path.join(getBaseDir(), ".state", "agent.lock"));
  logger.error(error.stack || error.message);
  process.exit(1);
});
