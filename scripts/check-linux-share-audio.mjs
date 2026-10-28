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
async function decodedVideo(page, purpose) {
  const video = page.locator(
    `.call-panel .video-tile[data-tile-id$=":${purpose}"] video`,
  );
  await expect(video).toHaveCount(1);
  let result;
  await expect
    .poll(
      async () => {
        result = await video.evaluate((element) => ({
          width: element.videoWidth,
          height: element.videoHeight,
          frames: element.getVideoPlaybackQuality().totalVideoFrames,
        }));
        return result.frames;
      },
      { timeout: 30000 },
    )
    .toBeGreaterThan(5);
  assert(result.width > 0 && result.height > 0);
  return result;
}

async function audioFrequency(page, frequency) {
  return page
    .locator('.call-panel audio[aria-label$="screen_audio"]')
    .evaluate(async (element, frequency) => {
      const context = new AudioContext({ sampleRate: 48000 });
      await context.resume();
      const source = context.createMediaStreamSource(element.srcObject);
      const analyser = context.createAnalyser();
      analyser.fftSize = 8192;
      source.connect(analyser);
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const values = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(values);
        return values[
          Math.round((frequency * analyser.fftSize) / context.sampleRate)
        ];
      } finally {
        source.disconnect();
        analyser.disconnect();
        await context.close();
      }
    }, frequency);
}
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
    selectedApp,
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
        sender.on("pageerror", (error) =>
          console.error("Sender page error:", error.message),
        );
        await sender.evaluate(() => {
          window.captureEvents = [];
          window.encoderChecks = [];
          const supported = VideoEncoder.isConfigSupported.bind(VideoEncoder);
          VideoEncoder.isConfigSupported = async (config) => {
            const result = await supported(config);
            window.encoderChecks.push({ config, supported: result.supported });
            return result;
          };
          window.hauntDesktop.onNativeEvent((event) => {
            if (["video-config", "error"].includes(event.kind))
              window.captureEvents.push(event);
          });
        });
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
        const share = async (audio, cancel = false, appWindow = false) => {
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
          await (
            appWindow
              ? picker
                  .locator('button.source[data-kind="window"]')
                  .filter({ hasText: "Haunt app capture test" })
              : picker.locator('button.source[data-kind="screen"]').first()
          ).click();
          await expect(picker.getByLabel("Shared audio output")).toContainText(
            "Haunt_test_output",
          );
          if (appWindow)
            await expect(picker.getByLabel("Shared audio output")).toHaveValue(
              new RegExp(`^app:${selectedApp.pid}:`),
            );
          else {
            await expect(picker.getByLabel("Shared audio output")).toHaveValue(
              /^output:/,
            );
            await picker
              .getByLabel("Shared audio output")
              .selectOption({ label: "Entire output — Haunt_test_output" });
          }
          await picker.locator("#audio").setChecked(audio);
          const selected = cancel
            ? picker.getByRole("button", { name: "Cancel", exact: true })
            : picker.getByRole("button", { name: "Share", exact: true });
          await Promise.all([
            picker.waitForEvent("close"),
            selected.click({ noWaitAfter: true }).catch((error) => {
              if (!picker.isClosed()) throw error;
            }),
          ]);
          if (!cancel)
            await expect(control("Stop sharing screen"))
              .toBeEnabled({ timeout: 30000 })
              .catch(async (error) => {
                console.error(
                  "Capture events:",
                  JSON.stringify(
                    await sender.evaluate(() => ({
                      events: window.captureEvents,
                      encoders: window.encoderChecks,
                    })),
                  ),
                );
                console.error(
                  "Capture alerts:",
                  await sender.locator('[role="alert"]').allTextContents(),
                );
                throw error;
              });
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
        await expect(control("Stop sharing screen"))
          .toBeEnabled({ timeout: 30000 })
          .catch(async (error) => {
            console.error(
              "Capture events:",
              await sender.evaluate(() => window.captureEvents),
            );
            console.error(
              "Capture alerts:",
              await sender.locator('[role="alert"]').allTextContents(),
            );
            throw error;
          });
        await expect(
          receiver.locator('.call-panel audio[aria-label$="screen_audio"]'),
        ).toHaveCount(0);
        assert.equal(await outputCaptures(), 0);
        await control("Stop sharing screen").click();
        await expect(control("Share screen")).toBeEnabled();
        await control("Turn on camera").click();
        await decodedVideo(receiver, "camera");
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
        const screenVideo = await decodedVideo(receiver, "screen");
        const cameraVideo = await decodedVideo(receiver, "camera");
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
        const report = await sender.evaluate(() =>
          window.hauntDesktop.mediaDiagnostics(),
        );
        const events = report.capture.log.split("\n").flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
        const active = events.findLast((event) => event.event === "spawn");
        assert(Number.isInteger(active?.detail.pid));
        await desktop.evaluate((_, pid) => {
          if (process.env.GITHUB_ACTIONS !== "true")
            throw Error("Worker failure check requires CI");
          process.kill(pid, "SIGKILL");
        }, active.detail.pid);
        await expect(
          sender
            .locator('[role="alert"]')
            .filter({ hasText: "signal SIGKILL" }),
        ).toBeVisible();
        await expect(control("Share screen")).toBeEnabled();
        await expect.poll(outputCaptures).toBe(0);
        await sender
          .getByRole("button", { name: "Account settings", exact: true })
          .click();
        await sender
          .getByRole("button", { name: "Devices", exact: true })
          .click();
        await sender
          .getByRole("button", {
            name: "Copy capture diagnostics",
            exact: true,
          })
          .click();
        await expect(
          sender.getByText("Capture diagnostics copied.", { exact: true }),
        ).toBeVisible();
        const copied = JSON.parse(
          await desktop.evaluate(({ clipboard }) => clipboard.readText()),
        );
        assert.match(copied.capture.log, /signal SIGKILL/);
        assert.match(copied.capture.log, /Using x264 software fallback/);
        assert.match(copied.capture.log, /missing element nvcudah264enc/);
        assert.equal(copied.capture.writeError, undefined);
        await fs.mkdir("test-results", { recursive: true });
        await fs.writeFile(
          `test-results/capture-diagnostics-${wayland ? "wayland" : "x11"}.json`,
          JSON.stringify(copied, null, 2),
        );
        await sender
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await share(true);
        await decodedVideo(receiver, "screen");
        await control("Stop sharing screen").click();
        await expect(
          receiver.locator('.call-panel audio[aria-label$="screen_audio"]'),
        ).toHaveCount(0);
        await expect.poll(outputCaptures).toBe(0);
        await decodedVideo(receiver, "camera");
        await control("Turn off camera").click();
        let appAudio;
        if (!wayland) {
          const display = await desktop.evaluate(() => process.env.DISPLAY);
          selectedApp = spawn(
            "python3",
            ["scripts/ci/audio-app.py", "Haunt app capture test", "--window"],
            {
              env: {
                ...process.env,
                DISPLAY: display,
                PULSE_SINK: "haunt_fixture",
              },
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          selectedApp.stderr.on("data", (data) => {
            diagnostics += data;
          });
          selectedApp.stdin.write("add 701\n");
          await expect
            .poll(async () =>
              JSON.parse(
                (await exec("pactl", ["-f", "json", "list", "sink-inputs"]))
                  .stdout,
              ).some(
                (item) =>
                  item.properties?.["application.process.id"] ===
                  String(selectedApp.pid),
              ),
            )
            .toBe(true);
          await share(true, false, true);
          await decodedVideo(receiver, "screen");
          const windowVideo = receiver.locator(
            '.call-panel .video-tile[data-tile-id$=":screen"] video',
          );
          for (const [color, expected] of [
            ["e02040", [224, 32, 64]],
            ["20d060", [32, 208, 96]],
          ]) {
            selectedApp.stdin.write(`color ${color}\n`);
            await expect
              .poll(() =>
                windowVideo.evaluate((video, expected) => {
                  const canvas = document.createElement("canvas");
                  canvas.width = canvas.height = 1;
                  const context = canvas.getContext("2d");
                  context.drawImage(
                    video,
                    video.videoWidth / 2,
                    video.videoHeight / 2,
                    1,
                    1,
                    0,
                    0,
                    1,
                    1,
                  );
                  const pixel = context.getImageData(0, 0, 1, 1).data;
                  return Math.max(
                    ...expected.map((value, index) =>
                      Math.abs(value - pixel[index]),
                    ),
                  );
                }, expected),
              )
              .toBeLessThan(25);
          }
          await expect
            .poll(() => audioFrequency(receiver, 701))
            .toBeGreaterThan(-45);
          await expect
            .poll(() => audioFrequency(receiver, 997))
            .toBeLessThan(-65);
          appAudio = {
            selected701: await audioFrequency(receiver, 701),
            excluded997: await audioFrequency(receiver, 997),
          };
          selectedApp.stdin.end();
          await expect(control("Share screen")).toBeEnabled();
          await expect.poll(outputCaptures).toBe(0);
        }
        await fs.writeFile(
          `test-results/linux-relay-${wayland ? "wayland" : "x11"}.json`,
          JSON.stringify(
            {
              screenVideo,
              cameraVideo,
              appAudio,
              encoders: await sender.evaluate(() => window.encoderChecks),
              captures: await sender.evaluate(() => window.captureEvents),
            },
            null,
            2,
          ),
        );
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
    selectedApp?.stdin.end();
    selectedApp?.kill("SIGTERM");
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
