const { spawn } = require("child_process");
const path = require("path");
const logger = require("./logger");
const { getConfigTargetsForService } = require("./serviceConfigs");
const { fileExists, isPortOpen, sleep, waitForPort } = require("./utils");

function escapePowerShellSingleQuotedString(value) {
  return String(value || "").replace(/'/g, "''");
}

class ServiceManager {
  constructor(services) {
    this.services = services;
    this.state = new Map();
    this.elevationState = null;
    this.locationCache = new Map();
    this.windowsServiceInventory = null;
    this.resolvedWindowsServices = new Map();
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
        warnings: Object.create(null),
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

  clearLocationCache(serviceName) {
    if (serviceName) {
      this.locationCache.delete(serviceName);
      this.resolvedWindowsServices.delete(serviceName);
      return;
    }

    this.locationCache.clear();
    this.resolvedWindowsServices.clear();
  }

  setLastError(serviceName, error) {
    const state = this.getState(serviceName);
    state.lastError = error instanceof Error ? error.message : String(error);
  }

  warnOnce(serviceName, warningKey, message, details = {}) {
    const state = this.getState(serviceName);
    if (state.warnings[warningKey]) {
      return;
    }

    state.warnings[warningKey] = true;
    logger.warn(message, {
      serviceName,
      ...details,
    });
  }

  clearWarning(serviceName, warningKey) {
    const state = this.getState(serviceName);
    delete state.warnings[warningKey];
  }

  normalizeCommand(commandConfig) {
    if (!commandConfig) {
      return null;
    }

    if (typeof commandConfig === "string") {
      return {
        command: this.getCmdPath(),
        args: ["/c", commandConfig],
      };
    }

    return {
      command: this.resolveSystemCommandPath(commandConfig.command),
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

  getSystem32Path() {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    return path.join(systemRoot, "System32");
  }

  getCmdPath() {
    return path.join(this.getSystem32Path(), "cmd.exe");
  }

  getScPath() {
    return path.join(this.getSystem32Path(), "sc.exe");
  }

  getTaskkillPath() {
    return path.join(this.getSystem32Path(), "taskkill.exe");
  }

  resolveSystemCommandPath(command) {
    const normalized = String(command || "").trim().toLowerCase();

    if (normalized === "cmd.exe" || normalized === "cmd") {
      return this.getCmdPath();
    }

    if (normalized === "sc.exe" || normalized === "sc") {
      return this.getScPath();
    }

    if (normalized === "taskkill.exe" || normalized === "taskkill") {
      return this.getTaskkillPath();
    }

    if (normalized === "powershell.exe" || normalized === "powershell") {
      return this.getPowerShellPath();
    }

    return command;
  }

  getWindowsServices(definition) {
    return Array.isArray(definition.windowsServices)
      ? definition.windowsServices.filter(Boolean)
      : [];
  }

  async listInstalledWindowsServices() {
    if (this.windowsServiceInventory) {
      return this.windowsServiceInventory;
    }

    const script = [
      "$services = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Select-Object Name, DisplayName, State, PathName)",
      "$services | ConvertTo-Json -Depth 3 -Compress",
    ].join("; ");
    const { stdout } = await this.runCapture(this.getPowerShellPath(), [
      "-NoProfile",
      "-Command",
      script,
    ]);

    const raw = String(stdout || "").trim();
    if (!raw) {
      this.windowsServiceInventory = [];
      return this.windowsServiceInventory;
    }

    let parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      parsed = [parsed];
    }

    this.windowsServiceInventory = parsed.map((entry) => ({
      name: entry.Name || "",
      displayName: entry.DisplayName || "",
      state: entry.State || "",
      pathName: entry.PathName || "",
    }));
    return this.windowsServiceInventory;
  }

  scoreDiscoveredWindowsService(candidate, discovery = {}, explicitNames = []) {
    const haystack = `${candidate.name} ${candidate.displayName}`.toLowerCase();
    let score = 0;

    if (explicitNames.some((name) => name.toLowerCase() === candidate.name.toLowerCase())) {
      score += 1000;
    }

    for (const token of discovery.includeAny || []) {
      if (haystack.includes(String(token).toLowerCase())) {
        score += 50;
      }
    }

    for (const token of discovery.preferAny || []) {
      if (haystack.includes(String(token).toLowerCase())) {
        score += 20;
      }
    }

    if (/\bdb\b|database/i.test(haystack)) {
      score += 5;
    }

    if (/\bsrv\b|\bweb\b|service/i.test(haystack)) {
      score += 5;
    }

    return score;
  }

  matchesDiscoveredWindowsService(candidate, discovery = {}) {
    const haystack = `${candidate.name} ${candidate.displayName}`.toLowerCase();
    const includeAny = Array.isArray(discovery.includeAny)
      ? discovery.includeAny.filter(Boolean)
      : [];
    const excludeAny = Array.isArray(discovery.excludeAny)
      ? discovery.excludeAny.filter(Boolean)
      : [];

    if (
      includeAny.length > 0 &&
      !includeAny.some((token) => haystack.includes(String(token).toLowerCase()))
    ) {
      return false;
    }

    if (
      excludeAny.some((token) => haystack.includes(String(token).toLowerCase()))
    ) {
      return false;
    }

    return true;
  }

  async resolveWindowsServices(serviceName) {
    if (this.resolvedWindowsServices.has(serviceName)) {
      return this.resolvedWindowsServices.get(serviceName);
    }

    const definition = this.getDefinition(serviceName);
    const explicit = this.getWindowsServices(definition);
    let resolved = [];

    if (definition.windowsServiceDiscovery) {
      const inventory = await this.listInstalledWindowsServices();
      const installedNames = new Set(
        inventory.map((entry) => String(entry.name || "").toLowerCase())
      );
      const explicitInstalled = explicit.filter((name) =>
        installedNames.has(String(name).toLowerCase())
      );
      const matched = inventory
        .filter((candidate) =>
          this.matchesDiscoveredWindowsService(candidate, definition.windowsServiceDiscovery)
        )
        .sort((left, right) => {
          const leftScore = this.scoreDiscoveredWindowsService(
            left,
            definition.windowsServiceDiscovery,
            explicit
          );
          const rightScore = this.scoreDiscoveredWindowsService(
            right,
            definition.windowsServiceDiscovery,
            explicit
          );
          if (leftScore !== rightScore) {
            return rightScore - leftScore;
          }

          return String(left.name).localeCompare(String(right.name));
        });

      const expectedCount = Number(
        definition.windowsServiceDiscovery.expectedCount || matched.length
      );
      const discovered = matched
        .slice(0, expectedCount > 0 ? expectedCount : matched.length)
        .map((entry) => entry.name)
        .filter(Boolean);

      if (explicitInstalled.length > 0) {
        resolved = Array.from(new Set([...explicitInstalled, ...discovered]));
      } else if (discovered.length > 0) {
        resolved = discovered;
      } else if (explicit.length > 0) {
        resolved = explicit.slice();
      }
    } else {
      resolved = explicit.slice();
    }

    this.resolvedWindowsServices.set(serviceName, resolved);
    return resolved;
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
      this.clearLocationCache(serviceName);
      this.clearLastError(serviceName);
      return this.refreshService(serviceName);
    }

    try {
      if (definition.startStrategy === "windows-service") {
        const { missingServices, skippedForElevation, discoveryFailed } =
          await this.startWindowsServices(serviceName);
        if (discoveryFailed) {
          const message = `No matching Windows service could be discovered for ${serviceName} on this device.`;
          this.setLastError(serviceName, message);
          this.setDesiredState(serviceName, "stopped", "missing-windows-service");
          this.warnOnce(serviceName, "missing-windows-service-discovery", message);
          return this.refreshService(serviceName);
        }
        if (missingServices.length > 0) {
          const message = `Windows service(s) not installed for ${serviceName}: ${missingServices.join(", ")}`;
          this.setLastError(serviceName, message);
          this.setDesiredState(serviceName, "stopped", "missing-windows-service");
          this.warnOnce(
            serviceName,
            `missing-windows-service:${missingServices.join(",")}`,
            message,
            { missingServices }
          );
          return this.refreshService(serviceName);
        }

        if (skippedForElevation) {
          const message = `Windows service start requires Administrator privileges for ${serviceName}. Run the admin launcher or start the target software manually once.`;
          this.setLastError(serviceName, message);
          this.setDesiredState(serviceName, "stopped", "requires-elevation");
          this.warnOnce(serviceName, "requires-elevation-start", message, {
            serviceName,
          });
          return this.refreshService(serviceName);
        }

        this.clearWarning(serviceName, "requires-elevation-start");
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

      this.clearLocationCache(serviceName);
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
      `$service = Get-Service -Name '${escapePowerShellSingleQuotedString(serviceName)}' -ErrorAction SilentlyContinue`,
      "if (-not $service) { Write-Output '__missing__'; exit 0 }",
      "Write-Output $service.Status",
    ].join("; ");
    const { stdout } = await this.runCapture(this.getPowerShellPath(), [
      "-NoProfile",
      "-Command",
      script,
    ]);
    const status = String(stdout || "").trim().toLowerCase();
    return status === "__missing__" ? "missing" : status;
  }

  async getWindowsServiceMetadata(serviceName) {
    const script = [
      `$service = Get-CimInstance Win32_Service -Filter "Name='${escapePowerShellSingleQuotedString(serviceName)}'" -ErrorAction SilentlyContinue`,
      "if (-not $service) { ([ordered]@{ installed = $false } | ConvertTo-Json -Compress); exit 0 }",
      "([ordered]@{ installed = $true; name = $service.Name; displayName = $service.DisplayName; state = $service.State; pathName = $service.PathName } | ConvertTo-Json -Compress)",
    ].join("; ");
    const { stdout } = await this.runCapture(this.getPowerShellPath(), [
      "-NoProfile",
      "-Command",
      script,
    ]);

    try {
      return JSON.parse(String(stdout || "").trim());
    } catch (error) {
      throw new Error(
        `Failed to parse Windows service metadata for ${serviceName}: ${error.message}`
      );
    }
  }

  extractExecutablePath(pathName) {
    const value = String(pathName || "").trim();

    if (!value) {
      return null;
    }

    if (value.startsWith('"')) {
      const closingIndex = value.indexOf('"', 1);
      return closingIndex > 1 ? value.slice(1, closingIndex) : null;
    }

    const exeIndex = value.toLowerCase().indexOf(".exe");
    if (exeIndex === -1) {
      return value;
    }

    return value.slice(0, exeIndex + 4);
  }

  getConfigTargets(definition) {
    return getConfigTargetsForService(definition).filter(Boolean);
  }

  getConfigTargetCandidatePaths(target) {
    const candidates = [];

    if (target?.path) {
      candidates.push(target.path);
    }

    if (Array.isArray(target?.pathCandidates)) {
      candidates.push(...target.pathCandidates);
    }

    return candidates.filter(Boolean);
  }

  discoverConfigPathFromExecutable(target, executablePath) {
    if (!target || !executablePath) {
      return null;
    }

    const parsedExecutablePath = this.extractExecutablePath(executablePath);
    if (!parsedExecutablePath) {
      return null;
    }

    const suffixes = this.getConfigTargetCandidatePaths(target)
      .map((candidatePath) =>
        String(candidatePath || "")
          .split(/[\\/]+/)
          .filter(Boolean)
      )
      .flatMap((segments) => {
        const nextSuffixes = [];
        if (segments.length >= 2) {
          nextSuffixes.push(path.join(...segments.slice(-2)));
        }
        if (segments.length >= 1) {
          nextSuffixes.push(path.join(...segments.slice(-1)));
        }
        return nextSuffixes;
      })
      .filter(Boolean);

    let cursor = path.dirname(parsedExecutablePath);
    for (let index = 0; index < 5; index += 1) {
      for (const suffix of suffixes) {
        const candidate = path.join(cursor, suffix);
        if (fileExists(candidate)) {
          return candidate;
        }
      }

      const parentDir = path.dirname(cursor);
      if (parentDir === cursor) {
        break;
      }

      cursor = parentDir;
    }

    return null;
  }

  async getLocationDiagnostics(serviceName, options = {}) {
    const cached = this.locationCache.get(serviceName);
    const cacheTtlMs = Number(options.cacheTtlMs || 30000);

    if (
      cached &&
      options.forceRefresh !== true &&
      Date.now() - cached.updatedAt < cacheTtlMs
    ) {
      return cached.value;
    }

    const definition = this.getDefinition(serviceName);
    const windowsServices = await this.resolveWindowsServices(serviceName);
    const configTargets = this.getConfigTargets(definition);
    const windowsServiceDetails = [];
    const executablePaths = [];

    for (const windowsServiceName of windowsServices) {
      try {
        const metadata = await this.getWindowsServiceMetadata(windowsServiceName);
        const executablePath = this.extractExecutablePath(metadata.pathName);
        if (metadata.installed && executablePath) {
          executablePaths.push(executablePath);
        }

        windowsServiceDetails.push({
          name: windowsServiceName,
          installed: Boolean(metadata.installed),
          state: metadata.state || null,
          pathName: metadata.pathName || null,
          executablePath: executablePath || null,
        });
      } catch (error) {
        windowsServiceDetails.push({
          name: windowsServiceName,
          installed: false,
          state: null,
          pathName: null,
          executablePath: null,
          error: error.message,
        });
      }
    }

    const configTargetDetails = configTargets.map((target) => {
      const candidatePaths = this.getConfigTargetCandidatePaths(target);
      const configuredPath = candidatePaths[0] || null;
      let resolvedPath = candidatePaths.find((candidatePath) => fileExists(candidatePath)) || configuredPath;
      let exists = Boolean(resolvedPath && fileExists(resolvedPath));

      if (!exists) {
        for (const executablePath of executablePaths) {
          const discoveredPath = this.discoverConfigPathFromExecutable(
            target,
            executablePath
          );
          if (discoveredPath) {
            resolvedPath = discoveredPath;
            exists = true;
            break;
          }
        }
      }

      return {
        key: target.key || null,
        type: target.type || null,
        configuredPath,
        candidatePaths,
        resolvedPath,
        exists,
      };
    });

    const installedWindowsServices = windowsServiceDetails.filter(
      (service) => service.installed
    );
    const missingWindowsServices = windowsServiceDetails.filter(
      (service) => !service.installed
    );
    const existingConfigTargets = configTargetDetails.filter((target) => target.exists);
    const missingConfigTargets = configTargetDetails.filter((target) => !target.exists);

    let status = "unknown";
    let message = "Location could not be resolved yet.";
    let resolvedPath = null;

    if (existingConfigTargets.length > 0) {
      status = missingConfigTargets.length > 0 ? "partial" : "ready";
      resolvedPath =
        existingConfigTargets[0].resolvedPath || existingConfigTargets[0].configuredPath;
      message =
        missingConfigTargets.length > 0
          ? `Some config targets are missing for ${serviceName}.`
          : `Config target detected for ${serviceName}.`;
    } else if (installedWindowsServices.length > 0) {
      status = configTargets.length > 0 ? "partial" : "ready";
      resolvedPath =
        installedWindowsServices[0].executablePath || installedWindowsServices[0].pathName;
      message =
        configTargets.length > 0
          ? `Windows service is installed for ${serviceName}, but config target could not be found.`
          : `Windows service is installed for ${serviceName}.`;
    } else if (
      windowsServices.length > 0 &&
      missingWindowsServices.length === windowsServices.length
    ) {
      status = "missing";
      message = `Windows service(s) not installed: ${missingWindowsServices
        .map((service) => service.name)
        .join(", ")}`;
    } else if (
      configTargets.length > 0 &&
      missingConfigTargets.length === configTargets.length
    ) {
      status = "missing";
      resolvedPath = missingConfigTargets[0].configuredPath || null;
      message = `Config target not found for ${serviceName}.`;
    }

    const value = {
      status,
      message,
      resolvedPath,
      details: {
        windowsServices: windowsServiceDetails,
        configTargets: configTargetDetails,
      },
    };

    this.locationCache.set(serviceName, {
      updatedAt: Date.now(),
      value,
    });

    return value;
  }

  async getResolvedConfigTargets(serviceName) {
    const definition = this.getDefinition(serviceName);
    const configTargets = this.getConfigTargets(definition);

    if (configTargets.length === 0) {
      return [];
    }

    const diagnostics = await this.getLocationDiagnostics(serviceName);

    return configTargets.map((target) => {
      if (target.path && fileExists(target.path)) {
        return target;
      }

      const existingCandidate = this.getConfigTargetCandidatePaths(target).find((candidatePath) =>
        fileExists(candidatePath)
      );
      if (existingCandidate) {
        return {
          ...target,
          path: existingCandidate,
        };
      }

      const detail = diagnostics.details?.configTargets?.find(
        (candidate) => candidate.key === target.key && candidate.exists
      );

      if (!detail?.resolvedPath) {
        return target;
      }

      return {
        ...target,
        path: detail.resolvedPath,
      };
    });
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
      if (status === "missing") {
        logger.warn(
          `Windows service ${serviceName} is not installed on this device. Skipping ${action}.`,
          { serviceName, action }
        );
        return { missing: true };
      }

      if (status === expectedState) {
        logger.info(`Windows service ${serviceName} already ${expectedState}`, {
          serviceName,
        });
        return { missing: false };
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
        command: this.getScPath(),
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

    return { missing: false };
  }

  async startWindowsServices(serviceName) {
    const definition = this.getDefinition(serviceName);
    const windowsServices = await this.resolveWindowsServices(serviceName);

    if (windowsServices.length === 0) {
      return {
        missingServices: [],
        discoveryFailed: true,
        skippedForElevation: false,
      };
    }

    const elevated = await this.isProcessElevated();
    if (!elevated) {
      return {
        missingServices: [],
        skippedForElevation: true,
      };
    }

    logger.info(`Starting Windows services for ${serviceName}`, {
      serviceName,
      windowsServices,
    });

    const missingServices = [];

    for (const windowsServiceName of windowsServices) {
      const result = await this.runWindowsServiceAction("start", windowsServiceName);
      if (result?.missing) {
        missingServices.push(windowsServiceName);
      }
    }

    this.clearLocationCache(serviceName);
    return { missingServices, skippedForElevation: false, discoveryFailed: false };
  }

  async stopWindowsServices(serviceName) {
    const definition = this.getDefinition(serviceName);
    const windowsServices = await this.resolveWindowsServices(serviceName);

    if (windowsServices.length === 0) {
      return {
        missingServices: [],
        discoveryFailed: true,
        skippedForElevation: false,
      };
    }

    const elevated = await this.isProcessElevated();
    if (!elevated) {
      return {
        missingServices: [],
        skippedForElevation: true,
      };
    }

    logger.info(`Stopping Windows services for ${serviceName}`, {
      serviceName,
      windowsServices,
    });

    const missingServices = [];

    for (const windowsServiceName of windowsServices.slice().reverse()) {
      const result = await this.runWindowsServiceAction("stop", windowsServiceName);
      if (result?.missing) {
        missingServices.push(windowsServiceName);
      }
    }

    this.clearLocationCache(serviceName);
    return { missingServices, skippedForElevation: false, discoveryFailed: false };
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

    await this.runOneShot({
      command: this.getTaskkillPath(),
      args: ["/PID", String(portPid), "/T", "/F"],
    });
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
        const { missingServices, skippedForElevation, discoveryFailed } =
          await this.stopWindowsServices(serviceName);
        if (discoveryFailed) {
          const message = `No matching Windows service could be discovered for ${serviceName} on this device.`;
          this.setLastError(serviceName, message);
          this.warnOnce(serviceName, "missing-windows-service-stop-discovery", message);
          return this.refreshService(serviceName);
        }
        if (missingServices.length > 0) {
          const message = `Windows service(s) not installed for ${serviceName}: ${missingServices.join(", ")}`;
          this.setLastError(serviceName, message);
          this.warnOnce(
            serviceName,
            `missing-windows-service-stop:${missingServices.join(",")}`,
            message,
            { missingServices }
          );
          return this.refreshService(serviceName);
        }
        if (skippedForElevation) {
          const message = `Windows service stop requires Administrator privileges for ${serviceName}.`;
          this.setLastError(serviceName, message);
          this.warnOnce(serviceName, "requires-elevation-stop", message);
          return this.refreshService(serviceName);
        }
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
        await this.runOneShot({
          command: this.getTaskkillPath(),
          args: ["/PID", String(state.pid), "/T", "/F"],
        });
      } else {
        await this.stopByPort(serviceName);
      }

      await sleep(1500);
      this.clearLocationCache(serviceName);
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
