const fs = require("fs");
const path = require("path");

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeShortcutUrl(value) {
  return String(value || "").trim();
}

function normalizeShortcutName(value) {
  return String(value || "").trim().toLowerCase();
}

function hasSamePathIgnoringCase(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function readShortcutFields(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  return content.split(/\r?\n/).filter((line) => line.trim() !== "");
}

function collectShortcutFiles(root, targetName, discovered, seen) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectShortcutFiles(fullPath, targetName, discovered, seen);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (normalizeShortcutName(entry.name) !== targetName) {
      continue;
    }

    const token = fullPath.toLowerCase();
    if (seen.has(token)) {
      continue;
    }

    seen.add(token);
    discovered.push(fullPath);
  }
}

function buildInternetShortcutContent(url, existingFields = [], shortcutConfig = {}) {
  const preservedFields = [];
  const seenKeys = new Set(["url"]);

  for (const line of existingFields) {
    if (!line || line.trim() === "[InternetShortcut]") {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    const normalizedKey = key.toLowerCase();
    if (seenKeys.has(normalizedKey)) {
      continue;
    }

    preservedFields.push(line);
    seenKeys.add(normalizedKey);
  }

  if (!seenKeys.has("hotkey")) {
    preservedFields.push("HotKey=0");
    seenKeys.add("hotkey");
  }

  if (shortcutConfig.iconFile && !seenKeys.has("iconfile")) {
    preservedFields.push(`IconFile=${shortcutConfig.iconFile}`);
    seenKeys.add("iconfile");
  }

  if (
    shortcutConfig.iconIndex !== undefined &&
    shortcutConfig.iconIndex !== null &&
    !seenKeys.has("iconindex")
  ) {
    preservedFields.push(`IconIndex=${shortcutConfig.iconIndex}`);
  }

  return ["[InternetShortcut]", `URL=${url}`, ...preservedFields, ""].join("\r\n");
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

  listDiscoveredShortcutPaths(shortcut) {
    const discovered = [];
    const targetName = normalizeShortcutName(shortcut.fileName || "e-Rapor SD.url");
    const seen = new Set();

    for (const root of shortcut.searchRoots || []) {
      if (!root || !fs.existsSync(root)) {
        continue;
      }
      collectShortcutFiles(root, targetName, discovered, seen);
    }

    return discovered;
  }

  resolveManagedShortcutPaths(serviceName) {
    const shortcut = this.getShortcutConfig(serviceName);
    if (!shortcut || shortcut.enabled === false) {
      return { managedPaths: [], duplicatePaths: [] };
    }

    const explicitPaths = Array.isArray(shortcut.filePaths)
      ? shortcut.filePaths.filter(Boolean)
      : [];
    const discoveredPaths = this.listDiscoveredShortcutPaths(shortcut);
    const combined = [];
    const seen = new Set();

    for (const filePath of [...discoveredPaths, ...explicitPaths]) {
      const token = String(filePath || "").toLowerCase();
      if (!filePath || seen.has(token)) {
        continue;
      }

      seen.add(token);
      combined.push(filePath);
    }

    if (combined.length === 0) {
      const primaryRoot = (shortcut.searchRoots || []).find(Boolean);
      if (primaryRoot) {
        combined.push(path.join(primaryRoot, shortcut.fileName || "e-Rapor SD.url"));
      }
    }
    return {
      managedPaths: combined,
      duplicatePaths: [],
    };
  }

  removeDuplicateShortcuts(filePaths) {
    for (const filePath of filePaths) {
      if (!filePath || !fs.existsSync(filePath)) {
        continue;
      }

      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        // Keep going; do not break sync because one duplicate could not be removed.
      }
    }
  }

  ensureCanonicalShortcutPath(filePath, shortcut) {
    if (!filePath || !shortcut?.fileName) {
      return filePath;
    }

    const canonicalPath = path.join(path.dirname(filePath), shortcut.fileName);
    if (filePath === canonicalPath) {
      return filePath;
    }

    if (!hasSamePathIgnoringCase(filePath, canonicalPath)) {
      return filePath;
    }

    try {
      const tempPath = path.join(
        path.dirname(filePath),
        `.__shortcut-rename-${Date.now()}.url`
      );
      fs.renameSync(filePath, tempPath);
      fs.renameSync(tempPath, canonicalPath);
      return canonicalPath;
    } catch (error) {
      return filePath;
    }
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

    const { managedPaths, duplicatePaths } = this.resolveManagedShortcutPaths(serviceName);
    this.removeDuplicateShortcuts(duplicatePaths);

    const syncedPaths = [];
    for (const originalPath of managedPaths) {
      const filePath = this.ensureCanonicalShortcutPath(originalPath, shortcut);

      try {
        ensureParentDirectory(filePath);
        const existingFields = readShortcutFields(filePath);
        fs.writeFileSync(
          filePath,
          buildInternetShortcutContent(effectiveUrl, existingFields, shortcut),
          "ascii"
        );
        if (filePath !== originalPath && fs.existsSync(originalPath)) {
          this.removeDuplicateShortcuts([originalPath]);
        }
        syncedPaths.push(filePath);
      } catch (error) {
        // Continue syncing other known shortcut locations.
      }
    }

    this.cache[serviceName] = {
      publicUrl: normalizedPublicUrl,
      effectiveUrl,
      filePaths: syncedPaths.length > 0 ? syncedPaths : managedPaths,
      updatedAt: new Date().toISOString(),
    };
    this.writeCache();
  }
}

module.exports = ShortcutManager;
