const path = require("path");

function compact(values) {
  return values.filter(Boolean);
}

function createRaporEnvTarget(targetId, candidates, options = {}) {
  return {
    targetId,
    type: "env",
    path: candidates[0] || null,
    pathCandidates: compact(candidates),
    key: "app.baseURL",
    urlSource: options.urlSource || "public",
    formatter: (url) => `app.baseURL = '${url}/'`,
  };
}

function buildRaporEnvConfigTargets() {
  const raporRoot = process.env.ERAPOR_ROOT
    ? path.resolve(process.env.ERAPOR_ROOT)
    : null;
  const explicitWebrootEnvPath = process.env.ERAPOR_ENV_PATH || null;

  return [
    createRaporEnvTarget(
      "rapor-root-env",
      [
        raporRoot ? path.join(raporRoot, ".env") : null,
        "C:\\newappraporsd2025\\.env",
        "C:\\E-Rapor\\.env",
        "C:\\erapor\\.env",
      ],
      { urlSource: "local" }
    ),
    createRaporEnvTarget(
      "rapor-wwwroot-env",
      [
        explicitWebrootEnvPath,
        raporRoot ? path.join(raporRoot, "wwwroot", ".env") : null,
        "C:\\newappraporsd2025\\wwwroot\\.env",
        "C:\\E-Rapor\\wwwroot\\.env",
        "C:\\erapor\\wwwroot\\.env",
      ],
      { urlSource: "public" }
    ),
  ];
}

const serviceConfigs = {
  rapor: {
    startStrategy: "windows-service",
    stopStrategy: "windows-service",
    needsConfigUpdate: true,
    configTargets: buildRaporEnvConfigTargets(),
    windowsServices: compact([
      process.env.ERAPOR_DB_SERVICE_NAME || null,
      process.env.ERAPOR_APP_SERVICE_NAME || null,
      "NU25_ERAPORSD_DB",
      "NU25_ERAPORSD_SRV",
    ]),
    windowsServiceDiscovery: {
      includeAny: ["rapor"],
      excludeAny: ["dapodik"],
      preferAny: ["db", "srv", "service"],
      expectedCount: 2,
    },
  },
  dapodik: {
    startStrategy: "windows-service",
    stopStrategy: "windows-service",
    needsConfigUpdate: false,
    windowsServices: compact([
      process.env.DAPODIK_DB_SERVICE_NAME || null,
      process.env.DAPODIK_WEB_SERVICE_NAME || null,
      "DapodikDB",
      "DapodikWebSrv",
    ]),
    windowsServiceDiscovery: {
      includeAny: ["dapodik"],
      preferAny: ["db", "web", "srv", "service"],
      expectedCount: 2,
    },
  },
};

function buildDefaults() {
  return {
    rapor: {
      serviceName: "rapor",
      port: 8535,
      startOrder: 10,
      autoStart: true,
      host: "127.0.0.1",
      startCommand: null,
      stopCommand: null,
      ...serviceConfigs.rapor,
    },
    dapodik: {
      serviceName: "dapodik",
      port: 5774,
      startOrder: 20,
      autoStart: true,
      host: "127.0.0.1",
      startCommand: null,
      stopCommand: null,
      ...serviceConfigs.dapodik,
    },
  };
}

function getConfigTargetsForService(serviceDefinition) {
  if (!serviceDefinition || serviceDefinition.needsConfigUpdate !== true) {
    return [];
  }

  if (
    Array.isArray(serviceDefinition.configTargets) &&
    serviceDefinition.configTargets.length > 0
  ) {
    return serviceDefinition.configTargets;
  }

  return [
    {
      type: serviceDefinition.type,
      path: serviceDefinition.path,
      key: serviceDefinition.key,
      formatter: serviceDefinition.formatter,
      format: serviceDefinition.format,
      value: serviceDefinition.value,
    },
  ];
}

module.exports = {
  buildDefaults,
  getConfigTargetsForService,
  serviceConfigs,
};
