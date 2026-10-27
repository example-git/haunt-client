import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

/** Exercise visible interactions on the production server-rendered application. */
export async function checkUIPolish(page, { appearance, close }) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole("button", { name: "Hide member list", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  const resize = page.getByRole("separator", { name: "Resize channels panel" });
  await expect(page.locator(".sidebar")).toHaveCSS("width", "236px");
  await resize.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".sidebar")).toHaveCSS("width", "252px");
  await page.keyboard.press("ArrowLeft");
  const memberResize = page.getByRole("separator", {
    name: "Resize members panel",
  });
  await memberResize.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".member-panel")).toHaveCSS("width", "236px");
  await page.keyboard.press("ArrowRight");
  const bounds = await page.locator(".sidebar").boundingBox();
  await page.mouse.move(bounds.x + bounds.width, bounds.y + 250);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width + 24, bounds.y + 250, {
    steps: 3,
  });
  await page.mouse.up();
  await expect(page.locator(".sidebar")).toHaveCSS("width", "260px");
  await resize.focus();
  // Arrow keys reset to the standard width while exercising persistence.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("haunt-panel-widths-v1")).channels,
    ),
    244,
  );

  const dated = page.locator(".message-group-date").first();
  await dated.scrollIntoViewIfNeeded();
  const row = dated.locator("..");
  const { dateBox, bodyBox } = await dated.evaluate((date) => ({
    dateBox: date.getBoundingClientRect().toJSON(),
    bodyBox: date.parentElement
      .querySelector(".message-body")
      .getBoundingClientRect()
      .toJSON(),
  }));
  assert(
    dateBox.y + dateBox.height <= bodyBox.y ||
      dateBox.x >= bodyBox.x + bodyBox.width,
    `Date must not overlap the body: ${JSON.stringify({ dateBox, bodyBox })}`,
  );
  await row.hover();
  await page.screenshot({ path: "test-results/polish-dated-message.png" });

  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("");
  const compact = await page.locator(".composer").boundingBox();
  assert(compact.height >= 48 && compact.height <= 56, JSON.stringify(compact));
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await input.fill("First line\nSecond line\nThird line");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  assert(
    (await page.locator(".composer").boundingBox()).height >
      compact.height + 25,
  );
  await input.fill("");

  await appearance(page);
  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  await page.getByLabel("Theme name", { exact: true }).fill("Polished rose");
  await page
    .getByRole("button", { name: "Save as new theme", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export theme", exact: true }).click();
  const bytes = await fs.readFile(await (await download).path());
  assert.equal(JSON.parse(bytes).theme.colors.chrome, "#f7abc3");
  await page.getByRole("tab", { name: "Built-in", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import theme", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "polished-rose.json",
    mimeType: "application/json",
    buffer: bytes,
  });
  await expect(
    page.getByRole("tab", { name: "Saved", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "Apply saved theme", exact: true })
    .click();
  await page.getByRole("tab", { name: "Built-in", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: "Rose Slate", exact: true })
      .locator(".theme-selected-check"),
  ).toBeVisible();
  await close(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".member-panel")).toBeHidden();
  await expect(page.locator(".server-rail")).toBeHidden();
  await page
    .getByRole("button", { name: "Show channels", exact: true })
    .click();
  await expect(page.locator(".server-rail")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.screenshot({ path: "test-results/polish-mobile-navigation.png" });
  await page
    .getByRole("button", { name: "Close navigation", exact: true })
    .click({ position: { x: 375, y: 400 } });
  await expect(page.locator(".server-rail")).toBeHidden();
  const reply = page.locator(".message.has-reply").last();
  await page.locator(".messages").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await reply.scrollIntoViewIfNeeded();
  await input.focus();
  await expect(reply.locator(".message-options-toggle")).toBeHidden();
  const touch = await reply.locator(".message-body").boundingBox();
  await page.touchscreen.tap(touch.x + 20, touch.y + 10);
  await expect(reply.locator(".message-options-toggle")).toBeVisible();
  await reply
    .getByRole("button", { name: "Message options", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Edit message", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await input.focus();
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touch.x + 20, y: touch.y + 10 }],
  });
  await page.waitForTimeout(650);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    page.getByRole("menu", { name: "Message options" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/polish-mobile-message-menu.png",
  });
  await page.keyboard.press("Escape");
  await session.detach();
  return {
    keyboardAndPointerResize: true,
    widthsPersisted: true,
    datedMessageNoOverlap: true,
    composerGrows: true,
    themeSaveExportImportApply: true,
    mobileDrawer: true,
    touchSelectionAndLongPress: true,
  };
}
