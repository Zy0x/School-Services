const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { VERSIONED_INSTALLER_PREFIX } = require("./appConstants");
const { getBuildInfoPath, getInstallDir } = require("./paths");
const { getPowerShellPath } = require("./windows");

function normalizeVersionToken(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  return normalized.replace(/^v/i, "").toLowerCase();
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

function resolveReleaseAssetNames(version) {
  const normalizedVersion = normalizeVersionToken(version);
  if (!normalizedVersion) {
    return [];
  }

  return [
    `${VERSIONED_INSTALLER_PREFIX}${normalizedVersion}.exe`,
    `School.Services.v${normalizedVersion}.exe`,
  ];
}

function buildUpdateStateFromCheck(check, overrides = {}) {
  const updateAvailable = Boolean(check?.updateAvailable);
  let updateStatus = updateAvailable ? "available" : "current";
  let updateError = null;

  if (check?.reason === "missing-build-info") {
    updateStatus = "failed";
    updateError = "Build metadata is missing.";
  } else if (check?.latestReleaseVersion && !check?.matchingAssetName) {
    updateStatus = "failed";
    updateError = "Latest release does not contain a supported installer asset.";
  }

  return {
    latestReleaseTag: check?.latestReleaseTag || null,
    latestVersion: check?.latestReleaseVersion || null,
    updateAvailable,
    updateStatus,
    updateError,
    updateAssetName: check?.matchingAssetName || null,
    ...overrides,
  };
}

class SelfUpdater {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.intervalMs = Number(options.intervalMs || 300000);
    this.logger = options.logger;
    this.baseDir = options.baseDir || getInstallDir();
    this.buildInfoPath = options.buildInfoPath || getBuildInfoPath();
    this.updateScriptPath =
      options.updateScriptPath || path.join(this.baseDir, "update-and-run.ps1");
    this.lastCheckedAt = 0;
    this.lastKnownReleaseTag = null;
    this.lastKnownReleaseVersion = null;
  }

  log(level, message, details = {}) {
    if (!this.logger || typeof this.logger[level] !== "function") {
      return;
    }

    this.logger[level](message, {
      serviceName: null,
      ...details,
    });
  }

  readBuildInfo() {
    if (!fs.existsSync(this.buildInfoPath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(this.buildInfoPath, "utf8"));
    } catch (error) {
      this.log("warn", `Failed to read agent-build.json: ${error.message}`);
      return null;
    }
  }

  getRequestHeaders() {
    const headers = {
      "User-Agent": "e-rapor-agent-self-updater",
    };

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  async fetchJson(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: this.getRequestHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while requesting ${url}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async getLatestRelease(buildInfo) {
    if (!buildInfo?.owner || !buildInfo?.repo) {
      throw new Error("Build info is missing GitHub owner/repo metadata.");
    }

    const releaseChannel = String(buildInfo.releaseChannel || "latest");
    const base = `https://api.github.com/repos/${buildInfo.owner}/${buildInfo.repo}/releases`;
    const url =
      releaseChannel === "latest"
        ? `${base}/latest`
        : `${base}/tags/${releaseChannel}`;

    return this.fetchJson(url);
  }

  shouldCheck(now = Date.now()) {
    return this.enabled && now - this.lastCheckedAt >= this.intervalMs;
  }

  async checkForUpdate(force = false) {
    if (!this.enabled) {
      return { checked: false, updateAvailable: false };
    }

    const now = Date.now();
    if (!force && !this.shouldCheck(now)) {
      return { checked: false, updateAvailable: false };
    }

    this.lastCheckedAt = now;
    const buildInfo = this.readBuildInfo();
    if (!buildInfo) {
      return { checked: true, updateAvailable: false, reason: "missing-build-info" };
    }

    const latestRelease = await this.getLatestRelease(buildInfo);
    const latestReleaseTag = String(latestRelease.tag_name || "").trim();
    const latestReleaseVersion = normalizeVersionToken(latestReleaseTag);
    const expectedAssetNames = resolveReleaseAssetNames(latestReleaseVersion);
    const matchingAsset = Array.isArray(latestRelease.assets)
      ? latestRelease.assets.find((asset) => expectedAssetNames.includes(String(asset?.name || "")))
      : null;
    const currentReleaseTag = String(buildInfo.releaseTag || "").trim();
    const currentVersion = normalizeVersionToken(buildInfo.version);
    const currentReleaseVersion = normalizeVersionToken(currentReleaseTag);
    const latestVersionParts = parseVersionParts(latestReleaseVersion);
    const currentVersionParts =
      parseVersionParts(currentVersion) || parseVersionParts(currentReleaseVersion);

    this.lastKnownReleaseTag = latestReleaseTag || null;
    this.lastKnownReleaseVersion = latestReleaseVersion || null;

    let updateAvailable = false;
    if (latestReleaseTag) {
      if (
        (currentReleaseTag && currentReleaseTag === latestReleaseTag) ||
        (currentVersion && currentVersion === latestReleaseVersion) ||
        (currentReleaseVersion && currentReleaseVersion === latestReleaseVersion)
      ) {
        updateAvailable = false;
      } else if (latestVersionParts && currentVersionParts) {
        updateAvailable = compareVersionParts(latestVersionParts, currentVersionParts) > 0;
      }
    }

    return {
      checked: true,
      updateAvailable: updateAvailable && Boolean(matchingAsset),
      expectedAssetNames,
      latestReleaseTag,
      latestReleaseVersion,
      matchingAssetName: matchingAsset?.name || null,
      currentReleaseTag,
      currentVersion,
    };
  }

  launchUpdater() {
    if (!fs.existsSync(this.updateScriptPath)) {
      throw new Error(`Update script not found: ${this.updateScriptPath}`);
    }

    const child = spawn(
      getPowerShellPath(),
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
        this.updateScriptPath,
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        cwd: this.baseDir,
      }
    );

    child.unref();
  }
}

module.exports = SelfUpdater;
module.exports.buildUpdateStateFromCheck = buildUpdateStateFromCheck;
