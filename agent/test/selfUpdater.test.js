const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const SelfUpdater = require("../selfUpdater");

function createUpdaterFixture(buildInfo = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erapor-agent-update-"));
  const buildInfoPath = path.join(dir, "agent-build.json");
  const updateScriptPath = path.join(dir, "update-and-run.ps1");
  fs.writeFileSync(
    buildInfoPath,
    `${JSON.stringify(
      {
        owner: "school",
        repo: "services",
        version: "2.0.5",
        releaseTag: "v2.0.5",
        ...buildInfo,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const updater = new SelfUpdater({
    buildInfoPath,
    updateScriptPath,
    intervalMs: 1,
  });

  return { dir, updater, updateScriptPath };
}

test("checkForUpdate detects a newer release with a supported installer asset", async () => {
  const { updater } = createUpdaterFixture();
  updater.fetchJson = async () => ({
    tag_name: "v2.0.6",
    assets: [{ name: "School Services v2.0.6.exe" }],
  });

  const result = await updater.checkForUpdate(true);

  assert.equal(result.checked, true);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestReleaseTag, "v2.0.6");
  assert.equal(result.matchingAssetName, "School Services v2.0.6.exe");
});

test("checkForUpdate ignores releases without a supported installer asset", async () => {
  const { updater } = createUpdaterFixture();
  updater.fetchJson = async () => ({
    tag_name: "v2.0.6",
    assets: [{ name: "random-installer.exe" }],
  });

  const result = await updater.checkForUpdate(true);
  const state = SelfUpdater.buildUpdateStateFromCheck(result);

  assert.equal(result.updateAvailable, false);
  assert.equal(state.updateStatus, "failed");
  assert.match(state.updateError, /supported installer asset/i);
});

test("checkForUpdate keeps the current version when release versions match", async () => {
  const { updater } = createUpdaterFixture();
  updater.fetchJson = async () => ({
    tag_name: "v2.0.5",
    assets: [{ name: "School Services v2.0.5.exe" }],
  });

  const result = await updater.checkForUpdate(true);
  const state = SelfUpdater.buildUpdateStateFromCheck(result);

  assert.equal(result.updateAvailable, false);
  assert.equal(state.updateStatus, "current");
});

test("launchUpdater fails fast when the generated updater script is missing", () => {
  const { updater, updateScriptPath } = createUpdaterFixture();

  assert.throws(() => updater.launchUpdater(), {
    message: new RegExp(updateScriptPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  });
});
