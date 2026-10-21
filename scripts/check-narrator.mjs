import { expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fillSignin } from "./signin-fields.mjs";
import { checkSettingsLayout } from "./check-settings-layout.mjs";

const expect = baseExpect.configure({ timeout: 15000 });
const speechPath = "/api/v1/server-extensions/example-tts/speech";
const defaultVoice = "example_voice";
const userVoice = "example_voice";

// Observe detached narrator Audio elements without replacing synthesis, play(),
// decoding, output routing or the media element's normal output.
function observeAudio() {
  window.narratorAudio = [];
  window.Audio = new Proxy(window.Audio, {
    construct(Target, args) {
      const audio = Reflect.construct(Target, args);
      if (!String(args[0]).startsWith("blob:")) return audio;
      const record = { played: false, ended: false, peak: 0, time: 0 };
      window.narratorAudio.push(record);
      let context, source, analyser, timer;
      const stop = () => {
        clearInterval(timer);
        source?.disconnect();
        analyser?.disconnect();
        void context?.close();
      };
      audio.addEventListener(
        "playing",
        async () => {
          try {
            context = new AudioContext();
            source = context.createMediaStreamSource(audio.captureStream());
            analyser = context.createAnalyser();
            analyser.fftSize = 1024;
            source.connect(analyser);
            await context.resume();
            record.played = true;
            record.volume = audio.volume;
            record.muted = audio.muted;
            const samples = new Float32Array(analyser.fftSize);
            timer = setInterval(() => {
              analyser.getFloatTimeDomainData(samples);
              record.peak = Math.max(record.peak, ...samples.map(Math.abs));
              record.time = Math.max(record.time, audio.currentTime);
            }, 15);
          } catch (error) {
            record.error = error.message;
            stop();
          }
        },
        { once: true },
      );
      audio.addEventListener("ended", () => {
        record.ended = true;
        stop();
      });
      audio.addEventListener("error", () => {
        record.error = audio.error?.message ?? "Audio failed";
        stop();
      });
      return audio;
    },
  });
}

export async function checkNarrator(browser, fixtures) {
  for (const [mode, server] of [
    ["rtc", fixtures.rtc],
    ["ws", fixtures.ws],
  ]) {
    const contexts = [];
    const errors = [];
    const requests = [];
    const events = [];
    const checks = [];
    let listener, actor;
    async function signin(username) {
      const context = await browser.newContext({
        permissions: ["camera", "microphone"],
      });
      contexts.push(context);
      await context.addInitScript(observeAudio);
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on("pageerror", (error) => errors.push(error.message));
      if (username === "owner") {
        page.on("request", (request) => {
          if (new URL(request.url()).pathname === speechPath)
            requests.push(request.postDataJSON());
        });
        page.on("websocket", (socket) => {
          socket.on("framereceived", ({ payload }) => {
            if (typeof payload !== "string") return;
            try {
              const event = JSON.parse(payload);
              if (event.type?.startsWith("media.participant."))
                events.push(event);
            } catch {
              // Encoded media frames are binary, not gateway events.
            }
          });
        });
      }
      await page.goto(server.url);
      await page
        .getByRole("button", { name: "Add server", exact: true })
        .click();
      await fillSignin(page, server.url, username);
      await page
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.locator(".connection")).toHaveText("Connected");
      return page;
    }
    const control = (page, name) =>
      page.locator(".call-dock").getByRole("button", { name, exact: true });
    async function openSettings() {
      await listener
        .getByRole("button", { name: "Account settings", exact: true })
        .click();
      await listener
        .getByRole("button", { name: "Text to speech", exact: true })
        .click();
      return listener.locator(".tts-settings");
    }
    async function closeSettings() {
      await listener
        .getByRole("button", { name: "Close", exact: true })
        .click();
    }
    async function chooseUser(settings) {
      const select = settings.getByLabel("User", { exact: true });
      await select.selectOption({
        label: await select
          .locator("option")
          .filter({ hasText: "@alice" })
          .innerText(),
      });
    }
    async function hear(text, voice, action) {
      const before = requests.length;
      const audioIndex = await listener.evaluate(
        () => window.narratorAudio.length,
      );
      await action();
      await expect
        .poll(() => requests.length, { message: text })
        .toBe(before + 1);
      assert.deepEqual(requests.at(-1), { text, voice, room_id: server.voice });
      await expect
        .poll(
          () =>
            listener.evaluate(
              (i) => window.narratorAudio[i]?.ended,
              audioIndex,
            ),
          { message: `actual audio playback: ${text}` },
        )
        .toBe(true);
      const audio = await listener.evaluate(
        (i) => window.narratorAudio[i],
        audioIndex,
      );
      assert.equal(audio.error, undefined);
      assert(audio.played && !audio.muted && audio.volume > 0);
      assert(audio.peak > 0.01 && audio.time > 0.1, JSON.stringify(audio));
      await listener.waitForTimeout(150);
      assert.equal(requests.length, before + 1, "one announcement per action");
      assert.equal(
        await listener.evaluate(() => window.narratorAudio.length),
        audioIndex + 1,
      );
      checks.push({ text, voice, audio });
    }
    async function silent(label, action, matches) {
      const before = requests.length;
      const eventIndex = events.length;
      const audioIndex = await listener.evaluate(
        () => window.narratorAudio.length,
      );
      await action();
      await expect
        .poll(() => events.slice(eventIndex).some(matches), { message: label })
        .toBe(true);
      await listener.waitForTimeout(750);
      assert.equal(requests.length, before, label);
      assert.equal(
        await listener.evaluate(() => window.narratorAudio.length),
        audioIndex,
        label,
      );
      checks.push({ silent: label, participantEventObserved: true });
    }
    try {
      listener = await signin("owner");
      actor = await signin("alice");
      await listener
        .getByRole("button", { name: "Server settings", exact: true })
        .click();
      await listener
        .getByRole("button", { name: "Example speech", exact: true })
        .click();
      const admin = listener.locator(".extension-settings");
      await admin
        .getByLabel("Session token", { exact: true })
        .fill("a".repeat(32));
      await admin.getByLabel("Enable for this server’s clients").check();
      const saved = listener.waitForResponse(
        (reply) =>
          reply.request().method() === "PUT" &&
          new URL(reply.url()).pathname ===
            "/api/v1/admin/server-extensions/example-tts",
      );
      await admin
        .getByRole("button", { name: "Save configuration", exact: true })
        .click();
      assert.equal((await saved).status(), 200);
      await expect(
        admin
          .getByLabel("Test voice", { exact: true })
          .locator("optgroup option"),
      ).toHaveCount(1);
      await admin
        .getByLabel("Test voice", { exact: true })
        .selectOption("example_voice");
      await closeSettings();

      let settings = await openSettings();
      await settings
        .getByLabel("Speech provider", { exact: true })
        .selectOption("example-tts");
      const voice = settings.getByLabel("Example speech voice", {
        exact: true,
      });
      await expect(voice.locator("optgroup option")).toHaveCount(1);
      await expect(voice.locator("optgroup")).toHaveCount(1);
      await voice.selectOption(":custom:");
      await settings
        .getByLabel("Example speech voice ID", { exact: true })
        .fill("custom_voice_01");
      await settings
        .getByLabel("Example speech voice ID", { exact: true })
        .fill("invalid voice!");
      await expect(settings.getByRole("alert")).toContainText(
        "hasn’t been saved",
      );
      await closeSettings();
      settings = await openSettings();
      await expect(
        settings.getByLabel("Example speech voice ID", { exact: true }),
      ).toHaveValue("custom_voice_01");
      await settings
        .getByLabel("Example speech voice", { exact: true })
        .selectOption(defaultVoice);
      await settings.getByLabel("Enabled", { exact: true }).check();
      await settings
        .getByLabel("Use device TTS if this extension fails")
        .uncheck();
      for (const name of [
        "Joins",
        "Leaves",
        "Mute / unmute",
        "Deafen / undeafen",
        "Screen sharing",
        "Ignore myself",
      ])
        await settings.getByLabel(name, { exact: true }).check();
      await settings
        .getByText("Advanced speech options", { exact: true })
        .click();
      await settings.getByLabel("Per-user cooldown (seconds)").fill("0");
      await settings
        .getByText("Voices and ignored users · this server", { exact: true })
        .click();
      await chooseUser(settings);
      const override = settings.getByLabel("Extension voice override", {
        exact: true,
      });
      await expect(override.locator("optgroup option")).toHaveCount(1);
      await override.selectOption("example_voice");
      await override.selectOption("");
      await expect(override).toHaveValue("");
      await override.selectOption(userVoice);
      await listener.screenshot({
        path: `test-results/narrator-${mode}-settings.png`,
      });
      await checkSettingsLayout(listener, mode);
      await closeSettings();
      await actor.evaluate(() => {
        navigator.mediaDevices.getDisplayMedia = async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 90;
          let frame = 0;
          const timer = setInterval(() => {
            const draw = canvas.getContext("2d");
            draw.fillStyle = frame++ % 2 ? "#39a" : "#a39";
            draw.fillRect(0, 0, 160, 90);
          }, 100);
          const stream = canvas.captureStream(10);
          stream
            .getVideoTracks()[0]
            .addEventListener("ended", () => clearInterval(timer));
          window.narratorScreenTimer = timer;
          return stream;
        };
      });
      const join = (page) =>
        page
          .locator(`[data-channel-id="${server.voice}"] button.channel`)
          .click();
      await join(listener);
      await expect(control(listener, "Mute microphone")).toBeEnabled();
      await silent(
        "Ignore myself still suppresses my own mute",
        () => control(listener, "Mute microphone").click(),
        (event) =>
          event.type === "media.participant.state" &&
          event.participant.state.muted,
      );
      await hear("alice joined lounge", userVoice, () => join(actor));
      await expect(control(actor, "Mute microphone")).toBeEnabled();
      await hear("alice muted", userVoice, () =>
        control(actor, "Mute microphone").click(),
      );
      await hear("alice unmuted", userVoice, () =>
        control(actor, "Unmute microphone").click(),
      );
      await hear("alice deafened", userVoice, () =>
        control(actor, "Deafen").click(),
      );
      await hear("alice undeafened", userVoice, () =>
        control(actor, "Deafen").click(),
      );
      await hear("alice started sharing their screen", userVoice, () =>
        control(actor, "Share screen").click(),
      );
      await hear("alice stopped sharing their screen", userVoice, () =>
        control(actor, "Stop sharing screen").click(),
      );
      await hear("alice left lounge", userVoice, () =>
        control(actor, "Leave call").click(),
      );

      settings = await openSettings();
      await settings.getByLabel("Ignore myself", { exact: true }).uncheck();
      await closeSettings();
      await hear("owner unmuted", defaultVoice, () =>
        control(listener, "Unmute microphone").click(),
      );

      settings = await openSettings();
      await settings.getByLabel("Joins", { exact: true }).uncheck();
      await settings.getByLabel("Mute / unmute", { exact: true }).uncheck();
      await closeSettings();
      await silent(
        "Disabled join event",
        () => join(actor),
        (event) => event.type === "media.participant.joined",
      );
      await expect(control(actor, "Mute microphone")).toBeEnabled();
      await silent(
        "Disabled mute event",
        () => control(actor, "Mute microphone").click(),
        (event) =>
          event.type === "media.participant.state" &&
          event.participant.state.muted,
      );

      settings = await openSettings();
      await settings.getByLabel("Mute / unmute", { exact: true }).check();
      await settings
        .getByText("Voices and ignored users · this server", { exact: true })
        .click();
      await chooseUser(settings);
      await expect(
        settings.getByLabel("Extension voice override", { exact: true }),
      ).toHaveValue(userVoice);
      await settings.getByLabel("Ignore this user", { exact: true }).check();
      await closeSettings();
      await silent(
        "Ignored participant",
        () => control(actor, "Unmute microphone").click(),
        (event) =>
          event.type === "media.participant.state" &&
          !event.participant.state.muted,
      );

      settings = await openSettings();
      await settings.getByLabel("Enabled", { exact: true }).uncheck();
      await closeSettings();
      await silent(
        "Narrator disabled",
        () => control(listener, "Mute microphone").click(),
        (event) =>
          event.type === "media.participant.state" &&
          event.participant.state.muted,
      );
      assert.deepEqual(errors, []);
      await fs.writeFile(
        `test-results/narrator-${mode}.json`,
        JSON.stringify({ checks, requests, errors }, null, 2),
      );
      console.log(
        `PASS ${mode}: all 42 voices; persisted/custom/per-user choices; eight remote actions and own opt-in played audible audio; explicit ignores and disabled events stayed silent`,
      );
    } catch (error) {
      console.error(
        "Narrator diagnostics:",
        JSON.stringify({ mode, checks, requests, events, errors }),
      );
      if (listener)
        await listener.screenshot({
          path: `test-results/narrator-${mode}-failure.png`,
        });
      throw error;
    } finally {
      for (const context of contexts) await context.close();
    }
  }
}
