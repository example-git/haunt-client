import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fillSignin } from "./signin-fields.mjs";

function observeMedia() {
  const evidence = (window.muteEvidence = {
    peers: [],
    contexts: [],
    inputs: [],
    events: [],
    sockets: [],
  });
  const record = (event) => {
    evidence.events.push({ at: performance.now(), ...event });
    if (evidence.events.length > 300) evidence.events.shift();
  };
  const Peer = RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(...args) {
      super(...args);
      evidence.peers.push(this);
      for (const type of ["connectionstatechange", "iceconnectionstatechange"])
        this.addEventListener(type, () =>
          record({
            type,
            connection: this.connectionState,
            ice: this.iceConnectionState,
          }),
        );
    }
  };
  const Audio = AudioContext;
  window.AudioContext = class extends Audio {
    constructor(...args) {
      super(...args);
      evidence.contexts.push(this);
      this.addEventListener("statechange", () =>
        record({ type: "audio-context", state: this.state }),
      );
    }
  };
  const capture = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  navigator.mediaDevices.getUserMedia = async (...args) => {
    const stream = await capture(...args);
    for (const track of stream.getAudioTracks()) {
      evidence.inputs.push(track);
      for (const type of ["mute", "unmute", "ended"])
        track.addEventListener(type, () =>
          record({
            type: `input-${type}`,
            id: track.id,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
          }),
        );
    }
    return stream;
  };
  const Socket = WebSocket;
  window.WebSocket = class extends Socket {
    constructor(...args) {
      super(...args);
      const counts = { sent: 0, received: 0, closed: false };
      evidence.sockets.push(counts);
      this.addEventListener("close", (event) => {
        counts.closed = true;
        record({ type: "socket-close", code: event.code });
      });
      this.addEventListener("message", ({ data }) => {
        if (typeof data !== "string") {
          counts.received++;
          return;
        }
        try {
          const event = JSON.parse(data);
          if (
            [
              "media.state.accepted",
              "media.participant.state",
              "media.participant.joined",
              "media.participant.left",
              "media.reconnect_required",
            ].includes(event.type)
          )
            record({
              type: event.type,
              participant: event.participant?.participant_id,
              state: event.participant?.state ?? event.state,
            });
        } catch {}
      });
      const send = this.send.bind(this);
      this.send = (data) => {
        if (typeof data !== "string") counts.sent++;
        else {
          try {
            const event = JSON.parse(data);
            if (event.type === "media.state")
              record({ type: "state-sent", state: event.state });
          } catch {}
        }
        return send(data);
      };
    }
  };
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const e = window.muteEvidence;
    const track = (t) => ({
      id: t.id,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState,
    });
    return {
      at: performance.now(),
      visibility: document.visibilityState,
      inputs: e.inputs.map(track),
      contexts: e.contexts.map((c) => ({
        state: c.state,
        currentTime: c.currentTime,
      })),
      sockets: e.sockets,
      events: e.events,
      peers: await Promise.all(
        e.peers.map(async (pc) => ({
          connection: pc.connectionState,
          ice: pc.iceConnectionState,
          senders: pc
            .getSenders()
            .flatMap((s) => (s.track ? [track(s.track)] : [])),
          receivers: pc
            .getReceivers()
            .flatMap((r) => (r.track ? [track(r.track)] : [])),
          stats: [...(await pc.getStats()).values()].filter((s) =>
            [
              "outbound-rtp",
              "inbound-rtp",
              "remote-inbound-rtp",
              "media-source",
              "transport",
            ].includes(s.type),
          ),
        })),
      ),
      playback: [...document.querySelectorAll(".call-panel audio")].map(
        (el) => ({
          label: el.getAttribute("aria-label"),
          paused: el.paused,
          muted: el.muted,
          volume: el.volume,
          readyState: el.readyState,
          tracks: el.srcObject?.getAudioTracks().map(track),
        }),
      ),
      suppression: document
        .querySelector(".call-panel")
        ?.getAttribute("data-noise-suppression"),
    };
  });
}

async function levels(page) {
  return page
    .locator('.call-panel audio[aria-label$=" · audio"]')
    .first()
    .evaluate(async (el) => {
      const context = new AudioContext({ sampleRate: 48000 });
      const streams = [el.srcObject, el.captureStream()];
      const nodes = streams.map((stream) => {
        const source = context.createMediaStreamSource(stream),
          meter = context.createAnalyser();
        meter.fftSize = 1024;
        source.connect(meter);
        return { source, meter, peak: 0 };
      });
      await context.resume();
      try {
        const samples = new Float32Array(1024);
        for (let i = 0; i < 30; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          for (const node of nodes) {
            node.meter.getFloatTimeDomainData(samples);
            for (const sample of samples)
              node.peak = Math.max(node.peak, Math.abs(sample));
          }
        }
        return { stream: nodes[0].peak, playback: nodes[1].peak };
      } finally {
        nodes.forEach(({ source, meter }) => {
          source.disconnect();
          meter.disconnect();
        });
        await context.close();
      }
    });
}

export async function checkMuteRecovery(fixtures) {
  const mode = process.env.HAUNT_MUTE_TRANSPORT;
  const suppression = process.env.HAUNT_MUTE_SUPPRESSION;
  assert(["rtc", "ws"].includes(mode), "Explicit rtc or ws transport required");
  assert(
    ["on", "off"].includes(suppression),
    "Explicit on or off suppression required",
  );
  const server = fixtures[mode],
    desktops = [],
    pages = [];
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-mute-"));
  const output = path.resolve(`test-results/mute-${mode}-${suppression}.json`);
  const report = {
    mode,
    suppression,
    versions: [],
    samples: [],
    errors: [],
    result: "running",
  };
  const save = () => fs.writeFile(output, JSON.stringify(report, null, 2));
  const sample = async (phase) => {
    const [sender, receiver] = await Promise.all(pages.map(snapshot));
    const entry = { phase, sender, receiver, levels: await levels(pages[1]) };
    report.samples.push(entry);
    await save();
    console.log(
      `Mute diagnostic ${mode}/${suppression}: ${phase}; ${JSON.stringify(entry.levels)}`,
    );
    return entry;
  };
  const control = (page, name) =>
    page
      .locator(".call-dock")
      .getByRole("button", { name, exact: true })
      .click();
  try {
    for (const username of ["alice", "bob"]) {
      const desktop = await electron.launch({
        executablePath: (await import("electron")).default,
        args: [
          "--no-sandbox",
          "--password-store=basic",
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          `--use-file-for-fake-audio-capture=${path.resolve("tests/fixtures/noise-speech.wav")}`,
          path.resolve("electron-app/main.cjs"),
        ],
        env: {
          ...process.env,
          HAUNT_DESKTOP_TEST: "1",
          HAUNT_DESKTOP_TEST_PROFILE: path.join(scratch, username),
        },
        timeout: 60000,
      });
      desktops.push(desktop);
      report.versions.push(
        await desktop.evaluate(({ app }) => ({
          versions: process.versions,
          argv: process.argv,
          name: app.getName(),
        })),
      );
      const page = await desktop.firstWindow();
      pages.push(page);
      page.setDefaultTimeout(20000);
      page.on("pageerror", (error) => report.errors.push(error.message));
      await page.addInitScript(observeMedia);
      await page.reload();
      await page
        .getByRole("button", { name: "Add server", exact: true })
        .click();
      await fillSignin(page, server.url, username);
      await page
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.locator(".connection")).toHaveText("Connected");
      await page
        .getByRole("button", { name: "Account settings", exact: true })
        .click();
      await page.getByRole("button", { name: "Devices", exact: true }).click();
      await page
        .getByLabel("Noise suppression", { exact: true })
        .setChecked(suppression === "on");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page
        .locator(`[data-channel-id="${server.voice}"] button.channel`)
        .click();
    }
    for (const page of pages) {
      await expect(page.locator(".call-panel")).toContainText("2 in the room");
      await expect(page.locator(".call-panel")).toHaveAttribute(
        "data-noise-suppression",
        suppression === "on" ? "active" : "off",
      );
    }
    const [sender, receiver] = pages;
    await expect
      .poll(async () => (await levels(receiver)).playback, { timeout: 20000 })
      .toBeGreaterThan(0.01);
    await sample("baseline");
    await control(receiver, "Mute microphone");
    const failures = [];
    for (const seconds of [120, 420, 900]) {
      await control(sender, "Mute microphone");
      await expect
        .poll(async () => (await levels(receiver)).playback)
        .toBeLessThan(0.001);
      await sample(`muted-${seconds}-start`);
      const deadline = Date.now() + seconds * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(30000, deadline - Date.now())),
        );
        console.log(
          `Mute diagnostic ${mode}/${suppression}: ${seconds}s mute, ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s remaining`,
        );
      }
      await sample(`muted-${seconds}-end`);
      await control(sender, "Unmute microphone");
      let recovered = true;
      try {
        await expect
          .poll(async () => (await levels(receiver)).playback, {
            timeout: 20000,
          })
          .toBeGreaterThan(0.01);
      } catch {
        recovered = false;
      }
      await sample(`unmuted-${seconds}-${recovered ? "recovered" : "silent"}`);
      if (!recovered) {
        failures.push(seconds);
        await control(sender, "Leave call");
        await sender
          .locator(`[data-channel-id="${server.voice}"] button.channel`)
          .click();
        await expect
          .poll(async () => (await levels(receiver)).playback, {
            timeout: 20000,
          })
          .toBeGreaterThan(0.01);
        await sample(`rejoined-after-${seconds}`);
      }
    }
    assert.deepEqual(
      failures,
      [],
      `Audio did not recover after mute durations: ${failures.join(", ")}`,
    );
    report.result = "passed";
  } catch (error) {
    report.result = "failed";
    report.failure = error.stack;
    for (const [index, page] of pages.entries()) {
      await page
        .screenshot({
          path: `test-results/mute-${mode}-${suppression}-${index}.png`,
        })
        .catch(() => {});
      report[`failurePeer${index}`] = await snapshot(page).catch((error) => ({
        error: error.message,
      }));
    }
    throw error;
  } finally {
    await save();
    for (const desktop of desktops) await desktop.close().catch(() => {});
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
