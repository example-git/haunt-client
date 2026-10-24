import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { fillSignin } from "./signin-fields.mjs";
import fs from "node:fs/promises";

// Small deterministic sources keep this playback check cheap on shared hosts.
// Capture the playing element and check its playback/mute/volume state too.
async function measurePlayback(page) {
  return page.locator(".call-panel audio").evaluateAll(async (elements) => {
    const context = new AudioContext({ sampleRate: 48000 });
    const nodes = elements.map((element) => {
      const source = context.createMediaStreamSource(element.captureStream());
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      return { element, source, analyser, peak: 0, frequency: 0 };
    });
    await context.resume();
    try {
      for (let n = 0; n < 15; n++) {
        await new Promise((r) => setTimeout(r, 50));
        for (const item of nodes) {
          const samples = new Float32Array(item.analyser.fftSize);
          item.analyser.getFloatTimeDomainData(samples);
          item.peak = Math.max(item.peak, ...samples.map(Math.abs));
          const bins = new Float32Array(item.analyser.frequencyBinCount);
          item.analyser.getFloatFrequencyData(bins);
          let bin = 0;
          for (let i = 1; i < bins.length; i++)
            if (bins[i] > bins[bin]) bin = i;
          if (bins[bin] > -40)
            item.frequency = (bin * context.sampleRate) / item.analyser.fftSize;
        }
      }
      return nodes.map(({ element, peak, frequency }) => ({
        label: element.getAttribute("aria-label"),
        peak,
        frequency,
        paused: element.paused,
        muted: element.muted,
        volume: element.volume,
      }));
    } finally {
      for (const { source, analyser } of nodes) {
        source.disconnect();
        analyser.disconnect();
      }
      await context.close();
    }
  });
}

export async function checkSourceAudio(browser, fixtures) {
  if (process.env.HAUNT_MUTE_DIAGNOSTICS === "1") {
    const { checkMuteRecovery } = await import("./check-mute-recovery.mjs");
    return checkMuteRecovery(fixtures);
  }
  const rawSoak = process.env.HAUNT_CALL_SOAK_SECONDS;
  const soakSeconds = rawSoak === undefined ? 0 : Number(rawSoak);
  if (
    rawSoak !== undefined &&
    (!/^\d+$/.test(rawSoak) ||
      !Number.isInteger(soakSeconds) ||
      soakSeconds < 30 ||
      soakSeconds > 1800)
  )
    throw Error("HAUNT_CALL_SOAK_SECONDS must be an integer from 30 to 1800");
  for (const [mode, server] of [
    ["rtc", fixtures.rtc],
    ["ws", fixtures.ws],
  ]) {
    const contexts = await Promise.all(
      [1, 2].map(() =>
        browser.newContext({ permissions: ["camera", "microphone"] }),
      ),
    );
    const errors = [];
    try {
      const [sender, receiver] = await Promise.all(
        contexts.map((context) => context.newPage()),
      );
      for (const [page, username] of [
        [sender, "alice"],
        [receiver, "bob"],
      ]) {
        page.setDefaultTimeout(20000);
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(
          process.env.HAUNT_CLIENT_BUILD === "dist-standalone"
            ? "http://127.0.0.1:5173"
            : server.url,
        );
        if (process.env.HAUNT_CLIENT_BUILD === "dist-standalone")
          await expect(
            page.getByRole("dialog", { name: "Connect to a server" }),
          ).toBeVisible();
        else
          await page
            .getByRole("button", { name: "Add server", exact: true })
            .click();
        await fillSignin(page, server.url, username);
        await page
          .getByLabel("Password", { exact: true })
          .fill(fixtures.password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }

      await receiver
        .getByRole("button", { name: "Account settings", exact: true })
        .click();
      await receiver
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      await receiver
        .getByRole("radio", { name: "Compact", exact: true })
        .check();
      await receiver
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await sender
        .getByRole("button", { name: "Account settings", exact: true })
        .click();
      await sender
        .getByRole("button", { name: "Devices", exact: true })
        .click();
      const audio = sender.getByLabel("Camera audio source", { exact: true });
      await expect
        .poll(() => audio.locator("option").count())
        .toBeGreaterThan(1);
      await audio.selectOption(
        await audio.locator("option").nth(1).getAttribute("value"),
      );
      await sender.getByLabel("Noise suppression", { exact: true }).uncheck();
      await sender.getByRole("button", { name: "Close", exact: true }).click();
      await sender.evaluate(() => {
        const get = navigator.mediaDevices.getUserMedia.bind(
          navigator.mediaDevices,
        );
        window.sourceConstraints = [];
        window.sourceFixtures = [];
        window.sourceEncoderConfigs = [];
        const Encoder = VideoEncoder;
        window.VideoEncoder = class extends Encoder {
          configure(config) {
            window.sourceEncoderConfigs.push(config);
            return super.configure(config);
          }
        };
        const source = async (frequency, rate, fps) => {
          const context = new AudioContext({ sampleRate: rate });
          const oscillator = context.createOscillator();
          oscillator.frequency.value = frequency;
          const gain = context.createGain();
          gain.gain.value = 0.2;
          const destination = context.createMediaStreamDestination();
          oscillator.connect(gain).connect(destination);
          oscillator.start();
          await context.resume();
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 180;
          let tick = 0;
          const timer = setInterval(() => {
            const draw = canvas.getContext("2d");
            draw.fillStyle = tick++ % 2 ? "#f80" : "#08f";
            draw.fillRect(0, 0, 320, 180);
          }, 1000 / fps);
          const stream = canvas.captureStream(fps);
          stream.addTrack(destination.stream.getAudioTracks()[0]);
          window.sourceFixtures.push({ context, timer, stream });
          return stream;
        };
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          if (!constraints.video) return get(constraints);
          window.sourceConstraints.push(constraints);
          const stream = await source(660, 44100, 12);
          if (constraints.audio === false) {
            stream.getAudioTracks().forEach((track) => {
              stream.removeTrack(track);
              track.stop();
            });
          }
          return stream;
        };
        navigator.mediaDevices.getDisplayMedia = async (constraints) => {
          window.sourceConstraints.push(constraints);
          return source(1320, 48000, 60);
        };
      });
      await receiver.evaluate(() => {
        window.hauntDesktop = {
          platform: "linux",
          onCallWindowClosed: () => () => {},
          windowState: async (target) => ({
            target,
            maximized: false,
            fullscreen: false,
          }),
          onWindowState: () => () => {},
          windowControl: async () => {},
          setBadge: async () => {},
          notificationAvailable: async () => false,
          showNotification: async () => {},
        };
      });
      for (const page of [sender, receiver])
        await page
          .locator(`[data-channel-id="${server.voice}"] button.channel`)
          .click();
      const control = (page, name) =>
        page
          .locator(".call-dock")
          .getByRole("button", { name, exact: true })
          .click();
      const checkChatToggle = async (view, label) => {
        const chat = view.getByRole("region", {
          name: "Voice channel chat",
          includeHidden: true,
        });
        const draft = chat.getByRole("textbox", {
          name: "Message",
          exact: true,
        });
        await draft.fill("unsent chat draft");
        const stage = view.locator(".call-panel.full .call-stage");
        const before = await stage.boundingBox();
        await view
          .getByRole("button", { name: "Hide chat", exact: true })
          .click();
        await expect(chat).toBeHidden();
        await expect
          .poll(async () => {
            const after = await stage.boundingBox();
            return (
              after.width > before.width + 100 ||
              after.height > before.height + 100
            );
          })
          .toBe(true);
        for (let i = 1; i <= 2; i++) {
          await sender
            .locator(".voice-chat")
            .getByRole("textbox", { name: "Message", exact: true })
            .fill(`${mode} ${label} hidden chat ${i}`);
          await sender
            .locator(".voice-chat")
            .getByRole("button", { name: "Send message", exact: true })
            .click();
          await expect(
            sender
              .locator(".voice-chat")
              .getByRole("textbox", { name: "Message", exact: true }),
          ).toHaveValue("");
          await expect(
            sender
              .locator(".voice-chat .message-body")
              .filter({ hasText: `${mode} ${label} hidden chat ${i}` }),
          ).toBeVisible();
        }
        // Focus the receiver while chat remains hidden: a visible call must not
        // acknowledge the messages on behalf of its hidden conversation pane.
        await view.bringToFront();
        await view.locator(".call-panel.full > header strong").click();
        const toggle = view.getByRole("button", {
          name: "Show chat",
          exact: true,
        });
        await expect(toggle.locator(".voice-chat-badge")).toHaveText("2");
        await view.waitForTimeout(800); // beyond the read-ack coalescing delay
        await expect(toggle.locator(".voice-chat-badge")).toHaveText("2");
        const read = receiver.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            response.url().includes(`/conversations/${server.voice}/read`) &&
            response.ok(),
        );
        await toggle.click();
        await expect(chat).toBeVisible();
        await expect(
          chat
            .locator(".message-body")
            .filter({ hasText: `${mode} ${label} hidden chat 2` }),
        ).toBeVisible();
        await expect(chat.locator(".messages")).toHaveClass(
          /chat-display-compact/,
        );
        await expect(chat.locator(".message-avatar")).toHaveCount(0);
        await expect(
          chat.locator(".compact-message-time").last(),
        ).toBeVisible();
        await view.screenshot({
          path: `test-results/compact-voice-${mode}-${label}.png`,
        });
        await expect(draft).toHaveValue("unsent chat draft");
        await draft.fill("");
        await expect(view.locator(".voice-chat-badge")).toHaveCount(0);
        await read;
        // The visibility choice uses the same saved client preferences in both windows.
        await expect
          .poll(() =>
            receiver.evaluate(() => {
              const state = JSON.parse(
                localStorage.getItem("chatxo-client-preferences-v1"),
              );
              return state.voiceChatHidden;
            }),
          )
          .toBe(false);
      };
      await control(sender, "Turn on camera");
      await control(sender, "Share screen");
      if (mode === "ws")
        await expect
          .poll(() =>
            sender.evaluate(() =>
              window.sourceEncoderConfigs.some(
                (config) =>
                  config.width === 320 &&
                  config.height === 180 &&
                  config.framerate === 60,
              ),
            ),
          )
          .toBe(true);
      await expect(receiver.locator(".call-panel audio")).toHaveCount(3);
      await expect
        .poll(() =>
          receiver
            .locator(".call-panel video")
            .evaluateAll(
              (videos) =>
                videos.filter(
                  (v) => !v.paused && v.readyState >= 2 && v.videoWidth === 320,
                ).length,
            ),
        )
        .toBe(2);
      await expect(
        receiver
          .locator(".video-tile")
          .getByRole("meter", { name: /microphone level$/ }),
      ).toHaveCount(0);
      await expect
        .poll(() =>
          receiver
            .locator(".video-tile .voice-level")
            .first()
            .evaluate((el) => parseFloat(getComputedStyle(el).height)),
        )
        .toBe(2);
      const measured = await measurePlayback(receiver);
      console.log(
        `${mode} simultaneous media-element output:`,
        JSON.stringify(measured),
      );
      assert.equal(measured.length, 3);
      for (const item of measured) {
        assert(
          !item.paused && !item.muted && item.volume === 1,
          `${item.label} must be playing`,
        );
        assert(
          item.peak > 0.01,
          `${item.label} must have audible element output`,
        );
      }
      if (soakSeconds) {
        const started = Date.now();
        const report = {
          transport: mode,
          requestedSeconds: soakSeconds,
          passed: false,
          samples: [],
        };
        let previousFrames;
        try {
          do {
            const playback = await measurePlayback(receiver);
            assert.equal(
              playback.length,
              3,
              "All source audio tracks remain attached",
            );
            for (const item of playback)
              assert(
                !item.paused && !item.muted && item.peak > 0.01,
                `${mode}: ${item.label} stopped producing audible playback`,
              );
            const video = await receiver
              .locator(".call-panel video")
              .evaluateAll((elements) =>
                elements.map((element) => ({
                  playing: !element.paused && element.readyState >= 2,
                  frames: element.getVideoPlaybackQuality().totalVideoFrames,
                  dropped: element.getVideoPlaybackQuality().droppedVideoFrames,
                })),
              );
            assert.equal(video.length, 2, "Camera and screen remain attached");
            video.forEach((item, index) => {
              assert(item.playing, `${mode}: video ${index} stopped playing`);
              if (previousFrames)
                assert(
                  item.frames > previousFrames[index],
                  `${mode}: video ${index} stopped decoding`,
                );
            });
            previousFrames = video.map((item) => item.frames);
            assert.deepEqual(
              errors,
              [],
              "No browser runtime errors during the call",
            );
            const elapsedSeconds = (Date.now() - started) / 1000;
            report.samples.push({ elapsedSeconds, playback, video });
            await fs.writeFile(
              `test-results/call-soak-${mode}.json`,
              JSON.stringify(report, null, 2),
            );
            console.log(
              `Call endurance ${mode}: ${Math.round(elapsedSeconds)}/${soakSeconds}s; 3 audio sources and 2 advancing video feeds`,
            );
            if (elapsedSeconds >= soakSeconds) break;
            await receiver.waitForTimeout(
              Math.min(10000, soakSeconds * 1000 - (Date.now() - started)),
            );
          } while (true);
          report.passed = true;
        } catch (error) {
          report.error = error.message;
          throw error;
        } finally {
          report.elapsedSeconds = (Date.now() - started) / 1000;
          await fs.writeFile(
            `test-results/call-soak-${mode}.json`,
            JSON.stringify(report, null, 2),
          );
        }
      }
      for (const [purpose, frequency] of [
        ["camera_audio", 660],
        ["screen_audio", 1320],
      ]) {
        const item = measured.find((m) => m.label.endsWith(purpose));
        assert(
          Math.abs(item.frequency - frequency) < 25,
          `${purpose} must retain its own pitch`,
        );
      }
      assert(
        await sender.evaluate(() =>
          window.sourceConstraints
            .filter((c) => c.audio !== false)
            .every((c) => c.audio && c.audio.echoCancellation === false),
        ),
      );
      const activeSources = () =>
        sender.evaluate(() =>
          window.sourceFixtures.flatMap(({ stream }) =>
            stream
              .getTracks()
              .filter((track) => track.readyState === "live")
              .map((track) => track.id),
          ),
        );
      const originalSources = await activeSources();
      const screenControl = sender
        .locator(".call-dock")
        .getByLabel("Screen-share capture settings", { exact: true });
      await screenControl.click();
      const screenSettings = sender.getByRole("dialog", {
        name: "Screen-share capture settings",
        exact: true,
      });
      await screenSettings
        .getByLabel("Screen share frame rate", { exact: true })
        .selectOption("30");
      await expect(screenSettings.locator("output")).toContainText("30 FPS");
      assert.deepEqual(await activeSources(), originalSources);
      if (mode === "ws")
        await expect
          .poll(() =>
            sender.evaluate(() =>
              window.sourceEncoderConfigs.some(
                (config) =>
                  config.width === 320 &&
                  config.height === 180 &&
                  config.framerate === 30,
              ),
            ),
          )
          .toBe(true);
      await expect
        .poll(
          async () =>
            (await measurePlayback(receiver)).filter(
              (item) =>
                /(?:camera|screen)_audio$/.test(item.label) && item.peak > 0.05,
            ).length,
        )
        .toBe(2);
      await screenControl.click();
      const meter = (page, source) =>
        page.getByRole("meter", {
          name: `alice ${source} level`,
          exact: true,
          includeHidden: true,
        });
      for (const page of [sender, receiver])
        for (const source of ["camera audio", "screen-share audio"])
          await expect
            .poll(async () =>
              Number(await meter(page, source).getAttribute("aria-valuenow")),
            )
            .toBeGreaterThan(50);
      await checkChatToggle(receiver, "main");
      await receiver.locator(".video-tile").first().click({ button: "right" });
      await receiver
        .getByRole("slider", { name: "Camera audio volume", exact: true })
        .fill("0");
      await expect
        .poll(async () =>
          Number(
            await meter(receiver, "camera audio").getAttribute("aria-valuenow"),
          ),
        )
        .toBe(0);
      await expect
        .poll(async () =>
          Number(
            await meter(receiver, "screen-share audio").getAttribute(
              "aria-valuenow",
            ),
          ),
        )
        .toBeGreaterThan(50);
      await expect
        .poll(async () =>
          Number(
            await meter(sender, "camera audio").getAttribute("aria-valuenow"),
          ),
        )
        .toBeGreaterThan(50);
      await receiver
        .getByRole("slider", { name: "Camera audio volume", exact: true })
        .fill("100");
      await receiver
        .getByRole("slider", { name: "Screen-share audio volume", exact: true })
        .fill("0");
      await expect
        .poll(async () =>
          Number(
            await meter(receiver, "screen-share audio").getAttribute(
              "aria-valuenow",
            ),
          ),
        )
        .toBe(0);
      await expect
        .poll(async () =>
          Number(
            await meter(receiver, "camera audio").getAttribute("aria-valuenow"),
          ),
        )
        .toBeGreaterThan(50);
      await receiver
        .getByRole("slider", { name: "Screen-share audio volume", exact: true })
        .fill("100");
      await receiver.keyboard.press("Escape");
      await receiver.screenshot({
        path: `test-results/source-audio-meters-${mode}.png`,
      });
      await control(sender, "Mute microphone");
      await expect
        .poll(
          async () =>
            (await measurePlayback(receiver)).find((m) =>
              m.label.endsWith(" · audio"),
            ).peak,
        )
        .toBeLessThan(0.01);
      const withoutMic = await measurePlayback(receiver);
      assert(
        withoutMic
          .filter((m) => !m.label.endsWith(" · audio"))
          .every((m) => m.peak > 0.1),
        "Microphone mute must not mute camera/screen audio",
      );
      await control(sender, "Unmute microphone");
      await control(receiver, "Deafen");
      await expect
        .poll(() =>
          receiver
            .locator(".call-panel audio")
            .evaluateAll((els) => els.every((el) => el.muted)),
        )
        .toBe(true);
      await control(receiver, "Deafen");
      await expect
        .poll(() =>
          receiver
            .locator(".call-panel audio")
            .evaluateAll((els) => els.every((el) => !el.muted && !el.paused)),
        )
        .toBe(true);
      await receiver.locator(".video-tile").first().click();
      await expect(receiver.locator(".call-tiles.has-focus")).toBeVisible();
      await receiver
        .locator(`[data-channel-id="${server.general}"] button.channel`)
        .click();
      await receiver
        .getByRole("button", { name: "Collapse call", exact: true })
        .click();
      assert(
        (await measurePlayback(receiver)).every(
          (m) => m.peak > 0.01 && !m.paused,
        ),
        "Collapsing PiP must keep all audio playing",
      );
      const opened = receiver.waitForEvent("popup");
      await receiver
        .getByRole("button", { name: "Pop out call", exact: true })
        .click();
      const popup = await opened;
      popup.on("pageerror", (error) => errors.push(error.message));
      await expect(receiver.locator(".call-panel.mini")).toBeHidden();
      await expect(popup.locator(".video-tile")).toHaveCount(2);
      for (const name of await popup
        .locator(".video-tile .profile-user-name")
        .all())
        await expect(name).toHaveAttribute("data-name-treatment", "backing");
      await checkChatToggle(popup, "popout");
      assert(
        (await measurePlayback(receiver)).every(
          (m) => m.peak > 0.01 && !m.paused,
        ),
        "Detached views must keep all audio playing in the main renderer",
      );
      await control(sender, "Turn off camera");
      await expect(
        receiver.locator('.call-panel audio[aria-label$=" · camera_audio"]'),
      ).toHaveCount(0);
      await expect(meter(popup, "camera audio")).toHaveCount(0, {
        timeout: 20000,
      });
      await expect
        .poll(
          async () =>
            (await measurePlayback(receiver)).find((m) =>
              m.label.endsWith("screen_audio"),
            )?.peak ?? 0,
        )
        .toBeGreaterThan(0.1);
      // Simulate autoplay refusing a newly published source while the call is
      // collapsed. Recovery must remain accessible in the persistent dock.
      await receiver.evaluate(() => {
        const play = HTMLMediaElement.prototype.play;
        window.rejectCameraPlayback = true;
        const source = Object.getOwnPropertyDescriptor(
          HTMLMediaElement.prototype,
          "srcObject",
        );
        Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
          ...source,
          set(stream) {
            // Stop UA autoplay before assigning the source as well as rejecting
            // play(). Otherwise this mock still allows browser-initiated play.
            if (
              window.rejectCameraPlayback &&
              this.getAttribute("aria-label")?.endsWith("camera_audio")
            )
              this.autoplay = false;
            source.set.call(this, stream);
          },
        });
        HTMLMediaElement.prototype.play = function () {
          if (
            window.rejectCameraPlayback &&
            this.getAttribute("aria-label")?.endsWith("camera_audio")
          ) {
            this.autoplay = false;
            this.pause();
            return Promise.reject(
              new DOMException("User gesture required", "NotAllowedError"),
            );
          }
          return play.call(this);
        };
      });
      await control(sender, "Turn on camera");
      const resume = receiver
        .locator(".call-dock")
        .getByRole("button", { name: "Enable call audio", exact: true });
      await expect(resume).toBeVisible();
      await expect(
        popup.getByRole("button", { name: "Enable call audio", exact: true }),
      ).toBeVisible();
      // Audio and video tracks arrive independently after renegotiation. The
      // camera meter belongs to its video tile, so wait for that tile before
      // checking the blocked audio level. A missing tile must still fail.
      await expect(meter(popup, "camera audio")).toHaveCount(1, {
        timeout: 20000,
      });
      await resume.click(); // A second policy refusal must stay recoverable.
      await expect(resume).toBeVisible();
      await expect
        .poll(async () =>
          Number(
            await meter(popup, "camera audio").getAttribute("aria-valuenow"),
          ),
        )
        .toBe(0)
        .catch(async (error) => {
          console.error(
            "Blocked playback diagnostics",
            await receiver.locator(".call-panel audio").evaluateAll((els) =>
              els.map((el) => ({
                label: el.getAttribute("aria-label"),
                paused: el.paused,
                muted: el.muted,
                autoplay: el.autoplay,
              })),
            ),
            await popup.locator('[role="meter"]').evaluateAll((els) =>
              els.map((el) => ({
                label: el.getAttribute("aria-label"),
                level: el.getAttribute("aria-valuenow"),
              })),
            ),
          );
          throw error;
        });
      await receiver.evaluate(() => {
        window.rejectCameraPlayback = false;
      });
      await resume.click();
      await expect(resume).toHaveCount(0);
      assert(
        (await measurePlayback(receiver)).find((m) =>
          m.label.endsWith("camera_audio"),
        ).peak > 0.1,
        "Camera audio recovers without rejoining or stopping screen audio",
      );
      await control(sender, "Turn off camera");
      await control(sender, "Stop sharing screen");
      await expect(receiver.locator(".call-panel audio")).toHaveCount(1);
      await popup
        .getByRole("button", {
          name: "Return call to main window",
          exact: true,
        })
        .click();
      await control(sender, "Leave call");
      await control(receiver, "Leave call");
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${mode}: simultaneous microphone, camera audio and screen audio with both video feeds`,
      );
    } catch (error) {
      for (const [contextIndex, context] of contexts.entries()) {
        for (const [pageIndex, page] of context.pages().entries()) {
          await page
            .screenshot({
              path: `test-results/source-audio-failure-${mode}-${contextIndex}-${pageIndex}.png`,
              fullPage: true,
            })
            .catch((captureError) =>
              console.error("Failure screenshot:", captureError),
            );
        }
      }
      throw error;
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  }
}
