const path = require("path");

function compact(values) {
  return values.filter(Boolean);
}

const serviceConfigs = {
  rapor: {
    startStrategy: "windows-service",
    stopStrategy: "windows-service",
    needsConfigUpdate: true,
    type: "env",
    path: process.env.ERAPOR_ENV_PATH || null,
    pathCandidates: compact([
      process.env.ERAPOR_ENV_PATH || null,
      process.env.ERAPOR_ROOT
        ? path.join(process.env.ERAPOR_ROOT, "wwwroot", ".env")
        : null,
      "C:\\newappraporsd2025\\wwwroot\\.env",
      "C:\\E-Rapor\\wwwroot\\.env",
      "C:\\erapor\\wwwroot\\.env",
    ]),
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
    key: "app.baseURL",
    formatter: (url) => `app.baseURL = '${url}/'`,
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
