const fs = require("fs");
const packageJson = require("./package.json");
const { getBuildInfoPath } = require("./paths");

function normalizeReleaseTag(version, releaseTag) {
  const explicit = String(releaseTag || "").trim();
  if (explicit) {
    return explicit;
  }

  const normalizedVersion = String(version || "").trim();
  return normalizedVersion ? `v${normalizedVersion.replace(/^v/i, "")}` : "";
}

function readLocalBuildInfo() {
  const fallbackVersion = String(packageJson.version || "0.0.0").trim() || "0.0.0";
  const fallback = {
    version: fallbackVersion,
    releaseTag: normalizeReleaseTag(fallbackVersion, packageJson.releaseTag),
    commit: null,
    builtAt: null,
  };

  try {
    const raw = fs.readFileSync(getBuildInfoPath(), "utf8");
    const parsed = JSON.parse(raw);
    const version = String(parsed?.version || fallback.version).trim() || fallback.version;
    return {
      version,
      releaseTag: normalizeReleaseTag(version, parsed?.releaseTag || fallback.releaseTag),
      commit: String(parsed?.commit || "").trim() || null,
      builtAt: String(parsed?.builtAt || "").trim() || null,
    };
  } catch (_error) {
    return fallback;
  }
}

module.exports = {
  readLocalBuildInfo,
};
