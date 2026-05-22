const fs = require("fs");

const path = require("path");

const { getDataDir, getInstallDir, getStateDir } = require("./paths");



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

  if (tunnelSnapshot.state === "reconnecting") {
    return "reconnecting";
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

function shouldRefreshTunnelsAfterReconnect(disconnectedMs, thresholdMs) {
  const gap = Number(disconnectedMs || 0);
  const threshold = Number(thresholdMs || 0);
  return Number.isFinite(gap) && Number.isFinite(threshold) && threshold > 0 && gap >= threshold;
}

function formatRemoteError(error) {
  if (!error) {
    return "Unknown remote error";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object") {
    const parts = [
      error.message,
      error.code ? `code=${error.code}` : null,
      error.status ? `status=${error.status}` : null,
      error.details ? `details=${error.details}` : null,
      error.hint ? `hint=${error.hint}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join("; ") : JSON.stringify(error);
  }
  return String(error);
}

function buildServiceLocalUrl(service) {
  const host = String(service?.host || "127.0.0.1").trim();
  const normalizedHost =
    host === "127.0.0.1" || host === "::1" ? "localhost" : host;
  const port = Number(service?.port || 0);

  if (!Number.isFinite(port) || port <= 0) {
    return `http://${normalizedHost}`;
  }

  return `http://${normalizedHost}:${port}`;
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



module.exports = {

  buildPendingCommandState,

  buildServiceLocalUrl,

  derivePublishedStatus,

  formatRemoteError,

  isSupabaseConnectivityError,

  shouldRefreshTunnelsAfterReconnect,

  writeDeviceState,

};
