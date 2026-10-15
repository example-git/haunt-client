// Run on the Windows CI runner after packaging, using only its new temporary profile.
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
if (process.platform !== "win32")
  throw Error("This check targets the Windows CI runner.");
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-startup-"));
let app;
try {
  app = await electron.launch({
    executablePath: path.resolve("release/builder/win-unpacked/haunt.exe"),
    args: [`--user-data-dir=${profile}`],
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await expect(page.locator(".app-titlebar")).toBeVisible({ timeout: 60_000 });
  const state = await page.evaluate(() => window.hauntDesktop.updates.state());
  assert.equal(
    state.current,
    JSON.parse(await fs.readFile("package.json", "utf8")).version,
  );
  assert.equal(state.phase, "idle");
  await page.evaluate(() => window.hauntDesktop.updates.healthy());
  await page.evaluate(() => window.hauntDesktop.windowControl("close", "main"));
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  assert.equal(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
    1,
  );
  await app.evaluate(({ app }) => app.emit("activate"));
  await expect(page.locator(".app-titlebar")).toBeVisible();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    true,
  );
  console.log(
    "Packaged Windows bootstrap, preload, web interface, update IPC and close-to-tray/restore lifecycle are ready.",
  );
} finally {
  await app?.close();
  await fs.rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 300,
  });
}
