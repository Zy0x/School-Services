const { spawn } = require("child_process");
const path = require("path");
const logger = require("./logger");
const { isPortOpen, sleep, waitForPort } = require("./utils");

function escapePowerShellSingleQuotedString(value) {
  return String(value || "").replace(/'/g, "''");
}

class ServiceManager {
  constructor(services) {
    this.services = services;
    this.state = new Map();
    this.elevationState = null;
  }

  list() {
    return Object.values(this.services)
      .slice()
      .sort((left, right) => {
        const leftOrder = Number(left.startOrder || 0);
        const rightOrder = Number(right.startOrder || 0);

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return String(left.serviceName || "").localeCompare(
          String(right.serviceName || "")
        );
      });
  }

  getDefinition(serviceName) {
    const definition = this.services[serviceName];

    if (!definition) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    return definition;
  }

  getState(serviceName) {
    if (!this.state.has(serviceName)) {
      const definition = this.services[serviceName] || {};
      this.state.set(serviceName, {
        child: null,
        pid: null,
        desiredState: definition.autoStart ? "running" : "stopped",
        lastError: null,
        warnedMissingStart: false,
      });
    }

    return this.state.get(serviceName);
  }

  getDesiredState(serviceName) {
    return this.getState(serviceName).desiredState;
  }

  setDesiredState(serviceName, desiredState, reason = "system") {
    if (desiredState !== "running" && desiredState !== "stopped") {
      throw new Error(`Invalid desired state "${desiredState}" for ${serviceName}`);
    }

    const state = this.getState(serviceName);
    if (state.desiredState === desiredState) {
      return;
    }

    state.desiredState = desiredState;
    logger.info(`Desired state changed for ${serviceName}: ${desiredState}`, {
      serviceName,
      desiredState,
      reason,
    });
  }

  clearLastError(serviceName) {
    this.getState(serviceName).lastError = null;
  }

  setLastError(serviceName, error) {
    const state = this.getState(serviceName);
    state.lastError = error instanceof Error ? error.message : String(error);
  }

  normalizeCommand(commandConfig) {
    if (!commandConfig) {
      return null;
    }

    if (typeof commandConfig === "string") {
      return {
        command: "cmd.exe",
        args: ["/c", commandConfig],
      };
    }

    return {
      command: commandConfig.command,
      args: commandConfig.args || [],
      cwd: commandConfig.cwd,
      env: commandConfig.env,
      shell: Boolean(commandConfig.shell),
    };
  }

  formatCommand(command) {
    const parts = [command.command].concat(command.args || []);
    return parts.join(" ");
  }

  getPowerShellPath() {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    return path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
  }

  getWindowsServices(definition) {
    return Array.isArray(definition.windowsServices)
      ? definition.windowsServices.filter(Boolean)
      : [];
  }

  async isProcessElevated() {
    if (this.elevationState !== null) {
      return this.elevationState;
    }

    const script = [
      "$identity = [Security.Principal.WindowsIdentity]::GetCurrent()",
      "$principal = New-Object Security.Principal.WindowsPrincipal($identity)",
      "Write-Output ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))",
    ].join("; ");
    const { stdout } = await this.runCapture(this.getPowerShellPath(), [
      "-NoProfile",
      "-Command",
      script,
    ]);

    this.elevationState = String(stdout || "").trim().toLowerCase() === "true";
    return this.elevationState;
  }

  async warnIfWindowsServiceControlNeedsElevation() {
    const managedServices = this.list()
      .filter(
        (service) =>
          service.startStrategy === "windows-service" ||
          service.stopStrategy === "windows-service"
      )
      .map((service) => service.serviceName);

    if (managedServices.length === 0) {
      return;
    }

    try {
      const elevated = await this.isProcessElevated();
      if (!elevated) {
        logger.warn(
          "Agent is not running with Administrator privileges. Windows service start/stop commands may fail with Access is denied.",
          { managedServices }
        );
      }
    } catch (error) {
      logger.warn(`Failed to determine process elevation: ${error.message}`);
    }
  }

  async initializeDesiredStates() {
    for (const service of this.list()) {
      const snapshot = await this.refreshService(service.serviceName);
      const shouldRun = snapshot.status === "running" || Boolean(service.autoStart);
      const reason =
        snapshot.status === "running"
          ? "startup-detected-running"
          : service.autoStart
            ? "startup-auto-start"
            : "startup-default-stopped";

      this.setDesiredState(
        service.serviceName,
        shouldRun ? "running" : "stopped",
        reason
      );
    }
  }

  async startService(serviceName) {
    const definition = this.getDefinition(serviceName);
    const state = this.getState(serviceName);

    if (await isPortOpen(definition.port, definition.host)) {
      this.clearLastError(serviceName);
      return this.refreshService(serviceName);
    }

    try {
      if (definition.startStrategy === "windows-service") {
        await this.startWindowsServices(serviceName);
        state.warnedMissingStart = false;
      } else {
        const command = this.normalizeCommand(definition.startCommand);

        if (!command) {
          if (!state.warnedMissingStart) {
            logger.warn(
              `Service ${serviceName} has no startCommand. The agent will only attach if the service is already running.`,
              { serviceName, port: definition.port }
            );
            state.warnedMissingStart = true;
          }

          return this.refreshService(serviceName);
        }

        logger.info(`Starting service ${serviceName}`, {
          serviceName,
          port: definition.port,
          command: this.formatCommand(command),
        });

        const child = await new Promise((resolve, reject) => {
          const spawned = spawn(command.command, command.args, {
            cwd: command.cwd,
            env: { ...process.env, ...(command.env || {}) },
            shell: command.shell,
            detached: false,
            stdio: "ignore",
            windowsHide: true,
          });

          spawned.once("error", reject);
          spawned.once("spawn", () => resolve(spawned));
        });

        state.child = child;
        state.pid = child.pid;
        state.warnedMissingStart = false;

        child.once("exit", () => {
          state.child = null;
          state.pid = null;
        });
      }

      const opened = await waitForPort(
        definition.port,
        definition.host,
        definition.startupTimeoutMs || 20000
      );

      if (!opened) {
        logger.warn(`Service ${serviceName} did not open port ${definition.port}`, {
          serviceName,
          port: definition.port,
        });
      }

      this.clearLastError(serviceName);
      return this.refreshService(serviceName);
    } catch (error) {
      this.setLastError(serviceName, error);
      throw error;
    }
  }

  async runOneShot(commandConfig) {
    const command = this.normalizeCommand(commandConfig);

    if (!command) {
      return;
    }

    await new Promise((resolve, reject) => {
      const child = spawn(command.command, command.args, {
        cwd: command.cwd,
        env: { ...process.env, ...(command.env || {}) },
        shell: command.shell,
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
          resolve();
          return;
        }

        reject(
          new Error(
            `Command "${this.formatCommand(command)}" exited with code ${code}${
              stdout.trim() ? `: ${stdout.trim()}` : stderr.trim() ? `: ${stderr.trim()}` : ""
            }`
          )
        );
      });
    });
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
            `Command exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`
          )
        );
      });
    });
  }

  async findListeningPidByPort(port) {
    try {
      const { stdout } = await this.runCapture(this.getPowerShellPath(), [
        "-NoProfile",
        "-Command",
        [
          "$conn = Get-NetTCPConnection -State Listen -LocalPort ",
          String(port),
          " -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; ",
          "if ($conn) { Write-Output $conn }",
        ].join(""),
      ]);

      const parsed = Number.parseInt(String(stdout || "").trim(), 10);
      return Number.isFinite(parsed) ? parsed : null;
    } catch (error) {
      logger.warn(`Failed to resolve listening PID on port ${port}: ${error.message}`, {
        port,
      });
      return null;
    }
  }

  async getWindowsServiceStatus(serviceName) {
    const script = [
      `$service = Get-Service -Name '${escapePowerShellSingleQuotedString(serviceName)}' -ErrorAction Stop`,
      "Write-Output $service.Status",
    ].join("; ");
    const { stdout } = await this.runCapture(this.getPowerShellPath(), [
      "-NoProfile",
      "-Command",
      script,
    ]);

    return String(stdout || "").trim().toLowerCase();
  }

  async waitForWindowsServiceState(serviceName, expectedState, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const status = await this.getWindowsServiceStatus(serviceName);
        if (status === expectedState) {
          return true;
        }
      } catch (error) {
        logger.warn(
          `Failed to query Windows service ${serviceName} while waiting for ${expectedState}: ${error.message}`,
          { serviceName }
        );
        return false;
      }

      await sleep(500);
    }

    return false;
  }

  async runWindowsServiceAction(action, serviceName) {
    const expectedState = action === "start" ? "running" : "stopped";

    try {
      const status = await this.getWindowsServiceStatus(serviceName);
      if (status === expectedState) {
        logger.info(`Windows service ${serviceName} already ${expectedState}`, {
          serviceName,
        });
        return;
      }
    } catch (error) {
      throw new Error(`Failed to query Windows service ${serviceName}: ${error.message}`);
    }

    const elevated = await this.isProcessElevated();
    if (!elevated) {
      throw new Error(
        `Windows service ${action} requires Administrator privileges for ${serviceName}. Start the agent with run-agent-admin.ps1 or an elevated terminal.`
      );
    }

    logger.info(`Executing Windows service ${action} for ${serviceName}`, {
      serviceName,
      action,
    });

    try {
      await this.runOneShot({
        command: "sc.exe",
        args: [action, serviceName],
      });
    } catch (error) {
      throw new Error(`Windows service ${action} failed for ${serviceName}: ${error.message}`);
    }

    const reached = await this.waitForWindowsServiceState(
      serviceName,
      expectedState,
      20000
    );

    if (!reached) {
      logger.warn(
        `Windows service ${serviceName} did not reach state ${expectedState} within timeout`,
        { serviceName, expectedState }
      );
    }
  }

  async startWindowsServices(serviceName) {
    const definition = this.getDefinition(serviceName);
    const windowsServices = this.getWindowsServices(definition);

    if (windowsServices.length === 0) {
      throw new Error(
        `Service ${serviceName} is configured with startStrategy "windows-service" but windowsServices is empty`
      );
    }

    logger.info(`Starting Windows services for ${serviceName}`, {
      serviceName,
      windowsServices,
    });

    for (const windowsServiceName of windowsServices) {
      await this.runWindowsServiceAction("start", windowsServiceName);
    }
  }

  async stopWindowsServices(serviceName) {
    const definition = this.getDefinition(serviceName);
    const windowsServices = this.getWindowsServices(definition);

    if (windowsServices.length === 0) {
      throw new Error(
        `Service ${serviceName} is configured with stopStrategy "windows-service" but windowsServices is empty`
      );
    }

    logger.info(`Stopping Windows services for ${serviceName}`, {
      serviceName,
      windowsServices,
    });

    for (const windowsServiceName of windowsServices.slice().reverse()) {
      await this.runWindowsServiceAction("stop", windowsServiceName);
    }
  }

  async stopByPort(serviceName) {
    const definition = this.getDefinition(serviceName);
    const portPid = await this.findListeningPidByPort(definition.port);

    if (!portPid) {
      logger.warn(
        `Service ${serviceName} has no active listener on port ${definition.port}`,
        { serviceName, port: definition.port }
      );
      return;
    }

    await this.runOneShot(`taskkill /PID ${portPid} /T /F`);
  }

  async stopService(serviceName) {
    const definition = this.getDefinition(serviceName);
    const state = this.getState(serviceName);

    logger.info(`Stopping service ${serviceName}`, {
      serviceName,
      port: definition.port,
    });

    try {
      if (definition.stopStrategy === "windows-service") {
        await this.stopWindowsServices(serviceName);
      } else if (definition.stopStrategy === "port") {
        try {
          await this.stopByPort(serviceName);
        } catch (error) {
          if (definition.stopCommand) {
            logger.warn(
              `Port-based stop failed for ${serviceName}; falling back to stopCommand: ${error.message}`,
              { serviceName, port: definition.port }
            );
            await this.runOneShot(definition.stopCommand);
          } else {
            throw error;
          }
        }
      } else if (definition.stopCommand) {
        await this.runOneShot(definition.stopCommand);
      } else if (state.child && state.pid) {
        await this.runOneShot(`taskkill /PID ${state.pid} /T /F`);
      } else {
        await this.stopByPort(serviceName);
      }

      await sleep(1500);
      this.clearLastError(serviceName);
      return this.refreshService(serviceName);
    } catch (error) {
      this.setLastError(serviceName, error);
      throw error;
    }
  }

  async stopAll() {
    const services = this.list();

    for (const service of services) {
      try {
        await this.stopService(service.serviceName);
      } catch (error) {
        logger.warn(`Failed to stop service ${service.serviceName}: ${error.message}`, {
          serviceName: service.serviceName,
          port: service.port,
        });
      }
    }
  }

  async refreshService(serviceName) {
    const definition = this.getDefinition(serviceName);
    const running = await isPortOpen(definition.port, definition.host);
    const state = this.getState(serviceName);

    return {
      serviceName,
      port: definition.port,
      host: definition.host,
      pid: state.pid,
      desiredState: state.desiredState,
      lastError: state.lastError,
      status: running ? "running" : "stopped",
      autoStart: Boolean(definition.autoStart),
    };
  }
}

module.exports = ServiceManager;
