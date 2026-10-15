import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as visible, type Browser } from "@playwright/test";
import { createServer, request as proxyRequest, type Server } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { SyncService } from "../packages/browser/src/sync/service";

const fixtureFile = process.env.HAUNT_SYNC_UI_FIXTURE;
const issuer = process.env.HAUNT_SYNC_TEST_ISSUER!,
  portal = process.env.HAUNT_SYNC_TEST_PORTAL!;
describe.skipIf(!fixtureFile || !issuer)(
  "rendered optional sync and restore",
  () => {
    let browser: Browser,
      frontServer: Server,
      portalServer: Server,
      fixture: { front: string; backend: string; password: string };
    const username = "ui-" + randomBytes(8).toString("hex"),
      master = "UI master password " + randomBytes(20).toString("hex");
    function files(directory: string, upstream?: string): Server {
      const server = createServer(async (req, res) => {
        if (
          upstream &&
          (req.url!.startsWith("/api/") || req.url === "/readyz")
        ) {
          const target = new URL(req.url!, upstream),
            outgoing = proxyRequest(
              target,
              {
                method: req.method,
                headers: { ...req.headers, host: new URL(fixture.front).host },
              },
              (reply) => {
                res.writeHead(reply.statusCode!, reply.headers);
                reply.pipe(res);
              },
            );
          outgoing.on("error", () => {
            res.writeHead(502);
            res.end();
          });
          req.pipe(outgoing);
          return;
        }
        try {
          const url = new URL(req.url!, "http://localhost"),
            candidate = path.resolve(
              directory,
              "." + decodeURIComponent(url.pathname),
            ),
            target =
              candidate.startsWith(directory + path.sep) &&
              path.extname(candidate)
                ? candidate
                : path.join(directory, "index.html");
          const data = await readFile(target),
            extension = path.extname(target);
          res.setHeader(
            "Content-Type",
            (
              {
                ".html": "text/html",
                ".js": "text/javascript",
                ".css": "text/css",
                ".wasm": "application/wasm",
                ".webp": "image/webp",
                ".svg": "image/svg+xml",
                ".png": "image/png",
                ".json": "application/json",
              } as Record<string, string>
            )[extension] ?? "application/octet-stream",
          );
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end();
        }
      });
      if (upstream)
        server.on("upgrade", (req, socket, head) => {
          const outgoing = proxyRequest(new URL(req.url!, upstream), {
            headers: {
              ...req.headers,
              host: new URL(fixture.front).host,
              origin: fixture.front,
            },
          });
          outgoing.on("upgrade", (reply, target, targetHead) => {
            socket.write(
              "HTTP/1.1 101 Switching Protocols\r\n" +
                Object.entries(reply.headers)
                  .map(([k, v]) => k + ": " + v)
                  .join("\r\n") +
                "\r\n\r\n",
            );
            if (head.length) target.write(head);
            if (targetHead.length) socket.write(targetHead);
            socket.pipe(target);
            target.pipe(socket);
          });
          outgoing.on("error", () => socket.destroy());
          outgoing.end();
        });
      return server;
    }
    beforeAll(async () => {
      fixture = JSON.parse(await readFile(fixtureFile!, "utf8"));
      frontServer = files(path.resolve("dist"), fixture.backend);
      portalServer = files(path.resolve("dist-sync-portal"));
      await Promise.all([
        new Promise<void>((resolve) =>
          frontServer.listen(
            Number(new URL(fixture.front).port),
            "127.0.0.1",
            resolve,
          ),
        ),
        new Promise<void>((resolve) =>
          portalServer.listen(
            Number(new URL(portal).port),
            "127.0.0.1",
            resolve,
          ),
        ),
      ]);
      browser = await chromium.launch({ headless: true });
      await mkdir("test-results/sync-ui", { recursive: true });
    }, 30_000);
    afterAll(async () => {
      await browser?.close();
      frontServer?.closeAllConnections();
      portalServer?.closeAllConnections();
      await Promise.all([
        new Promise<void>(
          (resolve) => frontServer?.close(() => resolve()) ?? resolve(),
        ),
        new Promise<void>(
          (resolve) => portalServer?.close(() => resolve()) ?? resolve(),
        ),
      ]);
    });
    async function desktop() {
      const context = await browser.newContext({
        viewport: { width: 1480, height: 960 },
        permissions: ["local-network-access"],
      });
      await context.addInitScript(() => {
        let accounts: unknown[] = [],
          servers: unknown[] = [];
        (window as any).hauntDesktop = {
          platform: "linux",
          nativeCaptureAvailable: false,
          appearance: { set: async () => {} },
          vaultRead: async () => accounts,
          vaultWrite: async (value: unknown[]) => {
            accounts = value;
          },
          serversRead: async () => servers,
          serversWrite: async (value: unknown[]) => {
            servers = value;
          },
          windowState: async () => ({
            maximized: false,
            minimized: false,
            fullscreen: false,
          }),
          onWindowState: () => () => {},
          windowControl: async () => {},
          mediaCacheRead: async () => undefined,
          mediaCacheWrite: async () => {},
          setBadge: async () => {},
          notificationAvailable: async () => false,
          onNotificationClick: () => () => {},
          onCallWindowClosed: () => () => {},
          nativeDevices: async () => [],
          openExternal: async () => {},
        };
      });
      // Emulate only the desktop's Origin header; the actual Go auth, proof and vault handlers run.
      await context.route(issuer + "/**", async (route) => {
        const response = await route.fetch({
          headers: {
            ...route.request().headers(),
            origin: "https://app.chatxo.local",
          },
        });
        await route.fulfill({
          response,
          headers: {
            ...response.headers(),
            "access-control-allow-origin": "https://app.chatxo.local",
          },
        });
      });
      await context.route("https://app.chatxo.local/**", async (route) => {
        const target = new URL(route.request().url());
        const response = await route.fetch({
          url: fixture.front + target.pathname + target.search,
        });
        await route.fulfill({ response });
      });
      await context.route(
        (url) =>
          url.origin === fixture.front &&
          (url.pathname.startsWith("/api/") || url.pathname === "/readyz"),
        async (route) => {
          const response = await route.fetch({
            headers: { ...route.request().headers(), origin: fixture.front },
          });
          await route.fulfill({
            response,
            headers: {
              ...response.headers(),
              "access-control-allow-origin": "https://app.chatxo.local",
            },
          });
        },
      );
      const page = await context.newPage();
      page.on("pageerror", (error) =>
        console.error("isolated browser error:", error.message),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          console.error("isolated browser console:", message.text());
      });
      await page.goto("https://app.chatxo.local/");
      await page
        .getByRole("button", { name: "Add server", exact: true })
        .click();
      return { context, page };
    }
    async function chooseService(page: any) {
      await page.getByLabel("Sync data service", { exact: true }).fill(issuer);
      await page
        .getByLabel("Trusted sync sign-in page", { exact: true })
        .fill(portal);
      await page
        .getByRole("button", { name: "Choose this sync service", exact: true })
        .click();
    }
    it("restores a community login into a fresh desktop, observes periodic upload, and delegates web access", async () => {
      const service = new SyncService(issuer, portal),
        keys = await import("../packages/browser/src/sync/crypto").then((m) =>
          m.proofKeys(),
        );
      await service.register(username, master, keys);
      let original: Awaited<ReturnType<typeof desktop>> | undefined,
        fresh: Awaited<ReturnType<typeof desktop>> | undefined;
      let observer: Awaited<ReturnType<SyncService["signIn"]>>;
      if (process.env.HAUNT_SYNC_UI_MODE !== "web-only") {
        original = await desktop();
        await chooseService(original.page);
        await original.page.getByLabel("Sync username or email").fill(username);
        await original.page
          .getByLabel("Master password", { exact: true })
          .fill(master);
        await original.page
          .getByRole("button", { name: "Sign in and restore", exact: true })
          .click();
        await visible(
          original.page.getByRole("button", { name: "Sync now", exact: true }),
        ).toBeVisible();
        await original.page.screenshot({
          path: "test-results/sync-ui/desktop-login.png",
        });
        await original.page
          .getByLabel("Account address", { exact: true })
          .fill("owner@" + new URL(fixture.front).host);
        await original.page.getByLabel("Use HTTPS").uncheck();
        await original.page
          .getByLabel("Password", { exact: true })
          .fill(fixture.password);
        await original.page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await visible(original.page.locator(".connection")).toHaveText(
          "Connected",
        );
        await original.page.evaluate(() =>
          localStorage.setItem("chatxo-voice-sounds", "off"),
        );
        observer = await service.signIn(username, master);
        let snapshot: any;
        // Observe the production one-minute timer, rather than calling the sync helper.
        for (let i = 0; i < 38; i++) {
          snapshot = (await service.read<any>(observer)).value;
          if (
            snapshot?.accounts?.length &&
            snapshot.preferences?.["chatxo-voice-sounds"] === "off"
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        expect(snapshot.accounts).toHaveLength(1);
        expect(snapshot.preferences["chatxo-voice-sounds"]).toBe("off");
        fresh = await desktop();
        await chooseService(fresh.page);
        await fresh.page.getByLabel("Sync username or email").fill(username);
        await fresh.page
          .getByLabel("Master password", { exact: true })
          .fill(master);
        await fresh.page
          .getByRole("button", { name: "Sign in and restore", exact: true })
          .click();
        await visible(
          fresh.page.getByText("Last synchronized:", { exact: false }),
        ).toBeVisible({ timeout: 20_000 });
        console.log(
          "fresh restored rail:",
          await fresh.page.locator(".server-rail").innerText(),
        );
        await fresh.page.screenshot({
          path: "test-results/sync-ui/fresh-before-selection.png",
        });
        await fresh.page
          .getByRole("button", { name: "Close", exact: true })
          .click();
        const restored = fresh.page.locator(
          ".server-rail button.server-icon:not(.add):not(.client-settings-button)",
        );
        await visible(restored).toHaveCount(1);
        await restored.click();
        await visible(fresh.page.locator(".connection")).toHaveText(
          "Connected",
          { timeout: 20_000 },
        );
        expect(
          await fresh.page.evaluate(() =>
            localStorage.getItem("chatxo-voice-sounds"),
          ),
        ).toBe("off");
        await fresh.page.screenshot({
          path: "test-results/sync-ui/desktop-restored.png",
        });
      } else {
        observer = await service.signIn(username, master);
        const instance = await (
          await fetch(fixture.front + "/api/v1/instance")
        ).json();
        const login = await (
          await fetch(fixture.front + "/api/v1/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: "owner",
              password: fixture.password,
              device_name: "Isolated sync web fixture",
              remember: true,
            }),
          })
        ).json();
        const backup = {
          version: 1,
          createdAt: new Date().toISOString(),
          accounts: [
            { origin: fixture.front, instance, login, remember: true },
          ],
          servers: [
            {
              origin: fixture.front,
              instanceId: instance.instance_id,
              name: instance.name,
              username: "owner",
              lastUsed: Date.now(),
            },
          ],
          preferences: { "chatxo-voice-sounds": "off" },
        };
        const { serverScope } =
          await import("../packages/browser/src/sync/crypto");
        await service.write(observer, backup, 0);
        await service.write(
          observer,
          backup,
          0,
          await serverScope(fixture.front),
          await service.scopeKey(observer, fixture.front),
        );
      }
      const webContext = await browser.newContext(),
        web = await webContext.newPage();
      await web.goto(fixture.front);
      await web
        .getByRole("button", { name: "Client settings", exact: true })
        .click();
      await web
        .getByRole("button", { name: "Encrypted sync", exact: true })
        .click();
      await visible(
        web.getByText("This web client syncs only this server.", {
          exact: false,
        }),
      ).toBeVisible();
      expect(
        await web.getByLabel("Master password", { exact: true }).count(),
      ).toBe(0);
      await chooseService(web);
      const opening = web.waitForEvent("popup");
      await web
        .getByRole("button", { name: "Sign in securely to sync this server" })
        .click();
      const popup = await opening;
      await visible(
        popup.getByLabel("Confirm your sync data service"),
      ).toHaveValue(issuer);
      await popup
        .getByRole("button", { name: "Continue with this service" })
        .click();
      await popup.getByLabel("Sync username or email").fill(username);
      await popup.getByLabel("Master password", { exact: true }).fill(master);
      await popup.getByRole("button", { name: "Sign in and restore" }).click();
      await visible(
        popup.getByRole("button", {
          name: "Allow sync for " + fixture.front,
          exact: true,
        }),
      ).toBeVisible();
      await popup.screenshot({
        path: "test-results/sync-ui/portal-consent.png",
      });
      await popup
        .getByRole("button", {
          name: "Allow sync for " + fixture.front,
          exact: true,
        })
        .click();
      try {
        await visible(
          web.getByRole("button", { name: "Sync now", exact: true }),
        ).toBeVisible({ timeout: 20_000 });
      } catch (error) {
        console.log(
          "web sync state:",
          await web.locator("body").innerText({ timeout: 1000 }),
        );
        await web.screenshot({ path: "test-results/sync-ui/web-failure.png" });
        if (!popup.isClosed())
          console.log("portal state:", await popup.locator("main").innerText());
        throw error;
      }
      await web.screenshot({ path: "test-results/sync-ui/web-sync.png" });
      expect(
        await web.evaluate(() => localStorage.getItem("chatxo-voice-sounds")),
      ).toBe("off");
      await original?.context.close();
      await fresh?.context.close();
      await webContext.close();
      await service.logout(observer);
    }, 150_000);
  },
);
