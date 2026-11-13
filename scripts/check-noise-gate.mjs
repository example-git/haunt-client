import { expect } from "@playwright/test";
import { fillSignin } from "./signin-fields.mjs";
import { speechPeak } from "./check-noise.mjs";

export async function checkNoiseGate(sender, browser, fixtures, label) {
  sender.setDefaultTimeout(15000);
  const settings = async (tab = "Devices") => {
    await sender
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await sender.getByRole("button", { name: tab, exact: true }).click();
  };
  const close = () =>
    sender.getByRole("button", { name: "Close", exact: true }).click();
  const login = async (page, server, username) => {
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, server.url, username);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    const dismiss = page.getByRole("button", {
      name: "Dismiss member list",
      exact: true,
    });
    if (await dismiss.isVisible()) await dismiss.click();
  };
  for (const server of [fixtures.rtc, fixtures.ws]) {
    const context = await browser.newContext({ permissions: ["microphone"] });
    const receiver = await context.newPage();
    try {
      await receiver.goto(server.url);
      if (label === "browser") await sender.goto(server.url);
      await login(receiver, server, "bob");
      await login(sender, server, "alice");
      await sender.evaluate(() => {
        window.gateTestNodes = [];
        const Node = window.AudioWorkletNode;
        window.AudioWorkletNode = class extends Node {
          constructor(context, name, options) {
            super(context, name, options);
            window.gateTestNodes.push({ node: this, name });
          }
        };
      });
      await settings();
      await sender.getByLabel("Noise gate", { exact: true }).uncheck();
      await sender.getByLabel("Automatic gain", { exact: true }).uncheck();
      await close();
      for (const page of [receiver, sender])
        await page
          .locator(`[data-channel-id="${server.voice}"] button.channel`)
          .click();
      await expect(sender.locator(".call-panel")).toContainText(
        "2 in the room",
      );
      await expect(receiver.locator(".call-panel")).toContainText(
        "2 in the room",
      );
      await expect(sender.locator(".call-panel")).toHaveAttribute(
        "data-noise-suppression",
        "active",
      );
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
      await settings();
      await sender.getByLabel("Noise gate", { exact: true }).check();
      const threshold = sender.getByRole("slider", {
        name: "Noise gate threshold",
        exact: true,
      });
      await threshold.focus();
      await threshold.press("End");
      await expect.poll(() => speechPeak(receiver)).toBeLessThan(0.0001);
      await expect(
        sender.getByLabel("Noise gate state", { exact: true }),
      ).toHaveText("Closed");
      await expect
        .poll(async () =>
          Number(
            await sender
              .getByRole("meter", {
                name: "Microphone level before gate",
                exact: true,
              })
              .getAttribute("aria-valuenow"),
          ),
        )
        .toBeGreaterThan(0);
      await expect
        .poll(async () =>
          Number(
            await sender
              .getByRole("meter", {
                name: "Microphone input level",
                exact: true,
              })
              .getAttribute("aria-valuenow"),
          ),
        )
        .toBe(0);
      await threshold.press("Home");
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
      await threshold.press("End");
      await sender.getByLabel("Noise suppression", { exact: true }).uncheck();
      await expect.poll(() => speechPeak(receiver)).toBeLessThan(0.0001);
      await sender.getByLabel("Noise suppression", { exact: true }).check();
      await expect(sender.locator(".microphone-monitor")).toHaveAttribute(
        "data-noise-suppression",
        "active",
      );
      await expect.poll(() => speechPeak(receiver)).toBeLessThan(0.0001);
      await sender
        .getByRole("button", { name: "Server audio plugins", exact: true })
        .click();
      await expect(
        sender.getByRole("slider", {
          name: "Noise gate threshold",
          exact: true,
        }),
      ).toHaveValue("0");
      await sender
        .getByRole("slider", { name: "Noise gate threshold", exact: true })
        .press("Home");
      const plugin = sender.getByRole("slider", {
        name: "Plugin output level",
        exact: true,
      });
      await plugin.focus();
      await plugin.press("Home");
      await expect.poll(() => speechPeak(receiver)).toBeLessThan(0.0001);
      await plugin.press("End");
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
      await sender
        .getByRole("slider", { name: "Noise gate threshold", exact: true })
        .press("End");
      await sender.evaluate(() => {
        for (const { node, name } of window.gateTestNodes)
          if (name === "haunt-audio-plugin-v1")
            node.dispatchEvent(new Event("processorerror"));
      });
      await expect(sender.locator(".call-panel")).toHaveAttribute(
        "data-noise-suppression",
        "fallback",
      );
      await expect.poll(() => speechPeak(receiver)).toBeLessThan(0.0001);
      await sender
        .getByRole("button", { name: "Devices", exact: true })
        .click();
      const captures = await sender.evaluate(() => {
        const count = window.gateTestNodes.filter(
          ({ name }) => name === "haunt-noise-gate",
        ).length;
        navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
        return count;
      });
      await expect
        .poll(() =>
          sender.evaluate(
            () =>
              window.gateTestNodes.filter(
                ({ name }) => name === "haunt-noise-gate",
              ).length,
          ),
        )
        .toBeGreaterThan(captures);
      await expect(sender.locator(".call-panel")).toHaveAttribute(
        "data-noise-suppression",
        "active",
      );
      await expect(
        sender.getByRole("button", {
          name: "Listen to microphone",
          exact: true,
        }),
      ).toBeEnabled();
      await expect.poll(() => speechPeak(receiver)).toBeLessThan(0.0001);
      await sender
        .getByRole("slider", { name: "Noise gate threshold", exact: true })
        .press("Home");
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
      await sender.evaluate(() => {
        for (const { node, name } of window.gateTestNodes)
          if (name === "haunt-noise-gate")
            node.dispatchEvent(new Event("processorerror"));
      });
      await expect(
        sender
          .getByRole("alert")
          .filter({ hasText: "Noise gate unavailable" })
          .first(),
      ).toBeVisible();
      await expect.poll(() => speechPeak(receiver)).toBeLessThan(0.0001);
      await sender.getByLabel("Noise gate", { exact: true }).uncheck();
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
      await close();
      for (const page of [sender, receiver])
        await page
          .locator(".call-dock")
          .getByRole("button", { name: "Leave call", exact: true })
          .click();
      console.log(
        `PASS ${label} ${server.name}: gate, preview, plugin controls/fallback, device replacement, failure recovery and received audio`,
      );
    } finally {
      await context.close();
    }
  }
}
