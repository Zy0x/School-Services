const path = require("path");
const dotenv = require("dotenv");
const { ensureBundledCloudflared } = require("./embeddedBinary");
const { buildDefaults } = require("./serviceConfigs");
const logger = require("./logger");
const {
  buildAncestorCandidates,
  deepMerge,
  getBaseDir,
  getRuntimeConfigPath,
  readJsonFile,
  resolveFirstExistingPath,
} = require("./utils");

function loadEnvironmentFiles() {
  const baseDir = getBaseDir();
  const candidates = [
    ...buildAncestorCandidates(process.cwd(), ".env"),
    ...buildAncestorCandidates(baseDir, ".env"),
  ];

  for (const candidate of candidates) {
    dotenv.config({ path: candidate, override: false });
  }
}

function expandEnvironmentTokens(value) {
  if (typeof value === "string") {
    return value
      .replace(/\$\{([A-Z0-9_]+)\}/gi, (_, key) => process.env[key] || "")
      .replace(/%([A-Z0-9_]+)%/gi, (_, key) => process.env[key] || "");
  }

  if (Array.isArray(value)) {
    return value.map((item) => expandEnvironmentTokens(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, expandEnvironmentTokens(item)])
    );
  }

  return value;
}

function loadRuntimeOverrides() {
  const runtimeConfigPath = getRuntimeConfigPath();
  const overrides = expandEnvironmentTokens(readJsonFile(runtimeConfigPath, {}));

  if (runtimeConfigPath) {
    logger.info(`Loaded runtime configuration from ${runtimeConfigPath}`);
  } else {
    logger.warn(
      "agent.runtime.json was not found. The agent will run with defaults and environment variables only."
    );
  }

  return { runtimeConfigPath, overrides };
}

function resolveCloudflaredPath(overridePath) {
  const baseDir = getBaseDir();
  const bundledPath = ensureBundledCloudflared();
  const fileCandidates = [
    overridePath,
    process.env.CLOUDFLARED_PATH,
    bundledPath,
    ...buildAncestorCandidates(process.cwd(), "cloudflared.exe"),
    ...buildAncestorCandidates(baseDir, "cloudflared.exe"),
  ];
  const existing = resolveFirstExistingPath(fileCandidates);
  return existing || "cloudflared";
}

function resolveConfigRelativePaths(filePaths, runtimeConfigPath) {
  if (!Array.isArray(filePaths)) {
    return [];
  }

  return filePaths
    .filter(Boolean)
    .map((filePath) => resolveConfigRelativePath(filePath, runtimeConfigPath));
}

function resolveConfigRelativePath(filePath, runtimeConfigPath) {
  if (!filePath) {
    return filePath;
  }

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  if (runtimeConfigPath) {
    return path.resolve(path.dirname(runtimeConfigPath), filePath);
  }

  return path.resolve(getBaseDir(), filePath);
}

function loadConfig() {
  loadEnvironmentFiles();
  const { runtimeConfigPath, overrides } = loadRuntimeOverrides();
  const defaultServices = buildDefaults();
  const mergedServices = deepMerge(defaultServices, overrides.services || {});
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    overrides.supabase?.url ||
    "https://fgimyyicixazygairmsa.supabase.co";
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || overrides.supabase?.anonKey || "";
  const cloudflaredPath = resolveCloudflaredPath(overrides.cloudflaredPath);
  const loopIntervalMs = Number(
    overrides.loopIntervalMs || process.env.AGENT_LOOP_INTERVAL_MS || 5000
  );
  const localLogPath = resolveConfigRelativePath(
    overrides.localLogPath ||
      process.env.AGENT_LOG_PATH ||
      path.join(getBaseDir(), "logs", `agent-${new Date().toISOString().slice(0, 10)}.log`),
    runtimeConfigPath
  );
  const tunnelMode = String(
    overrides.tunnel?.mode || process.env.TUNNEL_MODE || "quick"
  ).toLowerCase();
  const tunnelStartSpacingMs = Number(
    overrides.tunnel?.startSpacingMs ||
      process.env.TUNNEL_START_SPACING_MS ||
      5000
  );
  const tunnelGlobalCooldownMs = Number(
    overrides.tunnel?.globalCooldownMs ||
      process.env.TUNNEL_GLOBAL_COOLDOWN_MS ||
      60000
  );
  const tunnelStartupTimeoutMs = Number(
    overrides.tunnel?.startupTimeoutMs ||
      process.env.TUNNEL_STARTUP_TIMEOUT_MS ||
      30000
  );
  const tunnelRetryDelaysMs = Array.isArray(overrides.tunnel?.retryDelaysMs)
    ? overrides.tunnel.retryDelaysMs
        .map((value) => Number(value))
        .filter(Number.isFinite)
    : [10000, 30000, 60000, 120000, 300000];
  const raporPort = Number(mergedServices.rapor?.port || 8535);
  const defaultShortcutPaths = [
    process.env.PUBLIC
      ? path.join(process.env.PUBLIC, "Desktop", "E-Rapor SD.url")
      : "C:\\Users\\Public\\Desktop\\E-Rapor SD.url",
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, "Desktop", "E-Rapor SD.url")
      : null,
    path.join(getBaseDir(), "E-Rapor SD.url"),
  ].filter(Boolean);

  if (!supabaseAnonKey) {
    throw new Error(
      "SUPABASE_ANON_KEY is missing. Set it in .env or the environment."
    );
  }

  if (!cloudflaredPath) {
    throw new Error(
      "cloudflared was not found. Put cloudflared.exe next to the agent or set cloudflaredPath."
    );
  }

  if (tunnelMode !== "quick") {
    throw new Error(
      `Unsupported tunnel mode "${tunnelMode}". This agent currently supports only "quick".`
    );
  }

  return {
    runtimeConfigPath,
    cloudflaredPath,
    loopIntervalMs,
    localLogPath,
    startup: {
      mode:
        overrides.startup?.mode ||
        process.env.AGENT_STARTUP_MODE ||
        "clean-online",
    },
    tunnel: {
      mode: tunnelMode,
      startSpacingMs: tunnelStartSpacingMs,
      globalCooldownMs: tunnelGlobalCooldownMs,
      startupTimeoutMs: tunnelStartupTimeoutMs,
      retryDelaysMs: tunnelRetryDelaysMs,
    },
    supabase: {
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
    },
    deviceName: overrides.deviceName || process.env.DEVICE_NAME || null,
    shortcuts: {
      rapor: {
        enabled: overrides.shortcuts?.rapor?.enabled !== false,
        fallbackUrl:
          overrides.shortcuts?.rapor?.fallbackUrl ||
          process.env.ERAPOR_SHORTCUT_FALLBACK_URL ||
          `http://localhost:${raporPort}`,
        filePaths: resolveConfigRelativePaths(
          overrides.shortcuts?.rapor?.filePaths || defaultShortcutPaths,
          runtimeConfigPath
        ),
      },
    },
    services: mergedServices,
  };
}

module.exports = {
  loadConfig,
};
