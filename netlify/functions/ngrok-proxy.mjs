const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
  return Buffer.from(padded, "base64").toString("utf8");
}

function isNgrokFreeHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "ngrok-free.app" || normalized.endsWith(".ngrok-free.app");
}

function getRawProxyPath(event) {
  const path = String(event.path || "")
    .replace(/^\/\.netlify\/functions\/ngrok-proxy\/?/, "")
    .replace(/^\/ngrok-proxy\/?/, "");
  if (path) {
    return path;
  }

  const rawUrl = String(event.rawUrl || "");
  const marker = "/ngrok-proxy/";
  const markerIndex = rawUrl.indexOf(marker);
  if (markerIndex >= 0) {
    return rawUrl.slice(markerIndex + marker.length).split("?")[0];
  }

  return "";
}

function getRawQuery(event) {
  if (event.rawQuery) {
    return event.rawQuery;
  }

  const rawUrl = String(event.rawUrl || "");
  const queryIndex = rawUrl.indexOf("?");
  if (queryIndex >= 0) {
    return rawUrl.slice(queryIndex + 1);
  }

  return new URLSearchParams(event.queryStringParameters || {}).toString();
}

function resolveTargetUrl(event) {
  const rawPath = getRawProxyPath(event);
  const [hostToken = "", ...pathParts] = rawPath.split("/");
  const hostname = decodeBase64Url(hostToken);

  if (!isNgrokFreeHost(hostname)) {
    throw new Error("Target Ngrok tidak valid.");
  }

  const targetPath = `/${pathParts.join("/")}`;
  const rawQuery = getRawQuery(event);
  const query = rawQuery ? `?${rawQuery}` : "";
  return new URL(`https://${hostname}${targetPath}${query}`);
}

function filterResponseHeaders(headers) {
  const next = {};
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === "content-encoding" || lower === "content-length") {
      continue;
    }
    next[key] = value;
  }
  next["cache-control"] = "no-store";
  return next;
}

function rewriteHtml(html, proxyBasePath) {
  const baseTag = `<base href="${proxyBasePath}/">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `${baseTag}${html}`;
}

export async function handler(event) {
  try {
    const targetUrl = resolveTargetUrl(event);
    const method = event.httpMethod || "GET";
    const requestHeaders = {
      "ngrok-skip-browser-warning": "1",
      "user-agent": "school-services-ngrok-proxy",
      accept: event.headers?.accept || "*/*",
    };
    if (event.headers?.["content-type"]) {
      requestHeaders["content-type"] = event.headers["content-type"];
    }

    const upstream = await fetch(targetUrl, {
      method,
      headers: requestHeaders,
      body: ["GET", "HEAD"].includes(method) ? undefined : event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : event.body,
      redirect: "manual",
    });
    const headers = filterResponseHeaders(upstream.headers);
    const contentType = upstream.headers.get("content-type") || "";
    const hostToken = getRawProxyPath(event).split("/")[0];
    const proxyBasePath = `/ngrok-proxy/${hostToken}`;

    if (contentType.includes("text/html")) {
      headers["content-type"] = contentType;
      return {
        statusCode: upstream.status,
        headers,
        body: rewriteHtml(await upstream.text(), proxyBasePath),
      };
    }

    const arrayBuffer = await upstream.arrayBuffer();
    return {
      statusCode: upstream.status,
      headers,
      body: Buffer.from(arrayBuffer).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      body: error instanceof Error ? error.message : String(error),
    };
  }
}
