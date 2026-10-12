import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

export async function checkAttachmentInput(page, fixtures, desktop) {
  page.setDefaultTimeout(15000);
  const png = await fs.readFile(new URL("../static/icon.png", import.meta.url));
  const username = desktop ? "bob" : "alice";
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await page.getByLabel("Server address").fill(fixtures.rtc.url);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  const input = page.getByLabel("Message", { exact: true });
  const ready = (count) =>
    expect(page.locator(".attachment-chips button")).toHaveCount(count);
  const transfer = async (selector, kind, names, type = "image/png", size) =>
    page.locator(selector).evaluate(
      (element, { kind, names, type, bytes, size }) => {
        const dataTransfer = new DataTransfer();
        for (const name of names)
          dataTransfer.items.add(
            new File(
              [size ? new Uint8Array(size) : new Uint8Array(bytes)],
              name,
              { type },
            ),
          );
        const event =
          kind === "paste"
            ? new ClipboardEvent(kind, {
                clipboardData: dataTransfer,
                bubbles: true,
                cancelable: true,
              })
            : new DragEvent(kind, {
                dataTransfer,
                bubbles: true,
                cancelable: true,
              });
        return !element.dispatchEvent(event);
      },
      { kind, names, type, bytes: [...png], size },
    );
  const clear = async () => {
    while (await page.locator(".attachment-chips button").count())
      await page.locator(".attachment-chips button").first().click();
  };
  const send = async (text) => {
    await input.fill(text);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const row = page.locator(".message").filter({ hasText: text });
    await expect(row).toBeVisible();
    return row;
  };

  // Exercise the actual platform paste command; no clipboard-read API is used by the app.
  if (desktop)
    await desktop.evaluate(
      ({ clipboard, ClipboardItem }, bytes) =>
        clipboard.write([
          new ClipboardItem({
            "image/png": new Blob([new Uint8Array(bytes)], {
              type: "image/png",
            }),
          }),
        ]),
      [...png],
    );
  else
    await page.evaluate(
      async (bytes) =>
        navigator.clipboard.write([
          new ClipboardItem({
            "image/png": new Blob([new Uint8Array(bytes)], {
              type: "image/png",
            }),
          }),
        ]),
      [...png],
    );
  await input.focus();
  await page.keyboard.press("Control+v");
  await ready(1);
  const pasted = await send(`Native clipboard attachment ${username}`);
  await expect(pasted.locator(".attachment-image")).toBeVisible();
  const text = "Plain pasted text\nhttps://example.com stays text";
  if (desktop)
    await desktop.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      text,
    );
  else await page.evaluate((text) => navigator.clipboard.writeText(text), text);
  await input.focus();
  await page.keyboard.press("Control+v");
  await expect(input).toHaveValue(text);
  await ready(0);
  await input.fill("");

  await transfer(".messages", "dragenter", ["one.png"]);
  await expect(page.locator(".file-drop-overlay")).toBeVisible();
  await transfer(".history-note", "dragenter", ["one.png"]);
  await transfer(".history-note", "dragleave", ["one.png"]);
  await expect(page.locator(".file-drop-overlay")).toBeVisible();
  await transfer(".messages", "drop", ["one.png", "two.png"]);
  await ready(2);
  await expect(page.locator(".file-drop-overlay")).toBeHidden();
  assert.equal(await transfer(".profile", "drop", ["sidebar.png"]), true);
  await ready(2);
  const dropped = await send(`Dropped attachments ${username}`);
  await expect(dropped.locator(".attachment-image")).toHaveCount(2);

  await transfer(".messages", "drop", ["bad.txt"], "text/plain");
  await expect(page.locator(".composer-wrap .error")).toContainText("PNG");
  await ready(0);
  await transfer(".messages", "drop", ["too-large.png"], "image/png", 2097153);
  await expect(page.locator(".composer-wrap .error")).toContainText("limit");
  await ready(0);
  await page.locator(".composer input[type=file]").setInputFiles(
    ["picker-a.png", "picker-b.png"].map((name) => ({
      name,
      mimeType: "image/png",
      buffer: png,
    })),
  );
  await ready(2);
  await clear();

  console.log("PASS file drops, native paste, picker and validation");
  // A rejected upload is visible, frees its slot, and does not poison later uploads.
  await page.route(
    "**/api/v1/conversations/*/attachments?*",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"temporarily_unavailable"}',
      }),
    { times: 1 },
  );
  await transfer(".messages", "drop", ["retry.png"]);
  await expect(page.locator(".composer-wrap .error")).toContainText(
    "retry.png",
  );
  await expect(page.locator(".attachment-chips")).toHaveCount(0);
  await transfer(".messages", "drop", ["recovered.png"]);
  await ready(1);
  await clear();

  await input.fill("unsent general draft");
  await page.route(
    "**/api/v1/conversations/*/attachments?*",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue().catch(() => {});
    },
    { times: 1 },
  );
  await transfer(".messages", "drop", ["switching.png"]);
  await page
    .locator(".channel-entry")
    .filter({ hasText: "lounge" })
    .getByRole("button")
    .first()
    .click();
  await expect(page.locator(".voice-chat .conversation-view")).toBeVisible();
  await expect(page.locator(".attachment-chips")).toHaveCount(0);
  await transfer(".voice-chat .messages", "drop", ["voice-chat.png"]);
  await ready(1);
  const voice = await send(`Pinned chat attachment ${username}`);
  await expect(voice.locator(".attachment-image")).toBeVisible();
  await page
    .locator(".channel-entry")
    .filter({ hasText: "general" })
    .getByRole("button")
    .first()
    .click();
  await expect(input).toHaveValue("unsent general draft");
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/conversations/*/attachments?*", async (route) => {
    await held;
    await route.abort().catch(() => {});
  });
  await transfer(
    ".messages",
    "drop",
    Array.from({ length: 6 }, (_, n) => `limit-${n}.png`),
  );
  await transfer(".composer textarea", "paste", [
    "paste-a.png",
    "paste-b.png",
    "paste-overflow.png",
  ]);
  await expect(page.locator(".attachment-chips > span")).toHaveCount(8);
  await expect(page.locator(".composer-wrap .error")).toContainText("up to 8");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await page
    .locator(".channel-entry")
    .filter({ hasText: "lounge" })
    .getByRole("button")
    .first()
    .click();
  release();
  await expect(page.locator(".attachment-chips")).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${desktop ? "Electron" : "browser"} native clipboard image/text, conversation drops, sidebar exclusion, multi-file picker, pending limits, validation, upload recovery and channel isolation`,
  );
}
