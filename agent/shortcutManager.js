const fs = require("fs");
const path = require("path");

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeShortcutUrl(value) {
  return String(value || "").trim();
}

function buildInternetShortcutContent(url) {
  return [
    "[InternetShortcut]",
    `URL=${url}`,
    "HotKey=0",
    "",
  ].join("\r\n");
}

class ShortcutManager {
  constructor(options = {}) {
    this.cachePath = options.cachePath || null;
    this.shortcuts = options.shortcuts || {};
    this.cache = this.readCache();
  }

  readCache() {
    if (!this.cachePath || !fs.existsSync(this.cachePath)) {
      return {};
    }

    try {
      return JSON.parse(fs.readFileSync(this.cachePath, "utf8"));
    } catch (error) {
      return {};
    }
  }

  writeCache() {
    if (!this.cachePath) {
      return;
    }

    ensureParentDirectory(this.cachePath);
    fs.writeFileSync(this.cachePath, `${JSON.stringify(this.cache, null, 2)}\n`, "utf8");
  }

  getShortcutConfig(serviceName) {
    return this.shortcuts?.[serviceName] || null;
  }

  syncServiceUrl(serviceName, publicUrl) {
    const shortcut = this.getShortcutConfig(serviceName);
    if (!shortcut || shortcut.enabled === false) {
      return;
    }

    const normalizedPublicUrl = publicUrl ? normalizeShortcutUrl(publicUrl) : null;
    const effectiveUrl = normalizeShortcutUrl(
      normalizedPublicUrl || shortcut.fallbackUrl
    );

    if (!effectiveUrl) {
      return;
    }

    for (const filePath of shortcut.filePaths || []) {
      if (!filePath) {
        continue;
      }

      ensureParentDirectory(filePath);
      fs.writeFileSync(filePath, buildInternetShortcutContent(effectiveUrl), "ascii");
    }

    this.cache[serviceName] = {
      publicUrl: normalizedPublicUrl,
      effectiveUrl,
      updatedAt: new Date().toISOString(),
    };
    this.writeCache();
  }
}

module.exports = ShortcutManager;
