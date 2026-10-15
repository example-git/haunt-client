import { captureDemo } from "./capture-demo.mjs";
import { checkSourceAudio } from "./check-source-audio.mjs";
import { fillSignin } from "./signin-fields.mjs";
import { checkVoiceSettings } from "./check-voice-settings.mjs";
import { checkSecureDM } from "./check-dm-secure.mjs";
import { checkCallPopout } from "./check-call-popout.mjs";
import { checkRoleSections } from "./check-role-sections.mjs";
import { checkDirectMessages } from "./check-direct-messages.mjs";
import { checkClientState, checkWebUpdates } from "./check-client-state.mjs";
import { checkNotificationSounds } from "./check-notification-sounds.mjs";
import { checkPluginDownloads } from "./check-plugin-downloads.mjs";
import { checkPlugins } from "./check-plugins.mjs";
import { checkPluginRepository } from "./check-plugin-repository.mjs";
import { checkConfiguration } from "./check-configuration.mjs";
import { checkAttachmentInput } from "./check-attachment-input.mjs";
import { checkSignin } from "./check-signin.mjs";
import { checkImageCache } from "./check-image-cache.mjs";
import { checkMediaStatus } from "./check-media-status.mjs";
import { checkNativeMedia } from "./check-native-media-runtime.mjs";
import { checkAudio } from "./check-audio.mjs";
import { checkWindows } from "./check-windows.mjs";
import { checkBranding } from "./check-branding.mjs";
import { checkPresenceAppearance } from "./check-presence-appearance.mjs";
import { checkOnboarding } from "./check-onboarding.mjs";
import { checkModeration } from "./check-moderation.mjs";
import { checkEmojis, checkDesktopEmojiSettings } from "./check-emojis.mjs";
import { checkNoise } from "./check-noise.mjs";
import { checkCallControls } from "./check-call-controls.mjs";
import { checkEmbeds, checkDesktopLinks } from "./check-embeds.mjs";
import { checkGateway } from "./check-gateway.mjs";
import { checkScreen, cleanupScreen } from "./check-screen.mjs";
import {
  checkNotifications,
  checkDesktopNotifications,
} from "./check-notifications.mjs";
import { checkCustomization } from "./check-customization.mjs";
import { chromium, _electron as electron, expect } from "@playwright/test";
import { serveBuild } from "./serve-build.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const fixtures = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "chatxo-client-e2e-"));
const results = path.resolve("test-results");
await fs.mkdir(results, { recursive: true });
const owned = [];
let vite, browser, desktop;
// Only processes launched here, with private profiles and their own groups, can
// be stopped by this harness. No process searches or container/browser cleanup.
function launch(command, args, env = process.env) {
  const child = spawn(command, args, {
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  owned.push(child);
  child.stderr.on("data", () => {});
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  process.kill(-child.pid, "SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    process.kill(-child.pid, "SIGKILL");
    await once(child, "exit");
  }
}
const errors = [];
const observe = (page) => {
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));
};
async function connect(page, server, user = "alice", register = false) {
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  if (register)
    await page
      .getByRole("button", { name: "Have an invitation? Create an account" })
      .click();
  if (register) {
    await page.getByLabel("Server address").fill(server.url);
    await page.getByLabel("Username", { exact: true }).fill(user);
  } else await fillSignin(page, server.url, user);
  await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
  if (register)
    await page.getByLabel("Invitation code").fill(server.invitation);
  await page
    .getByRole("button", {
      name: register ? "Create account" : "Sign in",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog"))
    .toHaveCount(0, { timeout: 20_000 })
    .catch(async (error) => {
      console.error(
        "Connect error:",
        await page.locator(".error").allTextContents(),
      );
      throw error;
    });
  await expect(page.locator(".connection")).toHaveText("Connected", {
    timeout: 20_000,
  });
}
async function send(page, body) {
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(body);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.locator(".message-body").filter({ hasText: body }),
  ).toHaveCount(1, { timeout: 15_000 });
}

let cleaning;
function cleanup() {
  return (cleaning ??= (async () => {
    await cleanupScreen().catch(() => {});
    await desktop?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (vite) await new Promise((resolve) => vite.close(resolve));
    for (const child of owned.reverse()) await stop(child).catch(() => {});
    await fs.rm(scratch, { recursive: true, force: true });
  })());
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void cleanup().finally(() => process.exit(1)));

async function audioPeak(page) {
  return page
    .locator(".call-panel audio")
    .first()
    .evaluate(async (element) => {
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(element.srcObject),
        analyser = context.createAnalyser(),
        gain = context.createGain();
      gain.gain.value = 0;
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(context.destination);
      const samples = new Float32Array(512);
      analyser.fftSize = 512;
      let peak = 0;
      for (let i = 0; i < 60; i++) {
        analyser.getFloatTimeDomainData(samples);
        peak = Math.max(peak, ...samples.map(Math.abs));
        if (peak > 0.01) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      source.disconnect();
      analyser.disconnect();
      gain.disconnect();
      await context.close();
      return peak;
    });
}

try {
  vite = await serveBuild();
  const chrome = launch("/usr/bin/google-chrome", [
    "--headless=new",
    "--no-sandbox",
    ...(process.env.HAUNT_CLIENT_CHECK === "native-media"
      ? ["--enable-gpu"]
      : ["--disable-gpu"]),
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--no-first-run",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${path.resolve("tests/fixtures/noise-speech.wav")}`,
    "--autoplay-policy=no-user-gesture-required",
    "--auto-select-desktop-capture-source=Entire screen",
    "--remote-debugging-port=0",
    `--user-data-dir=${scratch}/chrome`,
    "about:blank",
  ]);
  let port;
  for (let i = 0; i < 200; i++) {
    try {
      port = (
        await fs.readFile(
          path.join(scratch, "chrome", "DevToolsActivePort"),
          "utf8",
        )
      ).split("\n")[0];
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  assert(port, "Owned Chrome did not start");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  if (process.env.HAUNT_CLIENT_CHECK === "demo") {
    await captureDemo(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "source-audio") {
    await checkSourceAudio(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "media-status") {
    await checkMediaStatus(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "desktop-media-status") {
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page) =>
      checkMediaStatus(browser, fixtures, page),
    );
  } else if (process.env.HAUNT_CLIENT_CHECK === "native-media") {
    await checkNativeMedia(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "desktop-proxy") {
    await checkScreen(
      process.env.HAUNT_PACKAGED_EXECUTABLE,
      async (page, desktop) => {
        await desktop.evaluate(({ session }, certificate) => {
          for (const target of [
            session.defaultSession,
            session.fromPartition("persist:chatxo"),
          ])
            target.setCertificateVerifyProc((request, callback) => {
              callback(
                request.hostname === "127.0.0.1" &&
                  request.certificate.data.trim().replaceAll("\r", "") ===
                    certificate.trim()
                  ? 0
                  : -3,
              );
            });
        }, fixtures.rtc.tlsCertificate);
        await checkSignin(browser, fixtures, page);
      },
    );
    process.exitCode = 0;
  } else if (process.env.HAUNT_CLIENT_CHECK === "plugin-downloads") {
    const context = await browser.newContext({
      permissions: ["microphone", "camera"],
    });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkPluginDownloads(page, fixtures);
    } finally {
      await context.close();
    }
    if (process.env.HAUNT_PLUGIN_DESKTOP === "1")
      await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page) =>
        checkPluginDownloads(page, fixtures, "electron"),
      );
  } else if (process.env.HAUNT_CLIENT_CHECK === "secure-dm") {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 960 },
    });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkSecureDM(page, fixtures, browser);
    } finally {
      await context.close();
    }
    if (process.env.HAUNT_DM_DESKTOP === "1")
      await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page) =>
        checkSecureDM(page, fixtures, browser, "electron"),
      );
  } else if (process.env.HAUNT_CLIENT_CHECK === "direct-messages") {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 960 },
      permissions: ["microphone", "camera"],
    });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkDirectMessages(page, fixtures, browser);
    } finally {
      await context.close();
    }
    if (process.env.HAUNT_DM_DESKTOP === "1")
      await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page) =>
        checkDirectMessages(page, fixtures, browser, "electron"),
      );
  } else if (process.env.HAUNT_CLIENT_CHECK === "notification-sounds") {
    const context = await browser.newContext({
      permissions: ["microphone", "camera"],
    });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkNotificationSounds(page, fixtures);
    } finally {
      await context.close();
    }
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page) =>
      checkNotificationSounds(page, fixtures, "electron"),
    );
  } else if (process.env.HAUNT_CLIENT_CHECK === "role-sections") {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 960 },
    });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkRoleSections(browser, page, fixtures);
    } finally {
      await context.close();
    }
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page) =>
      checkRoleSections(browser, page, fixtures, "electron"),
    );
  } else if (process.env.HAUNT_CLIENT_CHECK === "web-updates") {
    await checkWebUpdates(browser);
  } else if (process.env.HAUNT_CLIENT_CHECK === "client-state") {
    const context = await browser.newContext({
      viewport: { width: 1360, height: 900 },
    });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkClientState(page, fixtures);
    } finally {
      await context.close();
    }
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, async (page) => {
      let checks = 0;
      page.on("request", (request) => {
        if (request.url().includes("haunt-build.json")) checks++;
      });
      await checkClientState(page, fixtures, "electron");
      await page.waitForTimeout(21000);
      assert.equal(checks, 0, "Electron never checks web build freshness");
    });
    await checkWebUpdates(browser);
  } else if (process.env.HAUNT_CLIENT_CHECK === "plugin-repository") {
    const context = await browser.newContext({
      permissions: ["microphone", "camera"],
    });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkPluginRepository(page, fixtures);
    } finally {
      await context.close();
    }
  } else if (process.env.HAUNT_CLIENT_CHECK === "plugins") {
    const context = await browser.newContext({
      permissions: ["microphone", "camera"],
    });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkPlugins(page, fixtures);
    } finally {
      await context.close();
    }
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page) =>
      checkPlugins(page, fixtures, "electron"),
    );
  } else if (process.env.HAUNT_CLIENT_CHECK === "configuration") {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkConfiguration(page, fixtures);
    } finally {
      await context.close();
    }
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page) =>
      checkConfiguration(page, fixtures, "electron"),
    );
  } else if (process.env.HAUNT_CLIENT_CHECK === "attachment-input") {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkAttachmentInput(page, fixtures);
    } finally {
      await context.close();
    }
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page, desktop) =>
      checkAttachmentInput(page, fixtures, desktop),
    );
  } else if (process.env.HAUNT_CLIENT_CHECK === "image-cache") {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkImageCache(page, fixtures);
    } finally {
      await context.close();
    }
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page) =>
      checkImageCache(page, fixtures, "bob"),
    );
  } else if (
    ["signin", "signin-browser"].includes(process.env.HAUNT_CLIENT_CHECK)
  ) {
    await checkSignin(browser, fixtures);
    if (process.env.HAUNT_CLIENT_CHECK === "signin")
      await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page) =>
        checkSignin(browser, fixtures, page),
      );
    process.exitCode = 0;
  } else if (process.env.HAUNT_CLIENT_CHECK === "windows") {
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page, desktop) =>
      checkWindows(browser, fixtures, page, desktop),
    );
    process.exitCode = 0;
  } else if (process.env.HAUNT_CLIENT_CHECK === "presence-appearance") {
    await checkPresenceAppearance(browser, fixtures);
    await checkCallControls(browser, fixtures);
    await checkOnboarding(browser, fixtures);
    process.exitCode = 0;
  } else if (process.env.HAUNT_CLIENT_CHECK === "desktop-presence-appearance") {
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page) =>
      checkPresenceAppearance(browser, fixtures, page),
    );
    process.exitCode = 0;
  } else if (process.env.HAUNT_CLIENT_CHECK === "branding") {
    const context = await browser.newContext({
      viewport: { width: 1360, height: 950 },
    });
    try {
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkBranding(page);
    } finally {
      await context.close();
    }
    await checkGateway(browser, fixtures);
    await checkScreen(
      process.env.HAUNT_PACKAGED_EXECUTABLE,
      async (page, desktop) => {
        await checkBranding(page, desktop);
        await checkOnboarding(browser, fixtures, page, desktop);
      },
    );
    process.exitCode = 0;
  } else if (process.env.HAUNT_CLIENT_CHECK === "desktop-branding") {
    await checkScreen(
      process.env.HAUNT_PACKAGED_EXECUTABLE,
      async (page, desktop) => {
        await checkBranding(page, desktop);
        await checkOnboarding(browser, fixtures, page, desktop);
      },
    );
    process.exitCode = 0;
  } else if (process.env.HAUNT_CLIENT_CHECK === "onboarding") {
    await checkOnboarding(browser, fixtures);
    process.exitCode = 0;
  } else if (process.env.HAUNT_CLIENT_CHECK === "desktop-onboarding") {
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, (page, desktop) =>
      checkOnboarding(browser, fixtures, page, desktop),
    );
    process.exitCode = 0;
  } else if (process.env.HAUNT_CLIENT_CHECK === "desktop-moderation") {
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, async (page) => {
      observe(page);
      await connect(page, fixtures.rtc, "owner");
      await page
        .getByRole("button", { name: "Server settings", exact: true })
        .click();
      const sections = page.getByRole("navigation", {
        name: "Server settings sections",
      });
      await sections
        .getByRole("button", { name: "Roles & permissions", exact: true })
        .click();
      await expect(
        page.getByLabel("Role rank", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Ban members & review appeals", { exact: true }),
      ).toBeVisible();
      await sections
        .getByRole("button", { name: "Members", exact: true })
        .click();
      await page.getByLabel("Find a member").fill("bob");
      await page
        .locator(".settings-list-row")
        .filter({ hasText: "@bob" })
        .click();
      await page
        .getByRole("button", { name: "Kick member", exact: true })
        .click();
      await page
        .getByLabel("Reason", { exact: true })
        .fill("Packaged desktop moderation check");
      await page
        .getByRole("button", { name: "Confirm kick", exact: true })
        .click();
      await expect(
        page.getByText("Kicked — a new invitation is required to return", {
          exact: true,
        }),
      ).toBeVisible();
      await sections
        .getByRole("button", { name: "Audit log", exact: true })
        .click();
      await expect(
        page.getByText("Member kicked", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(results, "moderation-desktop.png"),
      });
      assert.deepEqual(errors, []);
      console.log("Packaged desktop moderation checks passed.");
    });
  } else if (process.env.HAUNT_CLIENT_CHECK === "desktop-emojis") {
    await checkScreen(process.env.HAUNT_PACKAGED_EXECUTABLE, async (page) => {
      observe(page);
      await connect(page, fixtures.rtc, "owner");
      await checkDesktopEmojiSettings(page);
      assert.deepEqual(errors, []);
    });
  } else if (process.env.HAUNT_CLIENT_CHECK === "moderation") {
    await checkModeration(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "emojis") {
    await checkEmojis(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "audio") {
    const ctx = await browser.newContext({
      permissions: ["microphone", "camera"],
    });
    try {
      const page = await ctx.newPage();
      await page.goto("http://127.0.0.1:5173");
      await checkAudio(page, fixtures);
    } finally {
      await ctx.close();
    }
    await checkScreen(
      process.env.HAUNT_PACKAGED_EXECUTABLE,
      async (page, desktop) => {
        await desktop.evaluate(({ dialog }) => {
          globalThis.audioPermissionPrompts = 0;
          const original = dialog.showMessageBox.bind(dialog);
          dialog.showMessageBox = async (...args) => {
            if (args.some((arg) => arg?.title === "Allow call capture?"))
              globalThis.audioPermissionPrompts++;
            return original(...args);
          };
        });
        await checkAudio(page, fixtures);
        assert.equal(
          await desktop.evaluate(() => globalThis.audioPermissionPrompts),
          0,
          "Granted microphone access must not show an extra app permission dialog",
        );
      },
    );
  } else if (process.env.HAUNT_CLIENT_CHECK === "noise") {
    await checkNoise(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "voice-settings") {
    await checkVoiceSettings(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "call-popout") {
    await checkCallPopout(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "calls") {
    await checkCallControls(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "embeds") {
    await checkEmbeds(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "gateway") {
    await checkGateway(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "notifications") {
    await checkNotifications(browser, fixtures);
  } else if (process.env.HAUNT_CLIENT_CHECK === "customization") {
    await checkCustomization(browser, fixtures);
  } else {
    const a = await browser.newContext({
        viewport: { width: 1280, height: 850 },
        permissions: ["microphone", "camera"],
      }),
      b = await browser.newContext({
        viewport: { width: 1120, height: 800 },
        permissions: ["microphone", "camera"],
      });
    const alice = await a.newPage(),
      bob = await b.newPage();
    observe(alice);
    observe(bob);
    await Promise.all([
      alice.goto("http://127.0.0.1:5173"),
      bob.goto("http://127.0.0.1:5173"),
    ]);
    await connect(alice, fixtures.rtc, "alice");
    await connect(bob, fixtures.rtc, "bob");
    await expect(alice.locator(".message-body")).toHaveCount(100);
    await alice
      .getByRole("button", { name: "Show older downloaded messages" })
      .click();
    await expect(alice.locator(".message-body")).toHaveCount(105);
    await send(alice, "Hello from the browser");
    await expect(
      bob.getByText("Hello from the browser", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    const row = alice
      .locator(".message")
      .filter({ hasText: "Hello from the browser" });
    await row.hover();
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await row.locator("textarea").fill("Edited from the browser");
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      bob.getByText("Edited from the browser", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await send(alice, "<img src=x onerror=alert(1)> is plain text");
    assert.equal(await alice.locator(".message-body img").count(), 0);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    await alice
      .locator("input[type=file]")
      .setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
    await expect(alice.locator(".attachment-chips")).toContainText("pixel.png");
    await send(alice, "A tiny shared image");
    await expect(bob.locator("img.attachment-image")).toBeVisible();
    await alice.reload();
    await expect(alice.locator(".connection")).toHaveText("Connected", {
      timeout: 20_000,
    });
    await expect(
      alice.getByText("Edited from the browser", { exact: true }),
    ).toBeVisible();
    const deleted = alice
      .locator(".message")
      .filter({ hasText: "Edited from the browser" });
    await deleted.hover();
    await deleted.getByRole("button", { name: "Delete", exact: true }).click();
    await alice
      .getByRole("button", { name: "Delete message", exact: true })
      .click();
    await expect(
      bob.getByText("Edited from the browser", { exact: true }),
    ).toHaveCount(0, { timeout: 10_000 });
    await alice
      .getByRole("button", { name: "New direct message", exact: true })
      .click();
    await alice
      .locator(".people-list label")
      .filter({ hasText: "bob" })
      .getByRole("checkbox")
      .check();
    await alice
      .getByRole("button", { name: "Start conversation", exact: true })
      .click();
    await expect(alice.getByRole("dialog")).toHaveCount(0);
    await expect(alice.locator(".conversation-head h1")).toHaveText("bob");
    await send(alice, "Private hello");
    await bob
      .getByRole("button", { name: "Refresh conversations", exact: true })
      .click();
    await bob.locator(".dm-entry").filter({ hasText: "alice" }).click();
    await expect(bob.getByText("Private hello", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    console.log(
      "PASS browser messaging: history pagination, live delivery, edits, tombstones, attachments, reload, DMs, text escaping",
    );
    await connect(alice, fixtures.ws, "alice");
    await send(alice, "Independent garden connection");
    for (const server of [fixtures.rtc, fixtures.ws])
      await expect(
        alice.getByRole("button", { name: `Open ${server.name}`, exact: true }),
      ).toHaveAttribute("title", `${server.name} · online`);
    // A network interruption persists an outbox entry and recovers the event stream.
    await a.setOffline(true);
    await alice
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Saved during interruption");
    await alice
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(alice.locator(".pending-message")).toContainText(
      "Saved during interruption",
    );
    await a.setOffline(false);
    await expect(alice.locator(".connection")).toHaveText("Connected", {
      timeout: 40_000,
    });
    await alice
      .locator(".pending-message")
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await expect(
      alice
        .locator(".message-body")
        .filter({ hasText: "Saved during interruption" }),
    ).toHaveCount(1, { timeout: 15_000 });
    await expect(alice.locator(".pending-message")).toHaveCount(0);
    await alice.screenshot({
      path: path.join(results, "browser.png"),
      fullPage: true,
    });
    console.log(
      "PASS independent instances and durable retry after a network interruption",
    );
    // Both call transport implementations are chosen only by server admission.
    for (const server of [fixtures.rtc, fixtures.ws]) {
      if (server === fixtures.ws) await connect(bob, server, "bob");
      else {
        await alice
          .getByRole("button", { name: `Open ${server.name}`, exact: true })
          .click();
        await bob
          .getByRole("button", { name: `Open ${server.name}`, exact: true })
          .click();
      }
      if (server === fixtures.ws)
        await alice
          .getByRole("button", { name: `Open ${server.name}`, exact: true })
          .click();
      await alice
        .getByRole("button", { name: "lounge Join", exact: true })
        .click();
      await expect(alice.locator(".call-panel header small")).toContainText(
        "1 in the room",
        { timeout: 25_000 },
      );
      await bob
        .getByRole("button", { name: "lounge Join", exact: true })
        .click();
      await expect(bob.locator(".call-panel header small")).toContainText(
        "2 in the room",
        { timeout: 25_000 },
      );
      await expect(alice.locator(".call-panel audio")).toHaveCount(1, {
        timeout: 25_000,
      });
      await expect(bob.locator(".call-panel audio")).toHaveCount(1, {
        timeout: 25_000,
      });
      assert(
        (await audioPeak(bob)) > 0.01,
        "Receiver must decode non-silent microphone audio",
      );
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Turn on camera", exact: true })
        .click();
      await expect(bob.locator(".call-panel video")).toHaveCount(1, {
        timeout: 25_000,
      });
      await expect
        .poll(
          () =>
            bob.locator(".call-panel video").evaluate((el) => el.videoWidth),
          { timeout: 25_000 },
        )
        .toBeGreaterThan(0);
      const videoTime = await bob
        .locator(".call-panel video")
        .evaluate((el) => el.currentTime);
      await expect
        .poll(
          () =>
            bob.locator(".call-panel video").evaluate((el) => el.currentTime),
          { timeout: 15_000 },
        )
        .toBeGreaterThan(videoTime);
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Share screen", exact: true })
        .click();
      await expect(bob.locator(".call-panel video")).toHaveCount(2, {
        timeout: 25_000,
      });
      await expect
        .poll(() =>
          bob
            .locator(".call-panel video")
            .last()
            .evaluate((el) => el.videoWidth),
        )
        .toBeGreaterThan(0);
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Stop sharing screen", exact: true })
        .click();
      await expect(bob.locator(".call-panel video")).toHaveCount(1, {
        timeout: 20_000,
      });
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Mute microphone", exact: true })
        .click();
      await expect(
        alice
          .locator(".call-dock")
          .getByRole("button", { name: "Unmute microphone", exact: true }),
      ).toBeVisible();
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Turn off camera", exact: true })
        .click();
      await expect(bob.locator(".call-panel video")).toHaveCount(0, {
        timeout: 20_000,
      });
      await alice
        .locator(".call-dock")
        .getByRole("button", { name: "Leave call", exact: true })
        .click();
      await bob
        .locator(".call-dock")
        .getByRole("button", { name: "Leave call", exact: true })
        .click();
      console.log(
        `PASS automatic ${server === fixtures.rtc ? "WebRTC" : "WebSocket"} call: two browsers, microphone streams, decoded moving camera video, screen sharing, mute and leave`,
      );
    }
    await alice.setViewportSize({ width: 390, height: 844 });
    await expect(
      alice.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeVisible();
    await alice.screenshot({
      path: path.join(results, "mobile-layout.png"),
      fullPage: true,
    });
    assert.equal(
      await alice.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const c = await browser.newContext(),
      charlie = await c.newPage();
    observe(charlie);
    await charlie.goto("http://127.0.0.1:5173");
    await connect(charlie, fixtures.rtc, "charlie", true);
    await send(charlie, "Invitation registration works");
    await c.close();
    // New X server, dedicated to this Electron invocation. Existing displays and
    // browser processes are never inspected or managed.
    const xvfb = launch("Xvfb", [
      "-displayfd",
      "1",
      "-screen",
      "0",
      "1280x900x24",
      "-nolisten",
      "tcp",
    ]);
    const display = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Xvfb timeout")), 10_000);
      xvfb.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("\n")) {
          clearTimeout(timer);
          resolve(output.trim());
        }
      });
    });
    const packaged = process.env.HAUNT_PACKAGED_EXECUTABLE;
    desktop = await electron.launch({
      ...(packaged ? { executablePath: packaged } : {}),
      args: [
        "--no-sandbox",
        "--password-store=basic",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${path.resolve("tests/fixtures/noise-speech.wav")}`,
        ...(packaged ? [] : [path.resolve("apps/desktop/main.cjs")]),
      ],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.join(scratch, "config"),
        XDG_CACHE_HOME: path.join(scratch, "cache"),
        DISPLAY: `:${display}`,
        HAUNT_DESKTOP_TEST: "1",
        HAUNT_DESKTOP_TEST_PROFILE: path.join(scratch, "desktop"),
      },
      timeout: 30_000,
    });
    const profile = await desktop.evaluate(({ app }) =>
      app.getPath("userData"),
    );
    assert(
      profile.startsWith(scratch + path.sep),
      "Desktop must use a private profile",
    );
    await desktop.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    const desktopPage = await desktop.firstWindow();
    desktop.on("window", async (picker) => {
      try {
        await picker.waitForLoadState("domcontentloaded");
        if (picker.url().endsWith("capture-picker.html"))
          await picker
            .locator('button.source[data-kind="screen"]')
            .first()
            .click();
      } catch (error) {
        errors.push(error.message);
      }
    });
    observe(desktopPage);
    await desktopPage.waitForLoadState("domcontentloaded");
    await connect(desktopPage, fixtures.rtc, "owner");
    await send(desktopPage, "Hello from the desktop");
    await checkDesktopEmojiSettings(desktopPage);
    assert.equal(
      await desktopPage.evaluate(() => typeof window.require),
      "undefined",
    );
    assert.equal(
      await desktopPage.evaluate(() => typeof window.hauntDesktop.vaultRead),
      "function",
    );
    await desktopPage
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await desktopPage
      .getByRole("button", { name: "Account", exact: true })
      .click();
    await expect(
      desktopPage
        .locator(".device-list")
        .getByText("This device", { exact: true }),
    ).toBeVisible();
    await desktopPage
      .getByRole("button", { name: "Invitations", exact: true })
      .click();
    await desktopPage
      .getByRole("button", { name: "Create invitation", exact: true })
      .click();
    await expect(desktopPage.locator(".invite-code code")).not.toHaveText("");
    await desktopPage
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await bob
      .getByRole("button", { name: `Open ${fixtures.rtc.name}`, exact: true })
      .click();
    await bob.getByRole("button", { name: "lounge Join", exact: true }).click();
    await desktopPage
      .getByRole("button", { name: "lounge Join", exact: true })
      .click();
    await expect(desktopPage.locator(".call-panel header small")).toContainText(
      "2 in the room",
      { timeout: 25_000 },
    );
    await expect(desktopPage.locator(".call-panel")).toHaveAttribute(
      "data-noise-suppression",
      "active",
    );
    assert(
      (await audioPeak(bob)) > 0.01,
      "Desktop audio plugin must preserve transmitted speech",
    );
    await expect(desktopPage.locator(".call-dock")).toBeVisible();
    await expect(desktopPage.locator(".call-tile")).toHaveCount(2);
    await expect
      .poll(() =>
        desktopPage
          .getByRole("meter")
          .evaluateAll((els) =>
            els.some((el) => Number(el.getAttribute("aria-valuenow")) > 0),
          ),
      )
      .toBe(true);
    const desktopTile = desktopPage.locator(".call-tile").first();
    await desktopTile.click();
    await expect(desktopTile).toHaveClass(/focused/);
    await expect(desktopPage.locator(".call-tile:not(.focused)")).toBeVisible();
    await desktopTile.click();
    await desktopPage
      .locator(".call-dock")
      .getByRole("button", { name: "Turn on camera", exact: true })
      .click();
    await expect(bob.locator(".call-panel video")).toHaveCount(1, {
      timeout: 25_000,
    });
    await expect
      .poll(() =>
        bob.locator(".call-panel video").evaluate((el) => el.videoWidth),
      )
      .toBeGreaterThan(0);
    await desktop.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await desktopPage
      .locator(".call-dock")
      .getByRole("button", { name: "Share screen", exact: true })
      .click();
    await expect(bob.locator(".call-panel video")).toHaveCount(2, {
      timeout: 25_000,
    });
    await desktopPage.screenshot({ path: path.join(results, "desktop.png") });
    await desktopPage
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
    await bob
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
    await connect(desktopPage, fixtures.ws, "owner");
    await bob
      .getByRole("button", { name: `Open ${fixtures.ws.name}`, exact: true })
      .click();
    await bob.getByRole("button", { name: "lounge Join", exact: true }).click();
    await desktopPage
      .getByRole("button", { name: "lounge Join", exact: true })
      .click();
    await expect(desktopPage.locator(".call-panel header small")).toContainText(
      "2 in the room",
      { timeout: 25_000 },
    );
    await expect(desktopPage.locator(".call-panel")).toHaveAttribute(
      "data-noise-suppression",
      "active",
    );
    assert(
      (await audioPeak(bob)) > 0.01,
      "Desktop audio plugin must preserve transmitted speech",
    );
    await expect(bob.locator(".call-panel audio")).toHaveCount(1, {
      timeout: 20_000,
    });
    assert(
      (await audioPeak(bob)) > 0.01,
      "Desktop WebSocket audio must be decoded by the browser",
    );
    await desktopPage
      .locator(".call-dock")
      .getByRole("button", { name: "Turn on camera", exact: true })
      .click();
    await expect(bob.locator(".call-panel video")).toHaveCount(1, {
      timeout: 25_000,
    });
    await expect
      .poll(() =>
        bob.locator(".call-panel video").evaluate((el) => el.videoWidth),
      )
      .toBeGreaterThan(0);
    await desktopPage
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
    await bob
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
    console.log(
      `PASS ${packaged ? "packaged" : "source"} desktop WebSocket fallback: AudioWorklet, decoded audio and camera video`,
    );
    await checkDesktopNotifications(desktop, desktopPage, fixtures.rtc);
    await checkDesktopLinks(desktop, desktopPage);
    await desktop.close();
    desktop = undefined;
    console.log(
      "PASS real Electron desktop: isolated renderer, API login, messaging, sessions, invitations, camera and screen capture",
    );
    await checkScreen(packaged);
    await checkNoise(browser, fixtures);
    await checkCallControls(browser, fixtures);
    await checkNotifications(browser, fixtures);
    await checkCustomization(browser, fixtures);
    await checkGateway(browser, fixtures);
    await checkEmbeds(browser, fixtures);
    await checkEmojis(browser, fixtures);
    assert.deepEqual(errors, [], "Unexpected browser exceptions");
    console.log("All client runtime checks passed.");
  }
} catch (error) {
  if (browser)
    for (const [i, context] of browser.contexts().entries())
      for (const [j, page] of context.pages().entries())
        await page
          .screenshot({ path: path.join(results, `failure-${i}-${j}.png`) })
          .catch(() => {});
  console.error(error);
  if (errors.length) console.error("Page exceptions:", errors);
  process.exitCode = 1;
} finally {
  await cleanup();
}
