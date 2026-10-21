import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkMessageBadges } from "./check-message-badges.mjs";
import { checkNotificationMessages } from "./check-notification-messages.mjs";
import { nativeNotificationUI } from "./native-notification-ui.mjs";

export async function prepareNativeNotifications(scratch, executable) {
  const ui = nativeNotificationUI(`${process.platform}-${process.arch}`);
  if (process.platform !== "linux") return { ...ui, stop() {} };
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
  const daemon = spawn("dunst", [], { stdio: ["ignore", "ignore", "inherit"] });
  await expect
    .poll(async () => {
      const { stdout } = await run("dbus-send", [
        "--session",
        "--print-reply",
        "--dest=org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus.NameHasOwner",
        "string:org.freedesktop.Notifications",
      ]);
      return stdout.includes("boolean true");
    })
    .toBe(true);
  const log = path.join(scratch, "native-notifications.jsonl");
  const child = spawn(
    "/usr/bin/python3",
    ["scripts/native-notification-observer.py", log],
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
    daemon.kill();
    dock.kill();
    wm.kill();
    throw error;
  }
  return {
    ...ui,
    records,
    desktop,
    stop: () => {
      child.kill();
      daemon.kill();
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
  await checkNotificationMessages(app, page, fixture, report);
  report.notificationDisplay =
    "Real desktop popups captured and read; native popup click opened its conversation.";
  report.nativeScreenshots = fixture.artifacts;
  return report;
}
