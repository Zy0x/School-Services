const TRY_CLOUDFLARE_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;
const NGROK_PATTERN = /https:\/\/[a-z0-9.-]+\.ngrok(?:-free)?\.(?:app|dev|io)/gi;
const RATE_LIMIT_PATTERN = /rate[- ]limited|429|error code:\s*1015|too many requests/i;
const NOT_READY_PATTERN = /not ready|failed to unmarshal quick tunnel/i;
const NGROK_AUTH_ERROR_PATTERN = /ERR_NGROK_10\d+|authentication failed|auth(?:entication)? token|authtoken|credentials|invalid token/i;
const PUBLIC_URL_PROBE_TIMEOUT_MS = 7000;
const NGROK_TOKEN_PROBE_TIMEOUT_MS = 15000;

const PROVIDERS = {
  cloudflare: {
    key: "cloudflare",
    label: "Cloudflare",
    logSuffix: "cloudflared",
    urlPattern: TRY_CLOUDFLARE_PATTERN,
  },
  ngrok: {
    key: "ngrok",
    label: "ngrok",
    logSuffix: "ngrok",
    urlPattern: NGROK_PATTERN,
  },
};

module.exports = {
  NGROK_AUTH_ERROR_PATTERN,
  NGROK_TOKEN_PROBE_TIMEOUT_MS,
  NOT_READY_PATTERN,
  PROVIDERS,
  PUBLIC_URL_PROBE_TIMEOUT_MS,
  RATE_LIMIT_PATTERN,
};
