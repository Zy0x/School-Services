export const REMOTE_UPDATE_MIN_VERSION = "2.0.3";

export function formatVersionLabel(version, releaseTag) {
  const normalizedReleaseTag = String(releaseTag || "").trim();
  if (normalizedReleaseTag) {
    return normalizedReleaseTag;
  }

  const normalizedVersion = String(version || "").trim();
  if (!normalizedVersion) {
    return "belum dilaporkan";
  }

  return normalizedVersion.startsWith("v") ? normalizedVersion : `v${normalizedVersion}`;
}

function normalizeVersionToken(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function parseVersionParts(value) {
  const match = normalizeVersionToken(value).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersionParts(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function getDeviceVersionToken(deviceRecord) {
  return (
    normalizeVersionToken(deviceRecord?.app_version || deviceRecord?.appVersion) ||
    normalizeVersionToken(deviceRecord?.release_tag || deviceRecord?.releaseTag)
  );
}

export function supportsRemoteUpdate(deviceRecord) {
  const localParts = parseVersionParts(getDeviceVersionToken(deviceRecord));
  const minParts = parseVersionParts(REMOTE_UPDATE_MIN_VERSION);
  return Boolean(localParts && minParts && compareVersionParts(localParts, minParts) >= 0);
}

function getDeviceVersionLabel(deviceRecord) {
  return formatVersionLabel(
    deviceRecord?.app_version || deviceRecord?.appVersion,
    deviceRecord?.release_tag || deviceRecord?.releaseTag
  );
}

function getDeviceLatestVersionLabel(deviceRecord) {
  return formatVersionLabel(
    deviceRecord?.latest_version || deviceRecord?.latestVersion,
    deviceRecord?.latest_release_tag || deviceRecord?.latestReleaseTag
  );
}

export function getDeviceUpdateModel(deviceRecord) {
  const status = String(deviceRecord?.update_status || deviceRecord?.updateStatus || "unchecked").trim();
  const updateAvailable = Boolean(deviceRecord?.update_available ?? deviceRecord?.updateAvailable);
  const checkedAt = deviceRecord?.update_checked_at || deviceRecord?.updateCheckedAt || null;
  const startedAt = deviceRecord?.update_started_at || deviceRecord?.updateStartedAt || null;
  const error = deviceRecord?.update_error || deviceRecord?.updateError || "";
  const localVersion = getDeviceVersionLabel(deviceRecord);
  const latestVersion = getDeviceLatestVersionLabel(deviceRecord);
  const normalizedStatus =
    status === "updating"
      ? "updating"
      : status === "failed"
        ? "failed"
        : updateAvailable
          ? "available"
          : status === "current"
            ? "current"
            : "unchecked";
  const labels = {
    available: "Update tersedia",
    current: "Sudah terbaru",
    updating: "Sedang update",
    failed: "Gagal update",
    unchecked: "Belum dicek",
  };

  return {
    status: normalizedStatus,
    label: labels[normalizedStatus] || labels.unchecked,
    toneStatus:
      normalizedStatus === "current"
        ? "ready"
        : normalizedStatus === "available" || normalizedStatus === "updating"
          ? "reconnecting"
          : normalizedStatus === "failed"
            ? "failed"
            : "unknown",
    localVersion,
    latestVersion,
    checkedAt,
    startedAt,
    error,
    updateAvailable,
  };
}

export function getUpdateStatusSummary(update) {
  if (update.status === "current") {
    return "Versi agent sudah sinkron dengan rilis terbaru.";
  }
  if (update.status === "available") {
    return `Update ${update.latestVersion || "terbaru"} siap dipasang dari panel ini.`;
  }
  if (update.status === "updating") {
    return "Agent sedang memasang pembaruan. Tunggu sampai layanan aktif kembali.";
  }
  if (update.status === "failed") {
    return "Update terakhir gagal. Periksa detail error agent.";
  }
  return "Versi agent perangkat ini belum dilaporkan ke dashboard.";
}
