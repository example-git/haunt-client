import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function checkGateway(browser, fixtures) {
  fixtures = structuredClone(fixtures);
  const context = await browser.newContext({
    viewport: { width: 1360, height: 950 },
  });
  const errors = [],
    requests = [];
  let page;
  const open = async () => {
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/"))
        requests.push({ url: r.url(), method: r.method() });
    });
    await page.addInitScript(() => {
      document.hasFocus = () =>
        sessionStorage.getItem("gateway-background") !== "1";
    });
    await page.goto("http://127.0.0.1:5173");
  };
  const api = async (
    server,
    token,
    path,
    body,
    method = body ? "POST" : "GET",
  ) => {
    const response = await fetch(server.url + "/api/v1" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert(response.ok, `${method} ${path}: ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  };
  const login = (server, username) =>
    api(server, "", "/auth/login", {
      username,
      password: fixtures.password,
      device_name: "gateway-e2e",
    });
  const connect = async (server) => {
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, server.url, "owner");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".community-head h2")).toHaveText(server.name);
    await expect(page.locator(".connection")).toHaveText("Connected");
  };
  const clear = async (server, token) => {
    let after;
    do {
      const value = await api(
        server,
        token,
        `/read-state${after ? `?after=${after}` : ""}`,
      );
      for (const state of value.states)
        if (state.last_seq)
          await api(
            server,
            token,
            `/conversations/${state.conversation_id}/read`,
            { seq: state.last_seq },
            "PUT",
          );
      after = value.next;
    } while (after);
  };
  try {
    // Other full-suite checks deliberately customize these communities.
    for (const server of [fixtures.rtc, fixtures.ws])
      server.name = (await api(server, "", "/instance")).name;
    const owner = await login(fixtures.rtc, "owner"),
      alice = await login(fixtures.rtc, "alice"),
      other = await login(fixtures.ws, "owner");
    await clear(fixtures.rtc, owner.token);
    await clear(fixtures.ws, other.token);
    await open();
    await connect(fixtures.rtc);
    const channel = await api(fixtures.rtc, owner.token, "/channels", {
      name: "gateway-unread",
      kind: "text",
    });
    const entry = () =>
      page.locator(`[data-channel-id="${channel.id}"] .channel`).first();
    await expect(entry()).toBeVisible();
    const send = (body) =>
      api(fixtures.rtc, alice.token, `/conversations/${channel.id}/messages`, {
        request_id: randomUUID(),
        body,
      });
    await send("An ordinary unread message");
    await expect(
      entry().getByLabel("Unread messages", { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle("• Haunt");
    await send("@owner first mention");
    await send("@owner second mention");
    await expect(
      entry().getByLabel("2 unread mentions", { exact: true }),
    ).toHaveText("2");
    await expect(page).toHaveTitle("(2) Haunt");
    assert.match(
      await page.locator('link[rel="icon"]').getAttribute("href"),
      /^data:image\/png;base64,/,
    );
    await entry().click();
    await expect(
      page.locator(".message-body").filter({ hasText: "second mention" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Haunt");
    await expect(
      entry().locator(".conversation-badge,.channel-ping"),
    ).toHaveCount(0);
    await connect(fixtures.ws);
    await expect(
      page.getByRole("button", {
        name: "Show older messages",
        exact: true,
      }),
    ).toBeVisible();
    await send("@owner on the background server");
    const serverButton = () =>
      page.getByRole("button", {
        name: `Open ${fixtures.rtc.name}`,
        exact: true,
      });
    await expect(serverButton().locator(".ping-badge")).toHaveText("1");
    await expect(page).toHaveTitle("(1) Haunt");
    await page.waitForTimeout(1500);
    const count = requests.length;
    await page.waitForTimeout(6200);
    assert.equal(
      requests.length,
      count,
      `Idle servers must not repeatedly fetch HTTP snapshots or histories: ${JSON.stringify(requests.slice(count))}`,
    );
    // Keep this tab's session vault while unloading the application/socket.
    await page.evaluate(() =>
      sessionStorage.setItem("gateway-background", "1"),
    );
    await page.goto("about:blank");
    await send("@owner while the client is closed");
    await page.goto("http://127.0.0.1:5173");
    await expect(page.locator(".dm-home")).toBeVisible();
    await expect(page).toHaveTitle("(2) Haunt");
    await expect(
      page.getByRole("button", { name: /^Direct messages and notifications/ }),
    ).toBeVisible();
    await serverButton().click();
    await entry().click();
    await page.evaluate(() => {
      sessionStorage.removeItem("gateway-background");
      window.dispatchEvent(new Event("focus"));
    });
    await expect(
      page
        .locator(".message-body")
        .filter({ hasText: "while the client is closed" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Haunt");
    // A DM has a numbered badge even without a mention and is discovered by the
    // account feed without manually refreshing the recipient's conversation list.
    const dm = await api(fixtures.rtc, alice.token, "/dms", {
      members: [owner.user.id],
    });
    await api(fixtures.rtc, alice.token, `/conversations/${dm.id}/messages`, {
      request_id: randomUUID(),
      body: "gateway direct message",
    });
    const direct = page.locator(".dm-rail").getByRole("button", {
      name: `Message ${alice.user.display_name || alice.user.username} via ${fixtures.rtc.name}`,
      exact: true,
    });
    await expect(
      direct.getByLabel("1 unread direct messages", { exact: true }),
    ).toHaveText("1");
    await expect(page).toHaveTitle("(1) Haunt");
    // A read on another device clears this client's badge through the gateway.
    const states = await api(fixtures.rtc, owner.token, "/read-state");
    const state = states.states.find((s) => s.conversation_id === dm.id);
    await api(
      fixtures.rtc,
      owner.token,
      `/conversations/${dm.id}/read`,
      { seq: state.last_seq },
      "PUT",
    );
    await expect(direct.locator(".conversation-badge")).toHaveCount(0);
    await expect(page).toHaveTitle("Haunt");
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      /\/brand\/favicon-32\.png$/,
    );
    await page.screenshot({ path: "test-results/gateway-unreads.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS account gateway UI: unread dots, mention/DM counts, tab/favicon, multiple servers, quiet idle connections, silent reconnect, cross-device reads",
    );
  } catch (error) {
    await page
      ?.screenshot({ path: "test-results/gateway-failure.png" })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}
