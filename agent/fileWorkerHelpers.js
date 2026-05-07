const fs = require("fs");
const path = require("path");

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function detectMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".txt":
    case ".log":
    case ".json":
    case ".js":
    case ".ts":
    case ".jsx":
    case ".tsx":
    case ".css":
    case ".html":
    case ".xml":
    case ".csv":
    case ".md":
    case ".ini":
    case ".env":
    case ".sql":
      return "text/plain";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

function safeBasename(targetPath, fallback = "artifact") {
  const base = path.basename(String(targetPath || "").trim());
  return base || fallback;
}

function formatArtifactTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function normalizeDirectoryCandidate(targetPath) {
  const normalized = path.resolve(String(targetPath || ""));
  if (!normalized) {
    return normalized;
  }

  try {
    const stats = fs.statSync(normalized);
    if (stats.isFile()) {
      return path.dirname(normalized);
    }
  } catch (error) {
    // Keep the original path when it does not exist yet.
  }

  return normalized;
}

function isConnectivityError(error) {
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
    "temporarily unavailable",
    "network",
  ].some((token) => message.includes(token));
}

function escapePowerShellSingleQuotedString(value) {
  return String(value || "").replace(/'/g, "''");
}

module.exports = {
  detectMimeType,
  ensureDirectory,
  escapePowerShellSingleQuotedString,
  formatArtifactTimestamp,
  isConnectivityError,
  normalizeDirectoryCandidate,
  safeBasename,
};
