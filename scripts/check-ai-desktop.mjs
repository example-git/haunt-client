import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fillSignin } from "./signin-fields.mjs";

export async function checkAIDesktop(page, desktop, fixtures) {
  const errors = [];
  const checked = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await desktop.evaluate(({ shell }) => {
      globalThis.aiOAuthFixture = [];
      globalThis.aiOAuthOriginalExternal = shell.openExternal;
      shell.openExternal = async (raw) => {
        const authorization = new URL(raw);
        const redirect = new URL(
          authorization.searchParams.get("redirect_uri"),
        );
        const state = authorization.searchParams.get("state");
        const provider =
          authorization.hostname === "claude.com"
            ? "claude"
            : authorization.hostname === "auth.openai.com"
              ? "codex"
              : authorization.hostname === "accounts.google.com"
                ? "antigravity"
                : "";
        if (!provider || !state)
          throw Error("Unexpected authorization request");
        redirect.searchParams.set("code", "isolated-fixture-code");
        redirect.searchParams.set("state", state);
        const entry = {
          provider,
          redirect_uri: authorization.searchParams.get("redirect_uri"),
          callback_url: redirect.href,
        };
        globalThis.aiOAuthFixture.push(entry);
      };
    });
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixtures.rtc.url, "owner");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    await page
      .getByRole("button", { name: "Server settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "AI connections", exact: true })
      .click();
    await expect(page.locator(".ai-account")).toHaveCount(1);
    const login = await page.request.post(
      fixtures.rtc.url + "/api/v1/auth/login",
      {
        data: {
          username: "owner",
          password: fixtures.password,
          device_name: "AI desktop assertions",
          remember: false,
        },
      },
    );
    assert.equal(login.status(), 200);
    const credential = await login.json();
    const accounts = async () => {
      const response = await page.request.get(
        fixtures.rtc.url + "/api/v1/ai/accounts",
        {
          headers: { Authorization: `Bearer ${credential.token}` },
        },
      );
      assert.equal(response.status(), 200);
      return (await response.json()).accounts;
    };
    const connect = async (provider, reconnect = false) => {
      const before = await page.locator(".ai-account").count();
      const attempts = await desktop.evaluate(
        () => globalThis.aiOAuthFixture.length,
      );
      const existing = new Set((await accounts()).map((account) => account.id));
      const complete = page.waitForResponse(
        (response) =>
          /\/api\/v1\/ai\/oauth\/[^/]+\/complete$/.test(response.url()) &&
          response.request().method() === "POST",
      );
      if (reconnect) {
        await page
          .locator(".ai-account")
          .filter({ hasText: reconnect.label || provider })
          .getByRole("button", { name: "Reconnect", exact: true })
          .click();
      } else {
        await page
          .getByRole("combobox", { name: "Integration", exact: true })
          .selectOption(provider);
        await page
          .getByRole("button", { name: "Connect account", exact: true })
          .click();
      }
      await expect
        .poll(() => desktop.evaluate(() => globalThis.aiOAuthFixture.length))
        .toBe(attempts + 1);
      const result = await desktop.evaluate(() =>
        globalThis.aiOAuthFixture.at(-1),
      );
      if (provider !== "antigravity") {
        const redirect = new URL(result.callback_url);
        redirect.hostname = "127.0.0.1";
        const invalid = new URL(redirect);
        invalid.searchParams.set("state", "wrong-fixture-state");
        const rejected = await page.request.get(invalid.href);
        result.wrong_state_status = rejected.status();
        const accepted = await page.request.get(redirect.href);
        result.callback_status = accepted.status();
      }
      if (provider === "antigravity") {
        const input = page.getByLabel("Authorization code or callback URL", {
          exact: true,
        });
        await expect(input).toBeVisible();
        const code = reconnect ? "isolated-fixture-code" : result.callback_url;
        await input.fill(code);
        await page
          .getByRole("button", { name: "Finish connection", exact: true })
          .click();
      }
      const response = await complete;
      assert.equal(
        response.status(),
        200,
        `${provider} completes OAuth through the server`,
      );
      const account = (await accounts()).find((account) =>
        reconnect ? account.id === reconnect.id : !existing.has(account.id),
      );
      assert(account, "OAuth completion persists account metadata");
      assert.equal(account.provider, provider);
      assert.equal(account.status, "connected");
      assert(!("access_token" in account) && !("refresh_token" in account));
      await expect(page.locator(".ai-account")).toHaveCount(
        before + (reconnect ? 0 : 1),
      );
      await expect(
        page.getByRole("button", { name: "Connect account", exact: true }),
      ).toBeEnabled();
      assert.equal(result.provider, provider);
      if (provider !== "antigravity") {
        assert.equal(result.wrong_state_status, 400);
        assert.equal(result.callback_status, 200);
        const redirect = new URL(result.redirect_uri);
        assert.equal(redirect.hostname, "localhost");
        assert.equal(
          redirect.pathname,
          provider === "codex" ? "/auth/callback" : "/callback",
        );
        if (provider === "codex") assert.equal(redirect.port, "1455");
        else assert(Number(redirect.port) > 0);
      } else
        assert.equal(
          result.redirect_uri,
          "https://antigravity.google/oauth-callback",
        );
      checked.push(
        `${provider}: renderer ${reconnect ? "reconnect" : "connect"}, native IPC, ${provider === "antigravity" ? (reconnect ? "bare code" : "full callback URL") : "reserved loopback callback and state validation"}, server token exchange`,
      );
      return account;
    };
    await connect("claude");
    await connect("codex");
    const antigravity = await connect("antigravity");
    assert.equal(
      (await connect("antigravity", antigravity)).id,
      antigravity.id,
    );
    const denied = await desktop.evaluate(
      async ({ BrowserWindow }, preload) => {
        const untrusted = new BrowserWindow({
          show: false,
          webPreferences: {
            preload,
            partition: "persist:chatxo",
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        const preloadErrors = [];
        untrusted.webContents.on("preload-error", (_event, file, error) =>
          preloadErrors.push({ file, error: String(error) }),
        );
        try {
          await untrusted.loadURL("about:blank");
          const result = await untrusted.webContents.executeJavaScript(`
          (async () => {
            if (!window.hauntDesktop?.aiOAuth) return { bridge: false };
            try {
              await window.hauntDesktop.aiOAuth.reserve("claude");
              return { bridge: true, denied: false };
            } catch (error) {
              return { bridge: true, denied: true, error: String(error) };
            }
          })()
        `);
          return { ...result, preload, preloadErrors };
        } finally {
          untrusted.destroy();
        }
      },
      path.resolve("apps/desktop/preload.cjs"),
    );
    assert.equal(denied.bridge, true, JSON.stringify(denied));
    assert.equal(denied.denied, true, JSON.stringify(denied));
    assert.match(denied.error, /Untrusted credential request/);
    checked.push("Untrusted renderer cannot reserve OAuth through native IPC");
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: "test-results/ai-desktop.png",
      fullPage: true,
    });
    await fs.writeFile(
      "test-results/ai-desktop.json",
      JSON.stringify(
        {
          source:
            "Production desktop renderer, preload, IPC, loopback listener, server OAuth service, and native provider token adapters; external browser authorization and provider endpoints use isolated fixtures",
          checked,
          providerLiveOAuth: false,
        },
        null,
        2,
      ),
    );
    console.log("Desktop AI OAuth fixture scenarios passed.");
  } catch (error) {
    console.error("Desktop AI OAuth scenario failed:", error);
    await fs
      .writeFile(
        "test-results/ai-desktop-failure.json",
        JSON.stringify({ checked, error: String(error) }, null, 2),
      )
      .catch(() => {});
    await page
      .screenshot({
        path: "test-results/ai-desktop-failure.png",
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    await desktop
      .evaluate(({ shell }) => {
        shell.openExternal = globalThis.aiOAuthOriginalExternal;
        delete globalThis.aiOAuthFixture;
        delete globalThis.aiOAuthOriginalExternal;
      })
      .catch(() => {});
  }
}
