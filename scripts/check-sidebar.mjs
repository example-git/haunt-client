import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

export async function checkChannelMenus(page, theme) {
  const selected = page.locator(".channel-entry:has(.channel.active)").first();
  const inactive = page
    .locator(".channel-entry:has(.channel:not(.active, .voice-connected))")
    .first();
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.focus();
  await page.mouse.move(1400, 900);
  for (const row of [selected, inactive])
    await expect(row.locator(".channel-menu-button")).toHaveCSS("opacity", "0");
  await fs.mkdir("test-results/channel-menus", { recursive: true });
  for (const [label, row] of [
    ["selected", selected],
    ["dark", inactive],
  ]) {
    const button = row.locator(".channel-menu-button");
    await row.hover();
    await expect(button).toHaveCSS("opacity", "1");
    await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const expectedColor = await (
      label === "selected"
        ? row.locator(".channel-name")
        : page.locator(".sidebar")
    ).evaluate((el) => getComputedStyle(el).color);
    await expect(button).toHaveCSS("color", expectedColor);
    const bar = await row.locator(".channel").boundingBox();
    const dots = await button.boundingBox();
    assert(dots.x >= bar.x && dots.x + dots.width <= bar.x + bar.width);
    assert(dots.y >= bar.y && dots.y + dots.height <= bar.y + bar.height);
    await page.locator(".sidebar").screenshot({
      path: `test-results/channel-menus/${theme}-${label}.png`,
    });
  }
  await selected.hover();
  await selected.locator(".channel-menu-button").click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Mark as read", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.mouse.move(1400, 900);
  await expect(selected.locator(".channel-menu-button")).toHaveCSS(
    "opacity",
    "1",
  );
  await input.focus();
  await expect(selected.locator(".channel-menu-button")).toHaveCSS(
    "opacity",
    "0",
  );
}

export async function checkCollapsedCategories(page, { request, general }) {
  const textCategory = await request("POST", "/api/v1/categories", {
    name: "Text rooms",
  });
  const voiceCategory = await request("POST", "/api/v1/categories", {
    name: "Voice rooms",
  });
  const create = (name, kind, category_id) =>
    request("POST", "/api/v1/channels", { name, kind, category_id });
  const first = await create("reading", "text", textCategory.id);
  const second = await create("writing", "text", textCategory.id);
  const voice = await create("live-room", "voice", voiceCategory.id);
  await create("quiet-room", "voice", voiceCategory.id);
  const category = (id) => page.locator(`[data-category-id="${id}"]`);
  const channel = (id) => page.locator(`[data-channel-id="${id}"] .channel`);
  const text = category(textCategory.id),
    voices = category(voiceCategory.id);
  const textToggle = text.locator(".category-toggle"),
    voiceToggle = voices.locator(".category-toggle");
  await expect(channel(first.id)).toBeVisible();
  await channel(first.id).click();
  await textToggle.click();
  await expect(textToggle).toHaveAttribute("aria-expanded", "false");
  await expect(text.locator(".channel")).toHaveCount(1);
  await expect(channel(first.id)).toBeVisible();
  await expect(channel(second.id)).toHaveCount(0);
  await page.screenshot({
    path: "test-results/collapsed-category-active-text.png",
  });
  await channel(general).click();
  await expect(text.locator(".channel")).toHaveCount(0);
  await expect(textToggle).toHaveAttribute("aria-expanded", "false");
  await textToggle.click();
  await channel(second.id).click();
  await textToggle.click();
  await expect(text.locator(".channel")).toHaveCount(1);
  await expect(channel(second.id)).toBeVisible();
  await channel(voice.id).click();
  await expect(channel(voice.id)).toContainText("Connected");
  await voiceToggle.click();
  await expect(voiceToggle).toHaveAttribute("aria-expanded", "false");
  await expect(voices.locator(".channel")).toHaveCount(1);
  await textToggle.click();
  await channel(first.id).click();
  await textToggle.click();
  await expect(text.locator(".channel")).toHaveCount(1);
  await expect(voices.locator(".channel")).toHaveCount(1);
  await expect(channel(voice.id)).toContainText("Connected");
  await page.screenshot({
    path: "test-results/collapsed-category-text-and-voice.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Show channels", exact: true })
    .click();
  await expect(channel(first.id)).toBeVisible();
  await expect(channel(voice.id)).toBeVisible();
  await page.screenshot({ path: "test-results/collapsed-category-mobile.png" });
  await page
    .getByRole("button", { name: "Close navigation", exact: true })
    .click({ position: { x: 375, y: 400 } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator(".call-dock")
    .getByRole("button", { name: "Leave call", exact: true })
    .click();
  await expect(voices.locator(".channel")).toHaveCount(0);
  await expect(voiceToggle).toHaveAttribute("aria-expanded", "false");
  await expect(channel(first.id)).toBeVisible();
  await channel(general).click();
  await expect(text.locator(".channel")).toHaveCount(0);
  await expect(textToggle).toHaveAttribute("aria-expanded", "false");
  await textToggle.click();
  await voiceToggle.click();
  await expect(text.locator(".channel")).toHaveCount(2);
  await expect(voices.locator(".channel")).toHaveCount(2);
  return {
    activeTextRetained: true,
    textSwitchHidesPrevious: true,
    connectedVoiceRetainedWhileReadingText: true,
    voiceLeaveHidesChannel: true,
    mobileActiveChannelsVisible: true,
    collapsedStatePreserved: true,
    expansionRestoresAllChannels: true,
  };
}
