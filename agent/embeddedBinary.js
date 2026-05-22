const fs = require("fs");
const path = require("path");
const { getInstallDir, getRuntimeDir } = require("./paths");
const { fileExists, sha256 } = require("./utils");

function getBundledCloudflaredSnapshotPath() {
  return path.resolve(__dirname, "..", "cloudflared.exe");
}

function getBundledCloudflaredRuntimePath() {
  return path.join(getRuntimeDir(), "cloudflared.exe");
}

function clearWindowsDownloadZone(filePath) {
  if (process.platform !== "win32" || !filePath) {
    return;
  }

  try {
    fs.unlinkSync(`${filePath}:Zone.Identifier`);
  } catch (_error) {
    // Zone.Identifier is optional; missing or locked streams must not block startup.
  }
}

function ensureExecutableAccess(filePath) {
  if (!filePath || !fileExists(filePath)) {
    return null;
  }

  clearWindowsDownloadZone(filePath);
  try {
    fs.chmodSync(filePath, 0o755);
  } catch (_error) {
    // Windows ACLs are handled by install scripts; chmod is best-effort only.
  }
  return filePath;
}

function copyRuntimeBinary(sourcePath, runtimePath) {
  if (!sourcePath || !runtimePath || !fileExists(sourcePath)) {
    return null;
  }

  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  const sourcePayload = fs.readFileSync(sourcePath);
  const sourceHash = sha256(sourcePayload);
  const hashPath = `${runtimePath}.sha256`;

  if (fileExists(runtimePath) && fileExists(hashPath)) {
    try {
      const currentHash = fs.readFileSync(hashPath, "utf8").trim();
      if (currentHash === sourceHash) {
        return ensureExecutableAccess(runtimePath);
      }
    } catch (_error) {
      // Re-copy below.
    }
  }

  fs.writeFileSync(runtimePath, sourcePayload);
  fs.writeFileSync(hashPath, `${sourceHash}\n`, "utf8");
  return ensureExecutableAccess(runtimePath);
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
  return copyRuntimeBinary(snapshotPath, runtimePath);
}

function ensureRuntimeBinaryFromInstall(fileName) {
  const installPath = path.join(getInstallDir(), fileName);
  const runtimePath = path.join(getRuntimeDir(), fileName);
  return copyRuntimeBinary(installPath, runtimePath);
}

module.exports = {
  clearWindowsDownloadZone,
  ensureExecutableAccess,
  ensureBundledCloudflared,
  ensureRuntimeBinaryFromInstall,
};
