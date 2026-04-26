const DEFAULT_RETRY_DELAYS_MS = [10000, 30000, 60000, 120000, 300000];

class RetryManager {
  constructor(options = {}) {
    this.retryDelaysMs = Array.isArray(options.retryDelaysMs)
      ? options.retryDelaysMs.map((value) => Number(value)).filter(Number.isFinite)
      : DEFAULT_RETRY_DELAYS_MS;
    this.globalCooldownMs = Number(options.globalCooldownMs || 60000);
    this.serviceState = new Map();
    this.globalCooldownUntil = null;
  }

  getState(serviceName) {
    if (!this.serviceState.has(serviceName)) {
      this.serviceState.set(serviceName, {
        attempt: 0,
        nextRetryAt: null,
        lastReason: null,
        lastCategory: null,
      });
    }

    return this.serviceState.get(serviceName);
  }

  hydrate(serviceName, snapshot = {}) {
    const state = this.getState(serviceName);
    state.attempt = Number(snapshot.attempt || 0);
    state.nextRetryAt = snapshot.nextRetryAt || null;
    state.lastReason = snapshot.lastReason || null;
    state.lastCategory = snapshot.lastCategory || null;
    this.pruneExpiredGlobalCooldown();
    return state;
  }

  reset(serviceName) {
    const state = this.getState(serviceName);
    state.attempt = 0;
    state.nextRetryAt = null;
    state.lastReason = null;
    state.lastCategory = null;
    this.pruneExpiredGlobalCooldown();
    return state;
  }

  getSnapshot(serviceName) {
    const state = this.getState(serviceName);
    this.pruneExpiredGlobalCooldown();
    return {
      attempt: state.attempt,
      nextRetryAt: state.nextRetryAt,
      lastReason: state.lastReason,
      lastCategory: state.lastCategory,
      globalCooldownUntil: this.globalCooldownUntil,
    };
  }

  countActiveRateLimits(now = Date.now()) {
    let count = 0;

    for (const state of this.serviceState.values()) {
      if (
        state.lastCategory === "rate_limit" &&
        state.nextRetryAt &&
        state.nextRetryAt > now
      ) {
        count += 1;
      }
    }

    return count;
  }

  pruneExpiredGlobalCooldown(now = Date.now()) {
    if (this.globalCooldownUntil && this.globalCooldownUntil <= now) {
      this.globalCooldownUntil = null;
    }
  }

  scheduleRetry(serviceName, options = {}) {
    const now = options.now || Date.now();
    const category = options.category || "transient";
    const reason = options.reason || "Tunnel start failed";
    const state = this.getState(serviceName);

    state.attempt += 1;
    const index = Math.min(
      Math.max(state.attempt - 1, 0),
      this.retryDelaysMs.length - 1
    );
    const delayMs = this.retryDelaysMs[index];
    state.nextRetryAt = now + delayMs;
    state.lastReason = reason;
    state.lastCategory = category;

    let globalCooldownUntil = this.globalCooldownUntil;
    if (category === "rate_limit" && this.countActiveRateLimits(now) >= 2) {
      globalCooldownUntil = now + this.globalCooldownMs;
      this.globalCooldownUntil = Math.max(this.globalCooldownUntil || 0, globalCooldownUntil);
    }

    this.pruneExpiredGlobalCooldown(now);

    return {
      attempt: state.attempt,
      delayMs,
      nextRetryAt: state.nextRetryAt,
      reason: state.lastReason,
      category: state.lastCategory,
      globalCooldownUntil: this.globalCooldownUntil,
    };
  }

  getBlockers(serviceName, now = Date.now()) {
    const state = this.getState(serviceName);
    this.pruneExpiredGlobalCooldown(now);

    const serviceCooldownUntil =
      state.nextRetryAt && state.nextRetryAt > now ? state.nextRetryAt : null;
    const globalCooldownUntil =
      this.globalCooldownUntil && this.globalCooldownUntil > now
        ? this.globalCooldownUntil
        : null;
    const until =
      globalCooldownUntil && serviceCooldownUntil
        ? Math.max(globalCooldownUntil, serviceCooldownUntil)
        : globalCooldownUntil || serviceCooldownUntil || null;

    return {
      canAttempt: !until,
      until,
      serviceCooldownUntil,
      globalCooldownUntil,
      attempt: state.attempt,
      reason: state.lastReason,
      category: state.lastCategory,
    };
  }
}

module.exports = RetryManager;
