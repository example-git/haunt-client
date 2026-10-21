import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { badgeServerFixture } from "./badge-server-fixture.mjs";
import { fillSignin } from "./signin-fields.mjs";
import { useNativeWindowFocus } from "./native-notification-ui.mjs";

// The installed app owns policy, focus detection, sound, unread state, IPC,
// native notifications and badges. This harness supplies only server input
// and ordinary UI actions; it never replaces any notification implementation.
export async function checkNotificationMessages(app, page, native, report) {
  await useNativeWindowFocus(page);
  const server = await badgeServerFixture();
  const checks = [];
  report.messageNotifications = { checks, passed: false };
  await page.evaluate(() => {
    window.nativeNotificationErrors = [];
    window.nativeNotificationErrorOff = window.hauntDesktop.onNotificationError(
      (message) => window.nativeNotificationErrors.push(message),
    );
  });
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
  const waitForQuiet = () =>
    expect
      .poll(
        () =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.isCurrentlyAudible(),
          ),
        { timeout: 10000 },
      )
      .toBe(false);
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
    if (native.audio)
      checks.push({ output: await native.audio.check(since, expected) });
  };
  const show = async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setBounds({ x: 0, y: 40, width: 600, height: 620 });
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.hauntDesktop.windowState("main")).focused,
        ),
      )
      .toBe(true);
  };
  const hide = async () => {
    // Exercise the same IPC and native command as the titlebar's Minimize
    // button. BrowserWindow.hide() is not a Haunt user action on macOS.
    await page.evaluate(() =>
      window.hauntDesktop.windowControl("minimize", "main"),
    );
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isMinimized(),
        ),
      )
      .toBe(true);
    await native.movePointerAway();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.hauntDesktop.windowState("main")).focused,
        ),
      )
      .toBe(false);
  };
  const settings = async () => {
    await show();
    const button = page.getByRole("button", {
      name: /^(Client settings|Account settings)$/,
    });
    if (!(await button.isVisible()))
      await page
        .getByRole("button", { name: /^(Show servers|Show channels)$/ })
        .click();
    await button.click();
    const notifications = page.getByRole("dialog").getByRole("button", {
      name: "Notification Settings",
      exact: true,
    });
    if (!(await notifications.isVisible()))
      await page
        .getByRole("dialog")
        .getByRole("button", {
          name: "Browse settings",
          exact: true,
        })
        .click();
    await notifications.click();
    await page
      .getByLabel("Server for notifications", { exact: true })
      .selectOption({
        label: `Badge delivery — ${new URL(server.origin).host}`,
      });
  };
  const closeSettings = () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
  const enablePopups = async () => {
    const checkbox = page.getByLabel(
      "Desktop popups when the app is in the background",
    );
    if (!(await checkbox.isChecked())) await checkbox.click();
    await expect(checkbox).toBeChecked();
  };
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
  const delivered = async (body, options) => {
    await native.expectPopup(body, options);
    checks.push({ body, nativePopup: "visible" });
  };
  const badge = async (count, label) => {
    if (process.platform === "darwin")
      await expect
        .poll(() => app.evaluate(({ app }) => app.dock.getBadge()))
        .toBe(count ? String(count) : "");
    if (native.records) {
      const latest = async () =>
        (await native.records())
          .filter((record) => record.kind === "badge")
          .at(-1);
      await expect.poll(async () => (await latest())?.count).toBe(count);
      const record = await latest();
      assert.equal(record.application, `application://${native.desktop}`);
      assert.equal(record.visible, count > 0);
      checks.push({ badge: record });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const screenshot = `test-results/notification-${native.target}-badge-${label}.png`;
    await native.capture(screenshot);
    native.artifacts.push(screenshot);
    checks.push({ badgeCount: count, screenshot });
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
    if (
      !(await page
        .getByRole("button", { name: "Add server", exact: true })
        .isVisible())
    )
      await page
        .getByRole("button", { name: /^(Show servers|Show channels)$/ })
        .click();
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
    await enablePopups();
    await page.getByLabel("Show message previews in desktop popups").check();
    await page.getByLabel("Ping sound", { exact: true }).selectOption("ping");
    await closeSettings();
    await select("general");
    if (process.platform === "darwin") {
      await hide();
      server.send(server.general, true, {
        body: "@owner Haunt permission setup",
      });
      await native.allowNotifications();
      checks.push({
        permission: "Allowed through the macOS notification prompt",
      });
      await show();
      await expect(page).toHaveTitle("Haunt");
    }
    server.send(server.general, true, { body: "@owner Haunt focused message" });
    await expect(
      page
        .locator(".message-body")
        .filter({ hasText: "Haunt focused message" }),
    ).toBeVisible();
    await absent("Haunt focused message");
    await hide();
    server.send(server.general, true, {
      body: "@owner Haunt minimized channel message",
    });
    await delivered("Haunt minimized channel message");
    await expect(page).toHaveTitle("(1) Haunt");
    await badge(1, "minimized-current-channel");
    await show();
    await expect(page).toHaveTitle("Haunt");
    if (process.platform === "darwin") {
      // The native Hide Haunt menu command hides the application, separately
      // from minimizing a window. Verify both actual macOS user states.
      await app.evaluate(({ app }) => app.hide());
      await expect
        .poll(() => app.evaluate(({ app }) => app.isHidden()))
        .toBe(true);
      server.send(server.general, true, {
        body: "@owner Haunt hidden application message",
      });
      await delivered("Haunt hidden application message");
      await badge(1, "hidden-application");
      await show();
      await expect(page).toHaveTitle("Haunt");
    }
    await select("quiet");
    await hide();
    server.send(server.general, false, { body: "Haunt ordinary message" });
    await absent("Haunt ordinary message");
    await waitForQuiet();
    let soundStart = Date.now();
    server.send(server.general, true, { body: "@owner Haunt mention message" });
    await delivered("Haunt mention message");
    await sound(soundStart, true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await waitForQuiet();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt direct message" });
    await delivered("Haunt direct message", { hover: true });
    await sound(soundStart, true);
    await expect(page).toHaveTitle("(2) Haunt");
    await badge(2, "incoming");
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
    await badge(1, "read-dm");
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
    await waitForQuiet();
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
    await waitForQuiet();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt popup disabled message" });
    await absent("Haunt popup disabled message");
    await sound(soundStart, true);
    await settings();
    await enablePopups();
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
    await badge(countBefore + 1, "settings-test");
    if (process.platform === "darwin")
      await expect
        .poll(() => app.evaluate(({ app }) => app.dock.getBadge()))
        .toBe(String(countBefore + 1));
    await show();
    await page
      .getByRole("button", { name: "Clear test badge", exact: true })
      .click();
    await expect(page).toHaveTitle(titleBefore);
    await badge(countBefore, "test-cleared");
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
    await waitForQuiet();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt silent message" });
    await delivered("Haunt silent message");
    await sound(soundStart, false);
    await settings();
    await page.getByLabel("Ping sound", { exact: true }).selectOption("chime");
    await closeSettings();
    await hide();
    await waitForQuiet();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt chime message" });
    await delivered("Haunt chime message");
    await sound(soundStart, true);
    await settings();
    await page.getByLabel("Ping sound", { exact: true }).selectOption("soft");
    await closeSettings();
    await hide();
    await waitForQuiet();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt soft message" });
    await delivered("Haunt soft message");
    await sound(soundStart, true);
    await settings();
    await page
      .getByLabel("Custom ping sound", { exact: true })
      .setInputFiles("tests/fixtures/narrator-tone.mp3");
    await expect(page.getByLabel("Ping sound", { exact: true })).toHaveValue(
      "custom",
    );
    await closeSettings();
    await hide();
    await waitForQuiet();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt custom sound message" });
    await delivered("Haunt custom sound message");
    await sound(soundStart, true);
    await settings();
    await page.getByLabel("Ping volume", { exact: true }).fill("0");
    await closeSettings();
    await hide();
    await waitForQuiet();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt zero volume message" });
    await delivered("Haunt zero volume message");
    await sound(soundStart, false);
    await settings();
    await page.getByLabel("Ping volume", { exact: true }).fill("70");
    await page
      .getByLabel("Notifications for Badge delivery", { exact: true })
      .selectOption("mute");
    await closeSettings();
    await hide();
    await waitForQuiet();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt muted server message" });
    await absent("Haunt muted server message");
    await sound(soundStart, false);
    await settings();
    await page
      .getByLabel("Notifications for Badge delivery", { exact: true })
      .selectOption("inherit");
    await page
      .getByLabel("Find a user for notifications", { exact: true })
      .fill("alice");
    await page
      .getByLabel(`Notifications for alice@${new URL(server.origin).host}`, {
        exact: true,
      })
      .selectOption("mute");
    await closeSettings();
    await hide();
    await waitForQuiet();
    soundStart = Date.now();
    server.send(server.dm, false, { body: "Haunt muted user message" });
    await absent("Haunt muted user message");
    await sound(soundStart, false);
    await settings();
    await page
      .getByLabel("Notifications for #general", { exact: true })
      .selectOption("mute");
    await closeSettings();
    await hide();
    await waitForQuiet();
    soundStart = Date.now();
    server.send(server.general, true, {
      body: "@owner Haunt muted channel message",
    });
    await absent("Haunt muted channel message");
    await sound(soundStart, false);
    // Read history after click checks: Electron restores wrapper objects here.
    if (process.platform === "darwin") {
      await expect
        .poll(() =>
          app.evaluate(
            async ({ Notification }, body) =>
              (await Notification.getHistory()).some((item) =>
                item.body.includes(body),
              ),
            "Haunt zero volume message",
          ),
        )
        .toBe(true);
      checks.push({
        body: "Haunt zero volume message",
        nativeHistory: "present in macOS Notification Center",
      });
    }
    report.messageNotifications.passed = true;
  } catch (error) {
    report.messageNotifications.error = error.stack;
    report.messageNotifications.nativeErrors = await page
      .evaluate(() => window.nativeNotificationErrors)
      .catch(() => []);
    if (process.platform === "darwin") {
      // Failure-only controls isolate native attachment handling. They import
      // the installed service and use Electron's real OS delivery; they cannot
      // satisfy any end-to-end assertion or change the original failure.
      report.messageNotifications.attachmentComparison = [];
      for (const attachment of [false, true]) {
        const body = `Haunt native attachment ${attachment ? "present" : "absent"}`;
        const result = { attachment, body };
        try {
          result.submission = await app.evaluate(
            async (
              { app, BrowserWindow, Notification },
              { attachment, body },
            ) => {
              const { createNotificationService } = process.mainModule.require(
                `${app.getAppPath()}/apps/desktop/notifications.cjs`,
              );
              const service = createNotificationService({
                Notification,
                getWindow: () => BrowserWindow.getAllWindows()[0],
                icon: attachment
                  ? `${app.getAppPath()}/dist/brand/logo-128.png`
                  : undefined,
              });
              global[Symbol.for("haunt.notification-attachment-control")] =
                service;
              return service.show({
                title: "Haunt native delivery comparison",
                body,
                instance: "native-comparison",
                conversation: "5d8dac74-87f9-4e34-a11d-cd630de9d69a",
              });
            },
            { attachment, body },
          );
          await native.expectPopup(body);
          result.nativePopup = "visible";
        } catch (failure) {
          result.error = failure.message;
        } finally {
          await app
            .evaluate(() => {
              global[
                Symbol.for("haunt.notification-attachment-control")
              ]?.dispose();
              delete global[
                Symbol.for("haunt.notification-attachment-control")
              ];
            })
            .catch(() => {});
        }
        report.messageNotifications.attachmentComparison.push(result);
      }
    }
    report.messageNotifications.nativeState = await app
      .evaluate(async ({ BrowserWindow, Notification }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return {
          focused: window.isFocused(),
          visible: window.isVisible(),
          minimized: window.isMinimized(),
          supported: Notification.isSupported(),
          history:
            process.platform === "darwin"
              ? await Promise.race([
                  Notification.getHistory().then((items) =>
                    items.map(({ title, body }) => ({ title, body })),
                  ),
                  new Promise((resolve) =>
                    setTimeout(
                      () => resolve("Native history query timed out"),
                      5000,
                    ),
                  ),
                ])
              : undefined,
        };
      })
      .catch((failure) => ({ error: failure.message }));
    report.messageNotifications.nativeDiagnostics = await native.diagnose?.();
    await settings()
      .then(async () => {
        report.messageNotifications.settings = await page
          .getByRole("dialog")
          .innerText();
        await native.capture(
          `test-results/notification-${native.target}-settings-failure.png`,
        );
      })
      .catch((failure) => {
        report.messageNotifications.settingsError = failure.message;
      });
    throw error;
  } finally {
    await page
      .evaluate(() => window.nativeNotificationErrorOff?.())
      .catch(() => {});
    await app
      .evaluate(() => {
        clearInterval(global[Symbol.for("haunt.native-audio-observer")]?.timer);
        delete global[Symbol.for("haunt.native-audio-observer")];
      })
      .catch(() => {});
    await server.stop();
  }
}
