const fs = require("fs");
const path = require("path");
const logger = require("./logger");

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeShortcutUrl(value) {
  return String(value || "").trim();
}

function normalizeShortcutName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeShortcutStem(value) {
  return String(value || "")
    .trim()
    .replace(/\.url$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

function hasExistingShortcut(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath);
  } catch (_error) {
    return false;
  }
}

function extractShortcutField(existingFields, fieldName) {
  const prefix = `${String(fieldName || "").trim().toLowerCase()}=`;

  for (const line of existingFields) {
    const trimmed = String(line || "").trim();
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }

  return null;
}

function collectShortcutFiles(root, matcher, discovered, seen) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectShortcutFiles(fullPath, matcher, discovered, seen);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!matcher(fullPath, entry.name)) {
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
    this.guestPortal = options.guestPortal || null;
    this.baseDir = options.baseDir || process.cwd();
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

  resolveGuestPortalPaths() {
    const explicitPaths = Array.isArray(this.guestPortal?.filePaths)
      ? this.guestPortal.filePaths.filter(Boolean)
      : [];

    if (explicitPaths.length > 0) {
      return explicitPaths;
    }

    if (this.guestPortal?.fileName) {
      return [path.join(this.baseDir, this.guestPortal.fileName)];
    }

    return [];
  }

  resolveGuestPortalManagedPaths() {
    const candidatePaths = this.resolveGuestPortalPaths();
    const normalizedCandidates = [];
    const seen = new Set();

    for (const filePath of candidatePaths) {
      const token = String(filePath || "").toLowerCase();
      if (!filePath || seen.has(token)) {
        continue;
      }

      seen.add(token);
      normalizedCandidates.push(filePath);
    }

    const existingCandidates = normalizedCandidates.filter((filePath) =>
      hasExistingShortcut(filePath)
    );
    const canonicalPath =
      existingCandidates[0] || normalizedCandidates[0] || null;

    return {
      canonicalPath,
      duplicatePaths: normalizedCandidates.filter(
        (filePath) =>
          filePath &&
          canonicalPath &&
          !hasSamePathIgnoringCase(filePath, canonicalPath) &&
          hasExistingShortcut(filePath)
      ),
    };
  }

  listDiscoveredShortcutPaths(shortcut) {
    const discovered = [];
    const targetName = normalizeShortcutName(shortcut.fileName || "e-Rapor SD.url");
    const targetStem = normalizeShortcutStem(shortcut.fileName || "e-Rapor SD.url");
    const fallbackUrl = normalizeShortcutUrl(shortcut.fallbackUrl || "");
    const iconFile = normalizeShortcutUrl(shortcut.iconFile || "");
    const seen = new Set();
    const matcher = (fullPath, entryName) => {
      if (normalizeShortcutName(entryName) === targetName) {
        return true;
      }

      const stem = normalizeShortcutStem(entryName);
      if (stem && stem === targetStem) {
        return true;
      }

      if (path.extname(entryName).toLowerCase() !== ".url") {
        return false;
      }

      const fields = readShortcutFields(fullPath);
      const urlField = normalizeShortcutUrl(extractShortcutField(fields, "URL") || "");
      const iconField = normalizeShortcutUrl(
        extractShortcutField(fields, "IconFile") || ""
      );

      if (fallbackUrl && urlField && urlField === fallbackUrl) {
        return true;
      }

      if (iconFile && iconField && iconField.toLowerCase() === iconFile.toLowerCase()) {
        return true;
      }

      return false;
    };

    for (const root of shortcut.searchRoots || []) {
      if (!root || !fs.existsSync(root)) {
        continue;
      }
      collectShortcutFiles(root, matcher, discovered, seen);
    }

    return discovered;
  }

  resolveManagedShortcutPaths(serviceName, options = {}) {
    const shortcut = this.getShortcutConfig(serviceName);
    if (!shortcut || shortcut.enabled === false) {
      return { managedPaths: [], duplicatePaths: [] };
    }

    const explicitPaths = Array.isArray(shortcut.filePaths)
      ? shortcut.filePaths.filter(Boolean)
      : [];
    const priorityPaths = Array.isArray(shortcut.priorityPaths)
      ? shortcut.priorityPaths.filter(Boolean)
      : [];
    const existingPriorityPaths = priorityPaths.filter((filePath) => {
      try {
        return fs.existsSync(filePath);
      } catch (_error) {
        return false;
      }
    });
    const discoveredPaths =
      existingPriorityPaths.length > 0 || options.skipDiscoveryIfPriorityMissing
        ? []
        : this.listDiscoveredShortcutPaths(shortcut);
    const combined = [];
    const seen = new Set();

    for (const filePath of [...priorityPaths, ...existingPriorityPaths, ...discoveredPaths, ...explicitPaths]) {
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

  syncServiceUrl(serviceName, publicUrl, options = {}) {
    return;
  }

  syncGuestPortalUrl(deviceId, publicUrl) {
    if (!this.guestPortal?.baseUrl || !this.guestPortal?.fileName || !deviceId) {
      return;
    }

    const baseUrl = String(this.guestPortal.baseUrl).replace(/\/+$/, "");
    const guestUrl = `${baseUrl}/guest/${encodeURIComponent(deviceId)}`;
    const { canonicalPath, duplicatePaths } = this.resolveGuestPortalManagedPaths();
    const shortcutOptions = {
      iconFile: this.guestPortal.iconFile || "",
      iconIndex: this.guestPortal.iconIndex ?? 0,
    };
    const syncedPaths = [];

    if (canonicalPath) {
      try {
        ensureParentDirectory(canonicalPath);
        const existingFields = readShortcutFields(canonicalPath);
        fs.writeFileSync(
          canonicalPath,
          buildInternetShortcutContent(guestUrl, existingFields, shortcutOptions),
          "ascii"
        );
        syncedPaths.push(canonicalPath);
      } catch (error) {
        logger.warn(`Failed to update guest portal shortcut: ${error.message}`, {
          serviceName: "rapor",
          deviceId,
          guestUrl,
          filePath: canonicalPath,
        });
      }
    }

    this.removeDuplicateShortcuts(duplicatePaths);

    this.cache.guestPortal = {
      deviceId,
      guestUrl,
      effectiveUrl: publicUrl || null,
      filePaths: syncedPaths,
      updatedAt: new Date().toISOString(),
    };
    this.writeCache();
  }
}

module.exports = ShortcutManager;
