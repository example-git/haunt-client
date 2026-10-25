import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const root = path.join(project, "dist-standalone");
const output = path.join(project, "test-results/standalone-web");
await fs.mkdir(output, { recursive: true });
const build = JSON.parse(
  await fs.readFile(path.join(root, "haunt-build.json"), "utf8"),
);
const worker = await fs.readFile(path.join(root, "haunt-sw.js"), "utf8");
const manifestFiles = (text) =>
  JSON.parse(
    text
      .split("\n")[1]
      .replace(/^self.HAUNT_FILES=/, "")
      .replace(/;$/, ""),
  );
const files = manifestFiles(worker);
const policy = (await fs.readFile(path.join(root, "_headers"), "utf8")).match(
  /Content-Security-Policy: (.+)/,
)[1];
let directory = root;
let broken = false;
let apiCalls = 0;
let temporary;
let nextBuild;
let server;
let url = process.argv[2];
if (!url) {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-web-update-"));
  execFileSync(
    process.execPath,
    [
      path.join(project, "node_modules/vite/bin/vite.js"),
      "build",
      "--mode",
      "standalone",
      "--outDir",
      temporary,
      "--emptyOutDir",
    ],
    {
      cwd: project,
      stdio: "inherit",
      env: { ...process.env, HAUNT_WEB_REVISION: String(build.revision + 1) },
    },
  );
  execFileSync(
    process.execPath,
    [path.join(project, "scripts/licenses.mjs"), temporary],
    { cwd: project, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [path.join(project, "scripts/package-web.mjs"), temporary],
    { cwd: project, stdio: "inherit" },
  );
  nextBuild = JSON.parse(
    await fs.readFile(path.join(temporary, "haunt-build.json"), "utf8"),
  );
  server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/api/cache-test") {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ calls: ++apiCalls }));
        return;
      }
      const filename = path.resolve(
        directory,
        "." + (pathname === "/" ? "/index.html" : decodeURIComponent(pathname)),
      );
      if (!filename.startsWith(directory + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      let data = await fs.readFile(filename);
      if (broken && pathname === "/haunt-sw.js") {
        const text = data.toString();
        const lines = text.split("\n");
        lines[1] = `self.HAUNT_FILES=${JSON.stringify(manifestFiles(text).map((file) => (file.path === "index.html" ? { ...file, sha256: "0".repeat(64) } : file)))};`;
        data = Buffer.from(lines.join("\n"));
      }
      const contentType =
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".json": "application/json",
          ".css": "text/css",
          ".wasm": "application/wasm",
          ".webmanifest": "application/manifest+json",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".webp": "image/webp",
        }[path.extname(filename)] ?? "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Security-Policy": policy,
        "Cache-Control": "no-store",
      });
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/`;
}
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
});
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const activeBuild = () =>
  page.evaluate(async () => {
    if (!navigator.serviceWorker.controller) return undefined;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        resolve(undefined);
      }, 2000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(event.data);
      };
      navigator.serviceWorker.controller.postMessage({ type: "HAUNT_BUILD" }, [
        channel.port2,
      ]);
    });
  });
const update = () =>
  page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
    const installing = registration.installing;
    if (installing)
      await new Promise((resolve) => {
        const changed = () => {
          if (
            installing.state === "redundant" ||
            installing.state === "activated"
          ) {
            installing.removeEventListener("statechange", changed);
            resolve();
          }
        };
        installing.addEventListener("statechange", changed);
        changed();
      });
  });
try {
  await page.goto(url);
  const manifestSession = await context.newCDPSession(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    /^blob:/,
  );
  const manifest = await manifestSession.send("Page.getAppManifest");
  assert.deepEqual(manifest.errors, []);
  const installed = JSON.parse(manifest.data);
  assert.equal(installed.background_color, "#202020");
  assert.equal(installed.theme_color, "#202020");
  assert.equal(installed.id, new URL("/", url).href);
  await manifestSession.detach();
  await expect(
    page.getByRole("dialog", { name: "Connect to a server", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Sync data service", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Sync data service", { exact: true })
    .fill("https://sync.example.test");
  await page
    .getByRole("button", { name: "Choose this sync service", exact: true })
    .click();
  await expect(
    page.getByLabel("Sync username or email", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Master password", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(activeBuild, { timeout: 180_000 })
    .toMatchObject({ id: build.id, ready: true });
  assert.equal(
    await page.evaluate(
      async (name) => (await (await caches.open(name)).keys()).length,
      `haunt-web-build-${build.id}`,
    ),
    files.length + 1,
  );
  await page.evaluate(async () => {
    localStorage.setItem("cache-preservation-test", "retained");
    await (
      await caches.open("unrelated-user-cache")
    ).put("/user-data", new Response("retained"));
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("cache-preservation-test", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("values");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("values", "readwrite");
        transaction.objectStore("values").put("retained", "key");
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
      };
    });
  });
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Connect to a server", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Sync data service", { exact: true }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("cache-preservation-test")),
    "retained",
  );
  assert.equal(
    await page.evaluate(
      async () => (await fetch("/brand/trayTemplate@2x.png")).ok,
    ),
    true,
  );
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("/index.html", {
          headers: { Authorization: "Bearer fixture" },
        });
        return true;
      } catch {
        return false;
      }
    }),
    false,
  );
  await page.screenshot({
    path: path.join(
      output,
      server ? "offline-local.png" : "offline-public.png",
    ),
  });
  await context.setOffline(false);
  if (server) {
    assert.deepEqual(
      await page.evaluate(async () => [
        await (await fetch("/api/cache-test")).json(),
        await (await fetch("/api/cache-test")).json(),
      ]),
      [{ calls: 1 }, { calls: 2 }],
    );
    directory = temporary;
    broken = true;
    await update();
    assert.equal((await activeBuild()).id, build.id);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("dialog")).toBeVisible();
    await context.setOffline(false);
    broken = false;
    const navigation = page.waitForNavigation();
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration()).update();
    });
    await navigation;
    await expect
      .poll(activeBuild, { timeout: 180_000 })
      .toMatchObject({ id: nextBuild.id, ready: true });
    await expect(
      page.getByRole("dialog", { name: "Connect to a server", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        (await page.evaluate(() => caches.keys())).filter((key) =>
          key.startsWith("haunt-web-build-"),
        ),
      )
      .toEqual([`haunt-web-build-${nextBuild.id}`]);
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("cache-preservation-test"),
      ),
      "retained",
    );
    assert.equal(
      await page.evaluate(async () =>
        (
          await (await caches.open("unrelated-user-cache")).match("/user-data")
        ).text(),
      ),
      "retained",
    );
    assert.equal(
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("cache-preservation-test");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const database = request.result;
              const value = database
                .transaction("values")
                .objectStore("values")
                .get("key");
              value.onsuccess = () => {
                database.close();
                resolve(value.result);
              };
            };
          }),
      ),
      "retained",
    );
    directory = root;
    await update();
    assert.equal((await activeBuild()).id, nextBuild.id);
  }
  assert.deepEqual(errors, []);
  const report = {
    url,
    build,
    cachedAssets: files.length,
    initialSyncSignIn: true,
    offlineReload: true,
    localDataPreserved: true,
    updateCases: server
      ? [
          "incomplete build rejected",
          "new build activated",
          "old code cache removed",
          "API responses excluded",
          "unrelated caches and IndexedDB preserved",
          "older revision rejected",
        ]
      : [],
  };
  await fs.writeFile(
    path.join(output, server ? "local.json" : "public.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await context.close();
  await browser.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
}
