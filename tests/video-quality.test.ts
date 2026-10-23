import { afterEach, expect, it, vi } from "vitest";
import {
  browserCameraModes,
  invalidateCameraModes,
  modeKey,
  nativeCameraModes,
  preferredCameraMode,
  selectedCameraMode,
} from "../packages/browser/src/media/video-settings";
import {
  incomingQuality,
  QualityController,
  videoLayers,
} from "../packages/browser/src/media/quality";
import { WebRTCTransport } from "../packages/browser/src/media/webrtc";
import { NativePublisher } from "../packages/browser/src/media/native-publisher";
import { nativeCaptures } from "../packages/browser/src/media/native-capture";
import type { TransportContext } from "../packages/browser/src/media/types";

afterEach(() => {
  invalidateCameraModes();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["video", "audio"])(
  "closes a native %s encoder when its configuration fails",
  async (kind) => {
    const close = vi.fn();
    const release = vi.fn();
    const bridge = {
      onNativeEvent: () => release,
      nativeOffer: vi.fn(async () => ({ sdp: {} })),
      nativeAnswer: vi.fn(async () => {}),
      nativeClosePublisher: vi.fn(async () => {}),
    };
    vi.stubGlobal("window", { hauntDesktop: bridge });
    vi.stubGlobal(
      kind === "video" ? "VideoEncoder" : "AudioEncoder",
      class {
        static isConfigSupported = async () => ({ supported: true });
        state = "unconfigured";
        configure() {
          throw Error("Encoder configuration failed");
        }
        close = close;
      },
    );
    vi.stubGlobal(
      "AudioContext",
      class {
        sampleRate = 48000;
        audioWorklet = { addModule: async () => {} };
        resume = async () => {};
        close = async () => {};
      },
    );
    const track = {} as MediaStreamTrack;
    if (kind === "video")
      nativeCaptures.set(track, {
        id: "capture",
        config: { codec: "avc1.42e02a", width: 1920, height: 1080, fps: 60 },
        decoded: vi.fn(),
      } as any);
    const publisher = new NativePublisher(
      {
        admission: {},
        client: {
          account: { instance: { capabilities: ["media.layers.v1"] } },
          command: vi.fn(async () => ({ sdp: {} })),
        },
      } as unknown as TransportContext,
      () => ({
        muted: false,
        deafened: false,
        camera_off: false,
        screen_off: true,
      }),
    );
    await expect(
      publisher.publish(
        new Map([[kind === "video" ? "camera" : "audio", track]]),
      ),
    ).rejects.toThrow("Encoder configuration failed");
    expect(close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(bridge.nativeClosePublisher).toHaveBeenCalledOnce();
  },
);

it("retains fixed fractional native frame rates", () => {
  const modes = nativeCameraModes({
    id: "fractional",
    label: "Fractional camera",
    formats: [
      { width: 1920, height: 1080, minFPS: 29.97, maxFPS: 29.97 },
      { width: 1280, height: 720, minFPS: 119.88, maxFPS: 119.88 },
    ],
  });
  expect(modes.map(modeKey).sort()).toEqual([
    "1280x720@119.88",
    "1920x1080@29.97",
  ]);
  expect(preferredCameraMode(modes).fps).toBe(29.97);
});

it("keeps camera FPS tied to each native format, including 120 and 240 FPS", () => {
  const modes = nativeCameraModes({
    id: "camera",
    label: "Camera",
    formats: [
      { width: 1920, height: 1080, minFPS: 30, maxFPS: 120 },
      { width: 1280, height: 720, minFPS: 60, maxFPS: 240 },
    ],
  });
  expect(modes.map(modeKey)).toContain("1920x1080@120");
  expect(modes.map(modeKey)).toContain("1280x720@240");
  expect(modes.map(modeKey)).not.toContain("1920x1080@240");
  expect(preferredCameraMode(modes)).toEqual({
    width: 1920,
    height: 1080,
    fps: 60,
  });
  expect(
    preferredCameraMode(modes.filter((mode) => mode.width < 1920)),
  ).toEqual({ width: 1280, height: 720, fps: 60 });
});

it("offers only exact browser combinations, verifies returned settings, caches and invalidates per device", async () => {
  let settings = { width: 1920, height: 1080, frameRate: 60 };
  const stop = vi.fn();
  const valid = new Set(["1920x1080@60", "1280x720@120", "640x480@240"]);
  const track = {
    stop,
    getSettings: () => settings,
    getCapabilities: () => ({
      width: { min: 640, max: 1920 },
      height: { min: 360, max: 1080 },
      frameRate: { min: 15, max: 240 },
      resizeMode: ["none"],
    }),
    applyConstraints: vi.fn(async (constraints: any) => {
      const mode = {
        width: constraints.width.exact,
        height: constraints.height.exact,
        fps: constraints.frameRate.exact,
      };
      if (!valid.has(modeKey(mode)) && modeKey(mode) !== "1920x1080@120")
        throw new DOMException(
          "Unsupported combination",
          "OverconstrainedError",
        );
      settings = {
        width: mode.width,
        height: mode.height,
        frameRate: modeKey(mode) === "1920x1080@120" ? 60 : mode.fps,
      };
    }),
  };
  const open = vi.fn(async () => ({
    getVideoTracks: () => [track],
    getTracks: () => [track],
  }));
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: open } });
  const modes = await browserCameraModes("one");
  expect(modes.map(modeKey).sort()).toEqual([...valid].sort());
  await browserCameraModes("one");
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith({
    audio: false,
    video: { deviceId: { exact: "one" } },
  });
  await expect(
    selectedCameraMode("one", { width: 1920, height: 1080, fps: 120 }),
  ).rejects.toThrow("unavailable");
  await browserCameraModes("two");
  invalidateCameraModes();
  await browserCameraModes("one");
  expect(open).toHaveBeenCalledTimes(3);
  expect(stop).toHaveBeenCalledTimes(3);
});

it("bounds lower copies without changing the selected high mode or adding duplicates", () => {
  expect(videoLayers({ width: 1920, height: 1080, fps: 120 })).toEqual([
    { id: "h", width: 1920, height: 1080, fps: 120 },
    { id: "m", width: 1280, height: 720, fps: 30 },
    { id: "l", width: 640, height: 360, fps: 15 },
  ]);
  expect(videoLayers({ width: 640, height: 360, fps: 15 })).toHaveLength(1);
  expect(videoLayers({ width: 1000, height: 1000, fps: 60 })[1]).toEqual({
    id: "m",
    width: 720,
    height: 720,
    fps: 30,
  });
});

it("requires consecutive bad samples, observes cooldown, and probes up after twenty good seconds", () => {
  const controller = new QualityController();
  expect(controller.sample(0.06, 0, 0, 3, 2000)).toBe(0);
  expect(controller.sample(undefined, undefined, 0, 3, 4000)).toBe(0);
  expect(controller.sample(0.06, 0, 0, 3, 6000)).toBe(0);
  expect(controller.sample(0.06, 0, 0, 3, 8000)).toBe(1);
  expect(controller.sample(0.5, 0.5, 1, 3, 10000)).toBe(1);
  expect(controller.sample(0.5, 0.5, 1, 3, 12000)).toBe(1);
  for (let time = 14000; time < 32000; time += 2000)
    expect(controller.sample(0, 0, 1, 3, time)).toBe(1);
  expect(controller.sample(0, 0, 1, 3, 32000)).toBe(0);
  controller.reset();
  expect(controller.sample(undefined, 0.11, 0, 3, 34000)).toBe(0);
  expect(controller.sample(undefined, 0.11, 0, 3, 36000)).toBe(1);
});

it("ignores absent counters and unchanged screen statistics", () => {
  const before = {
    id: "a",
    timestamp: 10,
    packetsReceived: 40,
    packetsLost: 0,
    framesDecoded: 1,
    framesDropped: 0,
  } as RTCInboundRtpStreamStats;
  expect(incomingQuality(before, { ...before, timestamp: 20 })).toEqual({
    loss: undefined,
    drops: undefined,
  });
  expect(
    incomingQuality(before, {
      ...before,
      timestamp: 20,
      packetsReceived: 49,
      packetsLost: 1,
    }),
  ).toEqual({ loss: 0.1, drops: undefined });
  expect(incomingQuality(undefined, before)).toEqual({});
});

it("closes failed and superseded publishing peers when simulcast setup rejects", async () => {
  const close = vi.fn(),
    oldClose = vi.fn();
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      close = close;
      addTransceiver() {
        return { setCodecPreferences: vi.fn() };
      }
    },
  );
  vi.stubGlobal("RTCRtpSender", { getCapabilities: () => ({ codecs: [] }) });
  vi.stubGlobal("MediaStream", class {});
  const transport = new WebRTCTransport({
    admission: {},
    client: { account: { instance: { capabilities: ["media.layers.v1"] } } },
  } as unknown as TransportContext);
  Object.assign(transport, { publisher: { close: oldClose } });
  const track = {
    getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }),
  } as MediaStreamTrack;
  await expect(transport.publish(new Map([["camera", track]]))).rejects.toThrow(
    "VP8",
  );
  expect(close).toHaveBeenCalledOnce();
  expect(oldClose).toHaveBeenCalledOnce();
});

it.each([true, false])(
  "preserves selected video dimensions and cadence when layered support is %s",
  async (layered) => {
    const parameters: RTCRtpSendParameters = {
      encodings: [{}],
      codecs: [],
      headerExtensions: [],
      rtcp: {},
      transactionId: "test",
    };
    const sender = {
      getParameters: () => parameters,
      setParameters: vi.fn(async () => {}),
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      class {
        iceGatheringState = "complete";
        localDescription?: RTCSessionDescriptionInit;
        addTransceiver() {
          return { sender, setCodecPreferences: vi.fn() };
        }
        addTrack() {
          return sender;
        }
        async createOffer() {
          return { type: "offer", sdp: "v=0\r\n" };
        }
        async setLocalDescription(value: RTCSessionDescriptionInit) {
          this.localDescription = value;
        }
        async setRemoteDescription() {}
        close() {}
      },
    );
    vi.stubGlobal("RTCRtpSender", {
      getCapabilities: () => ({ codecs: [{ mimeType: "video/VP8" }] }),
    });
    vi.stubGlobal("MediaStream", class {});
    const transport = new WebRTCTransport({
      admission: {},
      client: {
        account: {
          instance: { capabilities: layered ? ["media.layers.v1"] : [] },
        },
        command: async () => ({ sdp: { type: "answer", sdp: "v=0\r\n" } }),
      },
    } as unknown as TransportContext);
    const track = {
      id: "camera",
      getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }),
    } as MediaStreamTrack;
    await transport.publish(new Map([["camera", track]]));
    expect(sender.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        degradationPreference: "maintain-framerate-and-resolution",
      }),
    );
    transport.close();
  },
);

it("reports subscriber setup failures and closes the failed peer", () => {
  const close = vi.fn(),
    failed = vi.fn();
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      close = close;
      addTransceiver() {
        throw Error("Receiver limit reached");
      }
    },
  );
  const transport = new WebRTCTransport({
    admission: {},
    participantId: "self",
    remote: vi.fn(),
    failed,
  } as unknown as TransportContext);
  expect(() =>
    transport.participant({
      participant_id: "other",
      user_id: "them",
      state: {},
      tracks: [{ purpose: "camera", codec: { MimeType: "video/VP8" } }],
    } as any),
  ).not.toThrow();
  expect(failed).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Receiver limit reached" }),
  );
  expect(close).toHaveBeenCalledOnce();
});

it("discards statistics collected before a manual-to-Auto change", async () => {
  vi.useFakeTimers();
  let release!: (report: RTCStatsReport) => void;
  const command = vi.fn(async () => ({}));
  const transport = new WebRTCTransport({
    client: { command },
    quality: vi.fn(),
    remote: vi.fn(),
  } as unknown as TransportContext);
  const stats = (timestamp: number, received: number, lost: number) =>
    ({
      id: "video",
      type: "inbound-rtp",
      kind: "video",
      timestamp,
      packetsReceived: received,
      packetsLost: lost,
    }) as RTCInboundRtpStreamStats;
  const receiver = {
    getStats: () =>
      new Promise<RTCStatsReport>((resolve) => {
        release = resolve;
      }),
  };
  const pc = {
    connectionState: "connected",
    getTransceivers: () => [{ receiver }],
    close: vi.fn(),
  };
  const controller = new QualityController();
  const value = {
    mode: "auto",
    current: "l",
    layers: videoLayers({ width: 1920, height: 1080, fps: 60 }),
    controller,
    revision: 0,
  };
  Object.assign(transport, {
    receivers: new Map([["other", { pc, purposes: ["camera"] }]]),
    qualities: new Map([["other:camera", value]]),
    samples: new Map([["other:camera", stats(1000, 100, 0)]]),
  });
  await transport.start();
  await vi.advanceTimersByTimeAsync(2000);
  await transport.setQuality("other", "camera", "l");
  await transport.setQuality("other", "camera", "auto");
  const sample = vi.spyOn(controller, "sample");
  release(new Map([["video", stats(3000, 180, 20)]]) as RTCStatsReport);
  await vi.advanceTimersByTimeAsync(0);
  expect(sample).not.toHaveBeenCalled();
  expect(command).toHaveBeenCalledTimes(1);
  transport.close();
});

it("preserves the ten-second switch cooldown when a statistics read fails", async () => {
  vi.useFakeTimers();
  const command = vi.fn(async () => ({}));
  const transport = new WebRTCTransport({
    client: { command },
    remote: vi.fn(),
  } as unknown as TransportContext);
  const report = (timestamp: number, received: number, lost: number) =>
    new Map([
      [
        "video",
        {
          id: "video",
          type: "inbound-rtp",
          kind: "video",
          timestamp,
          packetsReceived: received,
          packetsLost: lost,
        },
      ],
    ]);
  const getStats = vi
    .fn()
    .mockRejectedValueOnce(Error("Stats temporarily unavailable"))
    .mockResolvedValueOnce(report(4000, 100, 0))
    .mockResolvedValueOnce(report(6000, 180, 20))
    .mockResolvedValueOnce(report(8000, 260, 40))
    .mockResolvedValueOnce(report(10000, 340, 60));
  const pc = {
    connectionState: "connected",
    getTransceivers: () => [{ receiver: { getStats } }],
    close: vi.fn(),
  };
  const controller = new QualityController();
  controller.reset(0);
  Object.assign(transport, {
    receivers: new Map([["other", { pc, purposes: ["camera"] }]]),
    qualities: new Map([
      [
        "other:camera",
        {
          mode: "auto",
          current: "h",
          controller,
          revision: 0,
          layers: videoLayers({ width: 1920, height: 1080, fps: 60 }),
        },
      ],
    ]),
  });
  await transport.start();
  await vi.advanceTimersByTimeAsync(8000);
  expect(command).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000);
  expect(command).toHaveBeenCalledWith(
    expect.objectContaining({ type: "media.subscription.quality", layer: "m" }),
    "media.subscription.quality.accepted",
    expect.any(Function),
  );
  transport.close();
});
