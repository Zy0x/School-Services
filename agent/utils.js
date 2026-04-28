const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const {
  getDataDir,
  getInstallDir,
  getRepoRoot,
  getRuntimeConfigPath: getDefaultRuntimeConfigPath,
} = require("./paths");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function normalizePublicUrl(url) {
  return ensureTrailingSlash(url.trim()).replace(/\/+$/, "/");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectEol(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(baseValue, overrideValue) {
  if (overrideValue === undefined) {
    return baseValue;
  }

  if (Array.isArray(baseValue) && Array.isArray(overrideValue)) {
    const maxLength = Math.max(baseValue.length, overrideValue.length);
    return Array.from({ length: maxLength }, (_, index) => {
      const baseItem = baseValue[index];
      const overrideItem = overrideValue[index];

      if (overrideItem === undefined) {
        return baseItem;
      }

      if (isPlainObject(baseItem) && isPlainObject(overrideItem)) {
        return deepMerge(baseItem, overrideItem);
      }

      return overrideItem;
    });
  }

  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    const merged = { ...baseValue };

    for (const [key, value] of Object.entries(overrideValue)) {
      merged[key] = deepMerge(baseValue[key], value);
    }

    return merged;
  }

  return overrideValue;
}

function resolveExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return candidates.find(Boolean) || null;
}

function resolveFirstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getBaseDir() {
  return getInstallDir();
}

function getWritableDataDir() {
  return getDataDir();
}

function getProjectRoot() {
  return getRepoRoot();
}

function buildAncestorCandidates(startDir, relativeFile) {
  const candidates = [];
  let currentDir = startDir;

  for (let index = 0; index < 5; index += 1) {
    candidates.push(path.join(currentDir, relativeFile));
    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return candidates;
}

function getRuntimeConfigPath() {
  const candidates = [
    getDefaultRuntimeConfigPath(),
    ...buildAncestorCandidates(process.cwd(), "agent.runtime.json"),
    ...buildAncestorCandidates(getBaseDir(), "agent.runtime.json"),
  ];

  return resolveFirstExistingPath(candidates);
}

function readJsonFile(filePath, fallback) {
  if (!filePath || !fileExists(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isPortOpen(port, host = "127.0.0.1", timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isPortOpen(port, host)) {
      return true;
    }

    await sleep(500);
  }

  return false;
}

module.exports = {
  deepMerge,
  detectEol,
  ensureTrailingSlash,
  escapeRegex,
  fileExists,
  getBaseDir,
  getProjectRoot,
  getRuntimeConfigPath,
  getWritableDataDir,
  isPortOpen,
  normalizePublicUrl,
  readJsonFile,
  buildAncestorCandidates,
  resolveFirstExistingPath,
  resolveExistingPath,
  sha256,
  sleep,
  waitForPort,
};
