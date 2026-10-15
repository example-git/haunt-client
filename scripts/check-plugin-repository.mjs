import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { fillSignin } from "./signin-fields.mjs";

export async function checkPluginRepository(page, fixtures) {
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await fillSignin(page, fixtures.rtc.url, "owner");
  await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await page
    .getByRole("button", { name: "Server settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Audio plugins", exact: true })
    .click();
  await page
    .getByLabel("Repository URL")
    .fill(process.env.HAUNT_TEST_PLUGIN_REPOSITORY);
  await page.getByLabel("Commit ID").fill("main");
  await page
    .getByLabel("Package SHA-256")
    .fill(process.env.HAUNT_TEST_PLUGIN_HASH);
  await expect(
    page.getByRole("button", { name: "Install verified plugin" }),
  ).toBeDisabled();
  await page
    .getByLabel("Commit ID")
    .fill(process.env.HAUNT_TEST_PLUGIN_REVISION);
  await page.getByRole("button", { name: "Install verified plugin" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "Verified audio plugin installed.",
    { timeout: 110000 },
  );
  await expect(
    page.getByRole("button", { name: "Remove plugin", exact: true }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const settings = async () => {
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Server audio plugins", exact: true })
      .click();
  };
  await settings();
  const plugin = page.getByLabel("Active Server Audio Plugin:", {
    exact: true,
  });
  const choices = await plugin
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => ({ id: o.value, name: o.textContent })),
    );
  assert.equal(choices.length, 2);
  const original = choices.find((o) => o.id !== "rnnoise").id;
  await plugin.selectOption("rnnoise");
  await expect(
    page.getByRole("slider", { name: "Suppression strength", exact: true }),
  ).toHaveValue("100");
  await expect(page.locator(".microphone-monitor")).toHaveAttribute(
    "data-noise-suppression",
    "active",
    { timeout: 60000 },
  );
  await page
    .getByLabel("Noise processing model", { exact: true })
    .selectOption("little");
  await expect(page.locator(".microphone-monitor")).toHaveAttribute(
    "data-noise-suppression",
    "active",
  );
  await plugin.selectOption(original);
  await expect(
    page.getByRole("slider", { name: "Plugin output level", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".microphone-monitor")).toHaveAttribute(
    "data-noise-suppression",
    "active",
  );
  await plugin.selectOption("rnnoise");
  await expect(
    page.getByLabel("Noise processing model", { exact: true }),
  ).toHaveValue("little");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
    .click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await settings();
  await expect(plugin).toHaveValue("rnnoise");
  await expect(
    page.getByLabel("Noise processing model", { exact: true }),
  ).toHaveValue("little");
  await expect(page.locator(".microphone-monitor")).toHaveAttribute(
    "data-noise-suppression",
    "active",
  );
  await page.screenshot({ path: "test-results/rnnoise-multiple-plugins.png" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      check: "plugin-repository",
      pinnedInstall: true,
      sandboxPCM: true,
      multiplePlugins: true,
      cachedReload: true,
      passed: true,
    }),
  );
}
