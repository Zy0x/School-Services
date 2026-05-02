const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const TunnelManager = require("../tunnel");

function createManager() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "erapor-tunnel-"));
  const manager = new TunnelManager({
    cloudflaredPath: "cloudflared",
    stateDir,
    retryDelaysMs: [1],
    globalCooldownMs: 1,
  });
  return { manager, stateDir };
}

test("recoverTunnel clears stale rate-limit logs after retry cooldown", async () => {
  const { manager, stateDir } = createManager();
  const service = {
    serviceName: "rapor",
    host: "127.0.0.1",
    port: 8535,
  };
  const tunnel = manager.getOrCreateTunnel("rapor");
  const logPath = path.join(stateDir, "rapor.cloudflared.log");
  fs.writeFileSync(logPath, 'status_code="429 Too Many Requests"\n', "utf8");
  Object.assign(tunnel, {
    pid: null,
    logPath,
    state: "waiting_retry",
    lastError: "old throttled request",
    nextRetryAt: Date.now() - 1000,
    retryAttempt: 12,
    lastFailureCategory: "rate_limit",
  });
  manager.persistTunnelState("rapor", tunnel);

  const recovered = await manager.recoverTunnel(service);

  assert.equal(recovered.state, "idle");
  assert.equal(recovered.retryAttempt, 0);
  assert.equal(recovered.lastError, null);
  assert.equal(fs.existsSync(logPath), false);
});

test("extractTunnelIssue reports throttled quick tunnel requests without blaming the machine", () => {
  const { manager } = createManager();
  const issue = manager.extractTunnelIssue('error code: 1015 status_code="429 Too Many Requests"');

  assert.equal(issue.category, "rate_limit");
  assert.match(issue.message, /request was throttled/i);
  assert.doesNotMatch(issue.message, /machine/i);
});
