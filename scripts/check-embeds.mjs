import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function checkEmbeds(browser, fixtures) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
  });
  const errors = [],
    external = [],
    previews = [];
  let conversation = fixtures.rtc.general;
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const target = new URL(request.url()).pathname.match(
        /^\/api\/v1\/conversations\/([^/]+)\/messages$/,
      );
      if (request.method() === "POST" && target) conversation = target[1];
      if (request.url().startsWith("https://preview.example.com"))
        external.push(request.url());
      if (request.url().includes("/embeds")) previews.push(request);
    });
    let previewsAvailable = false;
    await page.route(`${fixtures.rtc.url}/api/v1/instance`, async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      if (!previewsAvailable)
        json.capabilities = json.capabilities.filter(
          (value) => value !== "messages.embeds",
        );
      await route.fulfill({ response, json });
    });
    await page.goto("http://127.0.0.1:5173");
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixtures.rtc.url, "owner");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".connection")).toHaveText("Connected");
    const send = async (body, rendered = body) => {
      await page.getByLabel("Message", { exact: true }).fill(body);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      const row = page
        .locator(".message")
        .filter({ has: page.locator(".message-body", { hasText: rendered }) });
      await expect(row).toHaveCount(1);
      return row;
    };
    const row = await send("Rich article https://preview.example.com/article.");
    await expect(row.locator(".message-embeds")).toHaveCount(0);
    previewsAvailable = true;
    await page
      .getByRole("button", { name: "Refresh conversations", exact: true })
      .click();
    const card = row.locator(".embed-card");
    await expect(card).toContainText("Example journal · preview.example.com");
    await expect(card).toContainText(
      "A rich preview <script>plain text</script>",
    );
    await expect(card.locator("script")).toHaveCount(0);
    await expect(row.locator(".message-body a")).toHaveAttribute(
      "href",
      "https://preview.example.com/article",
    );
    await expect(card.locator("img")).toBeVisible();
    await expect
      .poll(() => card.locator("img").evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
    assert(
      previews.every((r) => !!r.headers().authorization),
      "preview requests require session authentication",
    );
    assert.deepEqual(
      external,
      [],
      "no direct browser thumbnail or metadata fetches",
    );
    await card.getByRole("button", { name: "Enlarge preview image" }).click();
    await expect(
      page.getByRole("dialog", { name: "Image preview" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .locator(".messages")
          .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
      )
      .toBeLessThan(120);

    const quiet = await send(
      "Quiet <https://preview.example.com/quiet> `https://preview.example.com/code`",
      "Quiet https://preview.example.com/quiet https://preview.example.com/code",
    );
    await expect(quiet.locator(".message-embeds")).toHaveCount(0);
    const unavailable = await send("Local http://127.0.0.1/private");
    await expect(unavailable.locator(".message-body a")).toHaveCount(1);
    await expect(unavailable.locator(".embed-card")).toHaveCount(0);
    const missing = await send(
      "Missing https://preview.example.com/missing-image",
    );
    await expect(missing.locator(".embed-title")).toBeVisible();

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.locator("input[type=file]").setInputFiles({
      name: "inline.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.locator(".attachment-chips")).toContainText("inline.png");
    const attachment = await send("An automatic inline attachment");
    await expect(attachment.locator("img.attachment-image")).toBeVisible();
    await expect
      .poll(() => attachment.locator("img").evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
    await attachment
      .getByRole("button", { name: "Enlarge inline.png" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close image preview" }).click();

    // A local document stands in for the external player; this checks gating,
    // CSP and sandbox integration, not live YouTube availability or playback.
    let playerRequests = 0;
    await page.route("https://www.youtube-nocookie.com/**", async (route) => {
      playerRequests++;
      await route.fulfill({
        contentType: "text/html",
        body: "<p>Test player frame</p>",
      });
    });
    const video = await send("Watch https://youtu.be/abcdefghijk");
    await expect(
      video.getByRole("button", { name: "Play YouTube video: Fixture video" }),
    ).toBeVisible();
    assert.equal(playerRequests, 0);
    await expect(video.locator("iframe")).toHaveCount(0);
    await video
      .getByRole("button", { name: "Play YouTube video: Fixture video" })
      .click();
    await expect(video.locator("iframe")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&rel=0",
    );
    await expect(
      video.frameLocator("iframe").getByText("Test player frame"),
    ).toBeVisible();
    await video.getByRole("button", { name: "Close embedded video" }).click();
    await expect(video.locator("iframe")).toHaveCount(0);

    // Incoming messages must not pull a reader away from older history or
    // start preview requests for content outside the visible scroll area.
    await page.locator(".messages").evaluate((el) => {
      el.scrollTop = 0;
    });
    const loginResponse = await fetch(`${fixtures.rtc.url}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "owner",
        password: fixtures.password,
        device_name: "embed scroll test",
      }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();
    const incomingResponse = await fetch(
      `${fixtures.rtc.url}/api/v1/conversations/${conversation}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${login.token}`,
        },
        body: JSON.stringify({
          body: "While reading history https://preview.example.com/background",
          request_id: randomUUID(),
        }),
      },
    );
    assert.equal(incomingResponse.status, 201);
    const incoming = await incomingResponse.json();
    const background = page
      .locator(".message")
      .filter({ hasText: "While reading history" });
    await expect(background).toHaveCount(1);
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator(".messages").evaluate((el) => el.scrollTop),
      0,
    );
    assert.equal(
      previews.filter((request) => request.url().includes(incoming.id)).length,
      0,
    );
    await page.locator(".messages").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(background.locator(".embed-title")).toBeVisible();

    await row.scrollIntoViewIfNeeded();
    await row.hover();
    await row
      .getByRole("button", { name: "Message options", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Edit message", exact: true })
      .click();
    await page
      .locator(".message textarea")
      .fill("Edited article without a link");
    await page
      .locator(".message")
      .filter({ has: page.locator("textarea") })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    const edited = page
      .locator(".message")
      .filter({ hasText: "Edited article without a link" });
    await expect(edited.locator(".embed-card")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    assert.deepEqual(errors, []);
    console.log(
      "PASS rich embeds: authenticated cards/images, escaped metadata, suppression, unavailable links, inline attachments/lightbox, click-gated sandboxed player, edits, capability upgrade, scroll preservation/lazy fetching and mobile width",
    );
  } finally {
    await context.close();
  }
}

export async function checkDesktopLinks(desktop, page) {
  await desktop.evaluate(({ shell }) => {
    globalThis.hauntLinks = [];
    shell.openExternal = async (url) => {
      globalThis.hauntLinks.push(url);
    };
  });
  await page.evaluate(() =>
    window.hauntDesktop.openExternal("https://example.com/article"),
  );
  assert.deepEqual(await desktop.evaluate(() => globalThis.hauntLinks), [
    "https://example.com/article",
  ]);
  assert.equal(
    await page.evaluate(() =>
      window.hauntDesktop.openExternal("file:///etc/passwd").then(
        () => false,
        () => true,
      ),
    ),
    true,
  );
  assert.equal(
    await desktop.evaluate(async ({ BrowserWindow, app }) => {
      const untrusted = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: `${app.getAppPath()}/apps/desktop/preload.cjs`,
          partition: "persist:chatxo",
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      try {
        await untrusted.loadURL("https://app.chatxo.local");
        return await untrusted.webContents.executeJavaScript(
          'window.hauntDesktop.openExternal("https://example.com/forbidden").then(()=>false,()=>true)',
        );
      } finally {
        untrusted.destroy();
      }
    }),
    true,
  );
  assert.deepEqual(await desktop.evaluate(() => globalThis.hauntLinks), [
    "https://example.com/article",
  ]);
  console.log(
    "PASS desktop external links: validated HTTP(S), trusted renderer only, OS browser call intercepted",
  );
}
