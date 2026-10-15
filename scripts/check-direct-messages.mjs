import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { checkServerIdentity } from "./check-server-identity.mjs";

export async function checkDirectMessages(
  page,
  fixtures,
  browser,
  label = "browser",
) {
  page.setDefaultTimeout(15000);
  const errors = [],
    historyRequests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      r.method() === "GET" &&
      /\/conversations\/[^/]+\/messages/.test(r.url())
    )
      historyRequests.push(r.url());
  });
  await page.addInitScript(() => {
    document.hasFocus = () => true;
  });
  await page.reload();
  const api = async (
    server,
    token,
    path,
    body,
    method = body ? "POST" : "GET",
  ) => {
    const response = await fetch(`${server.url}/api/v1${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert(
      response.ok,
      `${method} ${path}: ${response.status} ${await (response.ok ? Promise.resolve("") : response.text())}`,
    );
    return response.status === 204 ? undefined : response.json();
  };
  const login = async (server) => {
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await page.getByLabel("Server address").fill(server.url);
    await page.getByLabel("Username", { exact: true }).fill("owner");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
  };
  const home = async () => {
    await page
      .getByRole("button", { name: /^Direct messages and notifications/ })
      .click();
    await expect(page.locator(".dm-home")).toBeVisible();
  };
  const server = async (value) => {
    await page
      .getByRole("button", { name: `Open ${value.name}`, exact: true })
      .click();
    await expect(page.locator(".connection")).toHaveText("Connected");
  };
  const create = async () => {
    await page
      .getByRole("button", { name: "New direct message", exact: true })
      .click();
    await page.getByLabel("Find people").fill("alice");
    await page.locator(".people-list input[type=checkbox]").check();
    await page
      .getByRole("button", { name: "Start conversation", exact: true })
      .click();
    await expect(page.locator(".dm-workspace")).toBeVisible();
  };
  const send = async (body) => {
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(body);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.locator(".message-body").last()).toHaveText(body);
  };
  const row = (value) =>
    page.locator(".dm-home-entry").filter({
      has: page.locator(".dm-entry-text small", {
        hasText: `alice@${new URL(value.url).host}`,
      }),
    });
  const rail = (value) =>
    page.locator(".dm-rail").getByRole("button", {
      name: `Message alice via ${value.name}`,
      exact: true,
    });
  const peerContexts = [];
  const peers = new Map();
  const peerSend = async (peer, body) => {
    await peer
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(body);
    await peer
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      peer.locator(".message-body").filter({ hasText: body }),
    ).toHaveCount(1);
  };
  for (const value of [fixtures.rtc, fixtures.ws]) {
    const context = await browser.newContext();
    peerContexts.push(context);
    const peer = await context.newPage();
    peers.set(value.url, peer);
    await peer.goto("http://127.0.0.1:5173");
    await peer.getByRole("button", { name: "Add server", exact: true }).click();
    await peer.getByLabel("Server address").fill(value.url);
    await peer.getByLabel("Username", { exact: true }).fill("alice");
    await peer.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await peer.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(peer.locator(".connection")).toHaveText("Connected");
    await peer
      .getByRole("button", { name: /^Direct messages and notifications/ })
      .click();
    await peer
      .getByRole("button", { name: "New direct message", exact: true })
      .click();
    await peer.getByLabel("Find people").fill("owner");
    await peer.locator(".people-list input[type=checkbox]").check();
    await peer
      .getByRole("button", { name: "Start conversation", exact: true })
      .click();
  }
  try {
    await login(fixtures.rtc);
    await home();
    await create();
    await expect(page.locator(".dm-conversation-head h1")).toHaveText(
      `alice via ${fixtures.rtc.name}`,
    );
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await expect(
      page.getByRole("complementary", { name: "Member list" }),
    ).toHaveCount(0);
    const header = await page.locator(".dm-conversation-head").boundingBox();
    const titlebar = await page.locator(".app-titlebar").boundingBox();
    assert(
      header.y >= titlebar.y + titlebar.height,
      "DM header sits beneath the titlebar",
    );
    await send(`${label}: first server preview`);
    await page
      .getByRole("button", { name: "Add to favorites", exact: true })
      .click();
    await login(fixtures.ws);
    await home();
    const search = page.getByRole("combobox", {
      name: "Search direct messages",
    });
    await search.fill("alice");
    await expect(page.getByRole("option")).toHaveCount(2);
    for (const value of [fixtures.rtc, fixtures.ws])
      await expect(
        page.getByRole("option", {
          name: `alice@${new URL(value.url).host}`,
          exact: true,
        }),
      ).toBeVisible();
    await search.fill(`alice@${new URL(fixtures.ws.url).host}`);
    await search.press("Enter");
    await expect(page.locator(".dm-workspace")).toBeVisible();
    await send(`${label}: second server preview`);
    await home();
    await page
      .getByRole("button", { name: "New direct message", exact: true })
      .click();
    const firstPerson = page.getByRole("checkbox", {
      name: `alice@${new URL(fixtures.rtc.url).host}`,
      exact: true,
    });
    const otherPerson = page.getByRole("checkbox", {
      name: `alice@${new URL(fixtures.ws.url).host}`,
      exact: true,
    });
    await firstPerson.check();
    await expect(otherPerson).toBeDisabled();
    await firstPerson.uncheck();
    await expect(otherPerson).toBeEnabled();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(row(fixtures.rtc).locator(".dm-preview")).toHaveText(
      `You: ${label}: first server preview`,
    );
    await expect(row(fixtures.ws).locator(".dm-preview")).toHaveText(
      `You: ${label}: second server preview`,
    );
    await expect(
      page.getByRole("region", { name: "Favorites", exact: true }),
    ).toContainText(`alice@${new URL(fixtures.rtc.url).host}`);
    await row(fixtures.rtc).locator(".user-name").click();
    await expect(page.locator(".member-profile .account-address")).toHaveText(
      `alice@${new URL(fixtures.rtc.url).host}`,
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByLabel("Search direct messages")
      .fill(new URL(fixtures.ws.url).host);
    await expect(page.locator(".dm-home-entry")).toHaveCount(1);
    await page.getByLabel("Search direct messages").fill("");
    const before = historyRequests.length;
    await page.waitForTimeout(800);
    assert.equal(
      historyRequests.length,
      before,
      "Home previews do not fetch message histories",
    );

    const alice = await api(fixtures.rtc, "", "/auth/login", {
      username: "alice",
      password: fixtures.password,
      device_name: `dm-${label}`,
    });
    const dm = (
      await api(fixtures.rtc, alice.token, "/conversations")
    ).conversations.find((c) => c.kind === "dm" && c.members.length === 2);
    assert(dm);
    const peer = peers.get(fixtures.rtc.url);
    await peerSend(peer, `${label}: incoming on Home`);
    const incoming = (
      await api(fixtures.rtc, alice.token, `/conversations/${dm.id}/messages`)
    ).messages.at(-1);
    await expect(row(fixtures.rtc).locator(".dm-preview")).toHaveText(
      `${label}: incoming on Home`,
    );
    await expect(
      rail(fixtures.rtc).locator(".conversation-badge"),
    ).toBeVisible();
    await expect(
      page.locator(".dm-notifications .notification-inbox button").first(),
    ).toContainText(`${label}: incoming on Home`);
    const edited = peer
      .locator(".message")
      .filter({ hasText: `${label}: incoming on Home` });
    await edited.click({ button: "right" });
    await peer
      .getByRole("menuitem", { name: "Edit message", exact: true })
      .click();
    await edited.locator("textarea").fill(`${label}: edited preview`);
    await edited.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row(fixtures.rtc).locator(".dm-preview")).toHaveText(
      `${label}: edited preview`,
    );
    await api(
      fixtures.rtc,
      alice.token,
      `/conversations/${dm.id}/messages/${incoming.id}`,
      undefined,
      "DELETE",
    );
    await expect(row(fixtures.rtc).locator(".dm-preview")).toHaveText(
      "Message deleted",
    );
    await peerSend(peer, `${label}: open this notification`);
    await expect(
      page.locator(".dm-notifications .notification-inbox button").first(),
    ).toContainText(`${label}: open this notification`);
    await page
      .locator(".dm-notifications .notification-inbox button")
      .first()
      .click();
    await expect(page.locator(".dm-conversation-head h1")).toHaveText(
      `alice via ${fixtures.rtc.name}`,
    );
    await expect(page.locator(".message-body").last()).toHaveText(
      `${label}: open this notification`,
    );
    await expect(rail(fixtures.rtc).locator(".conversation-badge")).toHaveCount(
      0,
    );
    await expect(
      page
        .locator(".message-body")
        .filter({ hasText: `${label}: second server preview` }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Direct message options", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Notification Settings", exact: true })
      .click();
    await expect(
      page.getByLabel("Notification sound for alice", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await home();
    await page.screenshot({ path: `test-results/dm-home-${label}.png` });
    await page.reload();
    await expect(row(fixtures.rtc).locator(".dm-preview")).toHaveText(
      `${label}: open this notification`,
    );
    await expect(
      page.getByRole("region", { name: "Favorites", exact: true }),
    ).toContainText(`alice@${new URL(fixtures.rtc.url).host}`);
    await home();
    await row(fixtures.ws).click();
    await expect(page.locator(".dm-conversation-head h1")).toHaveText(
      `alice via ${fixtures.ws.name}`,
    );
    await expect(page.locator(".message-body").last()).toHaveText(
      `${label}: second server preview`,
    );
    await page.screenshot({
      path: `test-results/dm-conversation-${label}.png`,
    });
    // A call survives both Home and a DM on a different service.
    await server(fixtures.rtc);
    await page
      .locator(`[data-channel-id="${fixtures.rtc.voice}"] button.channel`)
      .click();
    const joinNow = page.getByRole("button", { name: "Join now", exact: true });
    if (await joinNow.isVisible()) await joinNow.click();
    await expect(page.locator(".call-dock")).toContainText("Voice connected", {
      timeout: 25000,
    });
    await home();
    await expect(page.locator(".call-panel.mini")).toBeVisible();
    await expect(page.locator(".call-dock")).toBeInViewport();
    const cog = await page
      .getByRole("button", { name: "Client settings", exact: true })
      .boundingBox();
    assert(
      Math.abs(page.viewportSize().height - cog.y - cog.height - 12) <= 1,
      "Settings stays at the bottom of the window during calls",
    );
    await home();
    await row(fixtures.ws).click();
    await expect(page.locator(".call-dock")).toContainText(fixtures.rtc.name);
    const composer = await page.locator(".composer-wrap").boundingBox();
    const dock = await page.locator(".call-dock").boundingBox();
    assert(
      composer.y + composer.height <= dock.y + 1,
      "Persistent call controls do not cover the DM composer",
    );
    await page
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
    await expect(page.locator(".call-dock")).toHaveCount(0);
    await checkServerIdentity(page, fixtures, api);
    if (label === "browser") {
      await home();
      await page.setViewportSize({ width: 430, height: 840 });
      await home();
      await expect(page.locator(".dm-directory")).toBeInViewport();
      await expect(page.locator(".dm-notifications")).toBeInViewport();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "No horizontal page overflow",
      );
      await page.screenshot({ path: "test-results/dm-home-narrow.png" });
      await page.setViewportSize({ width: 1400, height: 960 });
    }
    await home();
    // Signing out prunes one service's conversations without touching the other.
    await page
      .getByRole("button", { name: "Client settings", exact: true })
      .click();
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page
      .getByRole("button", { name: "Sign out of this server", exact: true })
      .click();
    await expect(row(fixtures.ws)).toHaveCount(0);
    await expect(row(fixtures.rtc)).toBeVisible();
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${label}: scoped DMs, Home previews/edit/delete/reload, favorites, notification routing/unread, separate header, server switching, persistent call controls and logout isolation`,
    );
  } finally {
    for (const context of peerContexts) await context.close();
  }
}
