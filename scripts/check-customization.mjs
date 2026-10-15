import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function checkCustomization(browser, fixtures) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 960 },
    permissions: ["microphone", "camera"],
  });
  const errors = [];
  const login = async (page, user) => {
    await page.addInitScript(() => {
      window.voiceTones = [];
      const start = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (...args) {
        window.voiceTones.push(this.frequency.value);
        return start.apply(this, args);
      };
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:5173");
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await page.getByLabel("Server address").fill(fixtures.rtc.url);
    await page.getByLabel("Username", { exact: true }).fill(user);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected", {
      timeout: 20000,
    });
  };
  const close = (page) =>
    page.getByRole("button", { name: "Close", exact: true }).click();
  const server = (page) =>
    page.getByRole("button", { name: "Server settings", exact: true }).click();
  let memberContext;
  try {
    const owner = await context.newPage();
    await login(owner, "owner");
    await expect(owner.locator(".conversation-head p")).toHaveCount(0);
    await expect(
      owner.getByText("YOUR COMMUNITY", { exact: true }),
    ).toHaveCount(0);
    memberContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ["microphone", "camera"],
    });
    const alice = await memberContext.newPage();
    await login(alice, "alice");
    await owner.getByRole("button", { name: "Show member list" }).click();
    await expect(
      owner.getByRole("complementary", { name: "Member list" }),
    ).toBeVisible();
    await owner.getByLabel("Search members").fill("bob");
    await expect(owner.locator(".member-row")).toHaveCount(1);
    await owner.locator(".member-row").click();
    await expect(owner.getByRole("dialog")).toContainText("@bob");
    await close(owner);
    await owner.getByRole("button", { name: "Close member list" }).click();
    await expect(owner.locator(".member-panel")).toHaveCount(0);

    await server(owner);
    await owner
      .getByLabel("Server name", { exact: true })
      .fill("Customization Room");
    await owner
      .getByLabel("Server description")
      .fill("A place for good company and shared projects.");
    await owner.getByLabel("Server accent color").fill("#a8b8ff");
    await owner
      .getByRole("button", { name: "Save server settings", exact: true })
      .click();
    await expect(owner.getByRole("status")).toHaveText(
      "Server settings saved.",
    );
    const png = Buffer.from(
      await owner.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 1200;
        c.height = 400;
        const x = c.getContext("2d");
        const g = x.createLinearGradient(0, 0, 1200, 400);
        g.addColorStop(0, "#354580");
        g.addColorStop(1, "#219381");
        x.fillStyle = g;
        x.fillRect(0, 0, 1200, 400);
        return c.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    );
    for (const kind of ["icon", "banner"]) {
      const section = owner.locator(`.art-editor.art-${kind}`);
      await section.locator("input[type=file]").setInputFiles({
        name: `${kind}.png`,
        mimeType: "image/png",
        buffer: png,
      });
      await expect(
        section.getByRole("button", { name: "Save image" }),
      ).toBeEnabled();
      await section.getByRole("button", { name: "Save image" }).click();
      await expect(section.getByRole("status")).toHaveText("Image saved.");
    }
    await close(owner);
    await expect(owner.locator(".community-head h2")).toHaveText(
      "Customization Room",
    );
    await expect(owner.locator(".server-banner")).toBeVisible();
    await expect
      .poll(() =>
        owner.locator(".server-icon.selected").evaluate((tile) => {
          const image = tile.querySelector("img");
          return (
            !!image &&
            Math.abs(image.getBoundingClientRect().width - tile.clientWidth) <
              1 &&
            Math.abs(image.getBoundingClientRect().height - tile.clientHeight) <
              1
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        owner.locator(".server-banner").evaluate((el) => el.naturalWidth),
      )
      .toBe(1200);
    await owner.reload();
    await expect(owner.locator(".connection")).toHaveText("Connected");
    await expect(owner.locator(".server-banner")).toBeVisible();
    assert.equal(
      await owner
        .locator(".community-cover h2")
        .evaluate((el) => getComputedStyle(el).backdropFilter),
      "blur(10px)",
    );
    assert.equal(
      await owner
        .locator(".channel-name")
        .first()
        .evaluate((el) => getComputedStyle(el).fontWeight),
      "600",
    );
    assert.equal(
      await owner
        .locator(".connection")
        .evaluate((el) => getComputedStyle(el).fontWeight),
      "400",
    );
    const surfaces = await owner.evaluate(() =>
      [".server-rail", ".sidebar", ".workspace", ".app-titlebar"].map(
        (selector) =>
          getComputedStyle(document.querySelector(selector)).backgroundColor,
      ),
    );
    for (const color of surfaces) {
      const [r, g, b] = color.match(/[\d.]+/g).map(Number);
      assert(r === g && g === b, `Surface must be neutral grey: ${color}`);
    }
    await expect(
      owner.getByRole("button", { name: "Client settings", exact: true }),
    ).toHaveCount(0);
    await expect(
      owner.getByRole("button", { name: "Account settings", exact: true }),
    ).toHaveCount(1);

    await owner
      .getByRole("button", { name: "Create channel", exact: true })
      .click();
    await owner
      .getByLabel("Channel name", { exact: true })
      .fill("project-room");
    await owner.getByLabel("Topic", { exact: true }).fill("Plans and sketches");
    await owner
      .getByRole("radio", { name: "Gaming icon", exact: true })
      .check();
    await owner
      .getByRole("dialog")
      .getByRole("button", { name: "Create channel", exact: true })
      .click();
    await expect(owner.locator(".conversation-head h1")).toHaveText(
      "project-room",
    );
    await expect(
      owner.locator('.conversation-head [data-channel-icon="gamepad-2"]'),
    ).toHaveCount(1);
    await expect(
      alice
        .getByRole("button", { name: "project-room", exact: true })
        .locator('[data-channel-icon="gamepad-2"]'),
    ).toHaveCount(1);
    await owner
      .getByRole("button", { name: "Channel menu for project-room" })
      .click();
    await owner
      .getByRole("menuitem", { name: "Edit channel", exact: true })
      .click();
    await owner
      .getByLabel("Channel name", { exact: true })
      .fill("project-chat");
    await expect(
      owner.getByRole("radio", { name: "Gaming icon", exact: true }),
    ).toBeChecked();
    await owner.getByRole("radio", { name: "Code icon", exact: true }).check();
    await owner.getByLabel("Topic", { exact: true }).fill("Project updates");
    await owner
      .getByRole("button", { name: "Save channel", exact: true })
      .click();
    await expect(owner.locator(".conversation-head p")).toHaveText(
      "Project updates",
    );
    await expect(
      alice
        .getByRole("button", { name: "project-chat", exact: true })
        .locator('[data-channel-icon="code"]'),
    ).toHaveCount(1);
    await owner.reload();
    await expect(owner.locator(".connection")).toHaveText("Connected");
    await owner
      .getByRole("button", { name: "project-chat", exact: true })
      .click();
    await expect(
      owner.locator('.conversation-head [data-channel-icon="code"]'),
    ).toHaveCount(1);
    await owner
      .getByRole("button", { name: "Channel menu for project-chat" })
      .click();
    await owner
      .getByRole("menuitem", { name: "Channel permissions", exact: true })
      .click();
    await expect(owner.getByLabel("Role", { exact: true })).not.toHaveValue("");
    await owner
      .getByLabel("Send messages", { exact: true })
      .selectOption("deny");
    await owner
      .getByRole("button", { name: "Save permissions", exact: true })
      .click();
    await expect(owner.getByRole("status")).toHaveText(
      "Channel permissions saved.",
    );
    await close(owner);
    await alice.getByRole("button", { name: "Refresh conversations" }).click();
    await alice
      .getByRole("button", { name: "project-chat", exact: true })
      .click();
    await expect(alice.locator(".readonly")).toBeVisible();
    await alice
      .getByRole("button", { name: "Channel menu for project-chat" })
      .click();
    await expect(
      alice.getByRole("menuitem", { name: "Notifications", exact: true }),
    ).toBeVisible();
    await expect(
      alice.getByRole("menuitem", { name: "Edit channel", exact: true }),
    ).toHaveCount(0);
    await expect(
      alice.getByRole("menuitem", { name: "Channel permissions", exact: true }),
    ).toHaveCount(0);
    await alice.keyboard.press("Escape");

    await server(owner);
    await owner
      .getByRole("button", { name: "Roles & permissions", exact: true })
      .click();
    await owner
      .getByLabel("Role name", { exact: true })
      .fill("Channel helpers");
    await owner.getByLabel("Manage channels", { exact: true }).check();
    await owner
      .getByRole("button", { name: "Create role", exact: true })
      .click();
    await expect(owner.getByRole("status")).toHaveText("Role saved.");
    await owner.getByRole("button", { name: "Members", exact: true }).click();
    await owner.getByLabel("Find a member", { exact: true }).fill("alice");
    await expect(owner.locator(".settings-list-row")).toHaveCount(1);
    await owner.locator(".settings-list-row").click();
    await owner.getByLabel("Channel helpers", { exact: true }).check();
    await owner
      .getByRole("button", { name: "Save member roles", exact: true })
      .click();
    await expect(owner.getByRole("status")).toHaveText("Member roles saved.");
    await close(owner);
    await alice.getByRole("button", { name: "Refresh conversations" }).click();
    await expect(
      alice.getByRole("button", { name: "Server settings", exact: true }),
    ).toBeVisible();
    await server(alice);
    await expect(
      alice.getByRole("button", { name: "Roles & permissions", exact: true }),
    ).toHaveCount(0);
    await close(alice);

    await alice
      .getByRole("button", { name: "Edit your profile", exact: true })
      .click();
    await alice.getByLabel("Display name", { exact: true }).fill("Alice Blue");
    await alice
      .getByLabel("About me", { exact: true })
      .fill("Building something together.");
    await alice.getByLabel("Profile color", { exact: true }).fill("#88bbff");
    await alice
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(alice.getByRole("status")).toHaveText("Changes saved.");
    const avatar = alice.locator(".art-editor.art-avatar");
    await avatar.locator("input[type=file]").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: png,
    });
    await avatar.getByRole("button", { name: "Save image" }).click();
    await expect(avatar.getByRole("status")).toHaveText("Image saved.");
    await expect(
      avatar.getByRole("button", { name: "Replace image" }),
    ).toBeVisible();
    await alice.screenshot({
      path: "test-results/profile-settings.png",
      fullPage: true,
    });
    await close(alice);
    await alice.reload();
    await expect(alice.locator(".connection")).toHaveText("Connected");
    await expect(alice.locator(".profile strong")).toHaveText("Alice Blue");
    await expect(alice.locator(".profile .avatar img")).toBeVisible();
    assert.equal(
      await alice
        .locator(".profile .avatar")
        .evaluate(
          (tile) =>
            tile.querySelector("img").getBoundingClientRect().width ===
            tile.clientWidth,
        ),
      true,
    );
    await owner.getByRole("button", { name: "Show member list" }).click();
    await expect(
      owner.locator(".member-row").filter({ hasText: "Alice Blue" }),
    ).toBeVisible();
    await owner
      .locator(".member-row")
      .filter({ hasText: "Alice Blue" })
      .click();
    await owner.getByRole("button", { name: "Message", exact: true }).click();
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await expect(owner.locator(".conversation-head h1")).toHaveText(
      "Alice Blue",
    );
    const dmPicture = owner
      .locator(".dm-entry")
      .filter({ hasText: "Alice Blue" })
      .locator(".avatar img");
    await expect(dmPicture).toBeVisible();
    await expect
      .poll(() => dmPicture.evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
    assert(
      await dmPicture.evaluate(
        (img) =>
          img.getBoundingClientRect().width === img.parentElement.clientWidth,
      ),
      "DM profile picture fills its tile",
    );
    await owner.screenshot({ path: "test-results/dm-profile-picture.png" });
    await owner.getByRole("button", { name: "general", exact: true }).click();
    await owner.getByRole("button", { name: "Show member list" }).click();
    await owner.screenshot({
      path: "test-results/customization.png",
      fullPage: true,
    });
    await owner.getByRole("button", { name: "Close member list" }).click();

    await alice
      .getByRole("button", { name: "lounge Join", exact: true })
      .click();
    await expect(alice.locator(".call-panel header small")).toContainText(
      "1 in the room",
      { timeout: 25000 },
    );
    await expect(owner.locator(".sidebar .voice-members")).toContainText(
      "Alice Blue",
    );
    await expect(
      alice.locator(`[data-channel-id="${fixtures.rtc.voice}"] .voice-members`),
    ).toContainText("Alice Blue");
    await expect
      .poll(() =>
        alice.evaluate(() => window.voiceTones.map((f) => Math.round(f))),
      )
      .toEqual([523, 784]);
    await expect(
      alice.getByRole("button", { name: "lounge Connected", exact: true }),
    ).toBeVisible();
    await owner
      .getByRole("button", { name: "lounge Join", exact: true })
      .click();
    await expect(alice.locator(".call-panel header small")).toContainText(
      "2 in the room",
      { timeout: 25000 },
    );
    await expect
      .poll(() => alice.evaluate(() => window.voiceTones.length))
      .toBe(4);
    await expect(
      owner.getByRole("button", { name: "lounge Connected", exact: true }),
    ).toBeVisible({ timeout: 25000 });
    const ownRoster = owner.locator(
      `[data-channel-id="${fixtures.rtc.voice}"] .voice-members`,
    );
    await expect(ownRoster.locator(".voice-member")).toHaveCount(2);
    await expect(ownRoster).toContainText("owner");
    await expect(owner.locator(".call-panel.full")).toBeVisible();
    await expect(
      owner.getByRole("region", { name: "Voice channel chat" }),
    ).toBeVisible();
    const stage = await owner.locator(".call-panel.full").boundingBox();
    const chat = await owner.locator(".voice-chat").boundingBox();
    assert(
      stage.width > 450 &&
        stage.height > 500 &&
        chat.x >= stage.x + stage.width - 1,
      "Selected voice channel fills the main area beside its pinned chat",
    );
    await alice
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Pinned note from Alice");
    await alice
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(owner.locator(".voice-chat .message-body")).toContainText([
      "Pinned note from Alice",
    ]);
    await expect(owner.locator(".call-panel audio")).toHaveCount(1, {
      timeout: 25000,
    });
    await owner.evaluate(() => {
      window.unchangedCallAudio = document.querySelector(".call-panel audio");
    });
    await owner.getByRole("button", { name: "general", exact: true }).click();
    await expect(owner.locator(".call-panel.mini")).toBeVisible();
    await expect(owner.locator(".voice-chat")).toHaveCount(0);
    await expect(owner.locator(".messages")).not.toContainText(
      "Pinned note from Alice",
    );
    assert.equal(
      await owner.evaluate(
        () =>
          window.unchangedCallAudio ===
          document.querySelector(".call-panel audio"),
      ),
      true,
      "Switching channels preserves the mounted audio player",
    );
    await owner
      .getByRole("button", { name: "Open voice channel", exact: true })
      .click();
    await expect(owner.locator(".call-panel.full")).toBeVisible();
    assert.equal(
      await owner.evaluate(
        () =>
          window.unchangedCallAudio ===
          document.querySelector(".call-panel audio"),
      ),
      true,
      "Returning to voice preserves the mounted audio player",
    );
    await expect(owner.locator(".voice-chat .message-body")).toContainText([
      "Pinned note from Alice",
    ]);
    await owner.screenshot({
      path: "test-results/voice-workspace.png",
      fullPage: true,
    });
    await owner.screenshot({
      path: "test-results/voice-roster.png",
      fullPage: true,
    });
    const beforeMenu = await ownRoster.boundingBox();
    const voiceMenu = owner.getByRole("button", {
      name: "Channel menu for lounge",
    });
    await voiceMenu.click();
    await expect(
      owner.getByRole("menu", { name: "lounge options" }),
    ).toBeVisible();
    assert.deepEqual(
      await ownRoster.boundingBox(),
      beforeMenu,
      "Menu must not move the voice roster",
    );
    const floating = await owner.getByRole("menu").boundingBox();
    assert.equal(
      await owner.evaluate(
        ({ x, y }) =>
          !!document.elementFromPoint(x, y)?.closest(".channel-menu"),
        { x: floating.x + floating.width / 2, y: beforeMenu.y + 4 },
      ),
      true,
      "Menu must draw over the voice roster",
    );
    await owner.screenshot({
      path: "test-results/channel-menu-overlay.png",
      fullPage: true,
    });
    await owner.keyboard.press("Escape");
    await expect(owner.getByRole("menu")).toHaveCount(0);
    await expect(voiceMenu).toBeFocused();
    await owner
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
    await expect(owner.locator(".voice-chat .message-body")).toContainText([
      "Pinned note from Alice",
    ]);
    await expect(alice.locator(".call-panel header small")).toContainText(
      "1 in the room",
    );
    await expect
      .poll(() => alice.evaluate(() => window.voiceTones.length))
      .toBe(6);
    await alice
      .locator(".call-dock")
      .getByRole("button", { name: "Mute microphone", exact: true })
      .click();
    await expect(
      owner.locator(".sidebar .voice-members [aria-label=Muted]"),
    ).toBeVisible();
    await alice
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
    await expect(owner.locator(".sidebar .voice-members")).toHaveCount(0);
    await expect
      .poll(() => alice.evaluate(() => window.voiceTones.length))
      .toBe(10);
    const tones = await alice.evaluate(() =>
      window.voiceTones.map((f) => Math.round(f)),
    );
    assert.deepEqual(tones, [523, 784, 659, 784, 523, 440, 392, 294, 523, 349]);
    await alice
      .getByRole("button", { name: "Edit your profile", exact: true })
      .click();
    await alice.getByRole("button", { name: "Account", exact: true }).click();
    await alice
      .getByRole("dialog")
      .getByRole("button", { name: "Notification Settings", exact: true })
      .click();
    await alice.getByLabel("Voice connection and participant sounds").uncheck();
    await close(alice);
    await alice
      .getByRole("button", { name: "lounge Join", exact: true })
      .click();
    await expect(alice.locator(".call-panel header small")).toContainText(
      "1 in the room",
      { timeout: 25000 },
    );
    await alice
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
    assert.equal(
      await alice.evaluate(() => window.voiceTones.length),
      10,
      "Sound preference suppresses cues",
    );
    await owner
      .getByRole("button", { name: "Channel menu for project-chat" })
      .click();
    await owner
      .getByRole("menuitem", { name: "Delete channel…", exact: true })
      .click();
    await owner.getByLabel("Confirm channel name").fill("project-chat");
    await owner
      .getByRole("button", { name: "Permanently delete channel", exact: true })
      .click();
    await expect(
      owner.getByRole("button", { name: "project-chat", exact: true }),
    ).toHaveCount(0);
    await expect(
      owner.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeVisible();
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.getByRole("button", { name: "Show member list" }).click();
    assert.equal(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await owner.screenshot({
      path: "test-results/customization-mobile.png",
      fullPage: true,
    });
    await owner.getByRole("button", { name: "Close member list" }).click();
    assert.deepEqual(errors, [], "Customization UI exceptions");
    console.log(
      "PASS customization: member drawer/profiles, persistent name/icon/banner, channel create/edit/delete/topic, permission denial, role creation/assignment, manager gating, avatars, outside-room voice roster/mute/leave, actual Web Audio cues/preferences and mobile layout",
    );
  } catch (error) {
    for (const [i, page] of context.pages().entries())
      await page
        .screenshot({ path: `test-results/customization-failure-${i}.png` })
        .catch(() => {});
    if (errors.length) console.error("Customization errors", errors);
    throw error;
  } finally {
    await memberContext?.close();
    await context.close();
  }
}
