const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const logger = require("./logger");
const { getStateDir } = require("./paths");
const RetryManager = require("./retryManager");

const TRY_CLOUDFLARE_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;
const RATE_LIMIT_PATTERN = /rate[- ]limited|429|error code:\s*1015|too many requests/i;
const NOT_READY_PATTERN = /not ready|failed to unmarshal quick tunnel/i;
const PUBLIC_URL_PROBE_TIMEOUT_MS = 5000;

class TunnelManager {
  constructor(options) {
    this.cloudflaredPath = options.cloudflaredPath;
    this.onUrl = options.onUrl;
    this.mode = "quick";
    this.stateDir = options.stateDir || path.join(getStateDir(), "tunnels");
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

  getFallbackTunnelDir() {
    const fallbackDir = path.join(os.tmpdir(), "school-services", "tunnels");
    fs.mkdirSync(fallbackDir, { recursive: true });
    return fallbackDir;
  }

  getWritableTunnelPaths(serviceName) {
    const primaryPaths = this.getTunnelPaths(serviceName);

    try {
      fs.writeFileSync(primaryPaths.logPath, "", "utf8");
      return primaryPaths;
    } catch (error) {
      if (!["EPERM", "EACCES"].includes(String(error?.code || ""))) {
        throw error;
      }

      const fallbackDir = this.getFallbackTunnelDir();
      const fallbackPaths = {
        logPath: path.join(fallbackDir, `${serviceName}.cloudflared.log`),
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
      fs.writeFileSync(fallbackPaths.logPath, "", "utf8");
      return fallbackPaths;
    }
  }

  deleteLog(serviceName) {
    const { logPath } = this.getTunnelPaths(serviceName);
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
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
    return {
      child: null,
      pid: payload.pid || null,
      logPath: payload.logPath || this.getTunnelPaths(serviceName).logPath,
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

  readPublicUrlFromLog(logPath) {
    if (!logPath || !fs.existsSync(logPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(logPath, "utf8");
      const matches = content.match(TRY_CLOUDFLARE_PATTERN);
      if (!matches || matches.length === 0) {
        return null;
      }

      return matches[matches.length - 1];
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
          "Cloudflare quick tunnel rate-limited this machine. Clear orphaned cloudflared processes, then retry after cooldown.",
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

  applyRetryState(serviceName, tunnel, issue) {
    const retry = this.retryManager.scheduleRetry(serviceName, {
      category: issue.category,
      reason: issue.message,
    });
    const previousGlobalCooldown = this.lastLoggedGlobalCooldownUntil;

    tunnel.pid = null;
    tunnel.child = null;
    tunnel.publicUrl = null;
    tunnel.lastError = retry.reason;
    tunnel.nextRetryAt = retry.nextRetryAt;
    tunnel.retryAttempt = retry.attempt;
    tunnel.lastFailureCategory = retry.category;
    tunnel.startedAt = null;
    tunnel.startupDeadlineAt = null;
    tunnel.state = "waiting_retry";
    this.persistTunnelState(serviceName, tunnel);

    logger.warn(`Cloudflare tunnel for ${serviceName} is not ready: ${retry.reason}`, {
      serviceName,
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
      return "Jaringan berubah. Menunggu tunnel Cloudflare tersambung kembali.";
    }

    if (reason === "resume-recovery") {
      return "Koneksi perangkat dipulihkan. Menunggu tunnel Cloudflare tersambung kembali.";
    }

    return "Tunnel Cloudflare sedang disegarkan kembali.";
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
            "Jaringan sedang berpindah atau tunnel Cloudflare lama sudah tidak berlaku. Menunggu tunnel baru tersambung.",
          restartRecommended: true,
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
          "Koneksi publik belum stabil. Menunggu jaringan dan tunnel Cloudflare tersambung kembali.",
        restartRecommended: true,
        details: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  markReconnectingState(serviceName, tunnel, issue, options = {}) {
    tunnel.publicUrl = null;
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

    const publicUrl = this.readPublicUrlFromLog(tunnel.logPath);
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

      this.applyRetryState(service.serviceName, tunnel, issue);
      return null;
    }

    if (tunnel.pid && (await this.isPidAlive(tunnel.pid))) {
      if (tunnel.startupDeadlineAt && Date.now() >= tunnel.startupDeadlineAt) {
        this.applyRetryState(service.serviceName, tunnel, {
          category: "transient",
          message: "Cloudflare tunnel startup timed out before a public URL was detected.",
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

    const issue = this.extractTunnelIssue(this.readLogContent(tunnel.logPath));
    if (issue) {
      if (this.shouldKeepExistingRetry(tunnel, issue)) {
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
        message: "Cloudflare tunnel process exited before publishing a public URL.",
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

    return tunnel.publicUrl || null;
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
        publicUrl: null,
        lastKnownPublicUrl: null,
        lastError: null,
        nextRetryAt: null,
        retryAttempt: 0,
      };
    }

    return {
      state: tunnel.state,
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
        !tunnel.startedAt &&
        !tunnel.nextRetryAt
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

  async startTunnelProcess(service, tunnel) {
    logger.info(`Starting Cloudflare tunnel for ${service.serviceName}`, {
      serviceName: service.serviceName,
      mode: this.mode,
    });

    const args = this.buildCloudflaredArgs(service);
    const { logPath } = this.getWritableTunnelPaths(service.serviceName);
    const stdoutFd = fs.openSync(logPath, "a");

    try {
      const child = await new Promise((resolve, reject) => {
        const spawned = spawn(this.cloudflaredPath, args, {
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
        `Restarting Cloudflare tunnel for ${service.serviceName} after connectivity change`,
        {
          serviceName: service.serviceName,
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
        logger.info(`Restarting Cloudflare tunnel for ${service.serviceName} instead of reusing stale tunnel`, {
          serviceName: service.serviceName,
          publicUrl: tunnel.lastKnownPublicUrl || tunnel.publicUrl || null,
          hiddenDurationMs,
          requiresFreshStart: tunnel.requiresFreshStart,
        });
        await this.stopTunnel(service.serviceName);
        return this.ensureTunnel(service);
      }

      if (tunnel.publicUrl) {
        logger.info(`Reusing existing Cloudflare tunnel for ${service.serviceName}`, {
          serviceName: service.serviceName,
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

    const startBlocker = this.getStartBlocker(service.serviceName);
    if (startBlocker) {
      const queueToken = `${startBlocker.serviceName}:${startBlocker.state}:${startBlocker.nextRetryAt || "none"}`;
      if (tunnel.lastQueueLogAt !== queueToken) {
        logger.info(`Queued Cloudflare tunnel start for ${service.serviceName}`, {
          serviceName: service.serviceName,
          waitingForService: startBlocker.serviceName,
          waitingForState: startBlocker.state,
          waitingUntil: startBlocker.nextRetryAt
            ? new Date(startBlocker.nextRetryAt).toISOString()
            : null,
          reason: startBlocker.lastError,
        });
        tunnel.lastQueueLogAt = queueToken;
      }

      this.markState(service.serviceName, tunnel, "starting", {
        nextRetryAt: startBlocker.nextRetryAt || null,
      });
      return tunnel;
    }

    if (Date.now() < this.nextStartAllowedAt) {
      if (tunnel.lastQueueLogAt !== this.nextStartAllowedAt) {
        logger.info(`Queued Cloudflare tunnel start for ${service.serviceName}`, {
          serviceName: service.serviceName,
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
      logger.info(`Suspending Cloudflare tunnel for ${serviceName}`, {
        serviceName,
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
    logger.info(`Marked Cloudflare tunnel for fresh restart on next ensure`, {
      serviceName,
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
    if (tunnel.pid) {
      try {
        await this.runCapture(this.getCmdPath(), ["/c", `taskkill /PID ${tunnel.pid} /T /F`]);
      } catch (error) {
        if (!this.isProcessNotFoundError(error)) {
          logger.warn(`Failed to stop Cloudflare tunnel for ${serviceName}: ${error.message}`, {
            serviceName,
            pid: tunnel.pid,
          });
        }
      }
    }

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
