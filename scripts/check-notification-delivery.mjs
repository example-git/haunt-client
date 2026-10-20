import { expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fillSignin } from "./signin-fields.mjs";

const expect = baseExpect.configure({ timeout: 20000 });

// Real accounts, websocket events, preferences, read state and navigation.
// Only the browser-to-OS popup boundary and window focus are controlled here.
// Packaged-client checks cover the native Notification and launcher APIs.
export async function checkNotificationDelivery(browser, fixtures) {
  const contexts = [],
    errors = [];
  const fixture = fixtures.rtc;
  const login = async (username) => {
    const context = await browser.newContext({
      viewport: { width: 1360, height: 950 },
    });
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.testFocused = true;
      document.hasFocus = () => window.testFocused;
      window.popupCalls = [];
      window.notificationPermissionRequests = 0;
      window.popupFailure = "";
      window.Notification = class {
        static permission = "default";
        static async requestPermission() {
          window.notificationPermissionRequests++;
          if (this.permission !== "denied") this.permission = "granted";
          return this.permission;
        }
        constructor(title, options) {
          if (window.popupFailure) throw Error(window.popupFailure);
          this.title = title;
          this.options = options;
          this.closed = false;
          window.popupCalls.push(this);
        }
        close() {
          this.closed = true;
          this.onclose?.();
        }
      };
    });
    await page.goto(fixture.url);
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixture.url, username);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    return page;
  };
  const settings = async (page) => {
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Notification Settings", exact: true })
      .click();
  };
  const close = (page) =>
    page.getByRole("button", { name: "Close", exact: true }).click();
  const home = (page) =>
    page.getByRole("button", {
      name: "Direct messages and notifications",
      exact: true,
    });
  const send = async (page, body) => {
    await page.getByLabel("Message", { exact: true }).fill(body);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.locator(".message-body").filter({ hasText: body }),
    ).toHaveCount(1);
  };
  const seen = (page, body) =>
    expect(
      page.locator(".message-body").filter({ hasText: body }),
    ).toBeVisible();
  const popupCount = (page, n) =>
    expect.poll(() => page.evaluate(() => window.popupCalls.length)).toBe(n);
  const clearPings = async (page, expected) => {
    await home(page).click();
    await expect(page.locator(".notification-inbox > button")).toHaveCount(
      expected,
    );
    await page.locator(".notification-inbox > button").first().click();
    await expect(home(page)).not.toHaveClass(/has-notifications/);
  };
  try {
    const owner = await login("owner"),
      alice = await login("alice");
    assert.equal(
      await owner.evaluate(() => window.notificationPermissionRequests),
      0,
    );
    await send(alice, "@owner focused conversation stays quiet");
    await seen(owner, "@owner focused conversation stays quiet");
    await expect(home(owner)).not.toHaveClass(/has-notifications/);
    await popupCount(owner, 0);

    await owner.evaluate(() => {
      window.testFocused = false;
    });
    await send(
      alice,
      "Ordinary messages stay quiet with mention-only preferences",
    );
    await seen(
      owner,
      "Ordinary messages stay quiet with mention-only preferences",
    );
    await expect(home(owner)).not.toHaveClass(/has-notifications/);
    await send(
      alice,
      "@owner incoming mention reaches the notification center",
    );
    await expect(home(owner)).toHaveClass(/has-notifications/);
    await expect(owner).toHaveTitle(/\(1\)/);
    await popupCount(owner, 0);
    await clearPings(owner, 1);

    await settings(owner);
    await owner
      .getByLabel("Desktop popups when the app is in the background")
      .check();
    assert.equal(
      await owner.evaluate(() => window.notificationPermissionRequests),
      1,
    );
    await owner.getByLabel("Show message previews in desktop popups").uncheck();
    await close(owner);
    await send(alice, "@owner this private text must not reach the popup");
    await popupCount(owner, 1);
    const payload = await owner.evaluate(() => window.popupCalls[0].options);
    assert.equal(payload.body, "New message");
    assert.equal(payload.silent, true);
    await home(owner).click();
    await expect(owner.locator(".notification-inbox > button")).toHaveCount(1);
    await owner.evaluate(() => {
      window.testFocused = true;
      window.popupCalls[0].onclick();
      window.dispatchEvent(new Event("focus"));
    });
    await seen(owner, "@owner this private text must not reach the popup");
    await expect(home(owner)).not.toHaveClass(/has-notifications/);
    await expect(owner).not.toHaveTitle(/\(\d+\)/);
    assert.equal(await owner.evaluate(() => window.popupCalls[0].closed), true);

    // Muted channels and the master switch remain effective.
    await owner.evaluate(() => {
      window.testFocused = false;
    });
    await owner
      .getByRole("button", { name: "Channel menu for general", exact: true })
      .locator("..")
      .hover();
    await owner
      .getByRole("button", { name: "Channel menu for general" })
      .click();
    await owner
      .getByRole("menuitem", { name: "Notifications", exact: true })
      .click();
    await owner
      .getByLabel("Notifications for #general", { exact: true })
      .selectOption("mute");
    await close(owner);
    await send(alice, "@owner muted channel stays quiet");
    await seen(owner, "@owner muted channel stays quiet");
    await expect(home(owner)).not.toHaveClass(/has-notifications/);
    await popupCount(owner, 1);
    await settings(owner);
    await owner
      .getByLabel("Notifications for #general", { exact: true })
      .selectOption("inherit");
    await owner.getByLabel("Enable message notifications").uncheck();
    await close(owner);
    await send(alice, "@owner disabled notifications stay quiet");
    await seen(owner, "@owner disabled notifications stay quiet");
    await expect(home(owner)).not.toHaveClass(/has-notifications/);
    await popupCount(owner, 1);

    // An explicit test works while focused and with automatic popups disabled.
    await settings(owner);
    await owner.getByLabel("Enable message notifications").check();
    await owner
      .getByLabel("Desktop popups when the app is in the background")
      .uncheck();
    await owner.evaluate(() => {
      window.testFocused = true;
    });
    await owner
      .getByRole("button", { name: "Send test notification", exact: true })
      .click();
    await popupCount(owner, 2);
    assert.equal(
      await owner.evaluate(() => window.popupCalls[1].title),
      "Haunt notification test",
    );
    await expect(owner.getByRole("dialog")).toContainText(
      "Test sent to your browser",
    );
    await expect(
      owner.getByLabel("Desktop popups when the app is in the background"),
    ).not.toBeChecked();
    await owner.evaluate(() => {
      window.popupFailure = "OS notification fixture rejected delivery";
    });
    await owner
      .getByRole("button", { name: "Send test notification", exact: true })
      .click();
    await expect(owner.getByRole("dialog")).toContainText(
      "OS notification fixture rejected delivery",
    );
    await owner.evaluate(() => {
      window.popupFailure = "";
      Notification.permission = "denied";
    });
    await owner
      .getByRole("button", { name: "Send test notification", exact: true })
      .click();
    await expect(owner.getByRole("dialog")).toContainText(
      "Allow notifications for this site",
    );
    await popupCount(owner, 2);
    await owner.evaluate(() => {
      Notification.permission = "granted";
    });
    await owner
      .getByRole("button", { name: "Send test notification", exact: true })
      .click();
    await popupCount(owner, 3);
    await owner.screenshot({ path: "test-results/notification-settings.png" });
    await owner.setViewportSize({ width: 390, height: 844 });
    assert(
      await owner
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await owner.screenshot({
      path: "test-results/notification-settings-mobile.png",
    });
    assert.deepEqual(errors, []);
    await fs.writeFile(
      "test-results/notification-delivery.json",
      JSON.stringify(
        {
          realServerEvents: true,
          focusedAndOrdinaryMessagesQuiet: true,
          mentionCenterAndTitleBadge: true,
          privatePopup: true,
          popupClickNavigationAndRead: true,
          muteAndDisableRespected: true,
          explicitTestWhileFocused: true,
          failedAndDeniedDeliveryVisible: true,
          nativePopupBoundary:
            "controlled; packaged native checks run separately",
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "PASS real notification events, title badge, privacy, click/read routing, focus/mute/disable rules, explicit test and visible delivery failures",
    );
  } catch (error) {
    console.error("Notification browser errors:", errors);
    for (const [i, context] of contexts.entries())
      for (const page of context.pages())
        await page
          .screenshot({
            path: `test-results/notification-delivery-failure-${i}.png`,
          })
          .catch(() => {});
    throw error;
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}
