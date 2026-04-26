const serviceConfigs = {
  rapor: {
    needsConfigUpdate: true,
    type: "env",
    path:
      process.env.ERAPOR_ENV_PATH ||
      "C:\\newappraporsd2025\\wwwroot\\.env",
    key: "app.baseURL",
    formatter: (url) => `app.baseURL = '${url}/'`,
  },
  dapodik: {
    needsConfigUpdate: false,
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
