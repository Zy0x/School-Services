const logger = require("./logger");
const SelfUpdater = require("./selfUpdater");

const { buildUpdateStateFromCheck } = SelfUpdater;

async function executeCommands({
  commands,
  serviceManager,
  tunnelManager,
  supabaseApi,
  shortcutManager,
  urlCache,
  selfUpdater,
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

  for (const command of commands) {
    logger.info(
      `Executing command ${command.action} for ${command.service_name || "all services"}`,
      {
        serviceName: command.service_name || null,
        action: command.action,
      }
    );

    try {
      if (command.action === "start" && command.service_name) {
        serviceManager.setDesiredState(command.service_name, "running", "remote-start");
        const snapshot = await serviceManager.startService(command.service_name);
        const locationPayload = await buildLocationPayload(command.service_name);
        await supabaseApi.upsertServiceStatus({
          deviceId: command.device_id,
          serviceName: command.service_name,
          port: snapshot.port,
          status: snapshot.status,
          publicUrl: tunnelManager.getPublicUrl(command.service_name),
          desiredState: snapshot.desiredState,
          lastError: snapshot.lastError,
          ...locationPayload,
        });
        logger.info(`Command start completed for ${command.service_name}`, {
          serviceName: command.service_name,
          status: snapshot.status,
          desiredState: snapshot.desiredState,
        });
      } else if (command.action === "stop" && command.service_name) {
        serviceManager.setDesiredState(command.service_name, "stopped", "remote-stop");
        const snapshot = await serviceManager.stopService(command.service_name);
        await tunnelManager.suspendTunnel(command.service_name);
        if (urlCache) {
          urlCache.clear(command.service_name);
        }
        if (shortcutManager) {
          shortcutManager.syncServiceUrl(command.service_name, null);
        }
        const locationPayload = await buildLocationPayload(command.service_name);
        await supabaseApi.upsertServiceStatus({
          deviceId: command.device_id,
          serviceName: command.service_name,
          port: snapshot.port,
          status: snapshot.status,
          publicUrl: null,
          desiredState: snapshot.desiredState,
          lastError: snapshot.lastError,
          ...locationPayload,
        });
        logger.info(`Command stop completed for ${command.service_name}`, {
          serviceName: command.service_name,
          status: snapshot.status,
          desiredState: snapshot.desiredState,
          publicUrl: null,
        });
      } else if (command.action === "kill") {
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
            ...locationPayload,
          });
        }
        shouldExit = true;
        exitMode = "kill";
      } else if (command.action === "update") {
        if (!selfUpdater) {
          throw new Error("Self updater is not available.");
        }

        const check = await selfUpdater.checkForUpdate(true);
        const now = new Date().toISOString();
        const updateState = buildUpdateStateFromCheck(check, {
          ...(check.updateAvailable
            ? {
                updateStatus: "updating",
                updateStartedAt: now,
                updateError: null,
              }
            : {}),
          updateCheckedAt: now,
        });
        await supabaseApi.updateDeviceUpdateState({
          deviceId: command.device_id,
          ...updateState,
        });

        if (!check.updateAvailable) {
          logger.info("Update command skipped because no newer GitHub release is available.", {
            serviceName: null,
            currentVersion: check.currentVersion,
            latestReleaseTag: check.latestReleaseTag,
          });
        } else {
          await tunnelManager.stopAll();
          for (const service of serviceManager.list()) {
            if (urlCache) {
              urlCache.clear(service.serviceName);
            }
            if (shortcutManager) {
              shortcutManager.syncServiceUrl(service.serviceName, null);
            }
            const snapshot = await serviceManager.stopService(service.serviceName);
            const locationPayload = await buildLocationPayload(service.serviceName);
            await supabaseApi.upsertServiceStatus({
              deviceId: command.device_id,
              serviceName: service.serviceName,
              port: snapshot.port,
              status: "stopped",
              publicUrl: null,
              desiredState: snapshot.desiredState,
              lastError: "Agent update is running.",
              ...locationPayload,
            });
          }
          selfUpdater.launchUpdater();
          shouldExit = true;
          exitMode = "update";
        }
      } else {
        logger.warn(`Unsupported command payload: ${JSON.stringify(command)}`, {
          serviceName: command.service_name || null,
          action: command.action,
        });
      }
    } catch (error) {
      logger.error(
        `Command ${command.action} failed for ${command.service_name || "all services"}: ${error.message}`,
        {
          serviceName: command.service_name || null,
          action: command.action,
        }
      );

      if (command.action === "update") {
        try {
          await supabaseApi.updateDeviceUpdateState({
            deviceId: command.device_id,
            updateAvailable: false,
            updateStatus: "failed",
            updateCheckedAt: new Date().toISOString(),
            updateStartedAt: null,
            updateError: error.message,
          });
        } catch (publishError) {
          logger.warn(`Failed to publish update command error: ${publishError.message}`);
        }
      }

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
            publicUrl: tunnelManager.getPublicUrl(command.service_name),
            desiredState: snapshot.desiredState,
            lastError: snapshot.lastError || error.message,
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
    } finally {
      await supabaseApi.markCommandDone(command.id);
    }
  }

  return { shouldExit, exitMode };
}

module.exports = {
  executeCommands,
};
