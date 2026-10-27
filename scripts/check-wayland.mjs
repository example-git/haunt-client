import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const exec = promisify(execFile);
const results = path.resolve("test-results/wayland");

export async function checkWayland(executablePath, afterCheck) {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.XDG_SESSION_TYPE, "wayland");
  assert(process.env.WAYLAND_DISPLAY);
  assert(!process.env.DISPLAY, "X11 must be unavailable to the sender");
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-wayland-"));
  await fs.mkdir(results, { recursive: true });
  let desktop;
  try {
    desktop = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [
        "--no-sandbox",
        "--password-store=basic",
        "--ozone-platform=wayland",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${path.resolve("tests/fixtures/noise-speech.wav")}`,
        ...(executablePath ? [] : [path.resolve("apps/desktop/main.cjs")]),
      ],
      env: {
        ...process.env,
        HAUNT_DESKTOP_TEST: "1",
        HAUNT_DESKTOP_TEST_PROFILE: path.join(scratch, "profile"),
        XDG_CACHE_HOME: path.join(scratch, "cache"),
      },
      timeout: 60000,
    });
    desktop.process().stderr.on("data", (data) => {
      process.stderr.write(data);
    });
    await desktop.evaluate(({ desktopCapturer }) => {
      globalThis.captureDiagnostics = { sourceCalls: 0, completed: 0 };
      const original = desktopCapturer.getSources.bind(desktopCapturer);
      desktopCapturer.getSources = async (options) => {
        globalThis.captureDiagnostics.sourceCalls++;
        try {
          const sources = await original(options);
          globalThis.captureDiagnostics.sources = sources.map(
            ({ id, name }) => ({ id, name }),
          );
          return sources;
        } catch (error) {
          globalThis.captureDiagnostics.error = error.message;
          throw error;
        } finally {
          globalThis.captureDiagnostics.completed++;
        }
      };
    });
    const page = await desktop.firstWindow();
    await page
      .getByRole("button", { name: "Join a server", exact: true })
      .waitFor({ timeout: 30000 });
    const surfaces = (node) => [
      node,
      ...(node.nodes || []).flatMap(surfaces),
      ...(node.floating_nodes || []).flatMap(surfaces),
    ];
    let tree, sender;
    await expect
      .poll(
        async () => {
          tree = JSON.parse(
            (await exec("swaymsg", ["-t", "get_tree", "-r"])).stdout,
          );
          sender = surfaces(tree).find(
            (node) => node.app_id === "com.exampleuser.haunt",
          );
          return sender?.shell;
        },
        { timeout: 30000 },
      )
      .toBe("xdg_shell");
    await fs.writeFile(
      path.join(results, "surfaces.json"),
      JSON.stringify(tree, null, 2),
    );
    await afterCheck(page, desktop);
    assert.equal(
      await desktop.evaluate(() => globalThis.captureDiagnostics.sourceCalls),
      0,
      "Native Wayland capture must use the portal worker",
    );
  } catch (error) {
    for (const [i, page] of (desktop?.windows() || []).entries())
      await page
        .screenshot({ path: path.join(results, `failure-${i}.png`) })
        .catch(() => {});
    throw error;
  } finally {
    if (desktop) {
      await fs.writeFile(
        path.join(results, "capture.json"),
        JSON.stringify(
          await desktop
            .evaluate(() => globalThis.captureDiagnostics)
            .catch(() => null),
          null,
          2,
        ),
      );
      await desktop.close();
    }
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

export async function cancelWaylandPortal(sender, desktop, outputCaptures) {
  const choice = process.env.HAUNT_PORTAL_CHOICE;
  assert(choice);
  await fs.writeFile(choice, "");
  const opened = desktop.waitForEvent("window");
  await sender
    .locator(".call-dock")
    .getByRole("button", { name: "Share screen", exact: true })
    .click();
  const picker = await opened;
  await picker.waitForLoadState("domcontentloaded");
  await picker.locator('button.source[data-kind="screen"]').first().click();
  await picker.locator("#audio").setChecked(false);
  await Promise.all([
    picker.waitForEvent("close"),
    picker
      .getByRole("button", { name: "Share", exact: true })
      .click({ noWaitAfter: true })
      .catch((error) => {
        if (!picker.isClosed()) throw error;
      }),
  ]);
  await expect(
    sender
      .locator(".call-dock")
      .getByRole("button", { name: "Share screen", exact: true }),
  ).toBeEnabled();
  assert.equal(await outputCaptures(), 0);
  assert(
    !desktop
      .windows()
      .some((page) => page.url().endsWith("capture-picker.html")),
  );
  await fs.writeFile(choice, "HEADLESS-1\n");
}

export async function checkWaylandVideo(receiver) {
  const video = receiver.locator(
    '.call-panel .video-tile[data-tile-id$=":screen"] video',
  );
  await expect(video).toHaveCount(1);
  const evidence = [];
  for (const [color, rgb] of [
    ["#e02040", [224, 32, 64]],
    ["#20d060", [32, 208, 96]],
  ]) {
    await exec("swaymsg", ["output", "HEADLESS-1", "bg", color, "solid_color"]);
    let observed;
    await expect
      .poll(
        async () => {
          observed = await video.evaluate((element) => {
            const canvas = document.createElement("canvas");
            canvas.width = 160;
            canvas.height = 100;
            const context = canvas.getContext("2d");
            context.drawImage(element, 0, 0, 160, 100);
            return {
              pixel: [...context.getImageData(2, 2, 1, 1).data],
              frames: element.getVideoPlaybackQuality().totalVideoFrames,
              width: element.videoWidth,
              height: element.videoHeight,
            };
          });
          return Math.max(
            ...rgb.map((value, i) => Math.abs(value - observed.pixel[i])),
          );
        },
        { timeout: 30000 },
      )
      .toBeLessThan(25);
    assert(observed.width > 0 && observed.height > 0 && observed.frames > 0);
    evidence.push({ color, ...observed });
    await video.screenshot({
      path: path.join(results, `receiver-${color.slice(1)}.png`),
    });
  }
  assert(evidence[1].frames > evidence[0].frames);
  await fs.writeFile(
    path.join(results, "video.json"),
    JSON.stringify(evidence, null, 2),
  );
}

export async function checkWaylandAudio(receiver) {
  let measured;
  await expect
    .poll(async () => {
      measured = await receiver
        .locator('.call-panel audio[aria-label$="screen_audio"]')
        .evaluate(async (element) => {
          const context = new AudioContext({ sampleRate: 48000 });
          await context.resume();
          const source = context.createMediaStreamSource(element.srcObject);
          const analyser = context.createAnalyser();
          analyser.fftSize = 8192;
          source.connect(analyser);
          try {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const spectrum = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatFrequencyData(spectrum);
            let bin = 1;
            for (let i = 2; i < spectrum.length; i++)
              if (spectrum[i] > spectrum[bin]) bin = i;
            return {
              frequency: (bin * context.sampleRate) / analyser.fftSize,
              decibels: spectrum[bin],
            };
          } finally {
            source.disconnect();
            analyser.disconnect();
            await context.close();
          }
        });
      return Math.abs(measured.frequency - 997);
    })
    .toBeLessThan(12);
  assert(measured.decibels > -45);
  await fs.writeFile(
    path.join(results, "audio.json"),
    JSON.stringify(
      {
        expectedFrequency: 997,
        microphoneMuted: true,
        senderDeafened: true,
        ...measured,
      },
      null,
      2,
    ),
  );
}
