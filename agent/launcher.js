#!/usr/bin/env node

const { loadConfig } = require("./config");
const { createDeviceMetadata } = require("./device");
const { ensureProcessPathEntries } = require("./environment");
const { getInstallDir } = require("./paths");
const ShortcutManager = require("./shortcutManager");
const { startUrlInBrowser } = require("./windows");

function main() {
  ensureProcessPathEntries();
  const config = loadConfig();
  const device = createDeviceMetadata({ deviceName: config.deviceName });
  const shortcutManager = new ShortcutManager({
    guestPortal: config.guestPortal,
    baseDir: getInstallDir(),
  });
  const guestPortalUrl = shortcutManager.getGuestPortalUrl(device.deviceId);

  if (!guestPortalUrl) {
    throw new Error("Guest portal URL is not configured.");
  }

  startUrlInBrowser(guestPortalUrl);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
