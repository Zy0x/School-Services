const fs = require("fs");
const path = require("path");
const { getRuntimeDir } = require("./paths");
const { fileExists, sha256 } = require("./utils");

function getBundledCloudflaredSnapshotPath() {
  return path.resolve(__dirname, "..", "cloudflared.exe");
}

function getBundledCloudflaredRuntimePath() {
  return path.join(getRuntimeDir(), "cloudflared.exe");
}

function ensureBundledCloudflared() {
  if (!process.pkg) {
    return null;
  }

  const snapshotPath = getBundledCloudflaredSnapshotPath();
  if (!fileExists(snapshotPath)) {
    return null;
  }

  const runtimePath = getBundledCloudflaredRuntimePath();
  const hashPath = `${runtimePath}.sha256`;
  const payload = fs.readFileSync(snapshotPath);
  const nextHash = sha256(payload);

  if (fileExists(runtimePath) && fileExists(hashPath)) {
    try {
      const currentHash = fs.readFileSync(hashPath, "utf8").trim();
      if (currentHash === nextHash) {
        return runtimePath;
      }
    } catch (error) {
      // Re-extract on read errors.
    }
  }

  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  fs.writeFileSync(runtimePath, payload);
  fs.writeFileSync(hashPath, `${nextHash}\n`, "utf8");
  return runtimePath;
}

module.exports = {
  ensureBundledCloudflared,
};
