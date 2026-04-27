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
  const oneDriveRoot =
    process.env.OneDrive ||
    process.env.ONEDRIVE ||
    process.env.OneDriveConsumer ||
    process.env.ONEDRIVECONSUMER ||
    null;
  const defaultShortcutSearchRoots = [
    "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
    "C:\\ProgramData\\Microsoft\\Windows\\Start Menu",
    "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Aplikasi e-Rapor SD",
    process.env.APPDATA
      ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs")
      : null,
    oneDriveRoot ? path.join(oneDriveRoot, "Desktop") : null,
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, "OneDrive", "Desktop")
      : null,
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, "Desktop")
      : null,
    process.env.PUBLIC
      ? path.join(process.env.PUBLIC, "Desktop")
      : "C:\\Users\\Public\\Desktop",
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
    fileAccess: {
      workspaceRoot: resolveConfigRelativePath(
        overrides.fileAccess?.workspaceRoot ||
          process.env.AGENT_FILE_WORKSPACE_ROOT ||
          path.join(getBaseDir(), "runtime", "file-jobs"),
        runtimeConfigPath
      ),
      maxArtifactBytes: Number(
        overrides.fileAccess?.maxArtifactBytes ||
          process.env.AGENT_FILE_MAX_ARTIFACT_BYTES ||
          45 * 1024 * 1024
      ),
      previewInlineBytes: Number(
        overrides.fileAccess?.previewInlineBytes ||
          process.env.AGENT_FILE_PREVIEW_INLINE_BYTES ||
          262144
      ),
      previewTextExtensions:
        overrides.fileAccess?.previewTextExtensions || [
          ".txt",
          ".log",
          ".json",
          ".js",
          ".ts",
          ".jsx",
          ".tsx",
          ".css",
          ".html",
          ".xml",
          ".csv",
          ".md",
          ".ini",
          ".env",
          ".conf",
          ".sql",
        ],
    },
    recovery: {
      resumeGapMs: Number(
        overrides.recovery?.resumeGapMs ||
          process.env.AGENT_RESUME_GAP_MS ||
          Math.max(loopIntervalMs * 6, 45000)
      ),
    },
    selfUpdate: {
      enabled: overrides.selfUpdate?.enabled !== false,
      intervalMs: Number(
        overrides.selfUpdate?.intervalMs ||
          process.env.AGENT_SELF_UPDATE_INTERVAL_MS ||
          300000
      ),
    },
    deviceName: overrides.deviceName || process.env.DEVICE_NAME || null,
    guestPortal: {
      baseUrl:
        overrides.guestPortal?.baseUrl ||
        process.env.GUEST_PORTAL_BASE_URL ||
        "https://school-services.netlify.app",
      fileName:
        overrides.guestPortal?.fileName ||
        process.env.GUEST_PORTAL_FILE_NAME ||
        "Guest E-Rapor.url",
    },
    shortcuts: {
      rapor: {
        enabled: overrides.shortcuts?.rapor?.enabled !== false,
        fileName:
          overrides.shortcuts?.rapor?.fileName ||
          process.env.ERAPOR_SHORTCUT_FILE_NAME ||
          "e-Rapor SD.url",
        iconFile:
          overrides.shortcuts?.rapor?.iconFile ||
          process.env.ERAPOR_SHORTCUT_ICON_FILE ||
          "C:\\newappraporsd2025\\ico\\logo128.ico",
        iconIndex: Number(
          overrides.shortcuts?.rapor?.iconIndex ||
            process.env.ERAPOR_SHORTCUT_ICON_INDEX ||
            0
        ),
        fallbackUrl:
          overrides.shortcuts?.rapor?.fallbackUrl ||
          process.env.ERAPOR_SHORTCUT_FALLBACK_URL ||
          `http://localhost:${raporPort}`,
        filePaths: resolveConfigRelativePaths(
          overrides.shortcuts?.rapor?.filePaths || [],
          runtimeConfigPath
        ),
        priorityPaths: resolveConfigRelativePaths(
          overrides.shortcuts?.rapor?.priorityPaths || [
            oneDriveRoot ? path.join(oneDriveRoot, "Desktop", "e-Rapor SD.url") : null,
            process.env.USERPROFILE
              ? path.join(process.env.USERPROFILE, "OneDrive", "Desktop", "e-Rapor SD.url")
              : null,
            process.env.USERPROFILE
              ? path.join(process.env.USERPROFILE, "Desktop", "e-Rapor SD.url")
              : null,
            "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\e-Rapor SD.url",
            "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Aplikasi e-Rapor SD\\e-Rapor SD.url",
          ].filter(Boolean),
          runtimeConfigPath
        ),
        searchRoots: resolveConfigRelativePaths(
          overrides.shortcuts?.rapor?.searchRoots || defaultShortcutSearchRoots,
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
