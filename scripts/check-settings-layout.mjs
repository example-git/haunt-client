import { expect } from "@playwright/test";
import assert from "node:assert/strict";

// Exercise navigation and sizing in the already-owned authenticated fixture.
export async function checkSettingsLayout(page, label) {
  const dialog = page.getByRole("dialog", {
    name: "User settings",
    exact: true,
  });
  const nav = dialog.getByRole("navigation", {
    name: "User settings sections",
  });
  const content = dialog.locator(".settings-content");
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const before = await dialog.boundingBox();
  assert(before.width <= 860);
  assert(
    await dialog.evaluate(
      (element) => parseFloat(getComputedStyle(element).borderRadius) >= 20,
    ),
  );
  assert.equal(
    await nav.locator(".settings-nav-item svg").count(),
    await nav.locator(".settings-nav-item").count(),
  );
  const voiceGroup = nav.getByRole("button", {
    name: "Voice & audio sections",
    exact: true,
  });
  await voiceGroup.click();
  await expect(
    nav.getByRole("button", { name: "Text to speech", exact: true }),
  ).toHaveCount(0);
  await nav.getByLabel("Search settings", { exact: true }).fill("tiktok");
  await expect(
    nav.getByRole("button", { name: "Text to speech", exact: true }),
  ).toBeVisible();
  await expect(nav.locator(".settings-nav-item")).toHaveCount(1);
  await nav
    .getByRole("button", { name: "Clear settings search", exact: true })
    .click();
  await voiceGroup.click();
  await expect(voiceGroup).toHaveAttribute("aria-expanded", "true");
  await nav
    .getByLabel("Search settings", { exact: true })
    .fill("no-such-setting");
  await expect(nav.getByRole("status")).toHaveText("No matching settings.");
  await nav
    .getByRole("button", { name: "Clear settings search", exact: true })
    .click();

  await dialog
    .getByRole("button", { name: "Expand settings", exact: true })
    .click();
  const expanded = await dialog.boundingBox();
  assert(expanded.width > before.width && expanded.height >= before.height);
  await page.screenshot({
    path: `test-results/settings-${label}-expanded.png`,
  });
  await dialog
    .getByRole("button", { name: "Restore settings size", exact: true })
    .click();
  assert.equal((await dialog.boundingBox()).width, before.width);
  const headerY = (await dialog.locator(".dialog-head").boundingBox()).y;
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeVisible();
  assert.equal((await dialog.locator(".dialog-head").boundingBox()).y, headerY);
  await content.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: `test-results/settings-${label}-desktop.png` });

  async function noOverflow() {
    for (const region of [dialog, content])
      assert(
        await region.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
        "settings must fit without horizontal scrolling",
      );
  }
  await noOverflow();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    nav.getByRole("button", { name: "Browse settings", exact: true }),
  ).toBeVisible();
  await noOverflow();
  await page.screenshot({ path: `test-results/settings-${label}-mobile.png` });
  const compactMobile = await dialog.boundingBox();
  await dialog
    .getByRole("button", { name: "Expand settings", exact: true })
    .click();
  const expandedMobile = await dialog.boundingBox();
  assert(
    expandedMobile.width > compactMobile.width &&
      expandedMobile.height > compactMobile.height,
  );
  await dialog
    .getByRole("button", { name: "Restore settings size", exact: true })
    .click();
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await nav
    .getByRole("button", { name: "Browse settings", exact: true })
    .click();
  await nav.getByLabel("Search settings", { exact: true }).fill("appearance");
  await nav.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(
    nav.getByRole("button", { name: "Browse settings", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(content.locator(".appearance-settings")).toBeVisible();
  assert.equal(await content.evaluate((element) => element.scrollTop), 0);
  await noOverflow();
  await page.screenshot({
    path: `test-results/settings-${label}-mobile-appearance.png`,
  });
  await nav
    .getByRole("button", { name: "Browse settings", exact: true })
    .click();
  await nav.getByLabel("Search settings", { exact: true }).fill("tiktok");
  await nav
    .getByRole("button", { name: "Text to speech", exact: true })
    .click();
  await page.setViewportSize(originalViewport);
  await nav
    .getByRole("button", { name: "Clear settings search", exact: true })
    .click();
  await expect(content.getByLabel("TikTok voice", { exact: true })).toHaveValue(
    "en_male_narration",
  );
  console.log(
    `PASS settings ${label}: icons, search, collapsed groups, expand/restore, fixed header, 390px navigation and no horizontal overflow`,
  );
}
