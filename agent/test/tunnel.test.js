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

test("queued starting tunnels without a process do not block each other", () => {
  const { manager } = createManager();
  const rapor = manager.getOrCreateTunnel("rapor");
  const dapodik = manager.getOrCreateTunnel("dapodik");

  Object.assign(rapor, {
    state: "starting",
    pid: null,
    startedAt: null,
    nextRetryAt: Date.now() + 30000,
  });
  Object.assign(dapodik, {
    state: "starting",
    pid: null,
    startedAt: null,
    nextRetryAt: Date.now() + 30000,
  });

  assert.equal(manager.getStartBlocker("rapor"), null);
  assert.equal(manager.getStartBlocker("dapodik"), null);
});

test("Cloudflare rate limit switches to ngrok when fallback is configured", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "erapor-tunnel-"));
  const manager = new TunnelManager({
    cloudflaredPath: "cloudflared",
    ngrokPath: "ngrok",
    ngrokAuthtoken: "test-token",
    stateDir,
    retryDelaysMs: [1],
    globalCooldownMs: 1,
  });
  const service = {
    serviceName: "rapor",
    host: "127.0.0.1",
    port: 8535,
  };
  const tunnel = manager.getOrCreateTunnel("rapor");
  fs.writeFileSync(tunnel.logPath, 'status_code="429 Too Many Requests"\n', "utf8");

  await manager.recoverTunnel(service);

  assert.equal(tunnel.provider, "ngrok");
  assert.equal(tunnel.state, "idle");
  assert.match(tunnel.lastError, /switching to ngrok/i);
});

test("ngrok is not used as fallback until an auth token is configured", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "erapor-tunnel-"));
  const manager = new TunnelManager({
    cloudflaredPath: "cloudflared",
    ngrokPath: "ngrok",
    stateDir,
    retryDelaysMs: [1],
    globalCooldownMs: 1,
  });
  const service = {
    serviceName: "rapor",
    host: "127.0.0.1",
    port: 8535,
  };
  const tunnel = manager.getOrCreateTunnel("rapor");
  fs.writeFileSync(tunnel.logPath, 'status_code="429 Too Many Requests"\n', "utf8");

  await manager.recoverTunnel(service);

  assert.equal(tunnel.provider, "cloudflare");
  assert.equal(tunnel.state, "waiting_retry");
});

test("configureSettings validates, stores, and switches to ngrok token immediately", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "erapor-tunnel-"));
  const settingsPath = path.join(os.tmpdir(), `erapor-tunnel-settings-${Date.now()}.json`);
  const manager = new TunnelManager({
    cloudflaredPath: "cloudflared",
    ngrokPath: "ngrok",
    stateDir,
    settingsPath,
    retryDelaysMs: [1],
    globalCooldownMs: 1,
  });
  let probedToken = "";
  manager.probeNgrokAuthtoken = async (token) => {
    probedToken = token;
    return { publicUrl: "https://valid.ngrok-free.app" };
  };

  const settings = await manager.configureSettings({
    tunnel: {
      preferredProvider: "ngrok",
      providerOrder: ["ngrok", "cloudflare"],
      ngrokAuthtoken: "valid-token",
      validateNgrokAuthtoken: true,
    },
  });

  const stored = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(probedToken, "valid-token");
  assert.equal(settings.preferredProvider, "ngrok");
  assert.equal(settings.ngrokConfigured, true);
  assert.equal(stored.ngrokAuthtoken, "valid-token");
});
