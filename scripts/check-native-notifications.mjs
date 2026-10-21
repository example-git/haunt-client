import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkMessageBadges } from "./check-message-badges.mjs";

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
  const run = promisify(execFile);
  const data = path.join(scratch, "xdg-data");
  const config = path.join(scratch, "xdg-config");
  // BAMF watches application directories present at session startup.
  await fs.mkdir(path.join(data, "applications"), { recursive: true });
  await fs.mkdir(config, { recursive: true });
  process.env.XDG_DATA_HOME = data;
  process.env.XDG_CONFIG_HOME = config;
  await run("dbus-update-activation-environment", [
    "XDG_DATA_HOME",
    "XDG_CONFIG_HOME",
    "DISPLAY",
    "XAUTHORITY",
  ]);
  await fs.mkdir("test-results", { recursive: true });
  const desktopLog = openSync(
    `test-results/message-badge-linux-${process.arch}-desktop.log`,
    "a",
  );
  const wm = spawn("openbox", ["--sm-disable"], {
    stdio: ["ignore", desktopLog, desktopLog],
  });
  const schema =
    "net.launchpad.plank.dock.settings:/net/launchpad/plank/docks/hauntci/";
  await run("gsettings", ["set", schema, "hide-mode", "none"]);
  await run("gsettings", ["set", schema, "icon-size", "64"]);
  const dock = spawn("plank", ["--name=hauntci", "--debug"], {
    stdio: ["ignore", desktopLog, desktopLog],
  });
  closeSync(desktopLog);
  await expect
    .poll(
      async () => {
        if (dock.exitCode !== null)
          throw Error(`Plank exited during startup: ${dock.exitCode}`);
        const { stdout } = await run("dbus-send", [
          "--session",
          "--print-reply",
          "--dest=org.freedesktop.DBus",
          "/org/freedesktop/DBus",
          "org.freedesktop.DBus.NameHasOwner",
          "string:com.canonical.Unity",
        ]);
        return stdout.includes("boolean true");
      },
      { timeout: 30000 },
    )
    .toBe(true)
    .catch((error) => {
      dock.kill();
      wm.kill();
      throw error;
    });
  const log = path.join(scratch, "native-notifications.jsonl");
  const child = spawn(
    "/usr/bin/python3",
    ["scripts/native-notification-daemon.py", log, "--observe-launcher"],
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
    dock.kill();
    wm.kill();
    throw error;
  }
  return {
    records,
    desktop,
    stop: () => {
      child.kill();
      dock.kill();
      wm.kill();
    },
    async installedLauncher(executablePath, windowId) {
      const filename = path.join(data, "applications", desktop);
      const entry = await fs.readFile(filename, "utf8");
      const windowIdentity = (
        await run("xprop", [
          "-id",
          `0x${windowId.toString(16)}`,
          "WM_CLASS",
          "_NET_WM_PID",
          "_GTK_APPLICATION_ID",
        ])
      ).stdout;
      console.log("Haunt native window identity:", windowIdentity);
      assert(
        windowIdentity.includes('"com.exampleuser.haunt"'),
        "The running window matches the installed desktop identity",
      );
      assert.match(entry, /StartupWMClass=com\.exampleuser\.haunt/);
      assert.match(entry, /X-Haunt-Managed=true/);
      assert(
        entry.includes(executablePath),
        "Launcher targets the actual installed AppImage",
      );
      await run("desktop-file-validate", [filename]);
      const icon = entry.match(/^Icon=(.+)$/m)?.[1];
      assert(
        icon && (await fs.stat(icon)).size > 0,
        "Installed icon exists outside the AppImage mount",
      );
      const uri = pathToFileURL(filename).href;
      const dockCall = async (method, ...args) =>
        (
          await run("gdbus", [
            "call",
            "--session",
            "--dest",
            "net.launchpad.plank.hauntci",
            "--object-path",
            "/net/launchpad/plank/hauntci",
            "--method",
            `net.launchpad.plank.Items.${method}`,
            ...args,
          ])
        ).stdout;
      assert(
        (await dockCall("Add", uri)).includes("true"),
        "The real dock accepted Haunt's installed launcher",
      );
      await expect
        .poll(() => dockCall("GetPersistentApplications"))
        .toContain(uri);
      const pinned = await dockCall("GetPersistentApplications");
      const matchedWindow = async () => {
        const { stdout: application } = await run("gdbus", [
          "call",
          "--session",
          "--dest",
          "org.ayatana.bamf",
          "--object-path",
          "/org/ayatana/bamf/matcher",
          "--method",
          "org.ayatana.bamf.matcher.ApplicationForXid",
          String(windowId),
        ]);
        const object = application.match(
          /'(\/org\/ayatana\/bamf\/application\/[^']+)'/,
        )?.[1];
        if (!object) return application;
        return (
          await run("gdbus", [
            "call",
            "--session",
            "--dest",
            "org.ayatana.bamf",
            "--object-path",
            object,
            "--method",
            "org.ayatana.bamf.application.DesktopFile",
          ])
        ).stdout;
      };
      await expect.poll(matchedWindow).toContain(filename);
      const windowLauncher = await matchedWindow();

      return {
        filename,
        entry,
        icon,
        appImage: executablePath,
        pinned,
        windowIdentity,
        windowLauncher,
        desktop: "Plank / Openbox",
      };
    },
    async capture(filename) {
      // Capture the real dock/window manager, not a renderer-made badge.
      await run("import", ["-window", "root", filename]);
    },
  };
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
  await checkMessageBadges(app, page, fixture, report);
  if (process.platform === "darwin" || process.platform === "linux") {
    report.withoutArtwork = {};
    await checkMessageBadges(app, page, fixture, report.withoutArtwork, {
      withoutArtwork: true,
    });
  }
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
    for (const notification of delivered) {
      assert.equal(notification.app, "Haunt");
      assert.equal(notification.desktopEntry, "com.exampleuser.haunt");
      assert.equal(notification.transient, false);
    }
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
