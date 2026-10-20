import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
export async function checkNotifications(browser, fixtures) {
  const contexts = [],
    errors = [];
  const login = async (user) => {
    const context = await browser.newContext({
      viewport: { width: 1360, height: 950 },
      permissions: ["microphone", "camera"],
    });
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.pingTones = [];
      window.pingBuffers = 0;
      const bufferStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.pingBuffers++;
        return bufferStart.apply(this, args);
      };
      window.captureConstraints = [];
      window.popupCalls = [];
      window.notificationPermissionRequests = 0;
      window.testFocused = true;
      document.hasFocus = () => window.testFocused;
      const start = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (...args) {
        window.pingTones.push(this.frequency.value);
        return start.apply(this, args);
      };
      const capture = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = (constraints) => {
        window.captureConstraints.push(constraints);
        return capture(constraints);
      };
      window.Notification = class {
        static permission = "default";
        static async requestPermission() {
          window.notificationPermissionRequests++;
          this.permission = "granted";
          return "granted";
        }
        constructor(title, options) {
          this.title = title;
          this.options = options;
          window.popupCalls.push(this);
        }
        close() {
          this.onclose?.();
        }
      };
    });
    await page.goto("http://127.0.0.1:5173");
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixtures.rtc.url, user);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected", {
      timeout: 20000,
    });
    return page;
  };
  const settings = async (page) => {
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Notification Settings", exact: true })
      .click();
  };
  const close = (page) =>
    page.getByRole("button", { name: "Close", exact: true }).click();
  const send = async (page, body) => {
    await page.getByLabel("Message", { exact: true }).fill(body);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.locator(".message-body").filter({ hasText: body }),
    ).toHaveCount(1);
  };
  const count = async (page, expected) =>
    expect(
      page.getByRole("button", {
        name: expected ? `Notifications (${expected})` : "Notifications",
        exact: true,
      }),
    ).toBeVisible();
  try {
    const owner = await login("owner"),
      alice = await login("alice");
    await count(owner, 0);
    assert.equal(
      await owner.evaluate(() => window.notificationPermissionRequests),
      0,
    );
    await send(alice, "@owner focused conversation stays quiet");
    await expect(owner.locator(".mention-self")).toContainText("@owner");
    await count(owner, 0);
    await owner.evaluate(() => {
      window.testFocused = false;
    });
    await send(alice, "Ordinary channel message is quiet by default");
    await expect(
      owner
        .locator(".message-body")
        .filter({ hasText: "Ordinary channel message is quiet by default" }),
    ).toBeVisible();
    await count(owner, 0);
    const composer = alice.getByLabel("Message", { exact: true });
    await composer.fill("Hello @ow");
    await expect(
      alice.getByRole("listbox", { name: "Mention a person" }),
    ).toBeVisible();
    await composer.press("Tab");
    await expect(composer).toHaveValue("Hello @owner ");
    await composer.press("Enter");
    await count(owner, 1);
    await owner.setViewportSize({ width: 390, height: 844 });
    await expect(owner.locator(".server-rail")).toBeHidden();
    await expect(owner.locator(".navigation-unread")).toBeVisible();
    await owner.screenshot({
      path: "test-results/mobile-navigation-unread.png",
    });
    await owner.setViewportSize({ width: 1360, height: 950 });
    await expect
      .poll(() => owner.evaluate(() => window.pingTones.map(Math.round)))
      .toContain(1047);
    assert.equal(await owner.evaluate(() => window.popupCalls.length), 0);
    await owner
      .getByRole("button", { name: "Notifications (1)", exact: true })
      .click();
    await expect(owner.getByRole("dialog")).toContainText("Hello @owner");
    await owner.locator(".notification-inbox button").click();
    await count(owner, 0);

    await settings(owner);
    await owner
      .getByLabel("Desktop popups when the app is in the background")
      .check();
    assert.equal(
      await owner.evaluate(() => window.notificationPermissionRequests),
      1,
    );
    await owner.getByLabel("Show message previews in desktop popups").uncheck();
    await owner.getByLabel("Ping sound", { exact: true }).selectOption("chime");
    await owner
      .getByRole("button", { name: "Preview ping", exact: true })
      .click();
    await expect
      .poll(() => owner.evaluate(() => window.pingTones.map(Math.round)))
      .toContain(1397);
    await owner.getByLabel("Ping volume", { exact: true }).fill("35");
    await close(owner);
    await send(alice, "@owner private popup preview");
    await count(owner, 1);
    await expect
      .poll(() => owner.evaluate(() => window.popupCalls.length))
      .toBe(1);
    assert.equal(
      await owner.evaluate(() => window.popupCalls[0].options.body),
      "New message",
    );
    assert.equal(
      await owner.evaluate(() => window.popupCalls[0].options.silent),
      true,
    );
    await owner.evaluate(() => window.popupCalls[0].onclick());
    await count(owner, 0);

    // Channel overrides are available to members without granting admin actions.
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
    await send(alice, "@owner channel mute");
    await expect(
      owner.locator(".message-body").filter({ hasText: "@owner channel mute" }),
    ).toBeVisible();
    await count(owner, 0);
    await settings(owner);
    await owner
      .getByRole("button", { name: "Notification Settings", exact: true })
      .click();
    await owner
      .getByLabel("Notifications for #general", { exact: true })
      .selectOption("all");
    await owner
      .getByLabel(`Notifications for ${fixtures.rtc.name}`, { exact: true })
      .selectOption("mute");
    await close(owner);
    await send(alice, "@owner server mute beats channel all");
    await expect(
      owner
        .locator(".message-body")
        .filter({ hasText: "@owner server mute beats channel all" }),
    ).toBeVisible();
    await count(owner, 0);
    await settings(owner);
    await owner
      .getByRole("button", { name: "Notification Settings", exact: true })
      .click();
    await owner
      .getByLabel(`Notifications for ${fixtures.rtc.name}`, { exact: true })
      .selectOption("inherit");
    await close(owner);
    await send(alice, "Channel override allows this ordinary message");
    await count(owner, 1);
    await owner
      .getByRole("button", { name: "Notifications (1)", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Clear all notifications" })
      .click();
    await close(owner);

    await settings(owner);
    await owner.getByLabel("Enable message notifications").uncheck();
    await close(owner);
    await send(alice, "@owner master disabled");
    await expect(
      owner
        .locator(".message-body")
        .filter({ hasText: "@owner master disabled" }),
    ).toBeVisible();
    await count(owner, 0);
    await settings(owner);
    await owner.getByLabel("Enable message notifications").check();
    // Valid custom sound, invalid input and persisted selection.
    const wav = Buffer.alloc(44 + 8000 * 2);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(16000, 40);
    for (let i = 0; i < 8000; i++)
      wav.writeInt16LE(
        Math.round(Math.sin((i * 2 * Math.PI * 660) / 8000) * 2000),
        44 + i * 2,
      );
    await owner.getByLabel("Custom ping sound").setInputFiles({
      name: "my-ping.wav",
      mimeType: "audio/wav",
      buffer: wav,
    });
    await expect(owner.getByLabel("Ping sound", { exact: true })).toHaveValue(
      "custom",
    );
    await owner
      .getByRole("button", { name: "Preview ping", exact: true })
      .click();
    await expect
      .poll(() => owner.evaluate(() => window.pingBuffers))
      .toBeGreaterThan(0);
    await owner.getByLabel("Custom ping sound").setInputFiles({
      name: "broken.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("not audio"),
    });
    await expect(owner.getByRole("alert")).toContainText("could not be read");
    await owner.getByRole("button", { name: "Devices", exact: true }).click();
    const mic = await owner
      .getByLabel("Default microphone")
      .locator("option")
      .nth(1)
      .getAttribute("value");
    const camera = await owner
      .getByLabel("Default webcam")
      .locator("option")
      .nth(1)
      .getAttribute("value");
    assert(mic && camera);
    await owner.getByLabel("Default microphone").selectOption(mic);
    await owner.getByLabel("Default webcam").selectOption(camera);
    await close(owner);
    await owner.reload();
    await expect(owner.locator(".connection")).toHaveText("Connected", {
      timeout: 20000,
    });
    await count(owner, 0);
    await settings(owner);
    await expect(owner.getByLabel("Ping sound", { exact: true })).toHaveValue(
      "custom",
    );
    await expect(owner.getByLabel("Ping volume", { exact: true })).toHaveValue(
      "35",
    );
    await owner
      .getByRole("button", { name: "Preview ping", exact: true })
      .click();
    await expect(owner.getByRole("alert")).toHaveCount(0);
    await expect
      .poll(() => owner.evaluate(() => window.pingBuffers))
      .toBeGreaterThan(0);
    await owner.getByRole("button", { name: "Devices", exact: true }).click();
    await expect(owner.getByLabel("Default microphone")).toHaveValue(mic);
    await expect(owner.getByLabel("Default webcam")).toHaveValue(camera);
    await close(owner);
    await owner
      .getByRole("button", { name: "lounge Join", exact: true })
      .click();
    await expect(owner.locator(".call-panel header small")).toContainText(
      "1 in the room",
    );
    await owner
      .locator(".call-dock")
      .getByRole("button", { name: "Turn on camera", exact: true })
      .click();
    await expect(owner.locator(".call-panel video")).toHaveCount(1);
    const constraints = await owner.evaluate(() => window.captureConstraints);
    assert(constraints.some((c) => c.audio?.deviceId?.ideal === mic));
    assert(constraints.some((c) => c.video?.deviceId?.ideal === camera));
    await owner
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
    await owner.getByRole("button", { name: "general", exact: true }).click();
    await owner.evaluate(() => {
      window.testFocused = false;
    });
    // New DM discovery uses the normal history refresh and does not require opening the DM.
    await alice
      .getByRole("button", { name: "New direct message", exact: true })
      .click();
    await alice.getByLabel("Find people").fill("owner");
    await alice.locator(".people-list input[type=checkbox]").check();
    await alice
      .getByRole("button", { name: "Start conversation", exact: true })
      .click();
    await expect(alice.getByRole("dialog")).toHaveCount(0);
    await expect(alice.locator(".conversation-head h1")).toHaveText("owner");
    await send(alice, "New direct message notification");
    await owner.getByRole("button", { name: "Refresh conversations" }).click();
    await count(owner, 1);
    await owner
      .getByRole("button", { name: "Notifications (1)", exact: true })
      .click();
    await expect(owner.getByRole("dialog")).toContainText(
      "New direct message notification",
    );
    await owner.locator(".notification-inbox button").click();
    await expect(
      owner
        .locator(".message-body")
        .filter({ hasText: "New direct message notification" }),
    ).toBeVisible();
    await count(owner, 0);
    await settings(owner);
    await owner.screenshot({ path: "test-results/client-notifications.png" });
    await owner.setViewportSize({ width: 390, height: 844 });
    assert(
      await owner
        .getByRole("dialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      "Client settings fit a narrow screen",
    );
    await owner.screenshot({
      path: "test-results/client-notifications-mobile.png",
    });
    await close(owner);
    assert.deepEqual(errors, []);
    console.log(
      "PASS client notifications: mention autocomplete/highlights, sound playback, rules/mutes, popup permission/privacy/click, custom audio persistence, device capture preferences, silent reload and new DM discovery",
    );
  } catch (error) {
    for (const [i, context] of contexts.entries())
      for (const [j, page] of context.pages().entries())
        await page
          .screenshot({
            path: `test-results/notifications-failure-${i}-${j}.png`,
          })
          .catch(() => {});
    throw error;
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}
export async function checkDesktopNotifications(desktop, page, fixture) {
  await desktop.evaluate(({ Notification, app }) => {
    globalThis.hauntBadgeTest = [];
    app.setBadgeCount = (count) => {
      globalThis.hauntBadgeTest.push(count);
      return true;
    };
    globalThis.hauntNotificationTest = [];
    Notification.isSupported = () => true;
    Notification.prototype.show = function () {
      globalThis.hauntNotificationTest.push(this);
    };
    Notification.prototype.close = function () {};
  });
  assert.equal(
    await desktop.evaluate(async ({ BrowserWindow, app }) => {
      const untrusted = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: `${app.getAppPath()}/apps/desktop/preload.cjs`,
          partition: "persist:chatxo",
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      try {
        await untrusted.loadURL("https://app.chatxo.local");
        return await untrusted.webContents.executeJavaScript(
          "window.hauntDesktop.notificationAvailable().then(() => false, () => true)",
        );
      } finally {
        untrusted.destroy();
      }
    }),
    true,
    "A different renderer cannot invoke notification IPC",
  );
  const badge = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    return { count: 23, unread: true, icon: canvas.toDataURL("image/png") };
  });
  await page.evaluate((value) => window.hauntDesktop.setBadge(value), badge);
  assert.equal(
    await desktop.evaluate(() => globalThis.hauntBadgeTest.at(-1)),
    23,
  );
  await page.evaluate((value) => window.hauntDesktop.setBadge(value), badge);
  assert.equal(
    await desktop.evaluate(
      () => globalThis.hauntBadgeTest.filter((n) => n === 23).length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(
      async (value) =>
        window.hauntDesktop.setBadge({ ...value, count: -1 }).then(
          () => false,
          () => true,
        ),
      badge,
    ),
    true,
  );
  assert.equal(
    await page.evaluate(
      async (value) =>
        window.hauntDesktop
          .setBadge({ ...value, icon: "https://untrusted.test/icon.png" })
          .then(
            () => false,
            () => true,
          ),
      badge,
    ),
    true,
  );
  await page.evaluate(
    (value) =>
      window.hauntDesktop.setBadge({ ...value, count: 0, unread: false }),
    badge,
  );
  const payload = {
    title: "Alice · #general",
    body: "Desktop ping",
    instance: fixture.instance,
    conversation: fixture.general,
  };
  assert.equal(
    await page.evaluate(() => window.hauntDesktop.notificationAvailable()),
    true,
  );
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.hauntDesktop.showNotification({ title: "bad" });
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  await page.evaluate(
    (value) => window.hauntDesktop.showNotification(value),
    payload,
  );
  await desktop.evaluate(() => {
    if (globalThis.hauntNotificationTest.length !== 1)
      throw Error("Missing native notification");
    globalThis.hauntNotificationTest[0].emit("click");
  });
  await expect(page.locator(".community-head h2")).toHaveText(fixture.name);
  await expect(page.locator(".conversation-head h1")).toHaveText("general");
  await expect(page.locator(".call-panel")).toHaveCount(0);
  console.log(
    "PASS desktop notification and badge IPC: validated/coalesced badges, payloads and native click routing (OS display mocked)",
  );
}
