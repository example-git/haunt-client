import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { badgeServerFixture } from "./badge-server-fixture.mjs";
import { fillSignin } from "./signin-fields.mjs";

// The installed app owns policy, focus detection, sound, unread state, IPC,
// native notifications and badges. This harness supplies only server input
// and ordinary UI actions; it never replaces any notification implementation.
export async function checkNotificationMessages(app, page, native, report) {
  const server = await badgeServerFixture();
  const checks = [];
  report.messageNotifications = { checks, passed: false };
  // Observe Chromium's real audio output. Nothing replaces AudioContext,
  // oscillators, buffers, sound selection or the production delivery path.
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const observation = { events: [], timer: null };
    observation.timer = setInterval(() => {
      if (!contents.isDestroyed() && contents.isCurrentlyAudible())
        observation.events.push(Date.now());
    }, 20);
    global[Symbol.for("haunt.native-audio-observer")] = observation;
  });
  const audibleSince = (time) =>
    app.evaluate(
      (_, time) =>
        global[Symbol.for("haunt.native-audio-observer")].events.some(
          (at) => at >= time,
        ),
      time,
    );
  const sound = async (since, expected) => {
    if (expected)
      await expect
        .poll(() => audibleSince(since), {
          timeout: 10000,
          intervals: [50, 100],
        })
        .toBe(true);
    else {
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(
        await audibleSince(since),
        false,
        "No audio rendered for a suppressed sound",
      );
    }
    checks.push({
      sound: expected
        ? "Chromium rendered audible output"
        : "No audible output",
      since,
    });
  };
  const show = async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setBounds({ x: 0, y: 40, width: 600, height: 620 });
      window.show();
      window.focus();
    });
    await expect
      .poll(() => page.evaluate(() => document.hasFocus()))
      .toBe(true);
  };
  const hide = async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].hide(),
    );
    await expect
      .poll(() => page.evaluate(() => document.hasFocus()))
      .toBe(false);
  };
  const settings = async () => {
    await show();
    await page
      .getByRole("button", { name: "Client settings", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Notification Settings", exact: true })
      .click();
  };
  const closeSettings = () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
  const select = async (name) => {
    const sidebar = page.getByRole("button", {
      name: "Show channels",
      exact: true,
    });
    if (await sidebar.isVisible()) await sidebar.click();
    await page
      .locator(".channel")
      .filter({ has: page.getByText(name, { exact: true }) })
      .first()
      .click();
  };
  const delivered = async (body) => {
    await native.expectPopup(body);
    checks.push({ body, nativePopup: "visible" });
  };
  const absent = async (body) => {
    await native.expectNoPopup(body);
    checks.push({ body, nativePopup: "absent" });
  };
  try {
    native.setScaleFactor(
      await app.evaluate(
        ({ screen }) => screen.getPrimaryDisplay().scaleFactor,
      ),
    );
    await show();
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, server.origin, "owner");
    await page
      .getByLabel("Password", { exact: true })
      .fill("native fixture password");
    await page.getByLabel("Remember this device", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    const members = page.getByRole("button", {
      name: "Dismiss member list",
      exact: true,
    });
    if (await members.isVisible()) await members.click();
    await settings();
    await page
      .getByLabel("Enable message notifications", { exact: true })
      .check();
    await page.getByLabel("Mentions of me", { exact: true }).check();
    await page.getByLabel("Direct messages", { exact: true }).check();
    await page.getByLabel("All channel messages", { exact: true }).uncheck();
    await page
      .getByLabel("Desktop popups when the app is in the background")
      .check();
    await page.getByLabel("Show message previews in desktop popups").check();
    await page.getByLabel("Ping sound", { exact: true }).selectOption("ping");
    await closeSettings();
    await select("general");
    server.send(server.general, true, { body: "@owner Haunt focused message" });
    await expect(
      page
        .locator(".message-body")
        .filter({ hasText: "Haunt focused message" }),
    ).toBeVisible();
    await absent("Haunt focused message");
    await select("quiet");
    await hide();
    server.send(server.general, false, { body: "Haunt ordinary message" });
    await absent("Haunt ordinary message");
    let soundStart = Date.now();
    server.send(server.general, true, { body: "@owner Haunt mention message" });
    await delivered("Haunt mention message");
    await sound(soundStart, true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt direct message" });
    await delivered("Haunt direct message");
    await sound(soundStart, true);
    await expect(page).toHaveTitle("(2) Haunt");
    if (process.platform === "darwin") {
      await expect
        .poll(() => app.evaluate(({ app }) => app.dock.getBadge()))
        .toBe("2");
      checks.push({ badge: "2", nativeReadback: "macOS Dock" });
    }
    await native.clickPopup("Haunt direct message");
    await expect
      .poll(() => page.evaluate(() => document.hasFocus()))
      .toBe(true);
    await expect(
      page.locator(".message-body").filter({ hasText: "Haunt direct message" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("(1) Haunt");
    checks.push({ click: "restored app, opened DM, cleared its unread state" });
    await settings();
    await page.getByLabel("Show message previews in desktop popups").uncheck();
    await closeSettings();
    await hide();
    server.send(server.dm, false, { body: "Haunt confidential message" });
    await delivered("New message");
    await absent("Haunt confidential message");
    await settings();
    await page.getByLabel("Show message previews in desktop popups").check();
    await page
      .getByLabel("Enable message notifications", { exact: true })
      .uncheck();
    await closeSettings();
    await hide();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt disabled message" });
    await absent("Haunt disabled message");
    await sound(soundStart, false);
    await settings();
    await page
      .getByLabel("Enable message notifications", { exact: true })
      .check();
    await page
      .getByLabel("Desktop popups when the app is in the background")
      .uncheck();
    await closeSettings();
    await hide();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt popup disabled message" });
    await absent("Haunt popup disabled message");
    await sound(soundStart, true);
    await settings();
    await page
      .getByLabel("Desktop popups when the app is in the background")
      .check();
    await page.getByLabel("All channel messages", { exact: true }).check();
    await closeSettings();
    await hide();
    server.send(server.general, false, { body: "Haunt channel message" });
    await delivered("Haunt channel message");
    server.send(server.general, true, {
      body: "@owner Haunt own message",
      own: true,
    });
    await absent("Haunt own message");
    await settings();
    const titleBefore = await page.title();
    const countBefore = Number(titleBefore.match(/^\((\d+)\)/)?.[1] ?? 0);
    await page
      .getByRole("button", { name: "Send test notification", exact: true })
      .click();
    await hide();
    await delivered("Haunt notification test");
    await expect(page).toHaveTitle(`(${countBefore + 1}) Haunt`);
    if (process.platform === "darwin")
      await expect
        .poll(() => app.evaluate(({ app }) => app.dock.getBadge()))
        .toBe(String(countBefore + 1));
    await show();
    await page
      .getByRole("button", { name: "Clear test badge", exact: true })
      .click();
    await expect(page).toHaveTitle(titleBefore);
    await closeSettings();
    assert.deepEqual(server.unexpected, []);
    await settings();
    const badgeCount = await page.title();
    await page
      .getByRole("button", { name: "Send test notification", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Popup suppressed because Haunt still has focus",
      { timeout: 15000 },
    );
    await page
      .getByRole("button", { name: "Clear test badge", exact: true })
      .click();
    await expect(page).toHaveTitle(badgeCount);
    await closeSettings();
    await settings();
    await page.getByLabel("Ping sound", { exact: true }).selectOption("none");
    await closeSettings();
    await hide();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt silent message" });
    await delivered("Haunt silent message");
    await sound(soundStart, false);
    await settings();
    await page.getByLabel("Ping sound", { exact: true }).selectOption("chime");
    await closeSettings();
    await hide();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt chime message" });
    await delivered("Haunt chime message");
    await sound(soundStart, true);
    report.messageNotifications.passed = true;
  } finally {
    await app
      .evaluate(() => {
        clearInterval(global[Symbol.for("haunt.native-audio-observer")]?.timer);
        delete global[Symbol.for("haunt.native-audio-observer")];
      })
      .catch(() => {});
    await server.stop();
  }
}
