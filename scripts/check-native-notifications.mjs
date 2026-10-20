import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

export async function prepareNativeNotifications(scratch, executable) {
  if (process.platform !== "linux") return { stop() {} };
  assert(
    process.env.DBUS_SESSION_BUS_ADDRESS,
    "Use a private dbus-run-session on Linux",
  );
  // Electron loads libnotify dynamically, so missing it does not stop startup.
  // Require the actual system library before testing native popup delivery.
  await promisify(execFile)("/usr/bin/python3", [
    "-c",
    "import ctypes; ctypes.CDLL('libnotify.so.4')",
  ]);
  const desktop = "com.exampleuser.haunt.desktop";
  const entry = await fs.readFile(
    path.join(path.dirname(executable), desktop),
    "utf8",
  );
  assert.match(entry, /StartupWMClass=com\.exampleuser\.haunt/);
  const data = path.join(scratch, "xdg-data");
  await fs.mkdir(path.join(data, "applications"), { recursive: true });
  await fs.writeFile(path.join(data, "applications", desktop), entry);
  process.env.XDG_DATA_HOME = data;
  const log = path.join(scratch, "native-notifications.jsonl");
  const child = spawn(
    "/usr/bin/python3",
    ["scripts/native-notification-daemon.py", log],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const records = async () =>
    (await fs.readFile(log, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  try {
    await expect
      .poll(async () => (await records()).some((r) => r.kind === "ready"))
      .toBe(true);
  } catch (error) {
    child.kill();
    throw error;
  }
  return { records, stop: () => child.kill(), desktop };
}

export async function checkNativeNotifications(
  app,
  page,
  fixture,
  report = {},
) {
  Object.assign(report, {
    platform: process.platform,
    nativeBadges: [],
    notificationDisplay: "not visually verified",
  });
  for (const [count, unread] of [
    [7, true],
    [0, true],
    [0, false],
  ]) {
    await page.evaluate(
      async ({ count, unread }) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const icon = canvas.toDataURL("image/png");
        await window.hauntDesktop.setBadge({
          count,
          unread,
          icon,
          overlay: icon,
        });
      },
      { count, unread },
    );
    if (process.platform === "darwin") {
      const actual = await app.evaluate(({ app }) => app.dock.getBadge());
      assert.equal(actual, count ? String(count) : unread ? "•" : "");
      report.nativeBadges.push({ count, unread, dock: actual });
    } else if (process.platform === "linux") {
      await expect
        .poll(
          async () =>
            (await fixture.records()).filter((r) => r.kind === "badge").at(-1)
              ?.count,
        )
        .toBe(count);
      const signal = (await fixture.records())
        .filter((r) => r.kind === "badge")
        .at(-1);
      assert.equal(signal.application, `application://${fixture.desktop}`);
      assert.equal(signal.visible, count > 0);
      report.nativeBadges.push(signal);
    }
  }
  if (process.platform === "linux") {
    const first = "00000000-0000-0000-0000-000000000001",
      second = "00000000-0000-0000-0000-000000000002";
    await page.evaluate(
      async ({ first, second }) => {
        window.nativeNotificationClicks = [];
        window.hauntDesktop.onNotificationClick((value) =>
          window.nativeNotificationClicks.push(value),
        );
        await Promise.all(
          [first, second].map((conversation) =>
            window.hauntDesktop.showNotification({
              title: `Native message ${conversation}`,
              body: "Delivered through Electron and the system bus",
              instance: "native-fixture",
              conversation,
            }),
          ),
        );
      },
      { first, second },
    );
    await expect
      .poll(
        async () =>
          (await fixture.records()).filter((r) => r.kind === "notification")
            .length,
      )
      .toBe(2);
    const delivered = (await fixture.records()).filter(
      (r) => r.kind === "notification",
    );
    for (const notification of delivered)
      assert.equal(notification.app, "Haunt");
    const clicked = delivered.find(
      (r) => r.title === `Native message ${second}`,
    );
    assert(clicked, "The second conversation was delivered independently");
    assert(
      clicked.actions.includes("default"),
      "Electron registered the default notification click action",
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].hide(),
    );
    await promisify(execFile)("dbus-send", [
      "--session",
      "--type=method_call",
      "--print-reply",
      "--reply-timeout=5000",
      "--dest=org.freedesktop.Notifications",
      "/org/freedesktop/Notifications",
      "vg.xo.haunt.Test.Activate",
      `uint32:${clicked.id}`,
    ]);
    await expect
      .poll(async () =>
        (await fixture.records()).some(
          (r) => r.kind === "activate" && r.id === clicked.id,
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.nativeNotificationClicks.length))
      .toBe(1);
    assert.deepEqual(
      await page.evaluate(() => window.nativeNotificationClicks[0]),
      { instance: "native-fixture", conversation: second },
    );
    assert(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    );
    report.systemBusDelivery = delivered;
    report.clickRestoresWindow = true;
  } else if (process.platform === "darwin") {
    // The runner may deny banners. Record the actual acknowledgement/error;
    // never equate a constructor or API call with visible Notification Center UI.
    report.notificationAcknowledgement = await page.evaluate(() =>
      window.hauntDesktop
        .testNotification()
        .catch((error) => `System declined: ${error.message}`),
    );
  }
  return report;
}
