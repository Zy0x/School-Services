const {
  NGROK_AUTH_ERROR_PATTERN,
  NOT_READY_PATTERN,
  PROVIDERS,
  RATE_LIMIT_PATTERN,
} = require("./tunnelProviders");

function redactSecret(text, secret) {
  const value = String(text || "");
  const token = String(secret || "");
  return token ? value.split(token).join("[redacted]") : value;
}

function formatNgrokProbeError(output, token) {
  const cleanOutput = redactSecret(String(output || "").trim(), token);
  if (NGROK_AUTH_ERROR_PATTERN.test(cleanOutput)) {
    return "Auth token Ngrok ditolak oleh ngrok. Periksa token dari dashboard akun Ngrok lalu simpan ulang.";
  }

  return `Auth token Ngrok belum bisa dipakai untuk membuka tunnel.${cleanOutput ? ` ${cleanOutput.slice(0, 260)}` : ""}`;
}

function readPublicUrlFromText(content, providerKey = "cloudflare") {
  const provider = PROVIDERS[providerKey] || PROVIDERS.cloudflare;
  provider.urlPattern.lastIndex = 0;
  const matches = String(content || "").match(provider.urlPattern);
  return matches && matches.length > 0 ? matches[matches.length - 1] : null;
}

function extractTunnelIssue(logContent) {
  const content = String(logContent || "");
  if (!content) {
    return null;
  }

  if (RATE_LIMIT_PATTERN.test(content)) {
    return {
      category: "rate_limit",
      message:
        "Cloudflare quick tunnel request was throttled. The agent will clear the stale tunnel log and retry after cooldown.",
    };
  }

  if (NOT_READY_PATTERN.test(content)) {
    return {
      category: "transient",
      message: "Cloudflare tunnel is not ready yet. The agent will retry automatically.",
    };
  }

  return null;
}

module.exports = {
  extractTunnelIssue,
  formatNgrokProbeError,
  readPublicUrlFromText,
  redactSecret,
};
