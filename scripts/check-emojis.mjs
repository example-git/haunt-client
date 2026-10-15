import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

export async function checkEmojis(browser, fixtures) {
  const contexts = [],
    errors = [];
  const login = async (user, server = fixtures.rtc) => {
    const context = await browser.newContext({
      viewport: { width: 1360, height: 950 },
      permissions: ["microphone", "camera"],
    });
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.previewTracks = [];
      window.previewSources = [];
      const source = AudioContext.prototype.createMediaStreamSource;
      AudioContext.prototype.createMediaStreamSource = function (stream) {
        window.previewSources.push(stream.getAudioTracks()[0].id);
        return source.call(this, stream);
      };
      const capture = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (window.denyPreview)
          throw new DOMException("Permission denied", "NotAllowedError");
        const stream = await capture(constraints);
        window.previewTracks.push(...stream.getTracks());
        return stream;
      };
    });
    await page.goto("http://127.0.0.1:5173");
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, server.url, user);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    return page;
  };
  const close = (page) =>
    page.getByRole("button", { name: "Close", exact: true }).click();
  const settings = (page) =>
    page.getByRole("button", { name: "Server settings", exact: true }).click();
  try {
    const owner = await login("owner"),
      member = await login("alice");
    await owner
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await owner.getByRole("button", { name: "Devices", exact: true }).click();
    const meter = owner.getByRole("meter", { name: "Microphone input level" });
    await expect(meter).toBeVisible();
    await expect
      .poll(async () => Number(await meter.getAttribute("aria-valuenow")))
      .toBeGreaterThan(0);
    await expect(
      owner.getByLabel("Noise suppression", { exact: true }),
    ).toBeChecked();
    await expect(owner.locator(".microphone-monitor")).toHaveAttribute(
      "data-noise-suppression",
      "active",
    );
    assert(
      await owner.evaluate(
        () => window.previewSources.at(-1) !== window.previewTracks[0].id,
      ),
      "meter reads the processed track, not raw capture",
    );
    const captures = await owner.evaluate(() => window.previewTracks.length);
    await owner.getByLabel("Noise suppression", { exact: true }).uncheck();
    await expect(owner.locator(".microphone-monitor")).toHaveAttribute(
      "data-noise-suppression",
      "off",
    );
    await owner.getByLabel("Noise suppression", { exact: true }).check();
    await expect(owner.locator(".microphone-monitor")).toHaveAttribute(
      "data-noise-suppression",
      "active",
    );
    assert.equal(
      await owner.evaluate(() => window.previewTracks.length),
      captures,
      "live toggles retain the same capture",
    );
    const gain = owner.getByRole("slider", {
      name: "Microphone gain",
      exact: true,
    });
    await expect(
      owner.getByLabel("Automatic gain", { exact: true }),
    ).toBeChecked();
    await expect(gain).toBeDisabled();
    await owner.getByLabel("Automatic gain", { exact: true }).uncheck();
    await expect(gain).toBeEnabled();
    await gain.focus();
    await gain.press("Home");
    await expect
      .poll(async () => Number(await meter.getAttribute("aria-valuenow")))
      .toBe(0);
    await gain.press("End");
    await expect(gain).toHaveValue("200");
    await expect
      .poll(async () => Number(await meter.getAttribute("aria-valuenow")))
      .toBeGreaterThan(0);
    await owner.getByLabel("Automatic gain", { exact: true }).check();
    await expect(gain).toBeDisabled();
    await expect(gain).toHaveValue("200");
    const mic = await owner
      .getByLabel("Default microphone")
      .locator("option")
      .evaluateAll((items) => items.find((o) => o.value)?.value);
    assert(mic);
    await owner.getByLabel("Default microphone").selectOption(mic);
    await expect
      .poll(() => owner.evaluate(() => window.previewTracks.length))
      .toBeGreaterThan(1);
    assert.equal(
      await owner.evaluate(() => window.previewTracks[0].readyState),
      "ended",
    );
    await expect
      .poll(async () => Number(await meter.getAttribute("aria-valuenow")))
      .toBeGreaterThan(0);
    await owner.screenshot({ path: "test-results/microphone-meter.png" });
    await close(owner);
    assert(
      await owner.evaluate(() =>
        window.previewTracks.every((t) => t.readyState === "ended"),
      ),
    );
    // Permission errors are contained in settings; retry can recover.
    await owner.evaluate(() => (window.denyPreview = true));
    await owner
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await owner.getByRole("button", { name: "Devices", exact: true }).click();
    await expect(owner.locator(".microphone-monitor")).toContainText(
      "Allow microphone access",
    );
    await owner.evaluate(() => (window.denyPreview = false));
    await owner.getByRole("button", { name: "Retry", exact: true }).click();
    await expect
      .poll(async () => Number(await meter.getAttribute("aria-valuenow")))
      .toBeGreaterThan(0);
    await owner
      .getByRole("dialog")
      .getByRole("button", { name: "Notification Settings", exact: true })
      .click();
    assert(
      await owner.evaluate(() =>
        window.previewTracks.every((t) => t.readyState === "ended"),
      ),
    );
    await close(owner);
    await owner.reload();
    await expect(owner.locator(".connection")).toHaveText("Connected");
    await owner
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await owner.getByRole("button", { name: "Devices", exact: true }).click();
    await expect(
      owner.getByRole("slider", { name: "Microphone gain", exact: true }),
    ).toHaveValue("200");
    await expect(
      owner.getByRole("slider", { name: "Microphone gain", exact: true }),
    ).toBeDisabled();
    await close(owner);
    const gif = await fs.readFile("tests/fixtures/animated.gif");
    await member
      .getByRole("button", { name: "Edit your profile", exact: true })
      .click();
    await expect(member.getByRole("dialog")).toHaveCount(1);
    await expect(
      member.getByRole("heading", { name: "User settings", exact: true }),
    ).toBeVisible();
    await member.getByRole("button", { name: "Devices", exact: true }).click();
    await expect(
      member.getByRole("meter", { name: "Microphone input level" }),
    ).toBeVisible();
    await member.getByRole("button", { name: "Profile", exact: true }).click();
    await expect
      .poll(() =>
        member.evaluate(() =>
          window.previewTracks.every((track) => track.readyState === "ended"),
        ),
      )
      .toBe(true);
    const avatar = member.locator(".art-avatar");
    await avatar.getByLabel("Upload avatar").setInputFiles({
      name: "avatar.gif",
      mimeType: "image/gif",
      buffer: gif,
    });
    await avatar
      .getByRole("button", { name: "Save image", exact: true })
      .click();
    await expect(avatar.getByRole("status")).toHaveText("Image saved.");
    await close(member);
    await expect(member.locator(".profile .avatar img")).toBeVisible();
    assert.equal(
      await member
        .locator(".profile .avatar")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    await settings(owner);
    for (const kind of ["icon", "banner"]) {
      const section = owner.locator(`.art-${kind}`);
      await section.getByLabel(`Upload ${kind}`).setInputFiles({
        name: "animated.gif",
        mimeType: "image/gif",
        buffer: gif,
      });
      await section
        .getByRole("button", { name: "Save image", exact: true })
        .click();
      await expect(section.getByRole("status")).toHaveText("Image saved.");
      await expect
        .poll(() =>
          section
            .locator(".art-preview img")
            .evaluate((image) => image.complete && image.naturalWidth),
        )
        .toBe(24);
      assert.equal(
        await section
          .locator(".art-preview")
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgba(0, 0, 0, 0)",
      );
    }
    await owner.getByRole("button", { name: "Emojis", exact: true }).click();
    await owner.getByLabel("Emoji name", { exact: true }).fill("test_wave");
    await owner
      .getByLabel("Emoji image", { exact: true })
      .setInputFiles({ name: "wave.gif", mimeType: "image/gif", buffer: gif });
    await owner
      .getByRole("button", { name: "Upload emoji", exact: true })
      .click();
    await expect(
      owner.getByRole("button", { name: "Delete :test_wave:", exact: true }),
    ).toBeVisible();
    await close(owner);
    await expect(
      owner.locator(".community-cover.has-banner .server-banner"),
    ).toBeVisible();
    const bounds = await owner.locator(".community-cover").evaluate((el) => {
      const image = el.querySelector("img").getBoundingClientRect(),
        title = el.querySelector("h2").getBoundingClientRect();
      return (
        title.x >= image.x &&
        title.right <= image.right &&
        title.y >= image.y &&
        title.bottom <= image.bottom
      );
    });
    assert(bounds, "server name is over the banner");
    assert.equal(
      await owner
        .locator(".server-icon.selected")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    assert.equal(
      await owner
        .locator(".community-cover")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    // Catalog updates arrive over the gateway, without refreshing the member.
    await member
      .getByRole("button", { name: "Choose emoji", exact: true })
      .click();
    await expect(
      member
        .getByRole("option", { name: "Insert :test_wave:", exact: true })
        .first(),
    ).toBeVisible();
    assert(
      (await member.locator(".emoji-grid-row button").count()) <= 80,
      "picker renders only visible rows",
    );
    const visibleSheets = await member
      .locator(".emoji-picker .standard-emoji")
      .evaluateAll((elements) => [
        ...new Set(
          elements.map((element) => getComputedStyle(element).backgroundImage),
        ),
      ]);
    assert.equal(
      visibleSheets.length,
      1,
      "opening the picker only needs one shared emoji sheet",
    );
    assert.match(visibleSheets[0], /127\.0\.0\.1:5173/);
    await member
      .locator(".emoji-picker .standard-emoji")
      .first()
      .evaluate(async (element) => {
        const image = new Image();
        image.src = getComputedStyle(element).backgroundImage.slice(5, -2);
        await image.decode();
        if (image.naturalWidth !== 1152)
          throw Error("Sprite sheet did not decode");
      });
    await member.getByRole("button", { name: "Flags", exact: true }).click();
    await expect(
      member.locator(".emoji-categories button[aria-pressed=true]"),
    ).toHaveAttribute("aria-label", "Flags");
    assert((await member.locator(".emoji-grid-row button").count()) <= 80);
    await member.getByLabel("Search emojis").fill("joy");
    await expect(
      member.getByRole("option", {
        name: "Insert :grinning_face:",
        exact: true,
      }),
    ).toBeVisible();
    await member.getByLabel("Search emojis").fill("no_such_emoji_xyz");
    await expect(member.locator(".emoji-picker")).toContainText(
      "No matching emojis.",
    );
    await member.getByLabel("Search emojis").fill("test_w");
    await member
      .getByRole("option", { name: "Insert :test_wave:", exact: true })
      .first()
      .click();
    await expect(
      member.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue(":test_wave: ");
    await member
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      member.locator('.message-body img[alt=":test_wave:"]'),
    ).toHaveCount(1);
    const input = member.getByRole("textbox", { name: "Message", exact: true });
    await member
      .getByRole("button", { name: "Choose emoji", exact: true })
      .click();
    await member
      .getByRole("button", { name: "Recently used", exact: true })
      .click();
    await expect(
      member.locator(".emoji-categories button[aria-pressed=true]"),
    ).toHaveAttribute("aria-label", "Recently used");
    await member.getByLabel("Search emojis").fill("red heart");
    await member.getByLabel("Search emojis").press("Enter");
    await expect(input).toHaveValue("❤️ ");
    await input.fill(":test_w");
    await expect(
      member.getByRole("listbox", { name: "Emoji suggestions" }),
    ).toBeVisible();
    await input.press("Tab");
    await expect(input).toHaveValue(":test_wave: ");
    await input.fill("`:test_wave:` :unknown_name:");
    await input.press("Enter");
    const literal = member
      .locator(".message-body")
      .filter({ hasText: ":test_wave: :unknown_name:" });
    await expect(literal).toBeVisible();
    await expect(literal.locator("img")).toHaveCount(0);
    const sendRich = async (body, visible) => {
      await input.fill(body);
      await member
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      const row = member.locator(".message-body").filter({ hasText: visible });
      await expect(row).toHaveCount(1);
      return row;
    };
    const large = await sendRich("😀 👩🏽‍💻 :test_wave:", "😀 👩🏽‍💻");
    await expect(large).toHaveClass(/emoji-only/);
    await expect(large.locator(".standard-emoji")).toHaveCount(2);
    await expect(large.locator(".custom-emoji")).toHaveCSS("width", "40px");
    const mixed = await sendRich(
      "Inline 😀 next to words",
      "Inline 😀 next to words",
    );
    await expect(mixed).not.toHaveClass(/emoji-only/);
    assert(
      parseFloat(
        await mixed
          .locator(".standard-emoji")
          .evaluate((el) => getComputedStyle(el).width),
      ) < 25,
    );
    const rich = await sendRich(
      "**Bold** *italic* __underline__ ~~gone~~ @owner :test_wave:\n> Quoted\n\n- First\n- Second\n\n||Secret **spoiler**||",
      "Bold italic underline gone",
    );
    await expect(rich.locator("strong").first()).toHaveText("Bold");
    await expect(rich.locator("em")).toHaveText("italic");
    await expect(rich.locator("u")).toHaveText("underline");
    await expect(rich.locator("s")).toHaveText("gone");
    await expect(rich.locator("blockquote")).toContainText("Quoted");
    await expect(rich.locator("li")).toHaveCount(2);
    await expect(rich.locator(".mention")).toHaveText("@owner");
    await expect(rich.locator(".message-spoiler > span")).toBeHidden();
    await rich.getByRole("button", { name: "Reveal spoiler" }).click();
    await expect(rich.locator(".message-spoiler > span")).toBeVisible();
    const code = await sendRich(
      "```js\n@owner :test_wave: 😀 <script>window.markdownUnsafe=1</script>\n```",
      "window.markdownUnsafe",
    );
    await expect(code.locator("pre code")).toContainText(":test_wave:");
    await expect(
      code.locator(".mention, .custom-emoji, .standard-emoji, script"),
    ).toHaveCount(0);
    const unsafe = await sendRich(
      "[blocked](javascript:alert(1)) <img src=x onerror=alert(1)> [safe](https://example.com/path)",
      "blocked",
    );
    await expect(unsafe.locator("img, script")).toHaveCount(0);
    await expect(unsafe.locator("a")).toHaveCount(1);
    await expect(unsafe.locator("a")).toHaveAttribute(
      "href",
      "https://example.com/path",
    );
    assert.equal(await member.evaluate(() => window.markdownUnsafe), undefined);
    await member.screenshot({ path: "test-results/markdown-emojis.png" });
    // Use the same composer/catalog in an instance-local direct message.
    await member
      .getByRole("button", { name: "New direct message", exact: true })
      .click();
    await member.getByLabel("Find people").fill("owner");
    await member.locator(".people-list input[type=checkbox]").check();
    await member
      .getByRole("button", { name: "Start conversation", exact: true })
      .click();
    await expect(member.getByRole("dialog")).toHaveCount(0);
    await expect(member.locator(".conversation-head h1")).toHaveText("owner");
    await input.fill("DM :test_wave:");
    await input.press("Enter");
    await expect(
      member.locator('.message-body img[alt=":test_wave:"]'),
    ).toHaveCount(1);
    await member.reload();
    await expect(member.locator(".connection")).toHaveText("Connected");
    await member
      .getByRole("button", { name: "Choose emoji", exact: true })
      .click();
    await expect(
      member
        .getByRole("option", { name: "Insert :test_wave:", exact: true })
        .first(),
    ).toBeVisible();
    await member.getByRole("button", { name: "Close emoji picker" }).click();
    await settings(owner);
    await owner.getByRole("button", { name: "Emojis", exact: true }).click();
    await owner
      .getByRole("button", { name: "Delete :test_wave:", exact: true })
      .click();
    await expect(
      owner.getByRole("button", { name: "Delete :test_wave:", exact: true }),
    ).toHaveCount(0);
    await close(owner);
    await member
      .getByRole("button", { name: "Choose emoji", exact: true })
      .click();
    await expect(
      member
        .getByRole("option", { name: "Insert :test_wave:", exact: true })
        .first(),
    ).toHaveCount(0);
    await member.screenshot({ path: "test-results/server-emojis.png" });
    assert.deepEqual(errors, []);
    console.log(
      "Microphone preview activity/device changes/permission recovery/cleanup; animated art; banner overlay; live emoji catalog, picker, completion, channel/DM rendering and deletion passed",
    );
  } finally {
    for (const context of contexts) await context.close();
  }
}

export async function checkDesktopEmojiSettings(desktopPage) {
  await desktopPage
    .getByLabel("Message", { exact: true })
    .fill("😀 **Desktop formatting**");
  await desktopPage
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(
    desktopPage
      .locator(".message-body strong")
      .filter({ hasText: "Desktop formatting" }),
  ).toHaveCount(1);
  const desktopEmoji = desktopPage
    .locator(".message-body .standard-emoji")
    .first();
  await expect(desktopEmoji).toBeVisible();
  await desktopEmoji.evaluate(async (element) => {
    const image = new Image();
    image.src = getComputedStyle(element).backgroundImage.slice(5, -2);
    await image.decode();
    if (image.naturalWidth !== 1152)
      throw Error("Packaged sprite did not decode");
  });
  await desktopPage
    .getByRole("button", { name: "Choose emoji", exact: true })
    .click();
  await desktopPage.getByLabel("Search emojis").fill("red heart");
  await desktopPage.getByLabel("Search emojis").press("Enter");
  await expect(desktopPage.getByLabel("Message", { exact: true })).toHaveValue(
    "❤️ ",
  );
  await desktopPage.getByLabel("Message", { exact: true }).fill("");

  await desktopPage
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await expect(desktopPage.getByRole("dialog")).toHaveCount(1);
  await desktopPage
    .getByRole("button", { name: "Devices", exact: true })
    .click();
  await expect(
    desktopPage.getByRole("meter", { name: "Microphone input level" }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        await desktopPage.getByRole("meter").getAttribute("aria-valuenow"),
      ),
    )
    .toBeGreaterThan(0);
  await desktopPage
    .getByRole("dialog")
    .getByRole("button", { name: "Notification Settings", exact: true })
    .click();
  await expect(
    desktopPage.getByLabel("Ping sound", { exact: true }),
  ).toBeVisible();
  await desktopPage.getByRole("button", { name: "Close", exact: true }).click();
  console.log(
    "PASS packaged emoji sprites, Markdown, picker insertion and unified settings with processed microphone meter",
  );
}
