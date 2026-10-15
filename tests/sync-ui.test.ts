import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as visible, type Browser } from "@playwright/test";
import { createServer, request as proxyRequest, type Server } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { SyncService } from "../packages/browser/src/sync/service";

const keyword = "synthetic private sync keyword";
const fixtureFile = process.env.HAUNT_SYNC_UI_FIXTURE;
const issuer = process.env.HAUNT_SYNC_TEST_ISSUER!,
  portal = issuer;
describe.skipIf(!fixtureFile || !issuer)(
  "rendered optional sync and restore",
  () => {
    let browser: Browser,
      frontServer: Server,
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
      await Promise.all([
        new Promise<void>((resolve) =>
          frontServer.listen(
            Number(new URL(fixture.front).port),
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
      await Promise.all([
        new Promise<void>(
          (resolve) => frontServer?.close(() => resolve()) ?? resolve(),
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
        .getByRole("button", { name: "Choose this sync service", exact: true })
        .click();
    }
    it("restores a community login into a fresh desktop, observes periodic upload, and delegates web access", async () => {
      const service = new SyncService(issuer, portal),
        keys = await import("../packages/browser/src/sync/crypto").then((m) =>
          m.proofKeys(),
        );
      await service.register(username, master, keys, undefined, keyword);
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
          .getByLabel("Private sync keyword", { exact: true })
          .fill(keyword);
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
        observer = await service.signIn(username, master, undefined, keyword);
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
          .getByLabel("Private sync keyword", { exact: true })
          .fill(keyword);
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
        observer = await service.signIn(username, master, undefined, keyword);
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
      await web
        .getByRole("button", { name: "Pair this browser with desktop" })
        .click();
      try {
        await visible(
          web.getByLabel("Browser pairing request", { exact: true }),
        ).toBeVisible({ timeout: 10_000 });
      } catch (error) {
        await web.screenshot({
          path: "test-results/sync-ui/pairing-start-failure.png",
        });
        console.log(
          "Pairing startup page:",
          await web.locator("body").innerText(),
        );
        throw error;
      }
      const pairingCode = await web
        .getByLabel("Browser pairing request", { exact: true })
        .inputValue();
      let approvalDesktop = fresh ?? original;
      if (!approvalDesktop) {
        approvalDesktop = await desktop();
        await chooseService(approvalDesktop.page);
        await approvalDesktop.page
          .getByLabel("Sync username or email")
          .fill(username);
        await approvalDesktop.page
          .getByLabel("Master password", { exact: true })
          .fill(master);
        await approvalDesktop.page
          .getByLabel("Private sync keyword", { exact: true })
          .fill(keyword);
        await approvalDesktop.page
          .getByRole("button", { name: "Sign in and restore", exact: true })
          .click();
        await visible(
          approvalDesktop.page.getByText("Last synchronized:", {
            exact: false,
          }),
        ).toBeVisible();
      } else {
        await approvalDesktop.page
          .getByRole("button", { name: "Client settings", exact: true })
          .click();
        await approvalDesktop.page
          .getByRole("button", { name: "Encrypted sync", exact: true })
          .click();
      }
      const native = approvalDesktop.page;
      await native.getByText("Approve browser access", { exact: true }).click();
      await native
        .getByLabel("Browser pairing request", { exact: true })
        .fill(pairingCode);
      await native
        .getByRole("button", { name: "Review browser request", exact: true })
        .click();
      await native
        .getByRole("button", { name: "Approve " + fixture.front, exact: true })
        .click();
      await visible(
        native.getByLabel("Desktop approval code", { exact: true }),
      ).toBeVisible();
      const approvalCode = await native
        .getByLabel("Desktop approval code", { exact: true })
        .inputValue();
      await web
        .getByLabel("Desktop approval code", { exact: true })
        .fill(approvalCode);
      await web
        .getByRole("button", { name: "Finish browser pairing", exact: true })
        .click();
      await visible(
        web.getByRole("button", { name: "Sync now", exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      expect(
        await web.getByLabel("Private sync keyword", { exact: true }).count(),
      ).toBe(0);
      expect(
        await web.getByLabel("Master password", { exact: true }).count(),
      ).toBe(0);
      await native.screenshot({
        path: "test-results/sync-ui/desktop-key-approval.png",
      });
      await web.screenshot({ path: "test-results/sync-ui/web-sync.png" });
      expect(
        await web.evaluate(() => localStorage.getItem("chatxo-voice-sounds")),
      ).toBe("off");
      const newPassword =
          "Changed UI master password " + randomBytes(20).toString("hex"),
        newKeyword =
          "Changed UI private keyword " + randomBytes(20).toString("hex");
      await native
        .getByText("Change sync password or private keyword", { exact: true })
        .click();
      await native
        .getByLabel("Current master password", { exact: true })
        .fill(master);
      await native
        .getByLabel("Current private sync keyword", { exact: true })
        .fill(keyword);
      await native
        .getByLabel("New master password", { exact: true })
        .fill(newPassword);
      await native
        .getByLabel("Confirm new master password", { exact: true })
        .fill(newPassword);
      await native
        .getByLabel("New private sync keyword", { exact: true })
        .fill(newKeyword);
      // Fail only the forced upload, after the secret migration has committed.
      let rotationSent = false;
      await approvalDesktop.context.route(
        issuer + "/v1/recovery/finish",
        async (route) => {
          rotationSent = true;
          await route.fallback();
        },
      );
      await approvalDesktop.context.route(
        issuer + "/v1/vault/full",
        async (route) => {
          if (rotationSent && route.request().method() === "PUT")
            await route.abort("failed");
          else await route.fallback();
        },
      );
      await native
        .getByRole("button", {
          name: "Change secrets and fully resync",
          exact: true,
        })
        .click();
      await visible(
        native.locator(".sync-global-notices .sync-failure"),
      ).toContainText("full resync did not finish", { timeout: 30_000 });
      expect(
        await native.evaluate(() =>
          localStorage.getItem("chatxo-voice-sounds"),
        ),
      ).toBe("off");
      await native.screenshot({
        path: "test-results/sync-ui/secret-change-failure.png",
      });
      await approvalDesktop.context.unroute(issuer + "/v1/vault/full");
      await native.getByRole("button", { name: "Close", exact: true }).click();
      await native
        .locator(".sync-global-notices")
        .getByRole("button", { name: "Retry sync", exact: true })
        .click();
      await visible(
        native.locator(".sync-global-notices .sync-failure"),
      ).toHaveCount(0, { timeout: 30_000 });
      await native
        .getByRole("button", { name: "Client settings", exact: true })
        .click();
      await native
        .getByRole("button", { name: "Encrypted sync", exact: true })
        .click();
      await visible(
        native.getByText("Full resync completed.", { exact: true }),
      ).toBeVisible();
      const rotated = await service.signIn(
        username,
        newPassword,
        undefined,
        newKeyword,
      );
      expect((await service.read(rotated)).value).toMatchObject({
        preferences: { "chatxo-voice-sounds": "off" },
      });
      expect(
        (
          await service.read(
            rotated,
            await import("../packages/browser/src/sync/crypto").then((m) =>
              m.serverScope(fixture.front),
            ),
            await service.scopeKey(rotated, fixture.front),
          )
        ).value,
      ).toBeDefined();
      await web.getByRole("button", { name: "Sync now", exact: true }).click();
      await visible(
        web.locator(".sync-global-notices .sync-failure"),
      ).toContainText("Sync stopped working");
      expect(
        await web.evaluate(() => localStorage.getItem("chatxo-voice-sounds")),
      ).toBe("off");
      await service.logout(rotated);
      if (!fresh && !original) await approvalDesktop.context.close();
      await original?.context.close();
      await fresh?.context.close();
      await webContext.close();
      await expect(service.read(observer!)).rejects.toMatchObject({
        status: 401,
      });
    }, 150_000);
  },
);
