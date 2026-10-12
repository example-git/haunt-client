import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function checkPresenceAppearance(browser, fixtures, desktopPage) {
  const contexts = [];
  const errors = [],
    requests = [],
    presenceFrames = [];
  const makePage = async () => {
    const context = await browser.newContext({
      viewport: { width: 1360, height: 900 },
    });
    contexts.push(context);
    return context.newPage();
  };
  const login = async (page, user, server = fixtures.rtc) => {
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    if (page !== desktopPage) {
      await page.addInitScript(() => {
        window.presenceTestSockets = [];
        const Original = window.WebSocket;
        window.WebSocket = class extends Original {
          constructor(...args) {
            super(...args);
            window.presenceTestSockets.push(this);
          }
        };
      });
      await page.goto("http://127.0.0.1:5173");
    }
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await page.getByLabel("Server address").fill(server.url);
    await page.getByLabel("Username", { exact: true }).fill(user);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
  };
  try {
    const owner = desktopPage ?? (await makePage());
    owner.on("request", (r) => {
      if (r.url().includes("/api/v1/users")) requests.push(r.url());
    });
    owner.on("websocket", (ws) =>
      ws.on("framereceived", (event) => {
        if (
          typeof event.payload === "string" &&
          event.payload.includes('"type":"presence.snapshot"')
        )
          presenceFrames.push(event.payload);
      }),
    );
    await login(owner, "owner");
    if (
      await owner
        .getByRole("button", { name: "Show member list", exact: true })
        .count()
    )
      await owner
        .getByRole("button", { name: "Show member list", exact: true })
        .click();
    const row = (name) =>
      owner.locator(".member-row").filter({ hasText: `@${name}` });
    await expect(row("alice").locator(".user-status")).toHaveAttribute(
      "aria-label",
      "Offline",
    );
    await expect(row("owner").locator(".user-status")).toHaveAttribute(
      "aria-label",
      "Online",
    );
    const aliceId = await row("alice")
      .locator(".user-status")
      .getAttribute("data-user-id");
    const directoryRequests = requests.length;
    const alice = await makePage();
    await login(alice, "alice");
    await expect(row("alice").locator(".user-status")).toHaveAttribute(
      "aria-label",
      "Online",
    );
    await alice
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Presence message");
    await alice
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      owner.locator(`.message .user-status[data-user-id="${aliceId}"]`).last(),
    ).toHaveAttribute("aria-label", "Online");
    await row("alice").click({ button: "right" });
    await owner.getByRole("menuitem", { name: "Message", exact: true }).click();
    await expect(
      owner.locator(`.dm-entry .user-status[data-user-id="${aliceId}"]`),
    ).toHaveAttribute("aria-label", "Online");
    if (
      await owner
        .getByRole("button", { name: "Show member list", exact: true })
        .count()
    )
      await owner
        .getByRole("button", { name: "Show member list", exact: true })
        .click();
    await expect(row("alice")).toBeVisible();
    // Account directory can refresh once when the newly-created DM arrives.
    await owner.waitForTimeout(350);
    const afterDM = requests.length;
    const second = await makePage();
    await login(second, "alice");
    await alice.context().close();
    await owner.waitForTimeout(350);
    await expect(row("alice").locator(".user-status")).toHaveAttribute(
      "aria-label",
      "Online",
    );
    await second.context().close();
    await expect(row("alice").locator(".user-status")).toHaveAttribute(
      "aria-label",
      "Offline",
    );
    await expect(
      owner.locator(`.dm-entry .user-status[data-user-id="${aliceId}"]`),
    ).toHaveAttribute("aria-label", "Offline");
    assert.equal(
      requests.length,
      afterDM,
      "Connection presence must not refetch the directory",
    );
    assert(directoryRequests > 0);
    const frames = presenceFrames.length;
    await owner.waitForTimeout(1200);
    assert.equal(
      presenceFrames.length,
      frames,
      "Idle presence must not send periodic snapshots",
    );
    await owner
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await expect(owner.getByRole("radio")).toHaveCount(97);
    await owner.getByRole("radio", { name: "Sky 3", exact: true }).check();
    const color = await owner
      .getByRole("radio", { name: "Sky 3", exact: true })
      .inputValue();
    assert.equal(
      await owner.evaluate(() =>
        document.documentElement.style.getPropertyValue("--accent"),
      ),
      color,
    );
    await owner.screenshot({
      path: `test-results/appearance-${desktopPage ? "desktop" : "browser"}.png`,
    });
    await owner.getByRole("button", { name: "Close", exact: true }).click();
    await owner.reload();
    await expect(owner.locator(".connection")).toHaveText("Connected");
    assert.equal(
      await owner.evaluate(() =>
        document.documentElement.style.getPropertyValue("--accent"),
      ),
      color,
    );
    if (
      await owner
        .getByRole("button", { name: "Show member list", exact: true })
        .count()
    )
      await owner
        .getByRole("button", { name: "Show member list", exact: true })
        .click();
    await expect(row("owner").locator(".user-status")).toHaveAttribute(
      "aria-label",
      "Online",
    );
    await owner.screenshot({
      path: `test-results/presence-${desktopPage ? "desktop" : "browser"}.png`,
    });
    if (!desktopPage) {
      await owner.context().setOffline(true);
      // Playwright offline emulation blocks fetches but leaves established
      // WebSockets open. Close only this page's captured sockets as well.
      await owner.evaluate(() =>
        window.presenceTestSockets.forEach((ws) => ws.close()),
      );
      await expect(row("owner").locator(".user-status")).toHaveAttribute(
        "aria-label",
        "Status unavailable",
      );
      await owner.context().setOffline(false);
      await expect(row("owner").locator(".user-status")).toHaveAttribute(
        "aria-label",
        "Online",
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${desktopPage ? "desktop" : "browser"} presence/appearance: multiple devices, last disconnect, member/DM/message avatars, quiet idle, no presence HTTP refresh, 96 pastels, saved preference and reconnect.`,
    );
  } finally {
    for (const context of contexts) await context.close();
  }
}
