const os = require("os");
const { readLocalBuildInfo } = require("./buildInfo");
const { sha256 } = require("./utils");

function createDeviceMetadata(overrides = {}) {
  const hostname = os.hostname();
  const platform = os.platform();
  const seed = `${hostname}:${platform}`;
  const buildInfo = readLocalBuildInfo();

  return {
    deviceId: sha256(seed).slice(0, 24),
    deviceName: overrides.deviceName || hostname,
    platform,
    hostname,
    appVersion: buildInfo.version,
    releaseTag: buildInfo.releaseTag,
    buildCommit: buildInfo.commit,
    builtAt: buildInfo.builtAt,
  };
}

module.exports = {
  createDeviceMetadata,
};
