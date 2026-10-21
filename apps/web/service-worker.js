const build = self.HAUNT_BUILD;
const files = self.HAUNT_FILES;
const prefix = "haunt-web-build-";
const cacheName = prefix + build.id;
const stateCache = "haunt-web-state-v1";
const base = self.registration.scope;
const stateURL = new URL("__haunt_cache_state__", base).href;
const completeURL = new URL("__haunt_cache_complete__", base).href;
const assets = new Set(files.map((file) => new URL(file.path, base).href));

async function stage() {
  const state = await caches.open(stateCache);
  const previous = await state.match(stateURL);
  if (previous) {
    const active = await previous.json();
    if (active.id !== build.id && active.revision >= build.revision)
      throw Error("The published build is not newer than the cached build.");
  }
  const cache = await caches.open(cacheName);
  try {
    for (const file of files) {
      const url = new URL(file.path, base).href;
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
      if (!response.ok)
        throw Error(`Application asset unavailable: ${file.path}`);
      const data = await response.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (hash !== file.sha256)
        throw Error(`Application asset changed during update: ${file.path}`);
      const headers = new Headers(response.headers);
      headers.delete("Content-Encoding");
      headers.delete("Content-Length");
      await cache.put(url, new Response(data, { status: 200, headers }));
    }
    await cache.put(completeURL, Response.json(build));
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(stage().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      if (!(await cache.match(completeURL)))
        throw Error("Application cache is incomplete.");
      const state = await caches.open(stateCache);
      await state.put(stateURL, Response.json(build));
      await self.clients.claim();
      for (const name of await caches.keys()) {
        if (name.startsWith(prefix) && name !== cacheName)
          await caches.delete(name);
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "HAUNT_BUILD") {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(cacheName);
        event.ports[0]?.postMessage({
          ...build,
          ready: !!(await cache.match(completeURL)),
        });
      })(),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(base);
  if (
    request.method !== "GET" ||
    request.headers.has("Authorization") ||
    url.origin !== scope.origin ||
    !url.pathname.startsWith(scope.pathname)
  )
    return;
  const path = url.pathname.slice(scope.pathname.length);
  if (
    path.startsWith("api/") ||
    path === "haunt-build.json" ||
    path === "haunt-sw.js"
  )
    return;
  let canonicalPath;
  try {
    canonicalPath = url.pathname
      .split("/")
      .map((part) => encodeURIComponent(decodeURIComponent(part)))
      .join("/");
  } catch {
    return;
  }
  const key = new URL(canonicalPath, url.origin).href;
  const target = assets.has(key)
    ? key
    : request.mode === "navigate"
      ? new URL("index.html", base).href
      : undefined;
  if (!target) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(target)) ?? fetch(request);
    })(),
  );
});
