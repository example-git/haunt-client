import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
export async function checkPlugins(page, fixtures, label = "browser") {
  page.setDefaultTimeout(20000);
  const errors = [],
    downloads = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/audio-plugins/") && r.url().endsWith(".wasm"))
      downloads.push(r.url());
  });
  const instrument = () => {
    const Original = window.Worker;
    window.pluginTerminations = 0;
    window.blockPluginHeartbeat = false;
    window.Worker = class extends Original {
      constructor(url, ...args) {
        super(url, ...args);
        this.plugin = String(url).includes("processor-worker");
        this.addEventListener("message", (event) => {
          if (this.plugin && window.blockPluginHeartbeat)
            event.stopImmediatePropagation();
        });
      }
      terminate() {
        if (this.plugin) window.pluginTerminations++;
        return super.terminate();
      }
    };
  };
  await page.addInitScript(instrument);
  await page.evaluate(instrument);
  const login = async (server) => {
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await page.getByLabel("Server address").fill(server.url);
    await page.getByLabel("Username", { exact: true }).fill("owner");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
  };
  await login(fixtures.rtc);
  const settings = async () => {
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Server audio plugins", exact: true })
      .click();
  };
  await settings();
  await expect(
    page.getByText("Input level · after audio plugin", { exact: true }),
  ).toBeVisible();
  const level = page.getByRole("slider", {
    name: "Plugin output level",
    exact: true,
  });
  await level.focus();
  await level.press("Home");
  for (let i = 0; i < 37; i++) await level.press("ArrowRight");
  await expect(level).toHaveValue("37");
  await page
    .getByRole("button", { name: "Listen to microphone", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop listening", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  // Cached bytes survive a full reload; no model download on an ordinary reopen.
  const count = downloads.length;
  assert.equal(count, 1);
  await page.reload();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await settings();
  await expect(level).toHaveValue("37");
  await expect(
    page.getByText("Input level · after audio plugin", { exact: true }),
  ).toBeVisible();
  assert.equal(downloads.length, count);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await login(fixtures.ws);
  await settings();
  await expect(level).toHaveValue("100");
  await level.focus();
  await level.press("Home");
  for (let i = 0; i < 61; i++) await level.press("ArrowRight");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
    .click();
  await settings();
  await expect(level).toHaveValue("37");
  await page
    .getByRole("button", { name: "Reset noise defaults", exact: true })
    .click();
  await expect(level).toHaveValue("100");
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  await expect(
    page.getByLabel("Noise suppression", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Noise processing model", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".microphone-monitor")).toHaveAttribute(
    "data-noise-suppression",
    "active",
  );
  await expect(
    page.getByRole("button", { name: "Listen to microphone", exact: true }),
  ).toBeEnabled();
  const before = await page.evaluate(() => window.pluginTerminations);
  const stableTrack = await page
    .locator('audio[aria-label="Microphone playback test"]')
    .evaluate((el) => el.srcObject.getAudioTracks()[0].id);
  await page.evaluate(() => {
    window.blockPluginHeartbeat = true;
  });
  await expect(page.locator(".microphone-monitor")).toHaveAttribute(
    "data-noise-suppression",
    "fallback",
  );
  assert(
    (await page.evaluate(() => window.pluginTerminations)) > before,
    "Stalled worker must be terminated",
  );
  assert.equal(
    await page
      .locator('audio[aria-label="Microphone playback test"]')
      .evaluate((el) => el.srcObject.getAudioTracks()[0].id),
    stableTrack,
    "Worker failure keeps the same microphone track",
  );
  await page.evaluate(() => {
    window.blockPluginHeartbeat = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".microphone-monitor")).toHaveAttribute(
    "data-noise-suppression",
    "active",
  );
  await page.screenshot({ path: `test-results/audio-plugins-${label}.png` });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  // Owner controls use the same restricted package API; remove and reinstall
  // without restarting either service or client.
  await page
    .getByRole("button", { name: "Server settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Audio plugins", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove plugin", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Audio plugin removed.");
  await expect(
    page.getByRole("button", { name: "Remove plugin", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Install audio plugin", { exact: true })
    .setInputFiles(
      fileURLToPath(
        new URL(
          "../tests/fixtures/audio-plugin/test-audio.zip",
          import.meta.url,
        ),
      ),
    );
  await expect(page.getByRole("status")).toHaveText("Audio plugin installed.");
  await expect(
    page.getByRole("button", { name: "Remove plugin", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await settings();
  await expect(level).toHaveValue("100");
  await expect(page.locator(".microphone-monitor")).toHaveAttribute(
    "data-noise-suppression",
    "active",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      check: "audio-plugins",
      client: label,
      cacheReload: true,
      serverIsolation: true,
      workerPCM: true,
      passed: true,
    }),
  );
}
