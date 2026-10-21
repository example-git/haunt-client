import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

assert.equal(process.env.CI, "true", "Use a disposable Fedora CI container");
const mode = process.argv[2];
assert(["write", "read"].includes(mode));
const profile = path.join(os.homedir(), ".config/haunt");
const app = await electron.launch({
  executablePath: "/opt/Haunt/haunt",
  timeout: 60000,
});
try {
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
    await fs.writeFile(
      `test-results/fedora-rpm-${process.arch}.json`,
      JSON.stringify(
        {
          passed: true,
          distribution: (await fs.readFile("/etc/os-release", "utf8")).trim(),
          ...actual,
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
  await app.close();
}
