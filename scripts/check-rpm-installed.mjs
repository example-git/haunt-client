import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

assert.equal(process.env.CI, "true", "Use a disposable Fedora CI container");
const mode = process.argv[2];
assert(["write", "read", "complete"].includes(mode));
const profile = path.join(os.homedir(), ".config/haunt");
const notificationLog = path.join(
  os.homedir(),
  `rpm-notifications-${mode}.jsonl`,
);
await fs.rm(notificationLog, { force: true });
const daemon = spawn(
  "python3",
  ["scripts/native-notification-daemon.py", notificationLog],
  {
    stdio: ["ignore", "inherit", "inherit"],
  },
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
    executablePath: "/opt/Haunt/haunt",
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
  assert.equal(
    await page.evaluate(() => window.hauntDesktop.testNotification()),
    "shown",
  );
  const notification = (await records()).find(
    (record) => record.kind === "notification",
  );
  assert(
    notification,
    "Electron delivered a notification through Fedora's libnotify",
  );
  assert.equal(notification.desktopEntry, "com.exampleuser.haunt");
  assert.equal(notification.transient, false);
  await page.evaluate(() =>
    window.hauntDesktop.setBadge({ count: 2, unread: true }),
  );
  await expect
    .poll(
      async () =>
        (await records()).filter((record) => record.kind === "badge").at(-1)
          ?.count,
    )
    .toBe(2);
  const badge = (await records())
    .filter((record) => record.kind === "badge")
    .at(-1);
  assert.equal(
    badge.application,
    "application://com.exampleuser.haunt.desktop",
  );
  assert.equal(badge.visible, true);
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
          notifications: {
            transport: "Electron/libnotify to isolated D-Bus recorder",
            notification,
            badge,
            kdeDisplay: "not verified",
          },
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
}
