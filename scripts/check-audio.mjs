import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function checkAudio(page, fixtures) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => {
    window.audioTestTracks = [];
    window.audioEchoStates = [];
    window.audioTestContexts = [];
    window.audioSinkCalls = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      window.audioTestTracks.push(...stream.getTracks());
      for (const track of stream.getAudioTracks()) {
        const record = () =>
          window.audioEchoStates.push(track.getSettings().echoCancellation);
        record();
        const apply = track.applyConstraints.bind(track);
        track.applyConstraints = async (...args) => {
          await apply(...args);
          record();
        };
      }
      return stream;
    };
    const Context = AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args) {
        super(...args);
        window.audioTestContexts.push({ ctx: this, processing: !!args[0] });
      }
    };
    // Headless machines have no physical headphones. Exercise real default-sink
    // playback; virtual IDs let us verify switching/fallback at the API boundary.
    const sink = HTMLMediaElement.prototype.setSinkId;
    HTMLMediaElement.prototype.setSinkId = async function (id) {
      window.audioSinkCalls.push(id);
      if (id === "missing") throw new DOMException("Gone", "NotFoundError");
      return sink.call(this, "");
    };
    const enumerate = navigator.mediaDevices.enumerateDevices.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.enumerateDevices = async () => [
      ...(await enumerate()),
      {
        kind: "audiooutput",
        deviceId: "test-headphones",
        label: "Test headphones",
        groupId: "test",
      },
      {
        kind: "audiooutput",
        deviceId: "missing",
        label: "Disconnected output",
        groupId: "test",
      },
    ];
  });
  const settings = async () => {
    await page
      .getByRole("button", { name: "Client settings", exact: true })
      .click();
    await page.getByRole("button", { name: "Devices", exact: true }).click();
  };
  const close = () =>
    page.getByRole("button", { name: "Close", exact: true }).click();
  await settings();
  await page
    .getByLabel("Output device", { exact: true })
    .selectOption("test-headphones");
  await expect(page.locator(".microphone-monitor")).toHaveAttribute(
    "data-noise-suppression",
    "off",
  );
  const granted = page.getByRole("button", {
    name: "Refresh microphones",
    exact: true,
  });
  await expect(granted).toBeVisible();
  const capturesBeforeRefresh = await page.evaluate(
    () => window.audioTestTracks.length,
  );
  await granted.click();
  await page
    .getByRole("button", { name: "Refresh cameras", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.audioTestTracks.length),
    capturesBeforeRefresh,
    "Refreshing already-granted devices must not open another capture",
  );
  await page
    .getByRole("button", { name: "Listen to microphone", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator('audio[aria-label="Microphone playback test"]')
        .evaluate(
          (el) =>
            !el.paused &&
            el.srcObject.getAudioTracks()[0].readyState === "live",
        ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => window.audioSinkCalls.includes("test-headphones")),
    )
    .toBe(true);
  // Model-specific controls live in per-server plugin pages; device settings
  // remain usable before login and when no plugin is installed.
  await expect(
    page.getByLabel("Noise processing model", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Automatic gain", { exact: true }).uncheck();
  const gain = page.getByRole("slider", {
    name: "Microphone gain",
    exact: true,
  });
  await gain.fill("0");
  await expect
    .poll(() =>
      page
        .getByRole("meter", { name: "Microphone input level" })
        .getAttribute("aria-valuenow"),
    )
    .toBe("0");
  await gain.fill("137");
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole("meter", { name: "Microphone input level" })
          .getAttribute("aria-valuenow"),
      ),
    )
    .toBeGreaterThan(5);
  await page
    .getByLabel("Output device", { exact: true })
    .selectOption("missing");
  await expect
    .poll(() => page.evaluate(() => window.audioSinkCalls.slice(-2)))
    .toEqual(["missing", ""]);
  await page
    .getByLabel("Output device", { exact: true })
    .selectOption("test-headphones");
  await expect(
    page.getByRole("button", { name: "Listen to microphone", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('audio[aria-label="Microphone playback test"]')
        .evaluate((el) => el.paused),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Listen to microphone", exact: true })
    .click();
  await page.evaluate(() =>
    navigator.mediaDevices.dispatchEvent(new Event("devicechange")),
  );
  await expect(
    page.getByRole("button", { name: "Listen to microphone", exact: true }),
  ).toBeVisible();
  assert(
    await page
      .locator('audio[aria-label="Microphone playback test"]')
      .evaluate((el) => el.paused),
    "Device changes must stop local monitoring before output fallback",
  );
  const echoStates = await page.evaluate(() => window.audioEchoStates);
  assert(
    echoStates.length >= 2 && echoStates.every((state) => state === false),
    `Echo cancellation must stay disabled through model/gain changes: ${JSON.stringify(echoStates)}`,
  );
  await page.getByLabel("Noise suppression", { exact: true }).uncheck();
  await page.evaluate(() => {
    // A real 44.1 kHz source entering the production 48 kHz microphone graph.
    const context = new AudioContext({ sampleRate: 44100 });
    const oscillator = context.createOscillator(),
      gain = context.createGain(),
      destination = context.createMediaStreamDestination();
    oscillator.frequency.value = 18000;
    gain.gain.value = 0.2;
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    void context.resume();
    window.highBandContext = context;
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (...args) => {
      navigator.mediaDevices.getUserMedia = capture;
      window.audioTestTracks.push(...destination.stream.getTracks());
      const track = destination.stream.getAudioTracks()[0];
      // An oscillator-backed track has no device DSP capabilities. Its native
      // applyConstraints rejects echo cancellation/AGC; those are exercised on
      // the real captured tracks above, not on this frequency-response fixture.
      track.applyConstraints = async () => {};
      return destination.stream;
    };
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".microphone-monitor")).toHaveAttribute(
    "data-noise-suppression",
    "off",
  );
  await expect(
    page.getByRole("button", { name: "Listen to microphone", exact: true }),
  ).toBeEnabled();
  for (const enabled of [false, true]) {
    await page
      .getByLabel("Noise suppression", { exact: true })
      .setChecked(enabled);
    await expect(page.locator(".microphone-monitor")).toHaveAttribute(
      "data-noise-suppression",
      "off",
    );
    const highBand = await page
      .locator('audio[aria-label="Microphone playback test"]')
      .evaluate(async (el) => {
        const context = new AudioContext({ sampleRate: 44100 }),
          source = context.createMediaStreamSource(el.srcObject),
          analyser = context.createAnalyser();
        analyser.fftSize = 8192;
        source.connect(analyser);
        await context.resume();
        let peak = -Infinity;
        const bins = new Float32Array(analyser.frequencyBinCount);
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 50));
          analyser.getFloatFrequencyData(bins);
          peak = Math.max(
            peak,
            bins[Math.round((18000 * analyser.fftSize) / context.sampleRate)],
          );
        }
        source.disconnect();
        await context.close();
        return peak;
      });
    assert(
      highBand > -35,
      `Suppression ${enabled ? "on" : "off"} must preserve 18 kHz content (${highBand} dBFS)`,
    );
  }
  await page.getByLabel("Noise suppression", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Listen to microphone", exact: true })
    .click();
  await page.evaluate(() => {
    window.oldPlayback = document.querySelector(
      'audio[aria-label="Microphone playback test"]',
    );
  });
  await close();
  await page.evaluate(() => window.highBandContext.close());
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.oldPlayback.paused &&
          !window.oldPlayback.srcObject &&
          window.audioTestTracks.every((t) => t.readyState === "ended") &&
          window.audioTestContexts
            .filter((c) => c.processing)
            .every((c) => c.ctx.state === "closed"),
      ),
    )
    .toBe(true);
  // Engines without microphone permission queries still learn the grant from
  // the actual preview capture, instead of asking again to enumerate devices.
  await page.evaluate(() => {
    const query = navigator.permissions.query.bind(navigator.permissions);
    window.restorePermissionQuery = () => {
      navigator.permissions.query = query;
    };
    navigator.permissions.query = (descriptor) =>
      descriptor.name === "microphone"
        ? Promise.reject(new TypeError("Capture permission query unavailable"))
        : query(descriptor);
  });
  try {
    await settings();
    await expect(granted).toBeVisible();
    const captures = await page.evaluate(() => window.audioTestTracks.length);
    await granted.click();
    assert.equal(
      await page.evaluate(() => window.audioTestTracks.length),
      captures,
    );
    await close();
  } finally {
    await page.evaluate(() => window.restorePermissionQuery());
  }
  // Settings survive an actual server login/logout, then a client reload.
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await fillSignin(page, fixtures.rtc.url, "alice");
  await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await page
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page
    .getByRole("button", { name: "Sign out of this server", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Client settings", exact: true }),
  ).toBeVisible();
  await page.reload();
  await settings();
  await expect(page.getByLabel("Output device", { exact: true })).toHaveValue(
    "test-headphones",
  );
  await expect(gain).toHaveValue("137");
  await expect(
    page.getByLabel("Automatic gain", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Listen to microphone", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('audio[aria-label="Microphone playback test"]')
        .evaluate((el) => el.paused),
    )
    .toBe(true);
  await close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS echo cancellation disabled, granted-device refresh, monitor routing/cleanup, output fallback and saved preferences",
  );
}
