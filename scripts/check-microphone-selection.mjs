import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { fillSignin } from "./signin-fields.mjs";
import { speechPeak } from "./check-noise.mjs";

// Chromium supplies multiple virtual capture devices in this harness. All
// getUserMedia calls, processing, publishing and received audio remain real.
export async function checkMicrophoneSelection(
  sender,
  browser,
  fixtures,
  label,
) {
  const errors = [];
  sender.on("pageerror", (error) => errors.push(error.message));
  const observeCapture = async () => {
    await sender.evaluate(() => {
      window.microphoneCaptures = [];
      window.microphoneAttempts = [];
      window.microphoneConstraints = [];
      window.microphoneReleases = [];
      const capture = (window.originalMicrophoneCapture ??=
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices));
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        window.microphoneAttempts.push(structuredClone(constraints));
        const stream = await capture(constraints);
        window.microphoneCaptures.push(...stream.getAudioTracks());
        for (const track of stream.getAudioTracks()) {
          const apply = track.applyConstraints.bind(track);
          track.applyConstraints = async (settings) => {
            const record = {
              id: track.id,
              started: performance.now(),
              settings,
            };
            window.microphoneConstraints.push(record);
            try {
              return await apply(settings);
            } finally {
              record.finished = performance.now();
            }
          };
        }
        if (
          window.heldMicrophone !== undefined &&
          constraints.audio?.deviceId?.exact === window.heldMicrophone
        )
          await new Promise((resolve) =>
            window.microphoneReleases.push(resolve),
          );
        return stream;
      };
    });
  };
  const login = async (page, server, username) => {
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, server.url, username);
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
  };
  const settings = async () => {
    await sender
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await sender.getByRole("button", { name: "Devices", exact: true }).click();
  };
  const closeSettings = () =>
    sender.getByRole("button", { name: "Close", exact: true }).click();
  const select = async (device) => {
    await settings();
    await sender
      .getByLabel("Default microphone", { exact: true })
      .selectOption(device);
    await closeSettings();
  };
  const activeInputs = () =>
    sender.evaluate(() =>
      window.microphoneCaptures
        .filter((track) => track.readyState === "live")
        .map((track) => ({
          id: track.id,
          device: track.getSettings().deviceId,
          enabled: track.enabled,
        })),
    );
  const expectInput = async (device, enabled = true) => {
    await expect
      .poll(activeInputs)
      .toEqual([{ id: expect.any(String), device, enabled }]);
  };
  const join = (page, server) =>
    page.locator(`[data-channel-id="${server.voice}"] button.channel`).click();
  const leave = (page) =>
    page
      .locator(".call-dock")
      .getByRole("button", { name: "Leave call", exact: true })
      .click();
  const control = (name) =>
    sender
      .locator(".call-dock")
      .getByRole("button", { name, exact: true })
      .click();

  for (const server of [fixtures.rtc, fixtures.ws]) {
    const context = await browser.newContext({ permissions: ["microphone"] });
    const receiver = await context.newPage();
    receiver.setDefaultTimeout(15000);
    receiver.on("pageerror", (error) => errors.push(error.message));
    try {
      await receiver.goto(server.url);
      if (label === "browser") await sender.goto(server.url);
      await login(receiver, server, "bob");
      await login(sender, server, "alice");
      const devices = await sender.evaluate(async () => {
        const permission = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        permission.getTracks().forEach((track) => track.stop());
        return (await navigator.mediaDevices.enumerateDevices())
          .filter(
            (device) =>
              device.kind === "audioinput" &&
              !["default", "communications"].includes(device.deviceId),
          )
          .map((device) => ({ id: device.deviceId, label: device.label }));
      });
      assert(
        devices.length >= 2,
        "The runtime must expose two independently selectable microphones",
      );
      const [first, selected] = devices;
      console.log(
        `CHECK ${label} ${server.name}: inputs ${devices.map((device) => device.label).join(", ")}`,
      );
      await observeCapture();
      await select(selected.id);
      await expect.poll(activeInputs).toEqual([]);
      await join(receiver, server);
      await join(sender, server);
      await expect(sender.locator(".call-panel")).toContainText(
        "2 in the room",
      );
      await expect(receiver.locator(".call-panel")).toContainText(
        "2 in the room",
      );
      await expectInput(selected.id);
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
      const initial = (await activeInputs())[0].id;

      // Deafen must shut off both capture and incoming playback immediately.
      await expect.poll(() => speechPeak(sender)).toBeGreaterThan(0.01);
      await control("Deafen");
      await expectInput(selected.id, false);
      await expect(
        sender
          .locator(".call-dock")
          .getByRole("button", { name: "Unmute microphone", exact: true }),
      ).toBeDisabled();
      await expect.poll(() => speechPeak(receiver)).toBeLessThan(0.001);
      await expect.poll(() => speechPeak(sender)).toBeLessThan(0.001);
      await control("Deafen");
      await expectInput(selected.id);
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);

      // Both preview surfaces run through the same shared safety state.
      for (const tab of ["Devices", "Server audio plugins"]) {
        await settings();
        if (tab !== "Devices")
          await sender.getByRole("button", { name: tab, exact: true }).click();
        const listen = sender.getByRole("button", {
          name: "Listen to microphone",
          exact: true,
        });
        await expect(listen).toBeEnabled();
        // An unstarted meter must not mute the call.
        await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
        await listen.click();
        const dock = sender.locator(".call-dock");
        await expect(
          dock.getByRole("button", { name: "Deafen", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(
          dock.getByRole("button", { name: "Deafen", exact: true }),
        ).toBeDisabled();
        await expect(
          dock.getByRole("button", { name: "Unmute microphone", exact: true }),
        ).toBeDisabled();
        await expect.poll(() => speechPeak(receiver)).toBeLessThan(0.001);
        await expect.poll(() => speechPeak(sender)).toBeLessThan(0.001);
        // Preview remains audible while the independent call microphone is disabled.
        await expect
          .poll(() =>
            sender
              .getByLabel("Microphone playback test", { exact: true })
              .evaluate(
                (el) =>
                  !el.paused &&
                  el.srcObject
                    .getAudioTracks()
                    .every(
                      (track) => track.enabled && track.readyState === "live",
                    ),
              ),
          )
          .toBe(true);
        assert.equal(
          (await activeInputs()).find((track) => track.id === initial).enabled,
          false,
        );
        if (tab === "Devices") {
          await sender
            .getByRole("button", { name: "Stop listening", exact: true })
            .click();
          await expect(
            dock.getByRole("button", { name: "Deafen", exact: true }),
          ).toHaveAttribute("aria-pressed", "false");
          await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
        }
        // Closing while playing must release loopback ownership too.
        await closeSettings();
        await expectInput(selected.id);
        await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
      }

      // Stopping a preview preserves an existing manual mute.
      await control("Mute microphone");
      await settings();
      await sender
        .getByRole("button", { name: "Listen to microphone", exact: true })
        .click();
      await closeSettings();
      await expectInput(selected.id, false);
      await expect(
        sender
          .locator(".call-dock")
          .getByRole("button", { name: "Deafen", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => speechPeak(receiver)).toBeLessThan(0.001);
      await control("Unmute microphone");
      await expectInput(selected.id);

      // DSP changes must retain the selected raw input and remain audible.
      await settings();
      await sender.getByLabel("Automatic gain", { exact: true }).uncheck();
      await sender.getByLabel("Noise suppression", { exact: true }).uncheck();
      await sender.getByLabel("Noise suppression", { exact: true }).check();
      await closeSettings();
      await expectInput(selected.id);
      assert.equal((await activeInputs())[0].id, initial);
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);

      await control("Mute microphone");
      await select(first.id);
      await expectInput(first.id, false);
      await expect.poll(() => speechPeak(receiver)).toBeLessThan(0.001);
      await control("Unmute microphone");
      await expectInput(first.id);
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);

      // Delay delivery of a real capture to exercise changing back to the
      // current device while another input is still opening.
      await settings();
      await sender.evaluate((device) => {
        window.heldMicrophone = device;
      }, selected.id);
      const input = sender.getByLabel("Default microphone", { exact: true });
      await input.selectOption(selected.id);
      await expect
        .poll(() => sender.evaluate(() => window.microphoneReleases.length))
        .toBeGreaterThan(0);
      await input.selectOption(first.id);
      await closeSettings();
      await sender.evaluate(() => {
        window.heldMicrophone = undefined;
        window.microphoneReleases.splice(0).forEach((release) => release());
      });
      await expectInput(first.id);
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);

      await select("");
      await expect.poll(async () => (await activeInputs()).length).toBe(1);
      const defaultDevice = (await activeInputs())[0].device;
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
      await select(selected.id);
      await expectInput(selected.id);
      const beforeChange = (await activeInputs())[0].id;
      await sender.evaluate(() =>
        navigator.mediaDevices.dispatchEvent(new Event("devicechange")),
      );
      await expect
        .poll(async () => (await activeInputs())[0]?.id)
        .not.toBe(beforeChange);
      await expectInput(selected.id);
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
      await leave(sender);
      await expect.poll(activeInputs).toEqual([]);

      // A disconnected saved device must fail the actual join, without opening
      // or publishing the system microphone. Reload also exercises persistence.
      await sender.evaluate(() => {
        const key = "chatxo-client-preferences-v1";
        localStorage.setItem(
          key,
          JSON.stringify({
            ...JSON.parse(localStorage.getItem(key)),
            microphone: "missing-microphone-fixture",
          }),
        );
      });
      await sender.reload();
      await sender
        .getByRole("button", { name: `Open ${server.name}`, exact: true })
        .click();
      await expect(sender.locator(".connection")).toHaveText("Connected");
      await observeCapture();
      await join(sender, server);
      await expect(
        sender
          .locator(".error")
          .filter({ hasText: "The selected microphone is unavailable" })
          .first(),
      ).toBeVisible();
      await expect.poll(activeInputs).toEqual([]);
      const attempts = await sender.evaluate(() => window.microphoneAttempts);
      assert.equal(
        attempts.length,
        1,
        "A failed selected input must not retry a default capture",
      );
      assert.deepEqual(attempts[0].audio.deviceId, {
        exact: "missing-microphone-fixture",
      });
      await expect(receiver.locator(".call-panel")).toContainText(
        "1 in the room",
      );

      await select(selected.id);
      await join(sender, server);
      await expect(sender.locator(".call-panel")).toContainText(
        "2 in the room",
      );
      await expectInput(selected.id);
      await expect.poll(() => speechPeak(receiver)).toBeGreaterThan(0.01);
      await leave(sender);
      await leave(receiver);
      await expect.poll(activeInputs).toEqual([]);
      console.log(
        `PASS ${label} ${server.name}: selected ${selected.label}, switched ${first.label}, default ${defaultDevice}, DSP, deafen, both loopback surfaces, preview cleanup, manual mute restoration, muted switch, devicechange, unavailable saved input and rejoin; received audio verified`,
      );
    } catch (error) {
      console.error("Microphone check failed", error);
      console.error(
        "Microphone runtime diagnostics",
        JSON.stringify({
          inputs: await activeInputs(),
          errors: await sender.locator(".error").allTextContents(),
          call: await sender.locator(".call-panel").allTextContents(),
          capture: await sender.evaluate(() => ({
            attempts: window.microphoneAttempts,
            constraints: window.microphoneConstraints,
          })),
        }),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
}
