import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { checkChannelMenus } from "./check-sidebar.mjs";

export async function checkCompactChat(page, { appearance, close }) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  const send = async (body, visibleText = body) => {
    await input.fill(body);
    await input.press("Enter");
    const row = page
      .locator("article.message")
      .filter({ has: page.locator(".message-body", { hasText: visibleText }) })
      .last();
    await expect(row).toBeVisible();
    return row;
  };
  const first = await send(
    "A compact view keeps the conversation close together.",
  );
  const normalHeight = (await first.boundingBox()).height;
  const second = await send("Every message still shows who said it.");
  const old = page.locator(".message:has(.message-group-date)").nth(8);
  const oldId = await old.getAttribute("id");
  const oldTimestamp = await old.locator(".message-group-date").textContent();
  await appearance(page);
  const preview = page.getByRole("group", {
    name: "Message preview",
    exact: true,
  });
  await expect(preview.locator("article.message")).toHaveCount(1);
  await expect(preview.locator(".message-avatar")).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Default", exact: true }),
  ).toBeChecked();
  const previewBounds = await preview.boundingBox();
  assert(
    previewBounds.y + previewBounds.height <=
      (await page.locator(".message-display-options").boundingBox()).y,
  );
  await page.screenshot({ path: "test-results/message-display-default.png" });
  await page.getByRole("radio", { name: "Compact", exact: true }).check();
  await expect(preview.locator(".message-avatar")).toHaveCount(0);
  await expect(preview.locator(".compact-message-time")).toBeVisible();
  await expect(preview).toHaveClass(/chat-display-compact/);
  assert((await preview.boundingBox()).height < previewBounds.height);
  await page.screenshot({ path: "test-results/message-display-compact.png" });
  await close(page);
  await expect(page.locator(".conversation-view > .messages")).toHaveClass(
    /chat-display-compact/,
  );
  await expect(first.locator(".message-avatar")).toHaveCount(0);
  await expect(second.locator(".message-meta .user-name")).toHaveCount(1);
  await expect(first.locator(".compact-message-time")).toBeVisible();
  assert((await first.boundingBox()).height < normalHeight);
  const inline = await first.evaluate((row) => {
    const author = row.querySelector(".user-name").getBoundingClientRect();
    const body = row.querySelector(".message-body p");
    const range = document.createRange();
    range.selectNodeContents(body.firstChild);
    const text = range.getClientRects()[0];
    return {
      authorY: author.y,
      textY: text.y,
      authorRight: author.right,
      textX: text.x,
    };
  });
  assert(Math.abs(inline.authorY - inline.textY) < 5, JSON.stringify(inline));
  assert(inline.textX > inline.authorRight, JSON.stringify(inline));
  await expect(page.locator(`#${oldId} .compact-message-time`)).toHaveText(
    oldTimestamp,
  );
  await first.hover();
  await first.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = await send("Replies keep their context in compact mode.");
  await expect(reply.locator(".message-reply-reference")).toContainText(
    "A compact view",
  );
  await reply.locator(".message-reply-reference").click();
  await expect(first).toHaveClass(/highlighted/);
  await send(
    "**Readable formatting**\n\nA second paragraph stays separate.\n\n```js\nconst compact = true;\n```\n\n- Lists still work\n- So do wrapped messages",
    "Readable formatting",
  );
  await expect(page.locator(".message-body pre").last()).toContainText(
    "const compact = true;",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Open The Common Room", exact: true })
    .click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect(page.locator(".conversation-view > .messages")).toHaveClass(
    /chat-display-compact/,
  );
  await expect(second.locator(".message-meta .user-name")).toHaveCount(1);
  const themes = [];
  await fs.mkdir("test-results/compact-themes", { recursive: true });
  await appearance(page);
  const choices = await page.locator(".theme-preset").allTextContents();
  await close(page);
  for (const name of choices) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await appearance(page);
    await page.getByRole("button", { name: name.trim(), exact: true }).click();
    await expect(
      page.getByRole("radio", { name: "Compact", exact: true }),
    ).toBeChecked();
    await close(page);
    const slug = name.trim().toLowerCase().replace(/\W+/g, "-");
    await checkChannelMenus(page, slug);
    await page.locator(".messages").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.screenshot({
      path: `test-results/compact-themes/${slug}-desktop.png`,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".member-panel")).toBeHidden();
    await expect(page.locator(".server-rail")).toBeHidden();
    assert(
      await page
        .locator(".conversation-view")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await page.screenshot({
      path: `test-results/compact-themes/${slug}-mobile.png`,
    });
    themes.push(name.trim());
  }
  await appearance(page);
  await expect(preview.locator("article.message")).toHaveCount(1);
  await expect(preview.locator(".compact-message-time")).toBeVisible();
  await page.screenshot({
    path: "test-results/message-display-compact-mobile.png",
  });
  await page.getByRole("radio", { name: "Default", exact: true }).check();
  await expect(preview.locator(".message-avatar")).toBeVisible();
  await page.getByRole("button", { name: "Rose Slate", exact: true }).click();
  await close(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Open The Common Room", exact: true })
    .click();
  await expect(page.locator(".conversation-view > .messages")).not.toHaveClass(
    /chat-display-compact/,
  );
  await expect(first.locator(".message-avatar")).toBeVisible();
  await expect(page.locator(".compact-message-time")).toHaveCount(0);
  return {
    liveSinglePreviewAboveControls: true,
    compactRowsShorter: true,
    inlineAuthors: true,
    consecutiveAuthors: true,
    olderDatesPreserved: true,
    repliesNavigate: true,
    markdownBlocks: true,
    reloadPersistence: true,
    defaultRestored: true,
    mobileNoOverflow: true,
    themes,
    channelMenusHoverContrastAndPlacement: true,
  };
}
