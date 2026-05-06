function commandLabel(command) {
  const action = String(command?.action || "command");
  const serviceName = command?.service_name || command?.serviceName || null;
  if (serviceName) {
    return `${action}:${serviceName}`;
  }
  return action;
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeError(error) {
  if (!error) {
    return null;
  }
  return error instanceof Error ? error.message : String(error);
}

function isCancelledCommand(command) {
  return (
    String(command?.status || "").toLowerCase() === "failed" &&
    String(command?.phase || "").toLowerCase() === "cancelled"
  );
}

class CommandCancelledError extends Error {
  constructor(message = "Command dibatalkan pengguna.") {
    super(message);
    this.name = "CommandCancelledError";
    this.cancelled = true;
  }
}

class CommandProgress {
  constructor({ command, supabaseApi, workerId, logger }) {
    this.command = command;
    this.supabaseApi = supabaseApi;
    this.workerId = workerId || "agent";
    this.logger = logger;
  }

  async claim(message = "Command diterima agent.") {
    await this.update({
      status: "running",
      phase: "claimed",
      progressPercent: 5,
      message,
      startedAt: new Date().toISOString(),
      claimedBy: this.workerId,
      claimedPid: typeof process !== "undefined" ? process.pid : null,
    });
  }

  async step(phase, progressPercent, message, details = {}) {
    await this.throwIfCancelled();
    this.logger?.info?.(message, {
      serviceName: this.command.service_name || null,
      action: this.command.action,
      commandId: this.command.id,
      phase,
      progressPercent,
      ...details,
    });
    await this.update({
      status: "running",
      phase,
      progressPercent,
      message,
      claimedBy: this.workerId,
      claimedPid: typeof process !== "undefined" ? process.pid : null,
    });
  }

  async done(message = "Command selesai.") {
    await this.throwIfCancelled();
    await this.update({
      status: "done",
      phase: "done",
      progressPercent: 100,
      message,
      error: null,
      completedAt: new Date().toISOString(),
    });
  }

  async failed(error, phase = "failed") {
    const message = normalizeError(error) || "Command gagal.";
    if (error?.cancelled || phase === "cancelled") {
      await this.update({
        status: "failed",
        phase: "cancelled",
        progressPercent: 100,
        message,
        error: message,
        completedAt: new Date().toISOString(),
      });
      return;
    }
    await this.update({
      status: "failed",
      phase,
      progressPercent: 100,
      message,
      error: message,
      completedAt: new Date().toISOString(),
    });
  }

  async update(patch) {
    if (!this.command?.id || !this.supabaseApi?.updateCommandProgress) {
      return;
    }

    try {
      if (!patch.status || patch.status === "running" || patch.status === "done") {
        await this.throwIfCancelled();
      }
      const nextPatch = { ...patch };
      if (Object.prototype.hasOwnProperty.call(nextPatch, "progressPercent")) {
        nextPatch.progressPercent = clampPercent(nextPatch.progressPercent);
      }
      await this.supabaseApi.updateCommandProgress(this.command.id, {
        ...nextPatch,
      });
    } catch (error) {
      this.logger?.warn?.(`Failed to update command progress for ${commandLabel(this.command)}: ${error.message}`, {
        serviceName: this.command.service_name || null,
        action: this.command.action,
        commandId: this.command.id,
      });
    }
  }

  async throwIfCancelled() {
    if (!this.command?.id || !this.supabaseApi?.fetchCommand) {
      return;
    }

    const current = await this.supabaseApi.fetchCommand(this.command.id);
    if (isCancelledCommand(current)) {
      throw new CommandCancelledError(current.error || current.message || undefined);
    }
  }
}

module.exports = {
  CommandProgress,
  CommandCancelledError,
  clampPercent,
};
