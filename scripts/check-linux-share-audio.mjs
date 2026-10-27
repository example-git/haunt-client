import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkScreen } from "./check-screen.mjs";
import {
  checkWayland,
  checkWaylandVideo,
  checkWaylandAudio,
  cancelWaylandPortal,
} from "./check-wayland.mjs";
import { fillSignin } from "./signin-fields.mjs";

const exec = promisify(execFile);
async function peak(page, purpose) {
  return page
    .locator(`.call-panel audio[aria-label$=" · ${purpose}"]`)
    .evaluate(async (element) => {
      if (!(element.srcObject instanceof MediaStream)) return 0;
      const stream = element.srcObject;
      const context = new AudioContext({ sampleRate: 48000 });
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      source.connect(analyser);
      const samples = new Float32Array(4096);
      let value = 0;
      for (let i = 0; i < 12; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) value = Math.max(value, Math.abs(sample));
      }
      source.disconnect();
      analyser.disconnect();
      await context.close();
      return value;
    });
}
export async function checkLinuxShareAudio(
  browser,
  fixtures,
  { wayland = false } = {},
) {
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), "haunt-linux-audio-"),
  );
  const socket = path.join(scratch, "pulse.sock");
  const config = path.join(scratch, "pulse.pa");
  await fs.writeFile(
    config,
    `load-module module-native-protocol-unix socket=${socket} auth-anonymous=1\nload-module module-null-sink sink_name=haunt_fixture rate=48000 channels=2 sink_properties=device.description=Haunt_test_output\nset-default-sink haunt_fixture\n`,
  );
  const pulse = wayland
    ? undefined
    : spawn(
        "dbus-run-session",
        [
          "--",
          "pulseaudio",
          "-n",
          "--file=" + config,
          "--daemonize=no",
          "--use-pid-file=no",
          "--exit-idle-time=-1",
          "--log-target=stderr",
        ],
        { detached: true, stdio: ["ignore", "ignore", "pipe"] },
      );
  let diagnostics = "",
    playback,
    ticker;
  pulse?.stderr.on("data", (data) => {
    diagnostics = (diagnostics + data).slice(-4000);
  });
  const priorServer = process.env.PULSE_SERVER;
  if (!wayland) process.env.PULSE_SERVER = "unix:" + socket;
  else
    assert(
      process.env.PULSE_SERVER,
      "Wayland CI must supply PipeWire Pulse audio",
    );
  const receiverContext = await browser.newContext({
    permissions: ["camera", "microphone"],
  });
  try {
    if (!wayland)
      await expect
        .poll(async () =>
          fs.access(socket).then(
            () => true,
            () => false,
          ),
        )
        .toBe(true);
    await expect
      .poll(async () => {
        try {
          return JSON.parse(
            (
              await exec("pactl", ["--format=json", "list", "sinks"], {
                env: process.env,
              })
            ).stdout,
          ).map((sink) => sink.name);
        } catch {
          return [];
        }
      })
      .toContain("haunt_fixture");
    playback = spawn(
      "pacat",
      [
        "--playback",
        "--raw",
        "--format=float32le",
        "--rate=48000",
        "--channels=2",
        "--device=haunt_fixture",
      ],
      { env: process.env, stdio: ["pipe", "ignore", "pipe"] },
    );
    playback.stderr.on("data", (data) => {
      diagnostics += data;
    });
    playback.stdin.on("error", () => {});
    let position = 0;
    let toneEnabled = true;
    ticker = setInterval(() => {
      if (playback.stdin.writableLength > 48000) return;
      const bytes = Buffer.alloc(7680);
      for (let i = 0; i < 960; i++) {
        const value = toneEnabled
          ? 0.15 * Math.sin((2 * Math.PI * 997 * position++) / 48000)
          : 0;
        bytes.writeFloatLE(value, i * 8);
        bytes.writeFloatLE(value, i * 8 + 4);
      }
      playback.stdin.write(bytes);
    }, 20);
    await (wayland ? checkWayland : checkScreen)(
      process.env.HAUNT_PACKAGED_EXECUTABLE,
      async (sender, desktop) => {
        desktop.manualCapturePicker = true;
        const receiver = await receiverContext.newPage();
        receiver.setDefaultTimeout(25000);
        sender.setDefaultTimeout(25000);
        await receiver.goto(fixtures.rtc.url);
        for (const [page, username] of [
          [sender, "alice"],
          [receiver, "bob"],
        ]) {
          const join = page.getByRole("button", {
            name: "Join a server",
            exact: true,
          });
          await (
            (await join.count())
              ? join
              : page.getByRole("button", { name: "Add server", exact: true })
          ).click();
          await fillSignin(page, fixtures.rtc.url, username);
          await page
            .getByLabel("Password", { exact: true })
            .fill(fixtures.password);
          await page
            .getByRole("button", { name: "Sign in", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toHaveCount(0);
          const members = page.getByRole("button", {
            name: "Dismiss member list",
            exact: true,
          });
          if (await members.isVisible()) await members.click();
          await page
            .locator(`[data-channel-id="${fixtures.rtc.voice}"] button.channel`)
            .click();
          const preparation = page.getByRole("dialog", {
            name: "Prepare voice call",
            exact: true,
          });
          await Promise.race([
            preparation.waitFor(),
            page.locator(".call-dock").waitFor(),
          ]);
          if (await preparation.isVisible())
            await preparation
              .getByRole("button", { name: "Join now", exact: true })
              .click();
          await expect(page.locator(".call-dock")).toBeVisible();
        }
        const control = (name) =>
          sender
            .locator(".call-dock")
            .getByRole("button", { name, exact: true });
        await expect(control("Share screen")).toBeEnabled();
        const share = async (audio, cancel = false) => {
          const opened = desktop.waitForEvent("window");
          await control("Share screen").click();
          const picker = await opened.catch(async (error) => {
            console.error(
              "Capture diagnostics:",
              await desktop.evaluate(() => globalThis.captureDiagnostics),
            );
            console.error(
              "Call controls:",
              await sender.locator(".call-dock").innerText(),
            );
            console.error(
              "Call errors:",
              await sender.locator('[role="alert"]').allTextContents(),
            );
            throw error;
          });
          await picker.waitForLoadState("domcontentloaded");
          await expect(picker.getByLabel("Shared audio output")).toContainText(
            "Haunt_test_output",
          );
          await picker
            .getByLabel("Shared audio output")
            .selectOption({ label: "Haunt_test_output" });
          await picker.locator("#audio").setChecked(audio);
          const selected = cancel
            ? picker.getByRole("button", { name: "Cancel", exact: true })
            : picker
                .locator(
                  wayland
                    ? "button.source"
                    : 'button.source[data-kind="screen"]',
                )
                .first();
          await Promise.all([
            picker.waitForEvent("close"),
            selected.click({ noWaitAfter: true }).catch((error) => {
              if (!picker.isClosed()) throw error;
            }),
          ]);
        };
        const outputCaptures = async () =>
          JSON.parse(
            (
              await exec("pactl", ["--format=json", "list", "source-outputs"], {
                env: process.env,
              })
            ).stdout,
          ).filter(
            (item) =>
              item.properties?.["application.name"] === "Haunt screen audio",
          ).length;
        if (wayland) await cancelWaylandPortal(sender, desktop, outputCaptures);
        await share(true, true);
        await expect(control("Share screen")).toBeEnabled();
        assert.equal(await outputCaptures(), 0);
        await share(false);
        await expect(control("Stop sharing screen")).toBeEnabled();
        await expect(
          receiver.locator('.call-panel audio[aria-label$="screen_audio"]'),
        ).toHaveCount(0);
        assert.equal(await outputCaptures(), 0);
        await control("Stop sharing screen").click();
        await expect(control("Share screen")).toBeEnabled();
        await share(true);
        await expect(
          receiver.locator('.call-panel audio[aria-label$="screen_audio"]'),
        ).toHaveCount(1);
        await expect
          .poll(() => peak(receiver, "screen_audio"))
          .toBeGreaterThan(0.03);
        console.log(
          "Linux output audio decoded at receiver; picker cancellation and audio-off passed.",
        );
        assert.equal(await outputCaptures(), 1);
        if (wayland) await checkWaylandVideo(receiver);
        await control("Mute microphone").click();
        await expect.poll(() => peak(receiver, "audio")).toBeLessThan(0.001);
        await expect
          .poll(() => peak(receiver, "screen_audio"))
          .toBeGreaterThan(0.03);
        await control("Deafen").click();
        await expect
          .poll(() => peak(receiver, "screen_audio"))
          .toBeGreaterThan(0.03);
        await expect(control("Deafen")).toHaveAttribute("aria-pressed", "true");
        if (wayland) {
          await checkWaylandAudio(receiver);
          toneEnabled = false;
          await expect
            .poll(() => peak(receiver, "screen_audio"))
            .toBeLessThan(0.001);
          toneEnabled = true;
          await expect
            .poll(() => peak(receiver, "screen_audio"))
            .toBeGreaterThan(0.03);
        }
        await control("Deafen").click();
        await control("Unmute microphone").click();
        if (!wayland) {
          await sender
            .getByRole("button", { name: "Account settings", exact: true })
            .click();
          await sender
            .getByRole("button", { name: "Devices", exact: true })
            .click();
          await sender
            .getByLabel("Global push to talk", { exact: true })
            .click();
          await expect(
            sender.getByLabel("Global push to talk", { exact: true }),
          ).toBeChecked();
          await expect(
            sender.getByText("Configuring desktop shortcuts…"),
          ).toHaveCount(0);
          await sender
            .getByLabel("Global mute and deafen shortcuts", { exact: true })
            .click();
          await expect(
            sender.getByLabel("Global mute and deafen shortcuts", {
              exact: true,
            }),
          ).toBeChecked();
          await expect(
            sender.getByText("Configuring desktop shortcuts…"),
          ).toHaveCount(0);
          await sender
            .getByRole("button", { name: "Close", exact: true })
            .click();
          await expect.poll(() => peak(receiver, "audio")).toBeLessThan(0.001);
          const display = await desktop.evaluate(() => process.env.DISPLAY);
          const keys = (...args) =>
            exec("xdotool", args, {
              env: { ...process.env, DISPLAY: display },
            });
          await desktop.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].hide(),
          );
          await keys("keydown", "F9");
          await expect
            .poll(() => peak(receiver, "audio"))
            .toBeGreaterThan(0.005);
          await keys("keyup", "F9");
          await expect.poll(() => peak(receiver, "audio")).toBeLessThan(0.001);
          await expect
            .poll(() => peak(receiver, "screen_audio"))
            .toBeGreaterThan(0.03);
          await keys("key", "ctrl+shift+d");
          await expect(control("Deafen")).toHaveAttribute(
            "aria-pressed",
            "true",
          );
          await keys("key", "ctrl+shift+d");
          await expect(control("Deafen")).toHaveAttribute(
            "aria-pressed",
            "false",
          );
          await desktop.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            window.show();
            window.focus();
          });
        }
        await control("Stop sharing screen").click();
        await expect(
          receiver.locator('.call-panel audio[aria-label$="screen_audio"]'),
        ).toHaveCount(0);
        await expect.poll(outputCaptures).toBe(0);
        await sender.screenshot({
          path: `test-results/${wayland ? "wayland" : "linux"}-share-audio.png`,
        });
        console.log(
          `PASS ${wayland ? "Wayland/PipeWire" : "X11/PulseAudio"}: real output monitor -> PCM IPC -> screen_audio -> remote decoded samples; cancel/audio-off/stop cleanup; share audio survives microphone mute/deafen. ${wayland ? "Real portal cancellation and changing compositor pixels verified." : "Held global push-to-talk and global deafen work with window hidden."}`,
        );
      },
    );
  } catch (error) {
    console.error("Owned audio diagnostics:", diagnostics);
    throw error;
  } finally {
    clearInterval(ticker);
    playback?.kill("SIGTERM");
    try {
      if (pulse?.pid) process.kill(-pulse.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    if (priorServer === undefined) delete process.env.PULSE_SERVER;
    else process.env.PULSE_SERVER = priorServer;
    await receiverContext.close();
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
