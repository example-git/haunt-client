import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { nativeNotificationUI } from "./native-notification-ui.mjs";
import { checkNotificationMessages } from "./check-notification-messages.mjs";

assert.equal(process.env.CI, "true", "Use a disposable Fedora CI container");
const mode = process.argv[2];
assert(["write", "read", "complete"].includes(mode));
const profile = path.join(os.homedir(), ".config/haunt");
const notificationLog = path.join(
  os.homedir(),
  `rpm-notifications-${mode}.jsonl`,
);
await fs.rm(notificationLog, { force: true });
const runtime = path.join(os.homedir(), ".run");
await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
process.env.XDG_RUNTIME_DIR = runtime;
process.env.XDG_CURRENT_DESKTOP = "KDE";
process.env.QT_QUICK_BACKEND = "software";
process.env.KWIN_COMPOSE = "N";
const desktop = spawn("startplasma-x11", [], {
  stdio: ["ignore", "inherit", "inherit"],
  env: process.env,
});
await expect
  .poll(
    async () => {
      const { stdout } = await promisify(execFile)("dbus-send", [
        "--session",
        "--print-reply",
        "--dest=org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus.NameHasOwner",
        "string:org.freedesktop.Notifications",
      ]);
      return stdout.includes("boolean true");
    },
    { timeout: 60000 },
  )
  .toBe(true);
const daemon = spawn(
  "python3",
  ["scripts/native-notification-observer.py", notificationLog],
  { stdio: ["ignore", "inherit", "inherit"] },
);
const records = async () =>
  (await fs.readFile(notificationLog, "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
let app;
try {
  await expect
    .poll(async () => {
      assert.equal(
        daemon.exitCode,
        null,
        "The isolated D-Bus recorder is running",
      );
      return (await records()).some((record) => record.kind === "ready");
    })
    .toBe(true);
  app = await electron.launch({
    executablePath: "/usr/bin/haunt",
    chromiumSandbox: true,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await expect(page.locator("#root")).not.toBeEmpty({ timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.hauntDesktop));
  const actual = await app.evaluate(({ app }) => ({
    name: app.getName(),
    executable: app.getPath("exe"),
    profile: app.getPath("userData"),
    format: global[Symbol.for("haunt.updater")].updater.config.installerFormat,
  }));
  assert.equal(actual.name, "Haunt");
  assert.equal(actual.executable, "/opt/Haunt/haunt");
  assert.equal(actual.profile, profile);
  assert.equal(actual.format, "rpm");
  const commandLine = await app.evaluate(() => process.argv);
  assert(
    !commandLine.includes("--no-sandbox"),
    "The installed app runs with its real sandbox",
  );
  if (mode === "write") {
    const report = {
      desktop: "Fedora KDE Plasma X11",
      commandLine,
      passed: false,
    };
    const native = {
      ...nativeNotificationUI(`fedora-${process.arch}`),
      records,
      desktop: "com.exampleuser.haunt.desktop",
    };
    try {
      await checkNotificationMessages(app, page, native, report);
      report.passed = true;
    } finally {
      report.bus = await records();
      report.screenshots = native.artifacts;
      await fs.writeFile(
        `test-results/fedora-notifications-${process.arch}.json`,
        JSON.stringify(report, null, 2),
      );
    }
  }
  if (mode === "write")
    await page.evaluate(() =>
      localStorage.setItem("haunt-rpm-install-check", "preserved"),
    );
  else {
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("haunt-rpm-install-check"),
      ),
      "preserved",
    );
  }
  if (mode === "complete") {
    await fs.writeFile(
      `test-results/fedora-rpm-${process.arch}.json`,
      JSON.stringify(
        {
          passed: true,
          distribution: (await fs.readFile("/etc/os-release", "utf8")).trim(),
          ...actual,
          notifications: JSON.parse(
            await fs.readFile(
              `test-results/fedora-notifications-${process.arch}.json`,
              "utf8",
            ),
          ),
          checks: [
            "dnf installation",
            "package-owned launcher and format marker",
            "native Electron startup",
            "RPM updater selection",
            "package replacement preserves launcher and preferences",
            "uninstall preserves profile",
            "reinstall restores preferences",
          ],
        },
        null,
        2,
      ) + "\n",
    );
  }
} finally {
  await app?.close();
  daemon.kill();
  desktop.kill();
}
