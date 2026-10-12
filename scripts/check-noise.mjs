import { expect } from "@playwright/test";
import assert from "node:assert/strict";
export async function speechPeak(page) {
  return page
    .locator('.call-panel audio[aria-label$=" · audio"]')
    .first()
    .evaluate(async (el) => {
      const ctx = new AudioContext(),
        source = ctx.createMediaStreamSource(el.srcObject),
        meter = ctx.createAnalyser();
      source.connect(meter);
      await ctx.resume();
      const data = new Float32Array(512);
      meter.fftSize = 512;
      let peak = 0;
      try {
        for (let i = 0; i < 20; i++) {
          meter.getFloatTimeDomainData(data);
          for (const x of data) peak = Math.max(peak, Math.abs(x));
          await new Promise((r) => setTimeout(r, 30));
        }
      } finally {
        source.disconnect();
        await ctx.close();
      }
      return peak;
    });
}
export async function checkNoise(browser, fixtures) {
  for (const server of [fixtures.rtc, fixtures.ws]) {
    const contexts = await Promise.all([
      browser.newContext({ permissions: ["microphone", "camera"] }),
      browser.newContext({ permissions: ["microphone", "camera"] }),
    ]);
    try {
      const [alice, bob] = await Promise.all(contexts.map((c) => c.newPage()));
      for (const [page, name] of [
        [alice, "alice"],
        [bob, "bob"],
      ]) {
        await page.goto("http://127.0.0.1:5173");
        await page
          .getByRole("button", { name: "Add server", exact: true })
          .click();
        await page.getByLabel("Server address").fill(server.url);
        await page.getByLabel("Username", { exact: true }).fill(name);
        await page
          .getByLabel("Password", { exact: true })
          .fill(fixtures.password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expect(page.locator(".connection")).toHaveText("Connected");
        await page
          .locator(`[data-channel-id="${server.voice}"] button.channel`)
          .click();
      }
      for (const page of [alice, bob]) {
        await expect(page.locator(".call-panel")).toContainText(
          "2 in the room",
        );
        await expect(page.locator(".call-panel")).toHaveAttribute(
          "data-noise-suppression",
          "active",
        );
      }
      assert(
        (await speechPeak(bob)) > 0.01,
        "Processed microphone must reach the other participant",
      );
      await alice
        .getByRole("button", { name: "Account settings", exact: true })
        .click();
      await alice
        .getByRole("button", { name: "Server audio plugins", exact: true })
        .click();
      const level = alice.getByRole("slider", {
        name: "Plugin output level",
        exact: true,
      });
      await level.focus();
      await level.press("Home");
      await expect
        .poll(() => speechPeak(bob), { timeout: 10000 })
        .toBeLessThan(0.001);
      await level.press("End");
      await expect.poll(() => speechPeak(bob)).toBeGreaterThan(0.01);
      await alice.getByRole("button", { name: "Devices", exact: true }).click();
      await alice.getByLabel("Noise suppression", { exact: true }).uncheck();
      await expect(alice.locator(".call-panel")).toHaveAttribute(
        "data-noise-suppression",
        "off",
      );
      assert((await speechPeak(bob)) > 0.01);
      await alice.getByLabel("Noise suppression", { exact: true }).check();
      await expect(alice.locator(".call-panel")).toHaveAttribute(
        "data-noise-suppression",
        "active",
      );
      await alice.getByRole("button", { name: "Close", exact: true }).click();
      for (const page of [alice, bob])
        await page
          .locator(".call-dock")
          .getByRole("button", { name: "Leave call", exact: true })
          .click();
      console.log(
        `PASS ${server.name}: plugin audio delivery, live controls and bypass`,
      );
    } finally {
      for (const context of contexts) await context.close();
    }
  }
}
