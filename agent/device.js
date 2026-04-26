const os = require("os");
const { sha256 } = require("./utils");

function createDeviceMetadata(overrides = {}) {
  const hostname = os.hostname();
  const platform = os.platform();
  const seed = `${hostname}:${platform}`;

  return {
    deviceId: sha256(seed).slice(0, 24),
    deviceName: overrides.deviceName || hostname,
    platform,
    hostname,
  };
}

module.exports = {
  createDeviceMetadata,
};
