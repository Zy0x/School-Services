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

test("power transition process inspection does not start a duplicate tunnel", async () => {
  const { manager } = createManager();
  const service = {
    serviceName: "rapor",
    host: "127.0.0.1",
    port: 8535,
  };
  const tunnel = manager.getOrCreateTunnel("rapor");
  Object.assign(tunnel, {
    pid: 12345,
    state: "running",
    publicUrl: "https://old.trycloudflare.com",
    lastKnownPublicUrl: "https://old.trycloudflare.com",
  });
  manager.isPidAlive = async () => null;
  manager.startTunnelProcess = async () => {
    throw new Error("should not start while Windows power transition is in progress");
  };

  const recovered = await manager.ensureTunnel(service);

  assert.equal(recovered.state, "reconnecting");
  assert.equal(recovered.pid, 12345);
  assert.equal(recovered.publicUrl, null);
  assert.equal(recovered.lastKnownPublicUrl, "https://old.trycloudflare.com");
  assert.equal(recovered.lastFailureCategory, "power_transition");
  assert.match(recovered.lastError, /sleep\/shutdown/i);
});

test("fresh tunnel recovery preserves stale URL only as last known", () => {
  const { manager } = createManager();
  const tunnel = manager.getOrCreateTunnel("rapor");
  Object.assign(tunnel, {
    state: "running",
    publicUrl: "https://stale.trycloudflare.com",
    lastKnownPublicUrl: "https://stale.trycloudflare.com",
  });

  manager.requestFreshStart("rapor", "network-reconnect");

  assert.equal(tunnel.state, "reconnecting");
  assert.equal(tunnel.publicUrl, null);
  assert.equal(tunnel.lastKnownPublicUrl, "https://stale.trycloudflare.com");
  assert.equal(manager.getPublicUrl("rapor"), null);
  assert.equal(manager.getLastKnownPublicUrl("rapor"), "https://stale.trycloudflare.com");
  assert.equal(manager.getStatusSnapshot("rapor").publicUrl, null);
  assert.equal(manager.getStatusSnapshot("rapor").lastKnownPublicUrl, "https://stale.trycloudflare.com");
});

test("repeated public link probe failures force a fresh tunnel restart", () => {
  const { manager } = createManager();
  manager.publicProbeFailureThreshold = 2;
  manager.publicProbeRestartMs = 60000;
  const tunnel = manager.getOrCreateTunnel("rapor");
  Object.assign(tunnel, {
    pid: 12345,
    state: "running",
    publicUrl: "https://stale.trycloudflare.com",
    lastKnownPublicUrl: "https://stale.trycloudflare.com",
  });
  const issue = {
    category: "network_switch",
    message: "Koneksi publik belum stabil.",
    restartRecommended: false,
  };

  const first = manager.recordPublicProbeFailure("rapor", tunnel, issue);
  const second = manager.recordPublicProbeFailure("rapor", tunnel, issue);

  assert.equal(first.restartRecommended, false);
  assert.equal(second.restartRecommended, true);
  assert.equal(tunnel.requiresFreshStart, true);
  assert.equal(tunnel.publicUrl, null);
  assert.equal(tunnel.lastKnownPublicUrl, "https://stale.trycloudflare.com");
  assert.equal(tunnel.publicProbeFailures, 2);
  assert.match(tunnel.lastError, /membuka tunnel baru/i);
});

test("successful public link probe clears accumulated failure counters", () => {
  const { manager } = createManager();
  const tunnel = manager.getOrCreateTunnel("rapor");
  manager.recordPublicProbeFailure("rapor", tunnel, {
    category: "network_switch",
    message: "Koneksi publik belum stabil.",
  });

  manager.clearRetryState("rapor", tunnel);

  assert.equal(tunnel.publicProbeFailures, 0);
  assert.equal(tunnel.firstPublicProbeFailureAt, null);
  assert.equal(tunnel.lastPublicProbeCategory, null);
});

test("provider launch permission failure falls back when another provider is configured", async () => {
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
  manager.startTunnelProcess = async () => {
    const error = new Error("spawn cloudflared.exe EACCES");
    error.code = "EACCES";
    throw error;
  };

  const tunnel = await manager.ensureTunnel(service);

  assert.equal(tunnel.provider, "ngrok");
  assert.equal(tunnel.state, "idle");
  assert.match(tunnel.lastError, /switching to ngrok/i);
});

test("provider launch failure waits for retry when no fallback is available", async () => {
  const { manager } = createManager();
  const service = {
    serviceName: "rapor",
    host: "127.0.0.1",
    port: 8535,
  };
  manager.startTunnelProcess = async () => {
    const error = new Error("spawn cloudflared.exe ENOENT");
    error.code = "ENOENT";
    throw error;
  };

  const tunnel = await manager.ensureTunnel(service);

  assert.equal(tunnel.provider, "cloudflare");
  assert.equal(tunnel.state, "waiting_retry");
  assert.equal(tunnel.publicUrl, null);
  assert.equal(tunnel.lastFailureCategory, "provider_missing");
  assert.match(tunnel.lastError, /executable tidak ditemukan/i);
});
