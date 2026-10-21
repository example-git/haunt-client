export interface WebBuild {
  version: 2;
  id: string;
  release: string;
  revision: number;
}

export function newerWebBuild(
  value: unknown,
  current: WebBuild,
): value is WebBuild {
  if (!value || typeof value !== "object") return false;
  const next = value as WebBuild;
  return (
    next.version === 2 &&
    typeof next.id === "string" &&
    /^[a-f0-9-]{36}$/.test(next.id) &&
    typeof next.release === "string" &&
    Number.isSafeInteger(next.revision) &&
    next.revision > current.revision &&
    next.id !== current.id
  );
}

function workerBuild(
  worker: ServiceWorker,
): Promise<WebBuild & { ready: boolean }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(Error("Application cache did not respond."));
    }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data);
    };
    worker.postMessage({ type: "HAUNT_BUILD" }, [channel.port2]);
  });
}

export function installWebCache(current: WebBuild, basePath: string) {
  if (!("serviceWorker" in navigator)) return () => {};
  const base = new URL(basePath, location.href);
  let disposed = false;
  let registration: ServiceWorkerRegistration | undefined;
  let running = false;
  let reloading = false;
  let lastCheck = 0;
  const report = (error: unknown) => {
    window.dispatchEvent(
      new CustomEvent("haunt:cache-status", {
        detail: {
          ready: false,
          error:
            error instanceof Error
              ? error.message
              : "Application caching failed.",
        },
      }),
    );
  };
  const activated = async () => {
    const worker = navigator.serviceWorker.controller;
    if (!worker || disposed) return;
    const active = await workerBuild(worker);
    if (!active.ready) throw Error("Application cache is incomplete.");
    window.dispatchEvent(
      new CustomEvent("haunt:cache-status", {
        detail: { ready: true, build: active },
      }),
    );
    if (newerWebBuild(active, current) && !reloading) {
      reloading = true;
      location.reload();
    }
  };
  const onController = () => {
    void activated().catch(report);
  };
  navigator.serviceWorker.addEventListener("controllerchange", onController);
  const check = async () => {
    if (running || disposed || document.visibilityState !== "visible") return;
    running = true;
    try {
      if (!registration) {
        registration = await navigator.serviceWorker.register(
          new URL("haunt-sw.js", base),
          {
            scope: base.pathname,
            updateViaCache: "none",
          },
        );
      }
      await activated();
      const response = await fetch(new URL("haunt-build.json", base), {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.includes("application/json")
      )
        throw Error("Application update information is unavailable.");
      const text = await response.text();
      if (text.length > 4096)
        throw Error("Invalid application update information.");
      if (newerWebBuild(JSON.parse(text), current)) await registration.update();
    } catch (error) {
      report(error);
    } finally {
      running = false;
    }
  };
  const poll = () => {
    if (Date.now() - lastCheck < 60_000) return;
    lastCheck = Date.now();
    void check();
  };
  void check();
  const timer = setInterval(poll, 300_000);
  window.addEventListener("focus", poll);
  window.addEventListener("online", poll);
  document.addEventListener("visibilitychange", poll);
  return () => {
    disposed = true;
    clearInterval(timer);
    navigator.serviceWorker.removeEventListener(
      "controllerchange",
      onController,
    );
    window.removeEventListener("focus", poll);
    window.removeEventListener("online", poll);
    document.removeEventListener("visibilitychange", poll);
  };
}
