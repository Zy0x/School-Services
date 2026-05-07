function buildCloudflaredArgs(service) {
  return [
    "tunnel",
    "--url",
    `http://${service.host}:${service.port}`,
    "--http-host-header",
    "localhost",
    "--no-autoupdate",
  ];
}

function buildNgrokArgs(service, authtoken, ngrokUrl = null) {
  if (!authtoken) {
    throw new Error("Ngrok requires an auth token before a tunnel can be started.");
  }

  const args = [
    "http",
    `http://${service.host}:${service.port}`,
    "--log=stdout",
    "--log-format=logfmt",
    "--host-header=localhost",
  ];

  if (ngrokUrl) {
    args.push("--url", ngrokUrl);
  }

  args.push("--authtoken", authtoken);

  return args;
}

function buildProviderArgs(service, providerKey, options) {
  if (providerKey === "ngrok") {
    return buildNgrokArgs(service, options.ngrokAuthtoken, options.ngrokUrl);
  }

  return buildCloudflaredArgs(service);
}

function getProviderCommand(providerKey, options) {
  if (providerKey === "ngrok") {
    return options.ngrokPath;
  }

  return options.cloudflaredPath;
}

module.exports = {
  buildCloudflaredArgs,
  buildNgrokArgs,
  buildProviderArgs,
  getProviderCommand,
};
