interface UpdateOptions {
  current: string;
  read: () => Promise<string | undefined>;
  busy: () => boolean;
  attempted: (id: string) => boolean;
  refresh: (id: string) => void;
}
/** Confirm twice; failures never interrupt use, and a stale CDN cannot cause a reload loop. */
export function webUpdateChecker(options: UpdateOptions) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      const next = await options.read();
      if (
        !next ||
        next === options.current ||
        options.attempted(next) ||
        options.busy()
      )
        return;
      if ((await options.read()) === next && !options.busy())
        options.refresh(next);
    } catch {
      /* Offline, missing marker, timeout or proxy error: keep this client running. */
    } finally {
      running = false;
    }
  };
}
export function installWebUpdates(current: string, base: string) {
  if (window.hauntDesktop || current === "development") return () => {};
  const storageKey = "haunt-web-update-attempt";
  let lastAttempt = "",
    lastCheck = 0;
  try {
    lastAttempt = sessionStorage.getItem(storageKey) ?? "";
  } catch {}
  const check = webUpdateChecker({
    current,
    read: async () => {
      const url = new URL("haunt-build.json", new URL(base, location.href));
      url.searchParams.set("check", `${Date.now()}-${Math.random()}`);
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.includes("application/json")
      ) {
        await response.body?.cancel();
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) return;
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024) return;
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const marker = JSON.parse(new TextDecoder().decode(bytes));
      return marker?.version === 1 &&
        typeof marker.id === "string" &&
        /^[a-f0-9-]{36}$/.test(marker.id)
        ? marker.id
        : undefined;
    },
    busy: () =>
      !!document.querySelector('[data-update-busy="true"], dialog[open]'),
    attempted: (id) => lastAttempt === id,
    refresh: (id) => {
      lastAttempt = id;
      // Without session storage, avoid an unbounded reload loop if HTML is stale.
      try {
        sessionStorage.setItem(storageKey, id);
      } catch {
        return;
      }
      location.reload();
    },
  });
  const poll = () => {
    if (
      document.visibilityState !== "visible" ||
      Date.now() - lastCheck < 60_000
    )
      return;
    lastCheck = Date.now();
    void check();
  };
  const first = setTimeout(poll, 20_000),
    interval = setInterval(poll, 60_000);
  window.addEventListener("online", poll);
  window.addEventListener("focus", poll);
  document.addEventListener("visibilitychange", poll);
  return () => {
    clearTimeout(first);
    clearInterval(interval);
    window.removeEventListener("online", poll);
    window.removeEventListener("focus", poll);
    document.removeEventListener("visibilitychange", poll);
  };
}
