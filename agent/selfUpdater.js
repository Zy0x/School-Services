const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { getBaseDir } = require("./utils");

function normalizeVersionToken(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  return normalized.replace(/^v/i, "").toLowerCase();
}

class SelfUpdater {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.intervalMs = Number(options.intervalMs || 300000);
    this.logger = options.logger;
    this.baseDir = options.baseDir || getBaseDir();
    this.buildInfoPath =
      options.buildInfoPath || path.join(this.baseDir, "agent-build.json");
    this.updateScriptPath =
      options.updateScriptPath || path.join(this.baseDir, "update-and-run.ps1");
    this.lastCheckedAt = 0;
    this.lastKnownReleaseTag = null;
    this.lastKnownReleaseVersion = null;
  }

  getPowerShellPath() {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    return path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
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
    const currentReleaseTag = String(buildInfo.releaseTag || "").trim();
    const currentVersion = normalizeVersionToken(buildInfo.version);
    const currentReleaseVersion = normalizeVersionToken(currentReleaseTag);

    this.lastKnownReleaseTag = latestReleaseTag || null;
    this.lastKnownReleaseVersion = latestReleaseVersion || null;

    const updateAvailable = Boolean(
      latestReleaseTag &&
        !(
          (currentReleaseTag && currentReleaseTag === latestReleaseTag) ||
          (currentVersion && currentVersion === latestReleaseVersion) ||
          (currentReleaseVersion && currentReleaseVersion === latestReleaseVersion)
        )
    );

    return {
      checked: true,
      updateAvailable,
      latestReleaseTag,
      latestReleaseVersion,
      currentReleaseTag,
      currentVersion,
    };
  }

  launchUpdater() {
    if (!fs.existsSync(this.updateScriptPath)) {
      throw new Error(`Update script not found: ${this.updateScriptPath}`);
    }

    const child = spawn(
      this.getPowerShellPath(),
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
