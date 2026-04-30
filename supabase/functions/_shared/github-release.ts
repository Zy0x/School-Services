type DeviceUpdateRecord = Record<string, unknown>;

type LatestReleaseInfo = {
  checkedAt: string;
  releaseTag: string | null;
  version: string | null;
  assetName: string | null;
};

let cachedLatestRelease: LatestReleaseInfo | null = null;
let cachedLatestReleaseAt = 0;

function normalizeVersionToken(value: unknown) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.replace(/^v/i, "");
}

function parseVersionParts(value: unknown) {
  const match = normalizeVersionToken(value).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersionParts(left: number[], right: number[]) {
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function resolveInstallerAssetNames(version: string) {
  if (!version) {
    return [];
  }
  return [
    `School Services v${version}.exe`,
    `School.Services.v${version}.exe`,
  ];
}

function getReleaseHeaders() {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "school-services-edge-release-check",
  });
  const token = Deno.env.get("GITHUB_TOKEN") || Deno.env.get("GH_TOKEN") || "";
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export async function getLatestGitHubRelease(force = false): Promise<LatestReleaseInfo | null> {
  const now = Date.now();
  if (!force && cachedLatestRelease && now - cachedLatestReleaseAt < 60000) {
    return cachedLatestRelease;
  }

  const owner = Deno.env.get("GITHUB_RELEASE_OWNER") || "Zy0x";
  const repo = Deno.env.get("GITHUB_RELEASE_REPO") || "School-Services";
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: getReleaseHeaders(),
  });

  if (!response.ok) {
    return cachedLatestRelease;
  }

  const release = await response.json();
  const releaseTag = String(release?.tag_name || "").trim() || null;
  const version = normalizeVersionToken(releaseTag) || null;
  const assetNames = resolveInstallerAssetNames(version || "");
  const asset = Array.isArray(release?.assets)
    ? release.assets.find((item: Record<string, unknown>) =>
        assetNames.includes(String(item?.name || ""))
      )
    : null;

  cachedLatestRelease = {
    checkedAt: new Date().toISOString(),
    releaseTag,
    version,
    assetName: asset?.name ? String(asset.name) : null,
  };
  cachedLatestReleaseAt = now;
  return cachedLatestRelease;
}

export function applyLatestReleaseToDevice<T extends DeviceUpdateRecord>(
  device: T,
  latestRelease: LatestReleaseInfo | null
): T {
  if (!device || !latestRelease?.version || !latestRelease.releaseTag) {
    return device;
  }

  const localVersion =
    normalizeVersionToken(device.app_version) ||
    normalizeVersionToken(device.release_tag);
  const localParts = parseVersionParts(localVersion);
  const latestParts = parseVersionParts(latestRelease.version);
  const checkedAt = latestRelease.checkedAt || String(device.update_checked_at || "");
  const dbStatus = String(device.update_status || "unchecked").trim();
  const isUpdating = dbStatus === "updating";
  const updateAvailable = Boolean(
    latestRelease.assetName &&
      localParts &&
      latestParts &&
      compareVersionParts(latestParts, localParts) > 0
  );
  const isCurrent = Boolean(
    localParts && latestParts && compareVersionParts(localParts, latestParts) >= 0
  );

  return {
    ...device,
    latest_release_tag: latestRelease.releaseTag,
    latest_version: latestRelease.version,
    update_asset_name: latestRelease.assetName,
    update_checked_at: checkedAt || device.update_checked_at || null,
    update_available: isUpdating ? Boolean(device.update_available) : updateAvailable,
    update_status: isUpdating
      ? "updating"
      : updateAvailable
        ? "available"
        : isCurrent
          ? "current"
          : dbStatus || "unchecked",
    update_error: latestRelease.assetName
      ? device.update_error || null
      : "Latest GitHub release tidak memiliki asset installer yang didukung.",
  };
}
