import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fillSignin } from "./signin-fields.mjs";

export async function checkMediaAppearance(browser, fixtures) {
  const contexts = await Promise.all(
    [0, 1].map(() =>
      browser.newContext({
        permissions: ["camera", "microphone"],
        viewport: { width: 1360, height: 900 },
      }),
    ),
  );
  const [owner, member] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  const errors = [],
    evidence = { names: [], glass: [], reconnect: [], moderationRequests: [] };
  owner.on("request", (request) => {
    if (request.method() === "PATCH")
      evidence.moderationRequests.push({
        path: new URL(request.url()).pathname,
      });
  });
  owner.on("requestfailed", (request) => {
    if (request.method() === "PATCH")
      evidence.moderationRequests.push({
        failure: request.failure()?.errorText,
      });
  });
  const server = fixtures.rtc,
    recordKey = "haunt-voice-reconnect-v1",
    preferenceKey = "chatxo-client-preferences-v1";
  const api = (page, method, path, body) =>
    page.evaluate(
      async ({ origin, method, path, body }) => {
        const response = await fetch(origin + path, {
          method,
          headers: {
            Authorization: `Bearer ${window.sessionToken}`,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) throw Error(`${method} ${path}: ${response.status}`);
        return response.status === 204 ? null : response.json();
      },
      { origin: server.url, method, path, body },
    );
  const join = async (page) => {
    const channel = page.locator(
      `[data-channel-id="${server.voice}"] button.channel`,
    );
    await expect(channel.locator(".join-label")).toHaveText("Join");
    await channel.click();
  };
  const connected = (page) =>
    expect(page.locator(".call-dock")).toContainText("Voice connected", {
      timeout: 30000,
    });
  const showServer = async (page) => {
    await page
      .getByRole("button", { name: "Open The Common Room", exact: true })
      .click();
    await expect(page.locator(".connection")).toHaveText("Connected");
  };
  const record = (page) =>
    page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
      recordKey,
    );
  const preferences = (page, patch) =>
    page.evaluate(
      ({ key, patch }) => {
        const value = {
          ...JSON.parse(localStorage.getItem(key) ?? "{}"),
          ...patch,
        };
        localStorage.setItem(key, JSON.stringify(value));
        window.dispatchEvent(new StorageEvent("storage", { key }));
      },
      { key: preferenceKey, patch },
    );
  try {
    for (const [index, page] of [owner, member].entries()) {
      page.setDefaultTimeout(20000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        const Socket = WebSocket;
        window.WebSocket = class extends Socket {
          constructor(...args) {
            super(...args);
            (window.appearanceSockets ??= []).push(this);
          }
          send(data) {
            if (typeof data === "string") {
              try {
                const value = JSON.parse(data);
                if (value.type === "authenticate")
                  window.sessionToken = value.token;
              } catch {}
            }
            return super.send(data);
          }
        };
      });
      await page.goto("http://127.0.0.1:5173");
      await expect(
        page.getByRole("dialog", { name: "Connect to a server" }),
      ).toBeVisible();
      await fillSignin(page, server.url, index ? "alice" : "owner");
      await page
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.locator(".connection")).toHaveText("Connected");
    }
    await member
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Profile color fixture");
    await member
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const author = owner
      .locator(".message")
      .filter({ hasText: "Profile color fixture" })
      .locator(".profile-user-name")
      .first();
    await expect(author).toBeVisible();
    const base = {
      background: "#202020",
      sidebar: "#202020",
      chrome: "#202020",
      surface: "#202020",
      raised: "#292929",
      text: "#ffffff",
      muted: "#bbbbbb",
      border: "#444444",
      selection: "#ff9a3d",
      selectionText: "#000000",
    };
    for (const [scenario, color, surface, text] of [
      ["light-on-dark", "#ffffff", "#000000", "#ffffff"],
      ["light-on-light", "#ffffff", "#ffffff", "#000000"],
      ["midtone-on-dark", "#777777", "#222222", "#ffffff"],
    ]) {
      await api(member, "PUT", "/api/v1/me/profile", {
        accent_color: color,
        display_name: "Color member",
        bio: "",
      });
      await preferences(owner, {
        theme: {
          preset: "custom",
          gradient: null,
          windowEffect: "solid",
          sidebarOpacity: 82,
          colors: {
            ...base,
            background: surface,
            surface,
            raised: surface,
            text,
          },
        },
      });
      await expect
        .poll(() =>
          author.evaluate((element) =>
            element.style.getPropertyValue("--name-color"),
          ),
        )
        .toBe(color);
      await expect(author).toHaveAttribute("data-name-treatment", "outline");
      await expect(author).toHaveCSS("-webkit-text-stroke-width", "4px");
      await expect(author).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      assert.equal(
        await author.evaluate((element) =>
          element.style.getPropertyValue("--name-color"),
        ),
        color,
      );
      evidence.names.push(
        await author.evaluate((element) => ({
          kind: element.dataset.nameTreatment,
          color: getComputedStyle(element).webkitTextFillColor,
          stroke: getComputedStyle(element).webkitTextStrokeWidth,
          background: getComputedStyle(element).backgroundColor,
          paintOrder: getComputedStyle(element).paintOrder,
        })),
      );
      await owner.screenshot({ path: `test-results/name-${scenario}.png` });
    }
    await owner.evaluate(() => {
      window.hauntDesktop = {
        platform: "linux",
        windowState: async () => ({
          target: "main",
          maximized: false,
          fullscreen: false,
        }),
        windowControl: async () => {},
        onWindowState: () => () => {},
        onCallWindowClosed: () => () => {},
        setBadge: async () => {},
        appearance: {
          set: async (request) => ({
            effect: request.mode,
            restart: false,
            supported: true,
          }),
        },
      };
    });
    const peach = {
      background: "#1b1b1b",
      sidebar: "#323232",
      chrome: "#ffc39c",
      surface: "#242424",
      raised: "#2c2c2c",
      text: "#f4f4f4",
      muted: "#b8b8b8",
      border: "#414141",
      selection: "#ffc39c",
      selectionText: "#1b1b1b",
    };
    for (const [name, colors, accent] of [
      ["neutral", base, "#ff9a3d"],
      ["peach", peach, "#ffc39c"],
    ])
      for (const effect of ["transparent", "material"])
        for (const opacity of [effect === "transparent" ? 50 : 30, 82, 100]) {
          await preferences(owner, {
            accentColor: accent,
            theme: {
              preset: "custom",
              gradient: null,
              windowEffect: effect,
              sidebarOpacity: opacity,
              colors,
            },
          });
          await expect(owner.locator("html")).toHaveAttribute(
            "data-window-effect",
            effect,
          );
          const palette = await owner.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            const active = getComputedStyle(
              document.querySelector(".channel.active"),
            );
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            const luminance = (color) => {
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data]
                .slice(0, 3)
                .map((value) => {
                  const component = value / 255;
                  return component <= 0.04045
                    ? component / 12.92
                    : ((component + 0.055) / 1.055) ** 2.4;
                });
              return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const foreground = luminance(active.color);
            const background = luminance(active.backgroundColor);
            return {
              channelContrast:
                (Math.max(foreground, background) + 0.05) /
                (Math.min(foreground, background) + 0.05),
              chrome: style.getPropertyValue("--chrome-fill"),
              side: style.getPropertyValue("--sidebar-fill"),
              content: style.getPropertyValue("--resolved-content"),
              title: getComputedStyle(
                document.querySelector(".app-titlebar") ??
                  document.querySelector(".profile"),
              ).backgroundImage,
              sidebar: getComputedStyle(document.querySelector(".sidebar"))
                .backgroundImage,
              contentBackground: getComputedStyle(
                document.querySelector(".workspace"),
              ).backgroundImage,
            };
          });
          assert.equal(
            new Set([palette.chrome, palette.side, palette.content]).size,
            3,
          );
          assert.ok(palette.channelContrast >= 4.5, JSON.stringify(palette));
          assert.equal(
            (palette.title.match(/data:image\/svg\+xml/g) ?? []).length,
            2,
          );
          assert.equal(
            (palette.sidebar.match(/data:image\/svg\+xml/g) ?? []).length,
            1,
          );
          assert.ok(!palette.contentBackground.includes("data:image/svg+xml"));
          if (name === "peach")
            assert.deepEqual(
              [palette.chrome, palette.side, palette.content],
              [peach.chrome, peach.sidebar, peach.surface],
            );
          evidence.glass.push({ name, effect, opacity, ...palette });
          await owner.screenshot({
            path: `test-results/glass-${name}-${effect}-${opacity}.png`,
          });
          if (name === "peach" && opacity === 82) {
            await owner
              .getByRole("button", { name: "Account settings", exact: true })
              .click();
            await owner
              .getByRole("button", { name: "Appearance", exact: true })
              .click();
            const preview = owner.locator(".theme-preview").first();
            await expect(preview).toHaveAttribute("data-window-effect", effect);
            const textures = await preview.evaluate((element) => ({
              chrome: getComputedStyle(element.querySelector(".preview-header"))
                .backgroundImage,
              side: getComputedStyle(element.querySelector(".preview-sidebar"))
                .backgroundImage,
              content: getComputedStyle(element.querySelector(".preview-chat"))
                .backgroundImage,
            }));
            assert.equal(
              (textures.chrome.match(/data:image\/svg\+xml/g) ?? []).length,
              2,
            );
            assert.equal(
              (textures.side.match(/data:image\/svg\+xml/g) ?? []).length,
              1,
            );
            assert.ok(!textures.content.includes("data:image/svg+xml"));
            await owner.screenshot({
              path: `test-results/glass-preview-${effect}.png`,
            });
            await owner
              .getByRole("button", { name: "Close", exact: true })
              .click();
          }
        }
    await owner.evaluate(() => {
      window.hauntDesktop.appearance.set = async () => {
        throw Error("Native appearance unavailable");
      };
    });
    await preferences(owner, {
      theme: {
        preset: "custom",
        gradient: null,
        windowEffect: "transparent",
        sidebarOpacity: 100,
        colors: peach,
      },
    });
    await expect(owner.locator("html")).toHaveAttribute(
      "data-appearance-supported",
      "false",
    );
    await expect(owner.locator("html")).toHaveAttribute(
      "data-window-effect",
      "material",
    );
    assert.equal(
      await owner.evaluate(() =>
        document.documentElement.style.getPropertyValue("--window-background"),
      ),
      "transparent",
    );
    evidence.nativeEffectFailure =
      "preserves the last confirmed effect and palette";
    await owner.evaluate(() => {
      window.hauntDesktop.appearance.set = async (request) => ({
        effect: request.mode,
        restart: false,
        supported: true,
      });
    });
    await preferences(owner, {
      chatDisplay: "compact",
      theme: {
        preset: "custom",
        gradient: { angle: 125, colors: ["#112233", "#442211"] },
        windowEffect: "solid",
        sidebarOpacity: 82,
        colors: base,
      },
    });
    await expect(owner.locator(".messages.chat-display-compact")).toBeVisible();
    await expect(author).toHaveAttribute("data-name-treatment", "outline");
    await owner
      .locator(".message")
      .filter({ hasText: "Profile color fixture" })
      .hover();
    await owner
      .locator(".message")
      .filter({ hasText: "Profile color fixture" })
      .getByRole("button", { name: "Reply", exact: true })
      .click();
    await owner
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Reply color fixture @alice");
    await owner
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const reply = owner
      .locator(".message")
      .filter({ hasText: "Reply color fixture @alice" });
    await expect(reply.locator(".message-reply-reference")).toHaveAttribute(
      "aria-label",
      "Reply to Color member: Profile color fixture",
    );
    for (const name of await reply
      .locator(
        ".message-reply-reference .profile-user-name, .mention .profile-user-name",
      )
      .all()) {
      await expect(name).toHaveAttribute("data-name-treatment", "outline");
      assert.equal(
        await name.evaluate((element) =>
          element.style.getPropertyValue("--name-color"),
        ),
        "#777777",
      );
    }
    await expect(reply.locator(".mention .profile-user-name")).toHaveCount(1);
    await owner.screenshot({
      path: "test-results/name-gradient-reply-mention.png",
    });
    evidence.names.push({ kind: "gradient reply and mention", compact: true });
    await preferences(owner, {
      theme: {
        preset: "custom",
        gradient: null,
        windowEffect: "solid",
        sidebarOpacity: 82,
        colors: base,
      },
    });
    let releaseRoster, capturedRoster;
    const heldRoster = new Promise((resolve) => {
      releaseRoster = resolve;
    });
    const rosterReady = new Promise((resolve) => {
      capturedRoster = resolve;
    });
    const rosterURL = `${server.url}/api/v1/voice/${server.voice}`;
    await member.route(rosterURL, async (route) => {
      const response = await route.fetch();
      capturedRoster(await response.json());
      await heldRoster;
      await route.fulfill({ response });
    });
    await join(member);
    const initialRoster = await rosterReady;
    const joiningUser = initialRoster.participants[0].user_id;
    await api(
      owner,
      "PATCH",
      `/api/v1/voice/${server.voice}/restrictions/${joiningUser}`,
      {
        muted: true,
        deafened: true,
      },
    );
    const restrictedControl = member.locator(".call-dock").getByRole("button", {
      name: "Unmute microphone",
      exact: true,
    });
    await expect(restrictedControl).toBeDisabled();
    releaseRoster();
    await connected(member);
    await expect(restrictedControl).toBeDisabled();
    await expect(
      member.locator(".call-dock").getByRole("button", {
        name: "Deafen",
        exact: true,
      }),
    ).toBeDisabled();
    await member.unroute(rosterURL);
    await api(
      owner,
      "PATCH",
      `/api/v1/voice/${server.voice}/restrictions/${joiningUser}`,
      {
        muted: false,
        deafened: false,
      },
    );
    await expect(
      member.locator(".call-dock").getByRole("button", {
        name: "Mute microphone",
        exact: true,
      }),
    ).toBeEnabled();
    evidence.reconnect.push(
      "newer moderator restrictions survive a delayed initial roster",
    );
    const saved = await record(member);
    assert.equal(saved.channel, server.voice);
    await owner
      .locator(".voice-member")
      .filter({ hasText: "Color member" })
      .click({ button: "right" });
    const moderationResponse = owner.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/restrictions/"),
    );
    await owner
      .getByRole("menuitem", { name: "Mute member", exact: true })
      .click();
    const moderation = await moderationResponse.catch(async (error) => {
      console.log(
        "Moderation UI",
        await owner.locator("[role=alert]").allTextContents(),
        evidence.moderationRequests,
      );
      throw error;
    });
    assert.equal(moderation.status(), 200, await moderation.text());
    await expect(
      member
        .locator(".call-dock")
        .getByRole("button", { name: "Unmute microphone", exact: true }),
    ).toBeDisabled();
    assert.equal((await record(member)).intent.muted, false);
    await api(
      owner,
      "PATCH",
      `/api/v1/voice/${server.voice}/restrictions/${saved.user}`,
      { muted: false, deafened: true },
    );
    await expect(
      member
        .locator(".call-dock")
        .getByRole("button", { name: "Deafen", exact: true }),
    ).toBeDisabled();
    await api(
      owner,
      "PATCH",
      `/api/v1/voice/${server.voice}/restrictions/${saved.user}`,
      { deafened: false },
    );
    await expect(
      member
        .locator(".call-dock")
        .getByRole("button", { name: "Mute microphone", exact: true }),
    ).toBeEnabled();
    await member
      .locator(".call-dock")
      .getByRole("button", { name: "Mute microphone", exact: true })
      .click();
    const muted = await record(member);
    assert.equal(muted.intent.muted, true);
    await member.reload();
    await expect(member.locator(".voice-reconnect-banner")).toContainText(
      "lounge",
    );
    await member
      .getByRole("button", { name: "Reconnect", exact: true })
      .click();
    await connected(member);
    await expect(
      member
        .locator(".call-dock")
        .getByRole("button", { name: "Unmute microphone", exact: true }),
    ).toBeEnabled();
    await expect(
      member
        .locator(".call-dock")
        .getByRole("button", { name: "Turn on camera", exact: true }),
    ).toBeVisible();
    await expect(
      member
        .locator(".call-dock")
        .getByRole("button", { name: "Share screen", exact: true }),
    ).toBeVisible();
    evidence.reconnect.push(
      "reload restores self mute with camera and screen off",
    );
    await member
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
    assert.equal(await record(member), null);
    await member.reload();
    await showServer(member);
    await expect(member.locator(".voice-reconnect-banner")).toHaveCount(0);
    evidence.reconnect.push("deliberate leave clears offer");
    await api(
      owner,
      "PATCH",
      `/api/v1/voice/${server.voice}/restrictions/${saved.user}`,
      { muted: true },
    );
    await owner
      .locator(`[data-channel-id="${server.voice}"] .channel-entry`)
      .hover();
    await owner
      .getByRole("button", { name: "Channel menu for lounge", exact: true })
      .click();
    await owner
      .getByRole("menuitem", { name: "Voice restrictions", exact: true })
      .click();
    const restrictions = owner.getByRole("dialog", {
      name: "Voice restrictions",
      exact: true,
    });
    await expect(restrictions).toContainText("Color member");
    await restrictions
      .getByRole("button", { name: "Remove mute", exact: true })
      .click();
    await expect(restrictions).toContainText("No restricted members.");
    await restrictions
      .getByRole("button", { name: "Close", exact: true })
      .click();
    evidence.reconnect.push(
      "absent member restriction cleared from channel list",
    );
    await join(member);
    await connected(member);
    await member.reload();
    await expect(member.locator(".voice-reconnect-banner")).toBeVisible();
    await member.getByRole("button", { name: "Dismiss", exact: true }).click();
    assert.equal(await record(member), null);
    evidence.reconnect.push("dismissal clears offer");
    await showServer(member);
    await join(member);
    await connected(member);
    const restore = await record(member);
    await member.route(
      `${server.url}/api/v1/channels/${server.voice}`,
      (route) => route.abort(),
    );
    await member.reload();
    await showServer(member);
    await expect(member.locator(".voice-reconnect-banner")).toHaveCount(0);
    assert.equal((await record(member)).channel, server.voice);
    await member.unroute(`${server.url}/api/v1/channels/${server.voice}`);
    await expect(member.locator(".voice-reconnect-banner")).toBeVisible({
      timeout: 15000,
    });
    evidence.reconnect.push(
      "unfinished access check remains hidden and retries",
    );
    const role = await api(owner, "POST", "/api/v1/roles", {
      name: "Voice access fixture",
      permissions: 0,
      position: 1,
    });
    await api(owner, "PUT", `/api/v1/members/${saved.user}/roles`, {
      role_ids: [role.id],
    });
    await api(
      owner,
      "PUT",
      `/api/v1/channels/${server.voice}/permissions/${role.id}`,
      { allow: 0, deny: 4 },
    );
    await expect(member.locator(".voice-reconnect-banner")).toHaveCount(0);
    await expect.poll(() => record(member)).toBeNull();
    evidence.reconnect.push("revoked Connect permission clears offer");
    await api(
      owner,
      "PUT",
      `/api/v1/channels/${server.voice}/permissions/${role.id}`,
      { allow: 4, deny: 0 },
    );
    await join(member);
    await connected(member);
    await member.reload();
    await expect(member.locator(".voice-reconnect-banner")).toBeVisible();
    await api(owner, "DELETE", `/api/v1/channels/${server.voice}`);
    await expect(member.locator(".voice-reconnect-banner")).toHaveCount(0);
    await expect.poll(() => record(member)).toBeNull();
    evidence.reconnect.push("deleted channel clears offer");
    await member.evaluate(
      ({ key, saved }) =>
        localStorage.setItem(
          key,
          JSON.stringify({ ...saved, user: "another-account" }),
        ),
      { key: recordKey, saved: restore },
    );
    await member.reload();
    await showServer(member);
    await expect.poll(() => record(member)).toBeNull();
    evidence.reconnect.push("account mismatch clears offer");
    const another = await api(owner, "POST", "/api/v1/channels", {
      name: "another-call",
      kind: "voice",
    });
    await member
      .locator(`[data-channel-id="${another.id}"] button.channel`)
      .click();
    await connected(member);
    assert.equal((await record(member)).channel, another.id);
    await member
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await member.getByRole("button", { name: "Account", exact: true }).click();
    await member
      .getByRole("button", { name: "Sign out of this server", exact: true })
      .click();
    await expect.poll(() => record(member)).toBeNull();
    evidence.reconnect.push("logout clears remembered channel");
    await owner
      .getByRole("button", { name: "Direct messages and notifications" })
      .click();
    await owner
      .getByRole("combobox", { name: "Search direct messages" })
      .fill("alice");
    const offlineResult = owner.locator('.dm-people-results [role="option"]');
    await expect(offlineResult).toHaveCount(1);
    await expect(offlineResult).toBeEnabled();
    await contexts[0].setOffline(true);
    await owner.evaluate(() => {
      for (const socket of window.appearanceSockets) socket.close();
    });
    await expect(offlineResult).toBeDisabled();
    assert.equal(
      await offlineResult.locator(".profile-user-name").evaluate((element) => {
        for (let node = element; node; node = node.parentElement)
          if (Number(getComputedStyle(node).opacity) !== 1) return false;
        return element.style.getPropertyValue("--name-color") === "#777777";
      }),
      true,
    );
    evidence.names.push({ kind: "disconnected search result", opacity: 1 });
    await owner.screenshot({ path: "test-results/name-offline-search.png" });
    assert.deepEqual(errors, []);
    console.log("Media appearance runtime", JSON.stringify(evidence));
  } finally {
    await fs.writeFile(
      "test-results/media-appearance.json",
      JSON.stringify({ ...evidence, errors }, null, 2),
    );
    await Promise.all(contexts.map((context) => context.close()));
  }
}
