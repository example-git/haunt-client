import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import dgram from "node:dgram";
import { fillSignin } from "./signin-fields.mjs";

export async function checkLayeredMedia(browser, fixtures) {
  const contexts = await Promise.all(
    [0, 1, 2].map(() =>
      browser.newContext({
        permissions: ["camera", "microphone"],
        viewport: { width: 1280, height: 850 },
      }),
    ),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [publisher, first, second] = pages;
  const errors = [],
    evidence = {};
  const proxies = [];
  let impair = false,
    droppedPackets = 0;
  await first.exposeFunction("layeredRoute", async (sdp) => {
    const lines = sdp.split("\r\n"),
      candidate = lines.find((line) =>
        /^a=candidate:\S+ 1 udp \d+ [\d.]+ \d+ /i.test(line),
      );
    if (!candidate)
      throw Error("No IPv4 UDP candidate for the isolated viewer fixture");
    const fields = candidate.split(" "),
      address = fields[4],
      port = Number(fields[5]);
    const socket = dgram.createSocket("udp4");
    proxies.push(socket);
    let client;
    socket.on("message", (packet, remote) => {
      if (remote.address === address && remote.port === port) {
        if (!client) return;
        const type =
          packet.length >= 12 && packet[0] >> 6 === 2 ? packet[1] & 127 : -1;
        if (
          impair &&
          (type === 97 || (type === 96 && packet.readUInt16BE(2) % 5 === 0))
        ) {
          droppedPackets++;
          return;
        }
        socket.send(packet, client.port, client.address);
      } else {
        client = remote;
        socket.send(packet, port, address);
      }
    });
    await new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, "0.0.0.0", resolve);
    });
    fields[4] = "127.0.0.1";
    fields[5] = String(socket.address().port);
    let inserted = false;
    return lines
      .filter(
        (line) =>
          !line.startsWith("a=candidate:") || (!inserted && (inserted = true)),
      )
      .map((line) =>
        line.startsWith("a=candidate:") ? fields.join(" ") : line,
      )
      .join("\r\n");
  });
  try {
    for (const [index, page] of pages.entries()) {
      page.setDefaultTimeout(30000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        ({ isolated }) => {
          window.mediaPeers = [];
          window.mediaEvents = [];
          window.mediaSockets = [];
          const Peer = RTCPeerConnection,
            Socket = WebSocket;
          window.RTCPeerConnection = class extends Peer {
            constructor(...args) {
              super(...args);
              window.mediaPeers.push(this);
            }
            async createOffer(...args) {
              if (
                window.holdCapturePublish &&
                this.getSenders().some(
                  (sender) => sender.track?.kind === "video",
                )
              ) {
                window.holdCapturePublish = false;
                await new Promise((resolve) => {
                  window.releaseCapturePublish = resolve;
                });
              }
              return super.createOffer(...args);
            }
            async setRemoteDescription(description) {
              if (
                isolated &&
                description.type === "answer" &&
                description.sdp.includes("m=video")
              )
                description = {
                  ...description,
                  sdp: await window.layeredRoute(description.sdp),
                };
              return super.setRemoteDescription(description);
            }
          };
          window.WebSocket = class extends Socket {
            constructor(...args) {
              super(...args);
              window.mediaSockets.push(this);
              this.addEventListener("message", (event) => {
                if (typeof event.data === "string") {
                  try {
                    window.mediaEvents.push(JSON.parse(event.data));
                  } catch {}
                }
              });
            }
            send(data) {
              if (isolated && typeof data === "string") {
                const value = JSON.parse(data);
                if (value.type === "media.subscribe") {
                  value.sdp.sdp = value.sdp.sdp.replace(
                    /^a=candidate:.*\r\n/gm,
                    "",
                  );
                  data = JSON.stringify(value);
                }
              }
              return super.send(data);
            }
          };
        },
        { isolated: index === 1 },
      );
      await page.goto("http://127.0.0.1:5173");
      await expect(
        page.getByRole("dialog", { name: "Connect to a server" }),
      ).toBeVisible();
      await fillSignin(
        page,
        fixtures.rtc.url,
        ["alice", "bob", "owner"][index],
      );
      await page
        .getByLabel("Password", { exact: true })
        .fill(fixtures.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.locator(".connection")).toHaveText("Connected");
      await page
        .locator(`[data-channel-id="${fixtures.rtc.voice}"] button.channel`)
        .click();
      await expect(page.locator(".call-dock")).toBeVisible();
    }
    await publisher
      .locator(".call-dock")
      .getByRole("button", { name: "Turn on camera", exact: true })
      .click();
    const selector = (page) => page.locator(".viewing-quality select").first();
    const dimensions = (page) =>
      page
        .locator(".call-panel video")
        .first()
        .evaluate((video) => [video.videoWidth, video.videoHeight]);
    const source = () =>
      publisher.evaluate(() =>
        window.mediaPeers.flatMap((peer) =>
          peer.connectionState === "connected"
            ? peer
                .getSenders()
                .filter((sender) => sender.track?.kind === "video")
                .map((sender) => sender.track.getSettings())
            : [],
        ),
      );
    const incoming = (page) =>
      page.evaluate(async () => {
        const records = [];
        for (const peer of window.mediaPeers)
          if (peer.connectionState === "connected")
            (await peer.getStats()).forEach((stat) => {
              if (stat.type === "inbound-rtp" && stat.kind === "video")
                records.push({
                  id: stat.id,
                  bytes: stat.bytesReceived,
                  width: stat.frameWidth,
                  height: stat.frameHeight,
                  frames: stat.framesDecoded,
                  lost: stat.packetsLost,
                  received: stat.packetsReceived,
                  dropped: stat.framesDropped,
                  timestamp: stat.timestamp,
                });
            });
        return records;
      });
    for (const viewer of [first, second]) {
      await expect(selector(viewer).locator("option")).toHaveCount(4, {
        timeout: 60000,
      });
      await selector(viewer).selectOption("h");
      await expect
        .poll(async () => (await dimensions(viewer))[1], { timeout: 30000 })
        .toBe(1080);
    }
    evidence.source = await source();
    const bandwidth = async (page) => {
      const before = await incoming(page);
      await page.waitForTimeout(3500);
      const after = await incoming(page);
      return after.reduce((sum, record) => {
        const old = before.find((item) => item.id === record.id);
        return (
          sum +
          (old
            ? ((record.bytes - old.bytes) * 8000) /
              (record.timestamp - old.timestamp)
            : 0)
        );
      }, 0);
    };
    evidence.highBitrate = await bandwidth(first);
    await selector(first).selectOption("l");
    await expect.poll(async () => (await dimensions(first))[1]).toBe(360);
    await expect.poll(async () => (await dimensions(second))[1]).toBe(1080);
    evidence.lowBitrate = await bandwidth(first);
    assert(
      evidence.lowBitrate < evidence.highBitrate * 0.7,
      JSON.stringify(evidence),
    );
    assert.deepEqual(await source(), evidence.source);
    await selector(first).selectOption("h");
    await expect.poll(async () => (await dimensions(first))[1]).toBe(1080);
    await selector(first).selectOption("auto");
    impair = true;
    await expect
      .poll(async () => (await dimensions(first))[1], { timeout: 45000 })
      .toBeLessThan(1080);
    evidence.constrained = await incoming(first);
    assert.equal((await dimensions(second))[1], 1080);
    assert.deepEqual(await source(), evidence.source);
    impair = false;
    evidence.droppedPackets = droppedPackets;
    assert(droppedPackets > 0);
    await expect
      .poll(async () => (await dimensions(first))[1], { timeout: 80000 })
      .toBe(1080);
    evidence.recovered = await incoming(first);
    await selector(first).selectOption("l");
    await expect.poll(async () => (await dimensions(first))[1]).toBe(360);
    const joinsBefore = await first.evaluate(() => {
      const count = window.mediaEvents.filter(
        (event) => event.type === "media.joined",
      ).length;
      for (const socket of window.mediaSockets)
        if (socket.readyState === WebSocket.OPEN) socket.close();
      return count;
    });
    await expect
      .poll(
        () =>
          first.evaluate(
            () =>
              window.mediaEvents.filter(
                (event) => event.type === "media.joined",
              ).length,
          ),
        { timeout: 30000 },
      )
      .toBeGreaterThan(joinsBefore);
    await expect(selector(first)).toHaveValue("l");
    await expect.poll(async () => (await dimensions(first))[1]).toBe(360);
    await first.waitForTimeout(24000);
    assert.equal((await dimensions(first))[1], 360);
    assert.equal((await dimensions(second))[1], 1080);
    assert.deepEqual(await source(), evidence.source);
    evidence.manualSurvivesReconnect = true;
    await publisher.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;
        const draw = canvas.getContext("2d");
        let index = 0;
        setInterval(() => {
          draw.fillStyle = `hsl(${index++ % 360} 80% 45%)`;
          draw.fillRect(0, 0, 1920, 1080);
          draw.fillStyle = "white";
          draw.fillRect((index * 9) % 1800, 100, 100, 600);
        }, 16);
        return canvas.captureStream(60);
      };
    });
    await publisher
      .locator(".call-dock")
      .getByRole("button", { name: "Share screen", exact: true })
      .click();
    for (const viewer of [first, second])
      await expect(viewer.locator(".viewing-quality select")).toHaveCount(2, {
        timeout: 45000,
      });
    await first.locator(".viewing-quality select").nth(1).selectOption("l");
    await expect
      .poll(() =>
        first
          .locator(".call-panel video")
          .evaluateAll((videos) => videos.map((video) => video.videoHeight)),
      )
      .toEqual([360, 360]);
    evidence.finalSource = await source();
    assert.equal(evidence.finalSource.length, 2);
    assert(evidence.finalSource.every((settings) => settings.height === 1080));
    await publisher
      .locator(".call-dock")
      .getByLabel("Camera capture settings", { exact: true })
      .click();
    const cameraSettings = publisher.getByRole("dialog", {
      name: "Camera capture settings",
      exact: true,
    });
    await cameraSettings
      .getByRole("button", { name: "Check camera modes", exact: true })
      .click();
    await expect(
      cameraSettings.getByLabel("Camera resolution", { exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    await publisher.evaluate(() => {
      window.holdCapturePublish = true;
    });
    await cameraSettings
      .getByLabel("Camera resolution", { exact: true })
      .selectOption("1280x720");
    await expect(cameraSettings.locator("output")).toContainText("1280 × 720");
    await expect
      .poll(
        async () =>
          (await source()).filter((settings) => settings.height === 720).length,
      )
      .toBe(1);
    const changed = await source();
    assert.equal(
      changed.find((settings) => settings.height === 720).deviceId,
      evidence.source[0].deviceId,
    );
    assert(
      changed.some(
        (settings) => settings.height === 1080 && settings.frameRate === 60,
      ),
    );
    evidence.activeCameraChange = changed;
    await publisher
      .locator(".call-dock")
      .getByLabel("Camera capture settings", { exact: true })
      .click();
    await publisher
      .locator(".call-dock")
      .getByLabel("Screen-share capture settings", { exact: true })
      .click();
    const screenSettings = publisher.getByRole("dialog", {
      name: "Screen-share capture settings",
      exact: true,
    });
    await expect
      .poll(() => publisher.evaluate(() => typeof window.releaseCapturePublish))
      .toBe("function");
    await expect(
      screenSettings.getByLabel("Screen share frame rate", { exact: true }),
    ).toBeDisabled();
    await expect(
      screenSettings.getByLabel("Screen share resolution", { exact: true }),
    ).toBeDisabled();
    await publisher.evaluate(() => {
      window.releaseCapturePublish();
      delete window.releaseCapturePublish;
    });
    await expect(
      screenSettings.getByLabel("Screen share frame rate", { exact: true }),
    ).toBeEnabled();
    evidence.captureChangesSerialized = true;
    await screenSettings
      .getByLabel("Screen share frame rate", { exact: true })
      .selectOption("30");
    await expect(screenSettings.locator("output")).toContainText("30 FPS");
    evidence.activeScreenChange = await source();
    assert.deepEqual(errors, []);
    console.log("Layered media runtime", JSON.stringify(evidence));
  } catch (error) {
    evidence.droppedPackets = droppedPackets;
    evidence.proxies = proxies.length;
    for (const [index, page] of pages.entries()) {
      await page
        .screenshot({ path: `test-results/layered-${index}.png` })
        .catch(() => {});
      evidence[`page${index}`] = await page
        .evaluate(async () => {
          const stats = [];
          for (const peer of window.mediaPeers ?? [])
            if (peer.connectionState === "connected")
              (await peer.getStats()).forEach((s) => {
                if (
                  ["inbound-rtp", "outbound-rtp"].includes(s.type) &&
                  s.kind === "video"
                )
                  stats.push(s);
              });
          return {
            stats,
            events: window.mediaEvents
              ?.slice(-20)
              .map(({ type, layer, purpose, error }) => ({
                type,
                layer,
                purpose,
                error,
              })),
            text: document.body.innerText,
          };
        })
        .catch(() => null);
    }
    console.error("Layered media diagnostics", JSON.stringify(evidence));
    throw error;
  } finally {
    await fs.writeFile(
      "test-results/layered-media.json",
      JSON.stringify(evidence, null, 2),
    );
    await Promise.all(contexts.map((context) => context.close()));
    for (const socket of proxies) socket.close();
  }
}
