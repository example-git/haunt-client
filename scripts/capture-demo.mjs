import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fillSignin } from "./signin-fields.mjs";
import { composeDemoBanner } from "./compose-demo-banner.mjs";

// Uses only the isolated integration fixtures; never connects to a saved account.
export async function captureDemo(browser, fixtures) {
  const directory = path.resolve("test-results/demo");
  await fs.mkdir(directory, { recursive: true });
  const errors = [],
    contexts = [],
    shots = [];
  const api = async (token, route, body, method = body ? "POST" : "GET") => {
    const response = await fetch(fixtures.rtc.url + "/api/v1" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert(
      response.ok,
      `${method} ${route}: ${response.status} ${response.ok ? "" : await response.text()}`,
    );
    return response.status === 204 ? undefined : response.json();
  };
  const make = async (user) => {
    const ctx = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
      permissions: ["microphone", "camera"],
      reducedMotion: "reduce",
    });
    contexts.push(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(fixtures.rtc.url);
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixtures.rtc.url, user);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    return page;
  };
  const settings = async (page, name) => {
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await page.getByRole("button", { name, exact: true }).click();
  };
  const close = (page) =>
    page.getByRole("button", { name: "Close", exact: true }).click();
  const shot = async (page, name, description) => {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(1580, 980);
    await page.screenshot({
      path: path.join(directory, name + ".png"),
      animations: "disabled",
    });
    shots.push({ file: name + ".png", description });
  };
  try {
    const ownerLogin = await api(null, "/auth/login", {
      username: "owner",
      password: fixtures.password,
      device_name: "Demo setup",
    });
    const aliceLogin = await api(null, "/auth/login", {
      username: "alice",
      password: fixtures.password,
      device_name: "Demo setup",
    });
    const bobLogin = await api(null, "/auth/login", {
      username: "bob",
      password: fixtures.password,
      device_name: "Demo setup",
    });
    for (const [login, display_name, accent_color, bio] of [
      [
        ownerLogin,
        "Rowan",
        "#b7c8f4",
        "Design, music, and small community spaces.",
      ],
      [aliceLogin, "Maya", "#d5b5e5", "Usually drawing, sometimes gardening."],
      [bobLogin, "Jules", "#a6d7b7", "Building things with friends."],
    ])
      await api(
        login.token,
        "/me/profile",
        { display_name, accent_color, bio },
        "PUT",
      );
    const category = await api(ownerLogin.token, "/categories", {
      name: "THE COMMON ROOM",
    });
    const studio = await api(ownerLogin.token, "/channels", {
      name: "studio",
      kind: "text",
      category_id: category.id,
      topic: "Sketches, small projects, and things we made this week",
    });
    for (const name of ["weekend-plans", "listening-room", "field-notes"])
      await api(ownerLogin.token, "/channels", {
        name,
        kind: "text",
        category_id: category.id,
      });
    const messages = [
      [
        ownerLogin,
        "The print files are ready for Saturday. I kept the layout simple so everyone can add their own drawings.",
      ],
      [
        aliceLogin,
        "Love the extra space around the illustrations. The little moon in the corner is staying, right?",
      ],
      [
        ownerLogin,
        "Absolutely. **Final details:**\n- A5 folded booklet\n- Two colors, uncoated paper\n- Bring a sketch or a short story",
      ],
      [
        bobLogin,
        "I can bring the paper cutter and an extra extension lead. Coffee at 10?",
      ],
      [aliceLogin, "10 works! I’ll bring the sketchbooks. ☕ 🌿"],
      [
        ownerLogin,
        "Perfect. There’s no deadline for finishing anything — just a morning to make things together.",
      ],
      [
        bobLogin,
        "Pushed the little gallery page too:\n```css\n.gallery {\n  display: grid;\n  gap: 1.5rem;\n}\n```",
      ],
      [
        aliceLogin,
        "The spacing feels so much better now. I’m in the lounge if anyone wants a second pair of eyes.",
      ],
    ];
    for (const [login, body] of messages)
      await api(login.token, `/conversations/${studio.id}/messages`, {
        request_id: randomUUID(),
        body,
      });
    for (const [login, body] of [
      [
        aliceLogin,
        "I’ve got the sketches open. Want to go through the cover first?",
      ],
      [ownerLogin, "Yes — let’s start with the moon illustration."],
      [bobLogin, "Here too. The audio sounds clear."],
    ])
      await api(login.token, `/conversations/${fixtures.rtc.voice}/messages`, {
        request_id: randomUUID(),
        body,
      });
    const page = await make("owner");
    await page
      .locator(`[data-channel-id="${studio.id}"] button.channel`)
      .click();
    await expect(page.locator(".message-body").last()).toContainText(
      "second pair of eyes",
    );
    // Native effects aren't simulated in demo images; these are genuine browser captures.
    for (const name of [
      "Charcoal",
      "Midnight",
      "Plum",
      "Forest",
      "Paper",
      "Ultraviolet",
      "Tidal",
      "Afterglow",
      "Rose Slate",
      "Mint Ink",
      "Peach Noir",
      "Lilac Carbon",
      "wumpoff",
    ]) {
      await settings(page, "Appearance");
      await page.getByRole("button", { name, exact: true }).click();
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      if (name === "Midnight")
        await shot(
          page,
          "06-appearance",
          "Theme presets and custom color controls",
        );
      await close(page);
      await shot(
        page,
        name.toLowerCase().replaceAll(" ", "-"),
        `${name} theme with community chat and members`,
      );
    }
    await settings(page, "Appearance");
    await page.getByRole("button", { name: "Midnight", exact: true }).click();
    await page.getByLabel("Accent hex", { exact: true }).fill("#a4cfef");
    await page.getByRole("tab", { name: "Saved", exact: true }).click();
    await page.getByLabel("Theme name", { exact: true }).fill("Evening blue");
    await page
      .getByRole("button", { name: "Save as new theme", exact: true })
      .click();
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export theme", exact: true })
      .click();
    const downloaded = await downloadEvent;
    const exported = await fs.readFile(await downloaded.path());
    const shared = JSON.parse(exported.toString());
    assert.equal(shared.accentColor, "#a4cfef");
    assert.equal(shared.format, "haunt-theme");
    assert.deepEqual(Object.keys(shared).sort(), [
      "accentColor",
      "format",
      "name",
      "theme",
      "version",
    ]);
    await page
      .getByRole("button", { name: "Delete saved theme", exact: true })
      .click();
    await page.getByLabel("Import theme file", { exact: true }).setInputFiles({
      name: "demo.haunt-theme.json",
      mimeType: "application/json",
      buffer: exported,
    });
    await expect(
      page.locator(".theme-picker").getByRole("status"),
    ).toContainText("Theme imported");
    await page.getByRole("tab", { name: "Built-in", exact: true }).click();
    await page.getByRole("button", { name: "Charcoal", exact: true }).click();
    await page.getByRole("tab", { name: "Saved", exact: true }).click();
    await page
      .getByRole("button", { name: "Apply saved theme", exact: true })
      .click();
    await close(page);
    await page.reload();
    await page
      .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
      .click();
    await settings(page, "Appearance");
    await expect(page.getByLabel("Accent hex", { exact: true })).toHaveValue(
      "#a4cfef",
    );
    await expect(
      page.getByLabel("Background and server rail hex", { exact: true }),
    ).toHaveValue("#101622");
    await page.getByRole("tab", { name: "Saved", exact: true }).click();
    await expect(
      page
        .getByLabel("Your themes", { exact: true })
        .locator("option")
        .filter({ hasText: "Evening blue" }),
    ).toHaveCount(1);
    await page
      .getByLabel("Your themes", { exact: true })
      .selectOption({ label: "Evening blue" });
    await shot(
      page,
      "11-saved-themes",
      "Save, import and export named themes with editable colors",
    );
    const bannerTheme = process.env.HAUNT_DEMO_THEME ?? "Midnight";
    await page.getByRole("tab", { name: "Built-in", exact: true }).click();
    const preset = page.locator(".theme-presets").getByRole("button", {
      name: bannerTheme,
      exact: true,
    });
    assert.equal(
      await preset.count(),
      1,
      `Unknown banner theme: ${bannerTheme}`,
    );
    await preset.click();
    await expect(preset).toHaveAttribute("aria-pressed", "true");
    await close(page);
    await settings(page, "Server audio plugins");
    await page
      .getByLabel("Noise processing model", { exact: true })
      .selectOption("little");
    await page.getByLabel("Suppression strength", { exact: true }).fill("75");
    await page
      .getByRole("button", { name: "Set as server default", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Current plugin, model" }),
    ).toBeVisible();
    const defaults = (await api(ownerLogin.token, "/audio-plugins")).default;
    assert.equal(defaults.id, "rnnoise");
    assert.equal(defaults.variant, "little");
    assert.equal(defaults.values.strength, 75);
    await shot(
      page,
      "07-audio-plugin",
      "RNNoise controls and administrator default selection",
    );
    await close(page);
    const maya = await make("alice");
    await settings(maya, "Server audio plugins");
    await expect(
      maya.getByLabel("Noise processing model", { exact: true }),
    ).toHaveValue("little");
    await expect(
      maya.getByLabel("Suppression strength", { exact: true }),
    ).toHaveValue("75");
    await expect(
      maya.getByRole("button", { name: "Set as server default" }),
    ).toHaveCount(0);
    await close(maya);
    for (const who of [page, maya])
      await who
        .locator(`[data-channel-id="${fixtures.rtc.voice}"] button.channel`)
        .click();
    await expect(page.locator(".call-tile")).toHaveCount(2, { timeout: 45000 });
    await expect(page.locator(".call-dock")).toBeVisible();
    await expect(
      page.locator(".call-plugin-notice[data-state='active']"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Dismiss audio plugin notice", exact: true })
      .click();
    await expect(page.locator(".call-plugin-notice")).toHaveCount(0);
    await shot(
      page,
      "08-voice",
      "Two participants in a real local voice call with pinned channel chat",
    );
    await page
      .locator(`[data-channel-id="${studio.id}"] button.channel`)
      .click();
    await expect(page.locator(".call-panel.mini")).toBeVisible();
    await shot(
      page,
      "09-voice-pip",
      "Persistent voice controls and picture-in-picture while reading chat",
    );
    await page.locator(".member-row").filter({ hasText: "Maya" }).click();
    await shot(page, "10-profile", "Server-scoped member profile");
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(directory, "index.json"),
      JSON.stringify(
        {
          kind: "Actual web-client captures with isolated demo data",
          nativeWindowEffects:
            "Not captured or runtime-tested on this Linux host",
          shots,
        },
        null,
        2,
      ),
    );
    await composeDemoBanner(browser, directory, bannerTheme);
    console.log(
      JSON.stringify({
        check: "themes-and-demo",
        themePersistence: true,
        themeSharing: true,
        serverDefaultForNewClient: true,
        screenshotCount: shots.length,
        passed: true,
      }),
    );
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
}
