const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const logger = require("./logger");
const { getStateDir } = require("./paths");
const RetryManager = require("./retryManager");

const TRY_CLOUDFLARE_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;
const NGROK_PATTERN = /https:\/\/[a-z0-9.-]+\.ngrok(?:-free)?\.(?:app|dev|io)/gi;
const RATE_LIMIT_PATTERN = /rate[- ]limited|429|error code:\s*1015|too many requests/i;
const NOT_READY_PATTERN = /not ready|failed to unmarshal quick tunnel/i;
const NGROK_AUTH_ERROR_PATTERN = /ERR_NGROK_10\d+|authentication failed|auth(?:entication)? token|authtoken|credentials|invalid token/i;
const PUBLIC_URL_PROBE_TIMEOUT_MS = 7000;
const NGROK_TOKEN_PROBE_TIMEOUT_MS = 15000;
const PROVIDERS = {
  cloudflare: {
    key: "cloudflare",
    label: "Cloudflare",
    logSuffix: "cloudflared",
    urlPattern: TRY_CLOUDFLARE_PATTERN,
  },
  ngrok: {
    key: "ngrok",
    label: "ngrok",
    logSuffix: "ngrok",
    urlPattern: NGROK_PATTERN,
  },
};

class TunnelManager {
  constructor(options) {
    this.cloudflaredPath = options.cloudflaredPath;
    this.ngrokPath = options.ngrokPath || null;
    this.ngrokAuthtoken = options.ngrokAuthtoken || null;
    this.ngrokUrl = options.ngrokUrl || null;
    this.onUrl = options.onUrl;
    this.mode = "quick";
    this.stateDir = options.stateDir || path.join(getStateDir(), "tunnels");
    this.settingsPath =
      options.settingsPath || path.join(getStateDir(), "tunnel-settings.json");
    this.providerOrder = this.normalizeProviderOrder(options.providerOrder);
    this.loadPersistedSettings();
    this.startSpacingMs = Number(options.startSpacingMs || 5000);
    this.startupTimeoutMs = Number(options.startupTimeoutMs || 30000);
    this.retryManager =
      options.retryManager ||
      new RetryManager({
        retryDelaysMs: options.retryDelaysMs,
        globalCooldownMs: options.globalCooldownMs,
      });
    this.tunnels = new Map();
    this.nextStartAllowedAt = 0;
    this.lastLoggedGlobalCooldownUntil = null;
  }

  loadPersistedSettings() {
    if (!this.settingsPath || !fs.existsSync(this.settingsPath)) {
      return;
    }

    try {
      const settings = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
      if (settings.ngrokAuthtoken) {
        this.ngrokAuthtoken = String(settings.ngrokAuthtoken);
      }
      if (Array.isArray(settings.providerOrder)) {
        this.providerOrder = this.normalizeProviderOrder(settings.providerOrder);
      }
      if (settings.preferredProvider) {
        this.setProviderOrder(String(settings.preferredProvider), {
          persist: false,
        });
      }
    } catch (error) {
      logger.warn(`Failed to load tunnel settings: ${error.message}`, {
        serviceName: null,
        settingsPath: this.settingsPath,
      });
    }
  }

  persistSettings() {
    if (!this.settingsPath) {
      return;
    }

    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(
      this.settingsPath,
      `${JSON.stringify(
        {
          preferredProvider: this.providerOrder[0] || "cloudflare",
          providerOrder: this.providerOrder,
          ngrokAuthtoken: this.ngrokAuthtoken || null,
          ngrokConfigured: Boolean(this.ngrokAuthtoken),
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  setProviderOrder(preferredProvider, options = {}) {
    const preferred = String(preferredProvider || "cloudflare").trim().toLowerCase();
    const fallback = preferred === "ngrok" ? "cloudflare" : "ngrok";
    this.providerOrder = this.normalizeProviderOrder([preferred, fallback]);
    if (options.persist !== false) {
      this.persistSettings();
    }
  }

  getSettingsSnapshot() {
    return {
      preferredProvider: this.providerOrder[0] || "cloudflare",
      providerOrder: this.providerOrder,
      ngrokConfigured: Boolean(this.ngrokAuthtoken),
      ngrokAvailable: Boolean(this.ngrokPath),
      updatedAt: fs.existsSync(this.settingsPath)
        ? fs.statSync(this.settingsPath).mtime.toISOString()
        : null,
    };
  }

  async configureSettings(settings = {}) {
    const tunnelSettings = settings.tunnel || settings;
    const preferredProvider = String(
      tunnelSettings.preferredProvider || tunnelSettings.provider || this.providerOrder[0]
    ).trim().toLowerCase();
    const nextNgrokAuthtoken = tunnelSettings.ngrokAuthtoken
      ? String(tunnelSettings.ngrokAuthtoken).trim()
      : this.ngrokAuthtoken;
    const wantsNgrok =
      preferredProvider === "ngrok" ||
      (Array.isArray(tunnelSettings.providerOrder) &&
        tunnelSettings.providerOrder
          .map((provider) => String(provider || "").trim().toLowerCase())
          .includes("ngrok"));

    if (wantsNgrok && !nextNgrokAuthtoken) {
      throw new Error("Ngrok requires an auth token. Cloudflared does not use an auth token.");
    }

    if (tunnelSettings.validateNgrokAuthtoken && nextNgrokAuthtoken) {
      await this.validateNgrokAuthtoken(
        nextNgrokAuthtoken,
        tunnelSettings.validationService || null
      );
    }

    if (nextNgrokAuthtoken) {
      this.ngrokAuthtoken = nextNgrokAuthtoken;
    }

    this.setProviderOrder(preferredProvider);

    for (const serviceName of this.listTrackedServiceNames()) {
      const tunnel = this.getOrCreateTunnel(serviceName);
      tunnel.provider = this.providerOrder[0] || tunnel.provider || "cloudflare";
      tunnel.providerFailures = [];
      tunnel.requiresFreshStart = true;
      tunnel.lastKnownPublicUrl = tunnel.lastKnownPublicUrl || tunnel.publicUrl || null;
      tunnel.publicUrl = null;
      tunnel.lastError = "Preferensi tunnel diperbarui. Menunggu tunnel baru tersambung.";
      tunnel.lastFailureCategory = "settings_update";
      tunnel.nextRetryAt = null;
      tunnel.retryAttempt = 0;
      tunnel.startedAt = null;
      tunnel.startupDeadlineAt = null;
      tunnel.state = "reconnecting";
      await this.killTunnelProcess(serviceName, tunnel);
      this.deleteLog(serviceName);
      this.persistTunnelState(serviceName, tunnel);
    }

    return this.getSettingsSnapshot();
  }

  normalizeProviderOrder(providerOrder) {
    const requested = Array.isArray(providerOrder)
      ? providerOrder
      : String(providerOrder || "cloudflare,ngrok").split(",");
    const normalized = [];

    for (const item of requested) {
      const provider = String(item || "").trim().toLowerCase();
      if (!PROVIDERS[provider] || normalized.includes(provider)) {
        continue;
      }

      if (provider === "ngrok" && (!this.ngrokPath || !this.ngrokAuthtoken)) {
        continue;
      }

      if (provider === "cloudflare" && !this.cloudflaredPath) {
        continue;
      }

      normalized.push(provider);
    }

    return normalized.length > 0 ? normalized : ["cloudflare"];
  }

  getSystem32Path() {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    return path.join(systemRoot, "System32");
  }

  getTasklistPath() {
    return path.join(this.getSystem32Path(), "tasklist.exe");
  }

  getCmdPath() {
    return path.join(this.getSystem32Path(), "cmd.exe");
  }

  ensureStateDir() {
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  getTunnelPaths(serviceName) {
    this.ensureStateDir();
    return {
      logPath: path.join(this.stateDir, `${serviceName}.cloudflared.log`),
      metaPath: path.join(this.stateDir, `${serviceName}.json`),
    };
  }

  getProviderLogPath(serviceName, providerKey) {
    const provider = PROVIDERS[providerKey] || PROVIDERS.cloudflare;
    this.ensureStateDir();
    return path.join(this.stateDir, `${serviceName}.${provider.logSuffix}.log`);
  }

  getLaunchLogPath(serviceName, providerKey) {
    const provider = PROVIDERS[providerKey] || PROVIDERS.cloudflare;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const nonce = Math.random().toString(36).slice(2, 8);
    this.ensureStateDir();
    return path.join(this.stateDir, `${serviceName}.${provider.logSuffix}.${timestamp}.${nonce}.log`);
  }

  getFallbackTunnelDir() {
    const fallbackDir = path.join(os.tmpdir(), "school-services", "tunnels");
    fs.mkdirSync(fallbackDir, { recursive: true });
    return fallbackDir;
  }

  getWritableTunnelPaths(serviceName, providerKey = "cloudflare") {
    const primaryPaths = {
      logPath: this.getLaunchLogPath(serviceName, providerKey),
      metaPath: this.getTunnelPaths(serviceName).metaPath,
    };

    try {
      fs.closeSync(fs.openSync(primaryPaths.logPath, "a"));
      return primaryPaths;
    } catch (error) {
      if (!["EPERM", "EACCES"].includes(String(error?.code || ""))) {
        throw error;
      }

      const fallbackDir = this.getFallbackTunnelDir();
      const fallbackPaths = {
        logPath: path.join(
          fallbackDir,
          `${serviceName}.${PROVIDERS[providerKey]?.logSuffix || "tunnel"}.log`
        ),
        metaPath: primaryPaths.metaPath,
      };
      logger.warn(
        `Tunnel log path is not writable for ${serviceName}. Falling back to temp directory.`,
        {
          serviceName,
          logPath: primaryPaths.logPath,
          fallbackLogPath: fallbackPaths.logPath,
          error: error.message,
        }
      );
      fs.closeSync(fs.openSync(fallbackPaths.logPath, "a"));
      return fallbackPaths;
    }
  }

  pruneOldLaunchLogs(serviceName, providerKey, keep = 6) {
    const provider = PROVIDERS[providerKey] || PROVIDERS.cloudflare;
    const prefix = `${serviceName}.${provider.logSuffix}.`;
    try {
      const entries = fs
        .readdirSync(this.stateDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".log"))
        .map((entry) => {
          const filePath = path.join(this.stateDir, entry.name);
          return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      for (const entry of entries.slice(keep)) {
        try {
          fs.unlinkSync(entry.filePath);
        } catch (_error) {
          // Old launch logs are best-effort cleanup only.
        }
      }
    } catch (_error) {
      // Cleanup must never block tunnel startup.
    }
  }

  deleteLog(serviceName) {
    const tunnel = this.tunnels.get(serviceName);
    const paths = new Set([
      this.getTunnelPaths(serviceName).logPath,
      this.getProviderLogPath(serviceName, "ngrok"),
      tunnel?.logPath,
    ]);

    for (const logPath of paths) {
      if (logPath && fs.existsSync(logPath)) {
        try {
          fs.unlinkSync(logPath);
        } catch (error) {
          logger.warn(`Tunnel log cleanup skipped for ${serviceName}: ${error.message}`, {
            serviceName,
            logPath,
          });
        }
      }
    }
  }

  readMeta(serviceName) {
    const { metaPath } = this.getTunnelPaths(serviceName);

    if (!fs.existsSync(metaPath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch (error) {
      logger.warn(`Failed to read tunnel metadata for ${serviceName}: ${error.message}`, {
        serviceName,
      });
      return null;
    }
  }

  writeMeta(serviceName, payload) {
    const { metaPath } = this.getTunnelPaths(serviceName);
    fs.writeFileSync(metaPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  deleteMeta(serviceName) {
    const { metaPath } = this.getTunnelPaths(serviceName);

    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
  }

  buildTunnelState(serviceName, payload = {}) {
    const provider =
      this.normalizeProviderOrder([payload.provider, ...(this.providerOrder || [])])[0] ||
      "cloudflare";

    return {
      child: null,
      pid: payload.pid || null,
      provider,
      providerFailures: Array.isArray(payload.providerFailures)
        ? payload.providerFailures
        : [],
      logPath:
        payload.logPath ||
        this.getProviderLogPath(serviceName, provider),
      publicUrl: payload.publicUrl || null,
      lastKnownPublicUrl: payload.lastKnownPublicUrl || payload.publicUrl || null,
      hiddenAt: payload.hiddenAt || null,
      requiresFreshStart: Boolean(payload.requiresFreshStart),
      hidden: Boolean(payload.hidden),
      lastError: payload.lastError || null,
      nextRetryAt: payload.nextRetryAt || null,
      retryAttempt: Number(payload.retryAttempt || 0),
      lastFailureCategory: payload.lastFailureCategory || null,
      startedAt: payload.startedAt || null,
      startupDeadlineAt: payload.startupDeadlineAt || null,
      state:
        payload.state ||
        (payload.hidden ? "stopped" : payload.publicUrl ? "running" : "idle"),
      stopping: false,
      lastQueueLogAt: payload.lastQueueLogAt || null,
    };
  }

  persistTunnelState(serviceName, tunnel) {
    this.writeMeta(serviceName, {
      pid: tunnel.pid,
      provider: tunnel.provider,
      providerFailures: tunnel.providerFailures || [],
      logPath: tunnel.logPath,
      publicUrl: tunnel.publicUrl,
      lastKnownPublicUrl: tunnel.lastKnownPublicUrl,
      hiddenAt: tunnel.hiddenAt,
      requiresFreshStart: tunnel.requiresFreshStart,
      hidden: tunnel.hidden,
      lastError: tunnel.lastError,
      nextRetryAt: tunnel.nextRetryAt,
      retryAttempt: tunnel.retryAttempt,
      lastFailureCategory: tunnel.lastFailureCategory,
      startedAt: tunnel.startedAt,
      startupDeadlineAt: tunnel.startupDeadlineAt,
      state: tunnel.state,
    });
  }

  listTrackedServiceNames() {
    this.ensureStateDir();
    const entries = fs.readdirSync(this.stateDir, { withFileTypes: true });
    const serviceNames = new Set(this.tunnels.keys());

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        serviceNames.add(entry.name.slice(0, -5));
      }
    }

    return Array.from(serviceNames);
  }

  async runCapture(command, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0 || code === null) {
          resolve({ stdout, stderr });
          return;
        }

        reject(
          new Error(
            `Command exited with code ${code}${stderr ? `: ${stderr.trim()}` : stdout ? `: ${stdout.trim()}` : ""}`
          )
        );
      });
    });
  }

  redactSecret(text, secret) {
    const value = String(text || "");
    const token = String(secret || "");
    return token ? value.split(token).join("[redacted]") : value;
  }

  formatNgrokProbeError(output, token) {
    const cleanOutput = this.redactSecret(String(output || "").trim(), token);
    if (NGROK_AUTH_ERROR_PATTERN.test(cleanOutput)) {
      return "Auth token Ngrok ditolak oleh ngrok. Periksa token dari dashboard akun Ngrok lalu simpan ulang.";
    }

    return `Auth token Ngrok belum bisa dipakai untuk membuka tunnel.${cleanOutput ? ` ${cleanOutput.slice(0, 260)}` : ""}`;
  }

  async probeNgrokAuthtoken(token, service = null) {
    if (!this.ngrokPath) {
      throw new Error("ngrok.exe tidak tersedia. Letakkan ngrok.exe di folder agent atau set NGROK_PATH.");
    }

    const probeService = service || {
      serviceName: "ngrok-token-probe",
      host: "127.0.0.1",
      port: 1,
    };
    const args = this.buildNgrokArgs(probeService, token);

    return new Promise((resolve, reject) => {
      const child = spawn(this.ngrokPath, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let output = "";
      let settled = false;
      let timer = null;

      const finish = (error, result = null) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        if (child.pid) {
          child.kill("SIGTERM");
        }
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      };

      const handleChunk = (chunk) => {
        output += chunk.toString("utf8");
        const publicUrl = this.readPublicUrlFromText(output, "ngrok");
        if (publicUrl) {
          finish(null, { publicUrl });
          return;
        }
        if (NGROK_AUTH_ERROR_PATTERN.test(output)) {
          finish(new Error(this.formatNgrokProbeError(output, token)));
        }
      };

      timer = setTimeout(() => {
        finish(new Error(this.formatNgrokProbeError(output, token)));
      }, NGROK_TOKEN_PROBE_TIMEOUT_MS);

      child.stdout.on("data", handleChunk);
      child.stderr.on("data", handleChunk);
      child.once("error", (error) => {
        finish(error);
      });
      child.once("exit", (code) => {
        if (!settled) {
          finish(
            new Error(
              this.formatNgrokProbeError(
                `${output}\nngrok exited before publishing a public URL${code === null ? "" : ` (code ${code})`}.`,
                token
              )
            )
          );
        }
      });
    });
  }

  async validateNgrokAuthtoken(token, service = null) {
    const cleanToken = String(token || "").trim();
    if (!cleanToken) {
      throw new Error("Auth token Ngrok wajib diisi untuk provider Ngrok.");
    }

    const result = await this.probeNgrokAuthtoken(cleanToken, service);
    logger.info("Ngrok auth token validation succeeded.", {
      serviceName: service?.serviceName || null,
      provider: "ngrok",
      publicUrl: result?.publicUrl || null,
    });
    return result;
  }

  async isPidAlive(pid) {
    if (!pid) {
      return false;
    }

    try {
      const { stdout } = await this.runCapture(this.getTasklistPath(), [
        "/FI",
        `PID eq ${pid}`,
        "/FO",
        "CSV",
        "/NH",
      ]);
      return String(stdout || "").includes(`"${pid}"`);
    } catch (error) {
      logger.warn(`Failed to inspect tunnel process ${pid}: ${error.message}`, { pid });
      return false;
    }
  }

  readPublicUrlFromText(content, providerKey = "cloudflare") {
    const provider = PROVIDERS[providerKey] || PROVIDERS.cloudflare;
    provider.urlPattern.lastIndex = 0;
    const matches = String(content || "").match(provider.urlPattern);
    return matches && matches.length > 0 ? matches[matches.length - 1] : null;
  }

  readPublicUrlFromLog(logPath, providerKey = "cloudflare") {
    if (!logPath || !fs.existsSync(logPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(logPath, "utf8");
      return this.readPublicUrlFromText(content, providerKey);
    } catch (error) {
      logger.warn(`Failed to read tunnel log ${logPath}: ${error.message}`, {
        logPath,
      });
      return null;
    }
  }

  readLogContent(logPath) {
    if (!logPath || !fs.existsSync(logPath)) {
      return "";
    }

    try {
      return fs.readFileSync(logPath, "utf8");
    } catch (error) {
      logger.warn(`Failed to read tunnel log ${logPath}: ${error.message}`, {
        logPath,
      });
      return "";
    }
  }

  extractTunnelIssue(logContent) {
    const content = String(logContent || "");
    if (!content) {
      return null;
    }

    if (RATE_LIMIT_PATTERN.test(content)) {
      return {
        category: "rate_limit",
        message:
          "Cloudflare quick tunnel request was throttled. The agent will clear the stale tunnel log and retry after cooldown.",
      };
    }

    if (NOT_READY_PATTERN.test(content)) {
      return {
        category: "transient",
        message: "Cloudflare tunnel is not ready yet. The agent will retry automatically.",
      };
    }

    return null;
  }

  getOrCreateTunnel(serviceName) {
    if (!this.tunnels.has(serviceName)) {
      const meta = this.readMeta(serviceName);
      const tunnel = this.buildTunnelState(serviceName, meta || {});
      this.retryManager.hydrate(serviceName, {
        attempt: tunnel.retryAttempt,
        nextRetryAt: tunnel.nextRetryAt,
        lastReason: tunnel.lastError,
        lastCategory: tunnel.lastFailureCategory,
      });
      this.tunnels.set(serviceName, tunnel);
    }

    return this.tunnels.get(serviceName);
  }

  markState(serviceName, tunnel, nextState, extra = {}) {
    Object.assign(tunnel, extra);
    tunnel.state = nextState;
    this.persistTunnelState(serviceName, tunnel);
    return tunnel;
  }

  clearRetryState(serviceName, tunnel) {
    this.retryManager.reset(serviceName);
    tunnel.lastError = null;
    tunnel.nextRetryAt = null;
    tunnel.retryAttempt = 0;
    tunnel.lastFailureCategory = null;
    tunnel.startedAt = null;
    tunnel.startupDeadlineAt = null;
  }

  getProviderLabel(providerKey) {
    return (PROVIDERS[providerKey] || PROVIDERS.cloudflare).label;
  }

  getNextProvider(currentProvider) {
    const currentIndex = this.providerOrder.indexOf(currentProvider);
    const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    return this.providerOrder.slice(startIndex).find((provider) => {
      if (provider === "ngrok") {
        return Boolean(this.ngrokPath && this.ngrokAuthtoken);
      }
      if (provider === "cloudflare") {
        return Boolean(this.cloudflaredPath);
      }
      return false;
    });
  }

  shouldFallbackProvider(tunnel, issue) {
    if (!issue || tunnel.provider !== "cloudflare") {
      return false;
    }

    return issue.category === "rate_limit" && Boolean(this.getNextProvider(tunnel.provider));
  }

  async killTunnelProcess(serviceName, tunnel) {
    if (!tunnel.pid) {
      return;
    }

    try {
      await this.runCapture(this.getCmdPath(), ["/c", `taskkill /PID ${tunnel.pid} /T /F`]);
    } catch (error) {
      if (!this.isProcessNotFoundError(error)) {
        logger.warn(`Failed to stop ${this.getProviderLabel(tunnel.provider)} tunnel for ${serviceName}: ${error.message}`, {
          serviceName,
          pid: tunnel.pid,
          provider: tunnel.provider,
        });
      }
    }
  }

  async switchToNextProvider(serviceName, tunnel, issue) {
    const nextProvider = this.getNextProvider(tunnel.provider);
    if (!nextProvider) {
      return false;
    }

    const previousProvider = tunnel.provider;
    await this.killTunnelProcess(serviceName, tunnel);
    this.deleteLog(serviceName);
    this.retryManager.reset(serviceName);
    tunnel.providerFailures = [
      ...(tunnel.providerFailures || []),
      {
        provider: previousProvider,
        category: issue.category,
        message: issue.message,
        failedAt: new Date().toISOString(),
      },
    ].slice(-5);
    tunnel.provider = nextProvider;
    tunnel.pid = null;
    tunnel.child = null;
    tunnel.lastKnownPublicUrl = tunnel.lastKnownPublicUrl || tunnel.publicUrl || null;
    tunnel.publicUrl = null;
    tunnel.logPath = this.getProviderLogPath(serviceName, nextProvider);
    tunnel.lastError = `${this.getProviderLabel(previousProvider)} tunnel failed; switching to ${this.getProviderLabel(nextProvider)}.`;
    tunnel.nextRetryAt = null;
    tunnel.retryAttempt = 0;
    tunnel.lastFailureCategory = issue.category;
    tunnel.startedAt = null;
    tunnel.startupDeadlineAt = null;
    tunnel.state = "idle";
    this.persistTunnelState(serviceName, tunnel);
    logger.warn(`Switching ${serviceName} tunnel from ${this.getProviderLabel(previousProvider)} to ${this.getProviderLabel(nextProvider)}.`, {
      serviceName,
      provider: nextProvider,
      previousProvider,
      reason: issue.message,
    });
    return true;
  }

  applyRetryState(serviceName, tunnel, issue) {
    const retry = this.retryManager.scheduleRetry(serviceName, {
      category: issue.category,
      reason: issue.message,
    });
    const previousGlobalCooldown = this.lastLoggedGlobalCooldownUntil;

    tunnel.pid = null;
    tunnel.child = null;
    tunnel.lastKnownPublicUrl = tunnel.lastKnownPublicUrl || tunnel.publicUrl || null;
    tunnel.lastError = retry.reason;
    tunnel.nextRetryAt = retry.nextRetryAt;
    tunnel.retryAttempt = retry.attempt;
    tunnel.lastFailureCategory = retry.category;
    tunnel.startedAt = null;
    tunnel.startupDeadlineAt = null;
    tunnel.state = "waiting_retry";
    this.persistTunnelState(serviceName, tunnel);

    logger.warn(`${this.getProviderLabel(tunnel.provider)} tunnel for ${serviceName} is not ready: ${retry.reason}`, {
      serviceName,
      provider: tunnel.provider,
      retryDelayMs: retry.delayMs,
      retryAttempt: retry.attempt,
      nextRetryAt: new Date(retry.nextRetryAt).toISOString(),
      category: retry.category,
    });

    if (
      retry.globalCooldownUntil &&
      retry.globalCooldownUntil !== previousGlobalCooldown
    ) {
      this.lastLoggedGlobalCooldownUntil = retry.globalCooldownUntil;
      logger.warn("Global tunnel cooldown activated after repeated Cloudflare rate limits.", {
        serviceName,
        globalCooldownUntil: new Date(retry.globalCooldownUntil).toISOString(),
      });
    }

    return tunnel;
  }

  describeFreshStartReason(reason) {
    if (reason === "network-reconnect" || reason === "reconnect") {
      return "Jaringan berubah. Menunggu tunnel publik tersambung kembali.";
    }

    if (reason === "resume-recovery") {
      return "Koneksi perangkat dipulihkan. Menunggu tunnel publik tersambung kembali.";
    }

    return "Tunnel publik sedang disegarkan kembali.";
  }

  async probePublicUrl(publicUrl) {
    if (!publicUrl) {
      return {
        ok: false,
        category: "transient",
        message: "Tautan publik belum tersedia.",
        restartRecommended: false,
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PUBLIC_URL_PROBE_TIMEOUT_MS);

    try {
      const response = await fetch(publicUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "school-services-agent",
        },
      });

      if (response.status === 530) {
        return {
          ok: false,
          category: "network_switch",
          message:
            "Jaringan sedang berpindah atau tunnel publik lama sudah tidak berlaku. Menunggu tunnel baru tersambung.",
          restartRecommended: false,
        };
      }

      if (response.status >= 500) {
        return {
          ok: false,
          category: "transient",
          message: `Tautan publik merespons HTTP ${response.status}. Menunggu origin siap.`,
          restartRecommended: false,
        };
      }

      return {
        ok: true,
        category: null,
        message: null,
        restartRecommended: false,
      };
    } catch (error) {
      return {
        ok: false,
        category: "network_switch",
        message:
          "Koneksi publik belum stabil. Menunggu jaringan dan tunnel publik tersambung kembali.",
        restartRecommended: false,
        details: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  markReconnectingState(serviceName, tunnel, issue, options = {}) {
    tunnel.lastKnownPublicUrl = tunnel.lastKnownPublicUrl || tunnel.publicUrl || null;
    tunnel.lastError = issue.message;
    tunnel.lastFailureCategory = issue.category || null;
    tunnel.nextRetryAt = null;
    tunnel.retryAttempt = 0;
    tunnel.startedAt = null;
    tunnel.startupDeadlineAt = null;
    tunnel.requiresFreshStart =
      options.restartRecommended === true || tunnel.requiresFreshStart;
    tunnel.state = "reconnecting";
    this.persistTunnelState(serviceName, tunnel);
    return tunnel;
  }

  shouldKeepExistingRetry(tunnel, issue) {
    return (
      tunnel.state === "waiting_retry" &&
      tunnel.nextRetryAt &&
      Date.now() < tunnel.nextRetryAt &&
      tunnel.lastError === issue.message &&
      tunnel.lastFailureCategory === issue.category
    );
  }

  async refreshTunnelUrl(service) {
    const tunnel = this.tunnels.get(service.serviceName);
    if (!tunnel) {
      return null;
    }

    const publicUrl = this.readPublicUrlFromLog(tunnel.logPath, tunnel.provider);
    if (publicUrl) {
      const probe = await this.probePublicUrl(publicUrl);
      if (!probe.ok) {
        tunnel.lastKnownPublicUrl = publicUrl;
        this.markReconnectingState(service.serviceName, tunnel, probe, {
          restartRecommended: probe.restartRecommended,
        });
        return null;
      }

      const changed = tunnel.publicUrl !== publicUrl;
      tunnel.publicUrl = publicUrl;
      tunnel.lastKnownPublicUrl = publicUrl;
      this.clearRetryState(service.serviceName, tunnel);
      tunnel.state = tunnel.hidden ? "stopped" : "running";
      this.persistTunnelState(service.serviceName, tunnel);

      if (!tunnel.hidden && changed && typeof this.onUrl === "function") {
        await this.onUrl(service, publicUrl);
      }

      return publicUrl;
    }

    const issue = this.extractTunnelIssue(this.readLogContent(tunnel.logPath));
    if (issue) {
      if (this.shouldKeepExistingRetry(tunnel, issue)) {
        return null;
      }

      if (this.shouldFallbackProvider(tunnel, issue)) {
        await this.switchToNextProvider(service.serviceName, tunnel, issue);
        return null;
      }

      this.applyRetryState(service.serviceName, tunnel, issue);
      return null;
    }

    if (tunnel.pid && (await this.isPidAlive(tunnel.pid))) {
      if (tunnel.startupDeadlineAt && Date.now() >= tunnel.startupDeadlineAt) {
        this.applyRetryState(service.serviceName, tunnel, {
          category: "transient",
          message: `${this.getProviderLabel(tunnel.provider)} tunnel startup timed out before a public URL was detected.`,
        });
        return null;
      }

      this.markState(service.serviceName, tunnel, tunnel.hidden ? "stopped" : "starting");
    }

    return null;
  }

  async recoverTunnel(service) {
    const tunnel = this.getOrCreateTunnel(service.serviceName);

    if (tunnel.pid && (await this.isPidAlive(tunnel.pid))) {
      await this.refreshTunnelUrl(service);
      return tunnel;
    }

    if (tunnel.pid) {
      tunnel.pid = null;
      tunnel.child = null;
    }

    if (
      tunnel.state === "waiting_retry" &&
      tunnel.nextRetryAt &&
      Date.now() >= tunnel.nextRetryAt
    ) {
      logger.info(`Retry cooldown elapsed for ${service.serviceName}; clearing stale tunnel state.`, {
        serviceName: service.serviceName,
        provider: tunnel.provider,
        lastError: tunnel.lastError || null,
        lastFailureCategory: tunnel.lastFailureCategory || null,
      });
      this.retryManager.reset(service.serviceName);
      this.deleteLog(service.serviceName);
      tunnel.publicUrl = null;
      tunnel.lastError = null;
      tunnel.nextRetryAt = null;
      tunnel.retryAttempt = 0;
      tunnel.lastFailureCategory = null;
      tunnel.startedAt = null;
      tunnel.startupDeadlineAt = null;
      tunnel.state = "idle";
      this.persistTunnelState(service.serviceName, tunnel);
      return tunnel;
    }

    if (
      tunnel.state === "starting" &&
      !tunnel.pid &&
      !tunnel.startedAt &&
      tunnel.nextRetryAt &&
      Date.now() >= tunnel.nextRetryAt
    ) {
      logger.info(`Queued tunnel start expired for ${service.serviceName}; clearing stale start state.`, {
        serviceName: service.serviceName,
        provider: tunnel.provider,
        queuedUntil: new Date(tunnel.nextRetryAt).toISOString(),
      });
      tunnel.nextRetryAt = null;
      tunnel.lastError = null;
      tunnel.state = "idle";
      this.persistTunnelState(service.serviceName, tunnel);
      return tunnel;
    }

    const issue = this.extractTunnelIssue(this.readLogContent(tunnel.logPath));
    if (issue) {
      if (this.shouldKeepExistingRetry(tunnel, issue)) {
        return tunnel;
      }

      if (this.shouldFallbackProvider(tunnel, issue)) {
        await this.switchToNextProvider(service.serviceName, tunnel, issue);
        return tunnel;
      }

      this.applyRetryState(service.serviceName, tunnel, issue);
      return tunnel;
    }

    if (
      tunnel.startedAt &&
      !tunnel.hidden &&
      tunnel.state !== "stopped" &&
      tunnel.state !== "waiting_retry" &&
      tunnel.state !== "reconnecting"
    ) {
      this.applyRetryState(service.serviceName, tunnel, {
        category: "transient",
        message: `${this.getProviderLabel(tunnel.provider)} tunnel process exited before publishing a public URL.`,
      });
      return tunnel;
    }

    if (tunnel.state !== "stopped" && tunnel.state !== "reconnecting") {
      tunnel.state = "idle";
    }

    this.persistTunnelState(service.serviceName, tunnel);
    return tunnel;
  }

  getPublicUrl(serviceName) {
    const tunnel = this.tunnels.get(serviceName);
    if (!tunnel || tunnel.hidden) {
      return null;
    }

    return tunnel.publicUrl || tunnel.lastKnownPublicUrl || null;
  }

  getLastKnownPublicUrl(serviceName) {
    const tunnel = this.tunnels.get(serviceName);
    if (!tunnel) {
      return null;
    }

    return tunnel.lastKnownPublicUrl || tunnel.publicUrl || null;
  }

  getHiddenPublicUrl(serviceName) {
    return this.tunnels.get(serviceName)?.publicUrl || null;
  }

  getStatusSnapshot(serviceName) {
    const tunnel = this.tunnels.get(serviceName);
    if (!tunnel) {
      return {
        state: "idle",
        provider: this.providerOrder[0] || "cloudflare",
        publicUrl: null,
        lastKnownPublicUrl: null,
        lastError: null,
        nextRetryAt: null,
        retryAttempt: 0,
      };
    }

    return {
      state: tunnel.state,
      provider: tunnel.provider,
      publicUrl: this.getPublicUrl(serviceName),
      lastKnownPublicUrl: this.getLastKnownPublicUrl(serviceName),
      hiddenAt: tunnel.hiddenAt,
      requiresFreshStart: tunnel.requiresFreshStart,
      lastError: tunnel.lastError,
      nextRetryAt: tunnel.nextRetryAt,
      retryAttempt: tunnel.retryAttempt,
      lastFailureCategory: tunnel.lastFailureCategory,
    };
  }

  getStartBlocker(serviceName) {
    for (const [otherServiceName, tunnel] of this.tunnels.entries()) {
      if (otherServiceName === serviceName) {
        continue;
      }

      if (tunnel.hidden) {
        continue;
      }

      if (tunnel.publicUrl) {
        continue;
      }

      if (
        tunnel.state === "starting" &&
        !tunnel.pid &&
        !tunnel.startedAt
      ) {
        continue;
      }

      if (
        tunnel.state === "starting" ||
        tunnel.state === "waiting_retry" ||
        tunnel.state === "reconnecting"
      ) {
        return {
          serviceName: otherServiceName,
          state: tunnel.state,
          nextRetryAt: tunnel.nextRetryAt || null,
          lastError: tunnel.lastError || null,
        };
      }
    }

    return null;
  }

  buildCloudflaredArgs(service) {
    return [
      "tunnel",
      "--url",
      `http://${service.host}:${service.port}`,
      "--http-host-header",
      "localhost",
      "--no-autoupdate",
    ];
  }

  buildNgrokArgs(service, authtoken = this.ngrokAuthtoken) {
    if (!authtoken) {
      throw new Error("Ngrok requires an auth token before a tunnel can be started.");
    }

    const args = [
      "http",
      `http://${service.host}:${service.port}`,
      "--log=stdout",
      "--log-format=logfmt",
      "--host-header=localhost",
    ];

    if (this.ngrokUrl) {
      args.push("--url", this.ngrokUrl);
    }

    args.push("--authtoken", authtoken);

    return args;
  }

  buildProviderArgs(service, providerKey) {
    if (providerKey === "ngrok") {
      return this.buildNgrokArgs(service);
    }

    return this.buildCloudflaredArgs(service);
  }

  getProviderCommand(providerKey) {
    if (providerKey === "ngrok") {
      return this.ngrokPath;
    }

    return this.cloudflaredPath;
  }

  async startTunnelProcess(service, tunnel) {
    const provider = tunnel.provider || this.providerOrder[0] || "cloudflare";
    logger.info(`Starting ${this.getProviderLabel(provider)} tunnel for ${service.serviceName}`, {
      serviceName: service.serviceName,
      provider,
      mode: this.mode,
    });

    const command = this.getProviderCommand(provider);
    const args = this.buildProviderArgs(service, provider);
    const { logPath } = this.getWritableTunnelPaths(service.serviceName, provider);
    const stdoutFd = fs.openSync(logPath, "a");
    this.pruneOldLaunchLogs(service.serviceName, provider);

    try {
      const child = await new Promise((resolve, reject) => {
        const spawned = spawn(command, args, {
          detached: true,
          stdio: ["ignore", stdoutFd, stdoutFd],
          windowsHide: true,
        });

        spawned.once("error", reject);
        spawned.once("spawn", () => resolve(spawned));
      });

      child.unref();
      tunnel.child = null;
      tunnel.pid = child.pid;
      tunnel.provider = provider;
      tunnel.logPath = logPath;
      tunnel.hidden = false;
      tunnel.hiddenAt = null;
      tunnel.requiresFreshStart = false;
      tunnel.publicUrl = null;
      tunnel.state = "starting";
      tunnel.lastQueueLogAt = null;
      tunnel.lastError = null;
      tunnel.lastFailureCategory = null;
      tunnel.nextRetryAt = null;
      tunnel.startedAt = Date.now();
      tunnel.startupDeadlineAt = Date.now() + this.startupTimeoutMs;
      this.persistTunnelState(service.serviceName, tunnel);
      this.nextStartAllowedAt = Date.now() + this.startSpacingMs;
      await this.refreshTunnelUrl(service);
      return tunnel;
    } finally {
      fs.closeSync(stdoutFd);
    }
  }

  async ensureTunnel(service) {
    const tunnel = await this.recoverTunnel(service);

    if (
      tunnel.requiresFreshStart &&
      tunnel.pid &&
      (await this.isPidAlive(tunnel.pid))
    ) {
      logger.info(
        `Restarting ${this.getProviderLabel(tunnel.provider)} tunnel for ${service.serviceName} after connectivity change`,
        {
          serviceName: service.serviceName,
          provider: tunnel.provider,
          publicUrl: tunnel.lastKnownPublicUrl || null,
          lastError: tunnel.lastError || null,
        }
      );
      await this.stopTunnel(service.serviceName);
      return this.ensureTunnel(service);
    }

    if (tunnel.hidden) {
      const hiddenDurationMs = tunnel.hiddenAt ? Date.now() - tunnel.hiddenAt : 0;
      const shouldForceFreshStart =
        tunnel.requiresFreshStart || hiddenDurationMs > 15000;

      if (shouldForceFreshStart) {
        logger.info(`Restarting ${this.getProviderLabel(tunnel.provider)} tunnel for ${service.serviceName} instead of reusing stale tunnel`, {
          serviceName: service.serviceName,
          provider: tunnel.provider,
          publicUrl: tunnel.lastKnownPublicUrl || tunnel.publicUrl || null,
          hiddenDurationMs,
          requiresFreshStart: tunnel.requiresFreshStart,
        });
        await this.stopTunnel(service.serviceName);
        return this.ensureTunnel(service);
      }

      if (tunnel.publicUrl) {
        logger.info(`Reusing existing ${this.getProviderLabel(tunnel.provider)} tunnel for ${service.serviceName}`, {
          serviceName: service.serviceName,
          provider: tunnel.provider,
          publicUrl: tunnel.publicUrl,
        });
      }

      tunnel.hidden = false;
      tunnel.hiddenAt = null;
      if (tunnel.state === "stopped") {
        tunnel.state = "idle";
      }
      this.persistTunnelState(service.serviceName, tunnel);
    }

    if (tunnel.pid && (await this.isPidAlive(tunnel.pid))) {
      await this.refreshTunnelUrl(service);
      return tunnel;
    }

    const blockers = this.retryManager.getBlockers(service.serviceName);
    if (!blockers.canAttempt) {
      this.markState(service.serviceName, tunnel, "waiting_retry", {
        nextRetryAt: blockers.until,
        retryAttempt: blockers.attempt,
        lastError: blockers.reason,
        lastFailureCategory: blockers.category,
      });
      return tunnel;
    }

    if (Date.now() < this.nextStartAllowedAt) {
      if (tunnel.lastQueueLogAt !== this.nextStartAllowedAt) {
        logger.info(`Queued tunnel start for ${service.serviceName}`, {
          serviceName: service.serviceName,
          provider: tunnel.provider,
          queuedUntil: new Date(this.nextStartAllowedAt).toISOString(),
        });
        tunnel.lastQueueLogAt = this.nextStartAllowedAt;
      }

      this.markState(service.serviceName, tunnel, "starting", {
        nextRetryAt: this.nextStartAllowedAt,
      });
      return tunnel;
    }

    return this.startTunnelProcess(service, tunnel);
  }

  async suspendTunnel(serviceName) {
    const tunnel = this.tunnels.get(serviceName);

    if (!tunnel) {
      return;
    }

    if (!tunnel.hidden) {
      logger.info(`Suspending ${this.getProviderLabel(tunnel.provider)} tunnel for ${serviceName}`, {
        serviceName,
        provider: tunnel.provider,
        publicUrl: tunnel.publicUrl,
      });
    }

    tunnel.hidden = true;
    tunnel.hiddenAt = Date.now();
    tunnel.state = "stopped";
    tunnel.publicUrl = null;
    this.clearRetryState(serviceName, tunnel);
    this.persistTunnelState(serviceName, tunnel);
  }

  requestFreshStart(serviceName, reason = "reconnect") {
    const tunnel = this.getOrCreateTunnel(serviceName);
    this.retryManager.reset(serviceName);
    this.deleteLog(serviceName);
    tunnel.requiresFreshStart = true;
    tunnel.lastKnownPublicUrl = tunnel.lastKnownPublicUrl || tunnel.publicUrl || null;
    if (!tunnel.hidden) {
      tunnel.state = "reconnecting";
      tunnel.lastError = this.describeFreshStartReason(reason);
      tunnel.lastFailureCategory = "network_switch";
      tunnel.nextRetryAt = null;
      tunnel.retryAttempt = 0;
      tunnel.startedAt = null;
      tunnel.startupDeadlineAt = null;
    }
    this.persistTunnelState(serviceName, tunnel);
    logger.info(`Marked tunnel for fresh restart on next ensure`, {
      serviceName,
      provider: tunnel.provider,
      reason,
      publicUrl: tunnel.lastKnownPublicUrl || tunnel.publicUrl || null,
    });
  }

  requestFreshStartAll(reason = "reconnect") {
    for (const serviceName of this.listTrackedServiceNames()) {
      this.requestFreshStart(serviceName, reason);
    }
  }

  isProcessNotFoundError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /not found|no running instance/i.test(message);
  }

  async stopTunnel(serviceName) {
    const tunnel = this.getOrCreateTunnel(serviceName);

    tunnel.stopping = true;
    await this.killTunnelProcess(serviceName, tunnel);

    this.retryManager.reset(serviceName);
    this.tunnels.delete(serviceName);
    this.deleteMeta(serviceName);
    this.deleteLog(serviceName);
  }

  async stopAll() {
    const serviceNames = this.listTrackedServiceNames();

    for (const serviceName of serviceNames) {
      await this.stopTunnel(serviceName);
    }
  }

  async resetAll() {
    await this.stopAll();
  }
}

module.exports = TunnelManager;
