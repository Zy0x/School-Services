const logger = require("./logger");
const { CommandProgress } = require("./commandProgress");
const { sleep } = require("./utils");

const SERVICE_READY_TIMEOUT_MS = 180000;
const SERVICE_STOP_TIMEOUT_MS = 90000;
const COMMAND_POLL_MS = 2500;

async function executeCommands({
  commands,
  serviceManager,
  tunnelManager,
  supabaseApi,
  shortcutManager,
  urlCache,
  selfUpdater,
  publicUrlFormatter = (url) => url,
}) {
  let shouldExit = false;
  let exitMode = null;

  async function buildLocationPayload(serviceName) {
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

  async function publishServiceSnapshot(deviceId, serviceName, snapshot, overrides = {}) {
    const locationPayload = await buildLocationPayload(serviceName);
    await supabaseApi.upsertServiceStatus({
      deviceId,
      serviceName,
      port: snapshot.port,
      status: overrides.status || snapshot.status,
      publicUrl:
        Object.prototype.hasOwnProperty.call(overrides, "publicUrl")
          ? publicUrlFormatter(overrides.publicUrl)
          : publicUrlFormatter(tunnelManager.getPublicUrl(serviceName)),
      desiredState: snapshot.desiredState,
      lastError:
        Object.prototype.hasOwnProperty.call(overrides, "lastError")
          ? overrides.lastError
          : snapshot.lastError,
      tunnelProvider: tunnelManager.getStatusSnapshot(serviceName)?.provider || null,
      ...locationPayload,
    });
  }

  async function waitForServiceReady(deviceId, serviceName, progress, startPercent = 48) {
    const deadline = Date.now() + SERVICE_READY_TIMEOUT_MS;
    let lastSnapshot = null;
    let lastTunnel = null;

    while (Date.now() < deadline) {
      lastSnapshot = await serviceManager.refreshService(serviceName);
      if (lastSnapshot.status !== "running") {
        await progress.step(
          "waiting_service",
          startPercent,
          `Menunggu service ${serviceName} membuka port ${lastSnapshot.port}.`,
          { status: lastSnapshot.status }
        );
        await publishServiceSnapshot(deviceId, serviceName, lastSnapshot);
        await sleep(COMMAND_POLL_MS);
        continue;
      }

      await progress.step(
        "preparing_tunnel",
        Math.max(startPercent + 18, 66),
        `Service ${serviceName} sudah running. Menyiapkan tunnel publik.`,
        { status: lastSnapshot.status }
      );
      lastTunnel = await tunnelManager.ensureTunnel(serviceManager.getDefinition(serviceName));
      await publishServiceSnapshot(deviceId, serviceName, lastSnapshot, {
        publicUrl: lastTunnel?.publicUrl || null,
        lastError: lastSnapshot.lastError || lastTunnel?.lastError || null,
      });

      if (lastTunnel?.publicUrl) {
        await progress.step(
          "verifying_public_link",
          96,
          `Link publik ${serviceName} sudah diterima. Memastikan status layanan tetap aktif.`,
          { publicUrl: lastTunnel.publicUrl }
        );
        const finalSnapshot = await serviceManager.refreshService(serviceName);
        if (finalSnapshot.status !== "running") {
          await publishServiceSnapshot(deviceId, serviceName, finalSnapshot, {
            publicUrl: null,
            lastError: finalSnapshot.lastError || `Service ${serviceName} berhenti sebelum link publik siap digunakan.`,
          });
          throw new Error(`Service ${serviceName} berhenti sebelum link publik siap digunakan.`);
        }
        await publishServiceSnapshot(deviceId, serviceName, finalSnapshot, {
          publicUrl: lastTunnel.publicUrl,
          lastError: null,
        });
        await progress.step(
          "ready",
          99,
          `Service ${serviceName} aktif dan link publik sudah siap digunakan.`,
          { publicUrl: lastTunnel.publicUrl }
        );
        return { snapshot: finalSnapshot, tunnel: lastTunnel };
      }

      await sleep(COMMAND_POLL_MS);
    }

    throw new Error(
      `Timeout menunggu service ${serviceName} siap. Status terakhir: ${lastSnapshot?.status || "unknown"}; tunnel: ${lastTunnel?.state || "unknown"}.`
    );
  }

  async function waitForServiceStopped(deviceId, serviceName, progress) {
    const deadline = Date.now() + SERVICE_STOP_TIMEOUT_MS;
    let lastSnapshot = null;

    while (Date.now() < deadline) {
      lastSnapshot = await serviceManager.refreshService(serviceName);
      await publishServiceSnapshot(deviceId, serviceName, lastSnapshot, {
        publicUrl: null,
      });
      if (lastSnapshot.status !== "running") {
        await tunnelManager.suspendTunnel(serviceName);
        await publishServiceSnapshot(deviceId, serviceName, lastSnapshot, {
          status: "stopped",
          publicUrl: null,
          lastError: null,
        });
        await progress.step(
          "stopped",
          99,
          `Service ${serviceName} sudah berhenti dan link publik dinonaktifkan.`,
          { status: lastSnapshot.status }
        );
        return lastSnapshot;
      }

      await progress.step(
        "waiting_stop",
        72,
        `Menunggu service ${serviceName} berhenti.`,
        { status: lastSnapshot.status }
      );
      await sleep(COMMAND_POLL_MS);
    }

    throw new Error(
      `Timeout menunggu service ${serviceName} berhenti. Status terakhir: ${lastSnapshot?.status || "unknown"}.`
    );
  }

  async function stopManagedServices(deviceId, reason) {
    for (const service of serviceManager.list()) {
      serviceManager.setDesiredState(service.serviceName, "stopped", reason);
      const snapshot = await serviceManager.stopService(service.serviceName);
      await tunnelManager.suspendTunnel(service.serviceName);
      if (urlCache) {
        urlCache.clear(service.serviceName);
      }
      if (shortcutManager) {
        shortcutManager.syncServiceUrl(service.serviceName, null);
      }
      await publishServiceSnapshot(deviceId, service.serviceName, snapshot, {
          status: "stopped",
          publicUrl: null,
        lastError: null,
      });
    }
  }

  async function startManagedServices(deviceId, reason) {
    for (const service of serviceManager.list()) {
      serviceManager.setDesiredState(service.serviceName, "running", reason);
      const snapshot = await serviceManager.startService(service.serviceName);
      await publishServiceSnapshot(deviceId, service.serviceName, snapshot);
    }
  }

  function getTunnelValidationService() {
    const services = serviceManager.list();
    return (
      services.find((service) => serviceManager.getDesiredState(service.serviceName) === "running") ||
      services[0] ||
      null
    );
  }

  async function refreshRunningTunnels(deviceId) {
    for (const service of serviceManager.list()) {
      const snapshot = await serviceManager.refreshService(service.serviceName);
      if (snapshot.status !== "running" && snapshot.desiredState !== "running") {
        await publishServiceSnapshot(deviceId, service.serviceName, snapshot);
        continue;
      }

      const tunnel =
        snapshot.status === "running"
          ? await tunnelManager.ensureTunnel(service)
          : tunnelManager.getStatusSnapshot(service.serviceName);
      await publishServiceSnapshot(deviceId, service.serviceName, snapshot, {
        publicUrl: tunnel?.publicUrl || null,
        lastError: snapshot.lastError || tunnel?.lastError || null,
      });
    }
  }

  for (const command of commands) {
    const progress = new CommandProgress({
      command,
      supabaseApi,
      workerId: "agent",
      logger,
    });
    logger.info(
      `Executing command ${command.action} for ${command.service_name || "all services"}`,
      {
        serviceName: command.service_name || null,
        action: command.action,
      }
    );

    try {
      await progress.claim("Command diterima agent dan mulai diproses.");
      if (command.action === "start" && command.service_name) {
        await progress.step(
          "starting_service",
          18,
          `Memulai service ${command.service_name}.`
        );
        serviceManager.setDesiredState(command.service_name, "running", "remote-start");
        const snapshot = await serviceManager.startService(command.service_name);
        await publishServiceSnapshot(command.device_id, command.service_name, snapshot);
        await waitForServiceReady(command.device_id, command.service_name, progress, 42);
        logger.info(`Command start completed for ${command.service_name}`, {
          serviceName: command.service_name,
          status: snapshot.status,
          desiredState: snapshot.desiredState,
        });
        await progress.done(`Service ${command.service_name} sudah aktif dan link publik siap.`);
      } else if (command.action === "stop" && command.service_name) {
        await progress.step(
          "stopping_service",
          18,
          `Menghentikan service ${command.service_name}.`
        );
        serviceManager.setDesiredState(command.service_name, "stopped", "remote-stop");
        const snapshot = await serviceManager.stopService(command.service_name);
        await progress.step(
          "stopping_tunnel",
          58,
          `Menghentikan tunnel ${command.service_name}.`
        );
        await tunnelManager.suspendTunnel(command.service_name);
        if (urlCache) {
          urlCache.clear(command.service_name);
        }
        if (shortcutManager) {
          shortcutManager.syncServiceUrl(command.service_name, null);
        }
        await publishServiceSnapshot(command.device_id, command.service_name, snapshot, {
          publicUrl: null,
        });
        await waitForServiceStopped(command.device_id, command.service_name, progress);
        logger.info(`Command stop completed for ${command.service_name}`, {
          serviceName: command.service_name,
          status: snapshot.status,
          desiredState: snapshot.desiredState,
          publicUrl: null,
        });
        await progress.done(`Service ${command.service_name} sudah berhenti.`);
      } else if (command.action === "configure_tunnel") {
        await progress.step("configuring_tunnel", 20, "Menyimpan dan menerapkan preferensi tunnel.");
        const configPayload = command.payload || {};
        if (configPayload.tunnel?.validateNgrokAuthtoken) {
          configPayload.tunnel.validationService = getTunnelValidationService();
        }
        const settings = await tunnelManager.configureSettings(configPayload);
        await refreshRunningTunnels(command.device_id);
        await progress.done("Preferensi tunnel diterapkan.");
        logger.info("Command configure_tunnel completed.", {
          serviceName: null,
          action: command.action,
          preferredProvider: settings.preferredProvider,
          providerOrder: settings.providerOrder,
          ngrokAvailable: settings.ngrokAvailable,
          ngrokConfigured: settings.ngrokConfigured,
        });
      } else if (command.action === "kill") {
        await progress.step("stopping_agent", 30, "Menghentikan agent dan tunnel.");
        await tunnelManager.stopAll();
        for (const service of serviceManager.list()) {
          if (urlCache) {
            urlCache.clear(service.serviceName);
          }
          if (shortcutManager) {
            shortcutManager.syncServiceUrl(service.serviceName, null);
          }
          const snapshot = await serviceManager.refreshService(service.serviceName);
          const locationPayload = await buildLocationPayload(service.serviceName);
          await supabaseApi.upsertServiceStatus({
            deviceId: command.device_id,
            serviceName: service.serviceName,
            port: snapshot.port,
            status: "stopped",
            publicUrl: null,
            desiredState: snapshot.desiredState,
            lastError: "Agent stopped by remote command.",
            tunnelProvider: tunnelManager.getStatusSnapshot(service.serviceName)?.provider || null,
            ...locationPayload,
          });
        }
        shouldExit = true;
        exitMode = "kill";
        await progress.done("Agent dihentikan.");
      } else {
        const unsupportedMessage = `Unsupported command payload: ${JSON.stringify(command)}`;
        logger.warn(unsupportedMessage, {
          serviceName: command.service_name || null,
          action: command.action,
        });
        await progress.failed(new Error(unsupportedMessage), "unsupported");
      }
    } catch (error) {
      logger.error(
        `Command ${command.action} failed for ${command.service_name || "all services"}: ${error.message}`,
        {
          serviceName: command.service_name || null,
          action: command.action,
        }
      );

      if (command.service_name) {
        await tunnelManager.stopTunnel(command.service_name);
        if (command.action === "stop") {
          if (urlCache) {
            urlCache.clear(command.service_name);
          }
          if (shortcutManager) {
            shortcutManager.syncServiceUrl(command.service_name, null);
          }
        }
        try {
          const snapshot = await serviceManager.refreshService(command.service_name);
          const locationPayload = await buildLocationPayload(command.service_name);
          await supabaseApi.upsertServiceStatus({
            deviceId: command.device_id,
            serviceName: command.service_name,
            port: snapshot.port,
            status: "error",
            publicUrl: publicUrlFormatter(tunnelManager.getPublicUrl(command.service_name)),
            desiredState: snapshot.desiredState,
            lastError: snapshot.lastError || error.message,
            tunnelProvider: tunnelManager.getStatusSnapshot(command.service_name)?.provider || null,
            ...locationPayload,
          });
        } catch (statusError) {
          logger.warn(
            `Failed to publish error status for ${command.service_name}: ${statusError.message}`,
            {
              serviceName: command.service_name,
              action: command.action,
            }
          );
        }
      }
      await progress.failed(error);
    }
  }

  return { shouldExit, exitMode };
}

module.exports = {
  executeCommands,
};
