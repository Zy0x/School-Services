function isNgrokFreeTunnelUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "ngrok-free.app" || hostname.endsWith(".ngrok-free.app");
  } catch (_error) {
    return false;
  }
}

function encodeBase64Url(value) {
  return Buffer.from(String(value || ""), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildNgrokProxyUrl(publicUrl, baseUrl) {
  if (!isNgrokFreeTunnelUrl(publicUrl)) {
    return publicUrl || null;
  }

  const normalizedBase = String(baseUrl || "").trim().replace(/\/+$/g, "");
  if (!normalizedBase) {
    return publicUrl;
  }

  try {
    const parsed = new URL(publicUrl);
    const hostToken = encodeBase64Url(parsed.hostname.toLowerCase());
    const pathAndSearch = `${parsed.pathname || "/"}${parsed.search || ""}`;
    return `${normalizedBase}/ngrok-proxy/${hostToken}${pathAndSearch}`;
  } catch (_error) {
    return publicUrl;
  }
}

module.exports = {
  buildNgrokProxyUrl,
  isNgrokFreeTunnelUrl,
};
