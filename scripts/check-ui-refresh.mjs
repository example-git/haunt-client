import { expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fillSignin } from "./signin-fields.mjs";

function contrast(a, b) {
  const luminance = (color) => {
    const [r, g, b] = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  };
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const expect = baseExpect.configure({ timeout: 20000 });
export async function checkUIRefresh(browser, fixtures) {
  const contexts = [],
    errors = [],
    report = { themes: [] };
  const fixture = fixtures.rtc;
  const request = async (method, path, token, body, status = 200) => {
    const response = await fetch(fixture.url + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(
      response.status,
      status,
      `${method} ${path}: ${await response.clone().text()}`,
    );
    return status === 204 ? undefined : response.json();
  };
  const login = async (username) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(fixture.url);
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixture.url, username);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    return page;
  };
  const section = (page, name) =>
    page
      .getByRole("navigation", { name: "Server settings sections" })
      .getByRole("button", { name, exact: true })
      .click();
  const close = (page) =>
    page.getByRole("button", { name: "Close", exact: true }).click();
  const appearance = async (page) => {
    if (
      !(await page
        .getByRole("button", { name: "Account settings", exact: true })
        .isVisible())
    )
      await page
        .getByRole("button", { name: "Show channels", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    if (
      !(await page
        .getByRole("button", { name: "Appearance", exact: true })
        .isVisible())
    )
      await page
        .getByRole("button", { name: "Browse settings", exact: true })
        .click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
  };
  try {
    const owner = await login("owner"),
      alice = await login("alice");
    const ownerAPI = await request("POST", "/api/v1/auth/login", "", {
      username: "owner",
      password: fixtures.password,
      device_name: "UI test controller",
    });
    const aliceAPI = await request("POST", "/api/v1/auth/login", "", {
      username: "alice",
      password: fixtures.password,
      device_name: "UI authorization probe",
    });
    const extension = "/api/v1/admin/server-extensions/tiktok-tts";
    await request("GET", extension, aliceAPI.token, undefined, 403);
    await expect(
      alice.getByRole("button", { name: "Server settings", exact: true }),
    ).toHaveCount(0);
    await owner
      .getByRole("button", { name: "Server settings", exact: true })
      .click();
    await section(owner, "Roles & permissions");
    await owner.getByLabel("Role name", { exact: true }).fill("Administrator");
    await owner.getByLabel("Role rank").fill("50");
    await owner.getByLabel("Administrator", { exact: true }).check();
    for (const checkbox of await owner
      .locator(".permission-checks input")
      .all())
      await expect(checkbox).toBeChecked();
    await owner
      .getByRole("button", { name: "Create role", exact: true })
      .click();
    await expect(owner.getByRole("dialog").getByRole("status")).toHaveText(
      "Role saved.",
    );
    await section(owner, "Members");
    await owner.getByLabel("Find a member").fill("alice");
    await owner
      .locator(".settings-list-row")
      .filter({ hasText: "@alice" })
      .click();
    await owner.getByLabel("Administrator", { exact: true }).check();
    await owner
      .getByRole("button", { name: "Save member roles", exact: true })
      .click();
    await expect(
      owner.getByRole("dialog").getByRole("status").first(),
    ).toHaveText("Member roles saved.");
    await alice
      .getByRole("button", { name: "Server settings", exact: true })
      .click();
    await section(alice, "Server extensions");
    await alice
      .getByLabel("TikTok session token", { exact: true })
      .fill("a".repeat(32));
    await alice.getByLabel("Enable for this server’s clients").check();
    await alice
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    await expect(alice.locator(".extension-settings")).toContainText("Enabled");
    await alice
      .getByRole("button", { name: "Test and play speech", exact: true })
      .click();
    const audio = alice.getByLabel("Extension test audio");
    await expect
      .poll(() => audio.evaluate((el) => el.currentTime))
      .toBeGreaterThan(0.1);
    await alice.screenshot({
      path: "test-results/administrator-extension.png",
    });
    const principal = await request("GET", "/api/v1/me", aliceAPI.token);
    assert.equal(principal.user.is_owner, false);
    assert.equal(principal.permissions, 65535);
    await request(
      "PUT",
      `/api/v1/members/${aliceAPI.user.id}/roles`,
      ownerAPI.token,
      { role_ids: [] },
      204,
    );
    await expect(
      alice
        .getByRole("navigation", { name: "Server settings sections" })
        .getByRole("button", { name: "Server extensions", exact: true }),
    ).toHaveCount(0);
    await request("GET", extension, aliceAPI.token, undefined, 403);
    report.administrator = {
      promotedWithoutRelogin: true,
      extensionSaved: true,
      actualAudioPlayback: true,
      revokedWithoutRelogin: true,
    };
    await close(owner);
    if (await alice.getByRole("dialog").count()) await close(alice);

    // Production history, real UI reply composition and navigation.
    await expect(owner.locator(".message-day-divider")).toHaveCount(3);
    await owner
      .getByRole("button", { name: "Show older downloaded messages" })
      .click();
    await expect(owner.locator(".message")).toHaveCount(105);
    await expect(owner.locator(".message-day-divider")).toHaveCount(3);
    const old = owner.locator(".message").first();
    await expect(old.locator("time").first()).toContainText(
      String(new Date().getFullYear()),
    );
    const original = await old.getAttribute("id");
    await old.scrollIntoViewIfNeeded();
    await old.hover();
    await old.getByRole("button", { name: "Reply", exact: true }).click();
    await owner
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("A compact reply with the original message above the author.");
    await owner
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const reply = owner.locator(".message.has-reply").last();
    await expect(reply).toBeVisible();
    const previewBox = await reply
      .locator(".message-reply-reference")
      .boundingBox();
    const metaBox = await reply.locator(".message-meta").boundingBox();
    assert(previewBox.y + previewBox.height <= metaBox.y + 1);
    assert.equal(await reply.locator(".reply-avatar").count(), 1);
    await expect(owner.locator(".message-day-divider")).toHaveCount(4);
    await reply.locator(".message-reply-reference").click();
    await expect(owner.locator(`#${original}`)).toHaveClass(/highlighted/);
    await reply.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: "test-results/replies-dates.png" });
    report.chat = {
      calendarDividers: 4,
      pagination: 105,
      oldDateVisible: true,
      replyAboveAuthor: true,
      replyNavigation: true,
    };

    for (const name of [
      "Rose Slate",
      "Mint Ink",
      "Peach Noir",
      "Lilac Carbon",
    ]) {
      await appearance(owner);
      await owner.getByRole("button", { name, exact: true }).click();
      if (name === "Rose Slate") {
        // Reopen a profile written by the previous release, through the real
        // preference loader. Its untouched built-in selection must update too.
        await owner.evaluate(() => {
          const key = "chatxo-client-preferences-v1";
          const preferences = JSON.parse(localStorage.getItem(key));
          preferences.theme.colors.sidebar = "#c8b8ee";
          localStorage.setItem(key, JSON.stringify(preferences));
        });
        await owner.reload();
        await owner
          .getByRole("button", { name: "Open The Common Room", exact: true })
          .click();
        await expect(owner.locator(".connection")).toHaveText("Connected");
        await appearance(owner);
        await expect(
          owner.getByRole("button", { name, exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(owner.locator(".settings-nav")).toHaveCSS(
          "background-color",
          "rgb(50, 50, 50)",
        );
        report.roseSlateUpgrade = true;
      }
      await expect(owner.locator(".theme-contrast-note")).toHaveCount(0);
      // Theme selection animates button foregrounds for 150 ms. Require the
      // settled rendered colors, not an intermediate transition frame.
      await expect
        .poll(async () => {
          const modal = await owner.evaluate(() => {
            const style = (selector) =>
              getComputedStyle(document.querySelector(selector));
            return {
              background: style(".dialog-head").backgroundColor,
              text: style(".dialog-head h2").color,
              side: style(".settings-nav").backgroundColor,
              sideText: style(".settings-group-toggle").color,
            };
          });
          return Math.min(
            contrast(modal.text, modal.background),
            contrast(modal.sideText, modal.side),
          );
        })
        .toBeGreaterThanOrEqual(4.5);
      await owner.screenshot({
        path: `test-results/theme-${name.toLowerCase().replaceAll(" ", "-")}-settings.png`,
      });
      await close(owner);
      await reply.scrollIntoViewIfNeeded();
      const layers = await owner.evaluate(() => {
        const inspect = (selector) => {
          const element = document.querySelector(selector);
          if (!element) throw Error(`Missing ${selector}`);
          const style = getComputedStyle(element);
          return { background: style.backgroundColor, color: style.color };
        };
        return {
          header: inspect(".app-titlebar"),
          sidebar: inspect(".sidebar"),
          members: inspect(".member-panel"),
          chat: inspect(".conversation-view"),
          button: inspect(".app-titlebar .icon"),
          selected: inspect(".sidebar .channel.active"),
          selectedLabel: inspect(".sidebar .channel.active .channel-name"),
        };
      });
      assert.equal(
        new Set([
          layers.header.background,
          layers.sidebar.background,
          layers.chat.background,
        ]).size,
        3,
      );
      assert.equal(layers.button.color, layers.header.background);
      if (name === "Rose Slate") {
        assert.equal(layers.header.background, "rgb(247, 171, 195)");
        assert.equal(layers.sidebar.background, "rgb(50, 50, 50)");
        assert.equal(layers.members.background, "rgb(50, 50, 50)");
        assert.equal(layers.chat.background, "rgb(36, 37, 41)");
        assert.equal(layers.selected.background, layers.header.background);
      } else {
        assert.equal(layers.selected.color, layers.sidebar.background);
      }
      assert(contrast(layers.sidebar.color, layers.sidebar.background) >= 4.5);
      assert.notEqual(layers.button.background, layers.header.background);
      assert(
        contrast(layers.selectedLabel.color, layers.selected.background) >= 4.5,
        JSON.stringify(layers),
      );
      report.themes.push({ name, layers });
      await owner.screenshot({
        path: `test-results/theme-${name.toLowerCase().replaceAll(" ", "-")}.png`,
      });
    }
    await owner.reload();
    await owner
      .getByRole("button", { name: "Open The Common Room", exact: true })
      .click();
    await expect(owner.locator(".connection")).toHaveText("Connected");
    const restoredReply = owner.locator(".message.has-reply").last();
    await expect(
      restoredReply.locator(".message-reply-reference"),
    ).toContainText("Archive message");
    await restoredReply.locator(".message-reply-reference").click();
    await expect(owner.locator(`#${original}`)).toHaveClass(/highlighted/);
    await owner
      .getByRole("button", { name: "Return to latest messages", exact: true })
      .click();
    await expect(
      restoredReply.locator(".message-reply-reference"),
    ).toContainText("Archive message");
    report.chat.replySurvivesReloadAndPagination = true;
    await appearance(owner);
    await expect(
      owner.getByRole("button", { name: "Lilac Carbon", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await owner
      .getByRole("button", { name: "Rose Slate", exact: true })
      .click();
    await close(owner);
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner
      .getByRole("button", { name: "Hide member list", exact: true })
      .click();
    await expect(owner.locator(".message.has-reply").last()).toBeVisible();
    await restoredReply
      .getByRole("button", { name: "Message options", exact: true })
      .click();
    await expect(
      owner
        .getByRole("menu", { name: "Message options" })
        .getByRole("menuitem", { name: "Reply", exact: true }),
    ).toBeVisible();
    await owner.keyboard.press("Escape");
    assert(
      await owner
        .locator(".conversation-view")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await owner.screenshot({ path: "test-results/replies-pastel-mobile.png" });
    await appearance(owner);
    assert(
      await owner
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await owner.screenshot({
      path: "test-results/theme-pastel-settings-mobile.png",
    });
    assert.deepEqual(errors, []);
    await fs.writeFile(
      "test-results/ui-refresh.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      "PASS Administrator UI/API promotion, extension save/playback/revocation; historical dates/replies; four contrasting three-layer presets and responsive layouts",
    );
  } catch (error) {
    console.error("Browser errors:", errors);
    for (const [i, context] of contexts.entries())
      for (const page of context.pages())
        await page
          .screenshot({ path: `test-results/ui-refresh-failure-${i}.png` })
          .catch(() => {});
    throw error;
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}
