const { BlockList, isIP } = require("node:net");
const localIPs = new BlockList();
localIPs.addSubnet("127.0.0.0", 8);
localIPs.addSubnet("10.0.0.0", 8);
localIPs.addSubnet("172.16.0.0", 12);
localIPs.addSubnet("192.168.0.0", 16);
localIPs.addAddress("::1", "ipv6");
localIPs.addSubnet("fc00::", 7, "ipv6");
function localHTTPHost(host) {
  if (host === "localhost") return true;
  const ip = host.replace(/^\[|\]$/g, "");
  const family = isIP(ip);
  return !!family && localIPs.check(ip, family === 6 ? "ipv6" : "ipv4");
}
function embedVideoRequest(details) {
  const url = new URL(details.url);
  return (
    details.resourceType === "media" &&
    /^\/api\/v1\/conversations\/[a-f0-9-]{36}\/messages\/[a-f0-9-]{36}\/embeds\/video$/.test(
      url.pathname,
    ) &&
    /^[a-f0-9]{48}$/.test(url.searchParams.get("ticket") || "")
  );
}
function allowInsecureRequest(details, webContentsId) {
  const url = new URL(details.url);
  return (
    details.webContentsId === webContentsId &&
    (["xhr", "webSocket"].includes(details.resourceType) ||
      embedVideoRequest(details)) &&
    ["http:", "ws:"].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    localHTTPHost(url.hostname) &&
    (url.pathname.startsWith("/api/v1/") || url.pathname === "/readyz")
  );
}
function externalURL(raw) {
  if (
    typeof raw !== "string" ||
    raw.length > 2048 ||
    /[\\\u0000-\u0020\u007f]/.test(raw)
  )
    throw Error("Invalid external link");
  const u = new URL(raw);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    !u.hostname
  )
    throw Error("Invalid external link");
  return u.href;
}
function apiTarget(raw) {
  try {
    const url = new URL(raw);
    if (
      url.username ||
      url.password ||
      !(url.pathname.startsWith("/api/v1/") || url.pathname === "/readyz") ||
      !["https:", "wss:", "http:", "ws:"].includes(url.protocol) ||
      (["http:", "ws:"].includes(url.protocol) && !localHTTPHost(url.hostname))
    )
      return null;
    url.protocol =
      url.protocol === "wss:"
        ? "https:"
        : url.protocol === "ws:"
          ? "http:"
          : url.protocol;
    return url.origin;
  } catch {
    return null;
  }
}
function fromApp(source, appOrigin) {
  try {
    return new URL(source).origin === appOrigin;
  } catch {
    return false;
  }
}
function appAPIRequest(details, appOrigin, windowIds) {
  if (
    !windowIds.includes(details.webContentsId) ||
    (!["xhr", "webSocket"].includes(details.resourceType) &&
      !embedVideoRequest(details))
  )
    return null;
  const source =
    details.initiatorOrigin ?? details.frame?.url ?? details.referrer;
  return fromApp(source, appOrigin) ? apiTarget(details.url) : null;
}
function targetHeaders(original, origin) {
  const headers = { ...original };
  for (const key of Object.keys(headers)) {
    if (["origin", "referer"].includes(key.toLowerCase())) delete headers[key];
  }
  headers.Origin = origin;
  headers.Referer = origin + "/";
  return headers;
}
function uiCorsHeaders(original, appOrigin) {
  const headers = new Headers(original);
  headers.set("Access-Control-Allow-Origin", appOrigin);
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  );
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set(
    "Access-Control-Expose-Headers",
    "Retry-After, Content-Length, Content-Range, Accept-Ranges",
  );
  return headers;
}
async function forwardDesktopRequest(request, appOrigin, fetch) {
  const provider = new URL(request.url);
  if (
    provider.origin === "https://cdn.bsky.app" &&
    provider.pathname.startsWith("/img/") &&
    !provider.username &&
    !provider.password &&
    request.method === "GET" &&
    fromApp(request.headers.get("Origin"), appOrigin)
  ) {
    const response = await fetch(
      new Request(request.url, {
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: request.signal,
      }),
    );
    const type = response.headers.get("Content-Type")?.split(";")[0];
    if (
      !response.ok ||
      !/^image\/(jpeg|png|gif|webp|avif)$/.test(type) ||
      !response.body
    ) {
      await response.body?.cancel();
      return new Response(null, {
        status: 502,
        headers: uiCorsHeaders({}, appOrigin),
      });
    }
    let bytes = 0;
    const body = response.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > 4 * 1024 * 1024)
            throw Error("Provider image exceeds 4 MiB.");
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, {
      headers: uiCorsHeaders({ "Content-Type": type }, appOrigin),
    });
  }
  const origin = apiTarget(request.url);
  const isAPI =
    origin &&
    fromApp(request.headers.get("Origin") ?? request.referrer, appOrigin);
  if (!isAPI) return fetch(request);
  // Each request retains its own URL, body and bearer token. Native requests
  // present the destination origin; only the bundled UI gets rewritten CORS.
  const upstream = new Request(request, {
    headers: targetHeaders(Object.fromEntries(request.headers), origin),
    credentials: "omit",
    redirect: "error",
  });
  const response = await fetch(upstream);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: uiCorsHeaders(response.headers, appOrigin),
  });
}
function installDesktopCors(session, appOrigin, windowIds) {
  const filter = { urls: ["http://*/*", "ws://*/*", "wss://*/*"] };
  session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const target = appAPIRequest(details, appOrigin, windowIds());
    callback({
      requestHeaders: target
        ? targetHeaders(details.requestHeaders, target)
        : details.requestHeaders,
    });
  });
  session.webRequest.onHeadersReceived(filter, (details, callback) => {
    if (
      !appAPIRequest(details, appOrigin, windowIds()) ||
      details.resourceType === "webSocket"
    ) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const responseHeaders = { ...details.responseHeaders };
    const cors = uiCorsHeaders({}, appOrigin);
    for (const key of Object.keys(responseHeaders)) {
      if (cors.has(key)) delete responseHeaders[key];
    }
    for (const [key, value] of cors) responseHeaders[key] = [value];
    callback({ responseHeaders });
  });
}
module.exports = {
  localHTTPHost,
  allowInsecureRequest,
  externalURL,
  apiTarget,
  appAPIRequest,
  forwardDesktopRequest,
  installDesktopCors,
};
