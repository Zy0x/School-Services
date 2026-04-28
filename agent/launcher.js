#!/usr/bin/env node

const path = require("path");
const { STARTUP_TASK_NAME } = require("./appConstants");
const { loadConfig } = require("./config");
const { createDeviceMetadata } = require("./device");
const { ensureProcessPathEntries } = require("./environment");
const { getAgentExePath, getInstallDir } = require("./paths");
const ShortcutManager = require("./shortcutManager");
const {
  fileExists,
  runPowerShellScript,
  startDetachedHidden,
  startUrlInBrowser,
} = require("./windows");

function ensureStartupTaskOrStartAgent(agentExePath) {
  try {
    const taskName = STARTUP_TASK_NAME.replace(/'/g, "''");
    const taskState = runPowerShellScript(
      [
        `$task = Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue`,
        "if (-not $task) { Write-Output 'missing'; exit 0 }",
        "try {",
        "  Start-ScheduledTask -TaskName $task.TaskName -ErrorAction Stop",
        "  Write-Output 'started'",
        "} catch {",
        "  Write-Output 'fallback'",
        "}",
      ].join("; "),
      { hidden: true }
    ).trim();

    if (taskState === "started") {
      return;
    }
  } catch (_error) {
    // Fall back to starting the agent directly when the task is missing or inaccessible.
  }

  if (fileExists(agentExePath)) {
    startDetachedHidden(agentExePath, [], path.dirname(agentExePath));
  }
}

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

  ensureStartupTaskOrStartAgent(getAgentExePath());
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
