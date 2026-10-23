import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceClient, MediaState, Purpose } from "@haunt/core";
import { Call } from "../packages/browser/src/media/call";
import {
  MicrophoneLoopbacks,
  microphoneLoopbacks,
} from "../packages/browser/src/media/state";

const hardware = vi.hoisted(() => ({
  open: vi.fn(),
  preferences: vi.fn(),
  savePreferences: vi.fn(),
  videoMode: vi.fn(),
}));
vi.mock("../packages/browser/src/media/microphone", () => ({
  MicrophoneCapture: { open: hardware.open },
}));
vi.mock("../packages/browser/src/preferences", () => ({
  getPreferences: () => ({
    microphone: "",
    camera: "",
    cameraModes: {},
    screenMode: { width: 1920, height: 1080, fps: 60 },
    microphoneGain: 100,
    automaticGainControl: false,
    noiseSuppression: false,
    ...hardware.preferences(),
  }),
  subscribePreferences: () => () => {},
  setPreferences: hardware.savePreferences,
}));
vi.mock("../packages/browser/src/audio-plugins/cache", () => ({
  ensureAudioPlugins: async () => {},
  subscribePlugins: () => () => {},
}));
vi.mock("../packages/browser/src/media/video-settings", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  selectedCameraMode: hardware.videoMode,
}));
vi.mock("../packages/browser/src/audio-plugins/preferences", () => ({
  pluginSelection: () => undefined,
}));
vi.mock("../packages/browser/src/audio-plugins/progress", () => ({
  pluginDownloads: () => ({
    subscribe: () => () => {},
    getSnapshot: () => ({ catalog: "ready" }),
  }),
}));
vi.mock("../packages/browser/src/sounds", () => ({
  VoiceCues: class {
    observe() {}
  },
}));
const transports = vi.hoisted(() => ({ items: [] as any[] }));
vi.mock("../packages/browser/src/media/webrtc", () => ({
  WebRTCTransport: class {
    publish = vi.fn(async (_tracks: Map<Purpose, MediaStreamTrack>) => {});
    state = vi.fn();
    close = vi.fn();
    participant() {}
    event() {}
    remove() {}
    async start() {}
    constructor(readonly context: any) {
      transports.items.push(this);
    }
  },
}));

class Track extends EventTarget {
  id = crypto.randomUUID();
  readyState = "live";
  enabled = true;
  muted = false;
  onended: (() => void) | null = null;
  constructor(readonly kind = "audio") {
    super();
  }
  getSettings() {
    return this.kind === "video"
      ? { width: 1920, height: 1080, frameRate: 60 }
      : {};
  }
  getConstraints() {
    return {};
  }
  async applyConstraints() {}
  stop() {
    this.readyState = "ended";
  }
  end() {
    this.stop();
    this.dispatchEvent(new Event("ended"));
    this.onended?.();
  }
  availability(muted: boolean) {
    this.muted = muted;
    this.dispatchEvent(new Event(muted ? "mute" : "unmute"));
  }
}
class Stream {
  constructor(private tracks: Track[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const cleanup: (() => void | Promise<void>)[] = [];
beforeEach(() => {
  transports.items = [];
  hardware.preferences.mockReset();
  hardware.savePreferences.mockReset();
  hardware.videoMode
    .mockReset()
    .mockResolvedValue({ width: 1920, height: 1080, fps: 60 });
  vi.stubGlobal("MediaStream", Stream);
  vi.stubGlobal("window", {});
  const devices = Object.assign(new EventTarget(), {
    getUserMedia: vi.fn(async () => new Stream([new Track()])),
  });
  vi.stubGlobal("navigator", { mediaDevices: devices });
  hardware.open.mockReset().mockImplementation(async (raw: Stream) => {
    const track = new Track();
    return {
      track,
      setMuted: (muted: boolean) => {
        track.enabled = !muted;
        raw.getTracks().forEach((t) => {
          t.enabled = !muted;
        });
      },
      setGain: async () => {},
      setSuppression: async () => {},
      close: () => {
        track.stop();
        raw.getTracks().forEach((t) => t.stop());
      },
    };
  });
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function connected(participants: any[] = []) {
  let held = false;
  const acknowledgements: ReturnType<typeof deferred>[] = [];
  const sent: MediaState[] = [];
  let wire!: (event: any) => void;
  const command = vi.fn(async (message: any) => {
    if (message.type === "media.join")
      return {
        participant: { participant_id: "self", user_id: "me", state: {} },
      };
    if (message.type === "media.state") {
      sent.push(message.state);
      if (held) {
        const ack = deferred();
        acknowledgements.push(ack);
        await ack.promise;
      }
    }
    return {};
  });
  const client = {
    account: {
      login: { user: { id: "me" } },
      instance: { capabilities: ["media.source_audio"] },
    },
    snapshot: { status: "online" },
    command,
    onWire: (listener: typeof wire) => {
      wire = listener;
      return () => {};
    },
    subscribe: () => () => {},
    http: {
      POST: async () => ({
        response: { ok: true },
        data: { transport: "webrtc", admission_id: "test" },
      }),
      GET: async () => ({ response: { ok: true }, data: { participants } }),
    },
  } as unknown as InstanceClient;
  const call = new Call(client, "room");
  cleanup.push(() => call.end());
  await call.start();
  const raw = hardware.open.mock.calls.at(-1)![0].getAudioTracks()[0] as Track;
  const processed = call.snapshot.local
    .find((t) => t.purpose === "audio")!
    .stream.getAudioTracks()[0];
  const transport = transports.items.at(-1)!;
  const incoming = new Track();
  transport.context.remote("other", "audio", new Stream([incoming]));
  return {
    call,
    raw,
    processed,
    incoming,
    transport,
    sent,
    acknowledgements,
    wire,
    hold: () => {
      held = true;
    },
  };
}
function monitor() {
  const stop = microphoneLoopbacks.acquire();
  cleanup.push(stop);
  return stop;
}

describe("reactive call safety", () => {
  it("enforces deafen on raw capture, processed output and incoming playback before acknowledgement", async () => {
    const { call, raw, processed, incoming, hold, acknowledgements } =
      await connected();
    hold();
    const pending = call.setState({ deafened: true });
    expect(call.snapshot.state).toMatchObject({ muted: true, deafened: true });
    expect([raw.enabled, processed.enabled, incoming.enabled]).toEqual([
      false,
      false,
      false,
    ]);
    expect(Object.isFrozen(call.snapshot.state)).toBe(true);
    acknowledgements[0].resolve();
    await pending;
    await call.setState({ muted: false }); // Still forced while deafened; no new command.
    expect(raw.enabled).toBe(false);
    const resume = call.setState({ deafened: false });
    expect([raw.enabled, processed.enabled, incoming.enabled]).toEqual([
      true,
      true,
      true,
    ]);
    acknowledgements[1].resolve();
    await resume;
  });

  it("serializes rapid changes and never rolls back local state on an older acknowledgement", async () => {
    const { call, raw, hold, acknowledgements, sent } = await connected();
    hold();
    const mute = call.setState({ muted: true });
    const unmute = call.setState({ muted: false });
    const deafen = call.setState({ deafened: true });
    expect(acknowledgements).toHaveLength(1);
    acknowledgements[0].resolve();
    await vi.waitFor(() => expect(acknowledgements).toHaveLength(2));
    expect(sent.at(-1)).toMatchObject({ muted: true, deafened: true });
    expect(raw.enabled).toBe(false);
    acknowledgements[1].resolve();
    await Promise.all([mute, unmute, deafen]);
    expect(call.snapshot.state.deafened).toBe(true);
  });

  it("retains independent loopback leases and current manual intent", async () => {
    const { call, raw, incoming } = await connected();
    const stopFirst = monitor(),
      stopSecond = monitor();
    expect(call.snapshot.microphoneMonitoring).toBe(true);
    await call.setState({ muted: false, deafened: false });
    expect([raw.enabled, incoming.enabled]).toEqual([false, false]);
    stopFirst();
    stopFirst();
    expect(call.snapshot.state.deafened).toBe(true);
    await call.setState({ muted: true });
    stopSecond();
    expect(call.snapshot.state).toMatchObject({ muted: true, deafened: false });
    expect([raw.enabled, incoming.enabled]).toEqual([false, true]);
    await call.setState({ muted: false });
    expect(raw.enabled).toBe(true);
  });

  it("joins safely when preview playback began before the call existed", async () => {
    const stop = monitor();
    const { call, raw, processed, sent } = await connected();
    expect([raw.enabled, processed.enabled]).toEqual([false, false]);
    expect(sent[0]).toMatchObject({ muted: true, deafened: true });
    stop();
    expect(call.snapshot.state).toMatchObject({
      muted: false,
      deafened: false,
    });
    expect(raw.enabled).toBe(true);
  });

  it("keeps local media blocked and closes the transport if signaling rejects deafen", async () => {
    const { call, raw, incoming, hold, acknowledgements, transport } =
      await connected();
    hold();
    const result = call.setState({ deafened: true });
    const rejected = expect(result).rejects.toThrow("lost acknowledgement");
    acknowledgements[0].reject(Error("lost acknowledgement"));
    await rejected;
    expect([raw.enabled, incoming.enabled]).toEqual([false, false]);
    expect(transport.close).toHaveBeenCalled();
    expect(call.snapshot.status).toBe("reconnecting");
  });

  it("ignores a stale acknowledgement failure after the connection has already changed", async () => {
    const { call, raw, hold, wire, acknowledgements, transport } =
      await connected();
    hold();
    const pending = call.setState({ deafened: true });
    const rejected = expect(pending).rejects.toThrow("old connection");
    wire({ type: "connection.lost" });
    acknowledgements[0].reject(Error("old connection"));
    await rejected;
    expect(transport.close).toHaveBeenCalledOnce();
    expect(call.snapshot.error).toBe("Reconnecting the call…");
    expect(raw.enabled).toBe(false);
  });

  it("uses capture availability and ignores delayed server echoes for self", async () => {
    const { call, raw, wire } = await connected();
    raw.availability(true);
    expect(call.snapshot.state.muted).toBe(true);
    expect(raw.enabled).toBe(false);
    wire({
      type: "media.participant.state",
      participant: {
        participant_id: "self",
        state: { muted: false, deafened: false },
      },
    });
    expect(
      call.snapshot.participants.find((p) => p.participant_id === "self")!.state
        .muted,
    ).toBe(true);
    raw.availability(false);
    expect(call.snapshot.state.muted).toBe(false);
    expect(raw.enabled).toBe(true);
  });

  it("mutes both old and replacement captures while a new publisher is pending", async () => {
    const { call, raw, transport } = await connected();
    const publication = deferred();
    transport.publish.mockImplementationOnce(() => publication.promise);
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
    await vi.waitFor(() => expect(hardware.open).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(transport.publish).toHaveBeenCalledTimes(2));
    const next = hardware.open.mock.calls[1][0].getAudioTracks()[0];
    const stop = monitor();
    expect([raw.enabled, next.enabled]).toEqual([false, false]);
    publication.resolve();
    await vi.waitFor(() => expect(raw.readyState).toBe("ended"));
    expect(next.enabled).toBe(false);
    stop();
    expect(next.enabled).toBe(true);
    expect(call.snapshot.state.muted).toBe(false);
  });

  it.each(["camera", "screen"] as const)(
    "derives %s state from capture and immediately stops associated audio on source end",
    async (purpose) => {
      const { call } = await connected();
      const video = new Track("video"),
        audio = new Track();
      const capture = vi.fn(async () => new Stream([video, audio]));
      Object.assign(navigator.mediaDevices, {
        getUserMedia: capture,
        getDisplayMedia: capture,
      });
      const pending = call.toggleVideo(purpose);
      await vi.waitFor(() =>
        expect(
          call.snapshot.state[
            purpose === "camera" ? "camera_off" : "screen_off"
          ],
        ).toBe(false),
      );
      expect(call.snapshot.busy).toBe(true);
      video.end();
      expect(
        call.snapshot.state[purpose === "camera" ? "camera_off" : "screen_off"],
      ).toBe(true);
      expect(audio.readyState).toBe("ended");
      expect(call.snapshot.local.some((t) => t.purpose === purpose)).toBe(
        false,
      );
      await pending;
    },
  );

  it("rejects forged source flags and cleans capture up when publication fails", async () => {
    const { call, transport } = await connected();
    await expect(call.setState({ camera_off: false } as any)).rejects.toThrow(
      "active sources",
    );
    const video = new Track("video"),
      audio = new Track();
    Object.assign(navigator.mediaDevices, {
      getUserMedia: async () => new Stream([video, audio]),
    });
    transport.publish.mockRejectedValueOnce(Error("publication failed"));
    await expect(call.toggleVideo("camera")).rejects.toThrow(
      "publication failed",
    );
    expect(call.snapshot.state.camera_off).toBe(true);
    expect([video.readyState, audio.readyState]).toEqual(["ended", "ended"]);
  });

  it("keeps the camera off and the voice connection intact after capture permission is denied", async () => {
    const { call, raw } = await connected();
    Object.assign(navigator.mediaDevices, {
      getUserMedia: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
    await expect(call.toggleVideo("camera")).rejects.toThrow("Denied");
    expect(call.snapshot.state.camera_off).toBe(true);
    expect(call.snapshot.status).toBe("connected");
    expect(raw.enabled).toBe(true);
  });

  it("retains applied capture settings and reconnects when republishing fails", async () => {
    const { call, transport } = await connected();
    const video = new Track("video"),
      audio = new Track();
    Object.assign(navigator.mediaDevices, {
      getDisplayMedia: async () => new Stream([video, audio]),
    });
    await call.toggleVideo("screen");
    vi.spyOn(video, "getSettings").mockReturnValue({
      width: 1280,
      height: 720,
      frameRate: 30,
    });
    transport.publish.mockRejectedValueOnce(Error("publication failed"));
    const mode = { width: 1280, height: 720, fps: 30 };
    await expect(call.setVideoMode("screen", mode)).rejects.toThrow(
      "publication failed",
    );
    expect(call.snapshot.status).toBe("reconnecting");
    expect(call.videoSettings("screen")).toEqual(mode);
    expect(hardware.savePreferences).toHaveBeenCalledWith({ screenMode: mode });
    expect([video.readyState, audio.readyState]).toEqual(["live", "live"]);
  });

  it("opens the probed camera even when device preferences change during the probe", async () => {
    const { call } = await connected();
    const probe = deferred();
    hardware.preferences.mockReturnValue({
      camera: "camera-a",
      cameraAudio: "audio-a",
    });
    hardware.videoMode.mockImplementationOnce(async () => {
      await probe.promise;
      return { width: 1920, height: 1080, fps: 60 };
    });
    const capture = vi.fn(
      async () => new Stream([new Track("video"), new Track()]),
    );
    Object.assign(navigator.mediaDevices, { getUserMedia: capture });
    const opening = call.toggleVideo("camera");
    expect(hardware.videoMode).toHaveBeenCalledWith("camera-a", undefined);
    hardware.preferences.mockReturnValue({
      camera: "camera-b",
      cameraAudio: "audio-b",
    });
    probe.resolve();
    await opening;
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ deviceId: { exact: "camera-a" } }),
        audio: expect.objectContaining({ deviceId: { exact: "audio-a" } }),
      }),
    );
    expect(call.cameraSettingsDevice()).toBe("camera-a");
  });

  it("releases independent monitor ownership idempotently", () => {
    const loopbacks = new MicrophoneLoopbacks(),
      listener = vi.fn();
    const off = loopbacks.subscribe(listener);
    const first = loopbacks.acquire(),
      second = loopbacks.acquire();
    first();
    first();
    expect(loopbacks.getSnapshot()).toBe(true);
    second();
    expect(loopbacks.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(4);
    off();
    loopbacks.acquire();
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

it("keeps fixed viewing quality across a transport reconnect and forgets departed publishers", async () => {
  const { call, transport, wire } = await connected([
    { participant_id: "other", user_id: "them", state: {}, tracks: [] },
  ]);
  const quality = {
    mode: "l",
    current: "l",
    layers: [{ id: "l", width: 640, height: 360, fps: 15 }],
  };
  transport.context.quality("other", "camera", quality);
  vi.useFakeTimers();
  wire({ type: "media.reconnect_required" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(call.snapshot.status).toBe("connected");
  const next = transports.items.at(-1)!;
  expect(next).not.toBe(transport);
  expect(next.context.viewingQuality("other", "camera")).toEqual(quality);
  transport.context.quality("other", "camera", { ...quality, mode: "auto" });
  expect(next.context.viewingQuality("other", "camera").mode).toBe("l");
  wire({ type: "media.participant.left", participant_id: "other" });
  expect(next.context.viewingQuality("other", "camera")).toBeUndefined();
});

it("keeps newer moderation and departure events when the initial roster arrives late", async () => {
  const { call, wire } = await connected();
  const response = deferred();
  const stale = [
    {
      participant_id: "self",
      user_id: "me",
      state: {},
      restriction: { muted: false, deafened: false },
    },
    { participant_id: "gone", user_id: "them", state: {}, tracks: [] },
  ];
  const get = vi.spyOn(call.client.http, "GET").mockImplementation(async () => {
    await response.promise;
    return { response: { ok: true }, data: { participants: stale } } as any;
  });
  vi.useFakeTimers();
  wire({ type: "media.reconnect_required" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(get).toHaveBeenCalledOnce();
  wire({
    type: "media.participant.state",
    participant: {
      ...stale[0],
      restriction: { muted: true, deafened: true },
    },
  });
  wire({ type: "media.participant.left", participant_id: "gone" });
  wire({
    type: "media.participant.joined",
    participant: {
      participant_id: "new",
      user_id: "new-user",
      state: {},
      tracks: [],
    },
  });
  response.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(call.snapshot.status).toBe("connected");
  expect(call.snapshot.restriction).toEqual({ muted: true, deafened: true });
  expect(call.snapshot.state).toMatchObject({ muted: true, deafened: true });
  expect(
    call.snapshot.participants.map((p) => p.participant_id).sort(),
  ).toEqual(["new", "self"]);
});

it("does not mark a superseded join connected after subscriber setup fails", async () => {
  const { call, wire } = await connected();
  vi.spyOn(call.client.http, "GET").mockImplementation(async () => {
    const transport = transports.items.at(-1)!;
    transport.participant = () =>
      transport.context.failed(Error("Receiver setup failed"));
    return {
      response: { ok: true },
      data: {
        participants: [
          { participant_id: "other", user_id: "them", state: {}, tracks: [] },
        ],
      },
    } as any;
  });
  vi.useFakeTimers();
  wire({ type: "media.reconnect_required" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(call.snapshot.status).toBe("reconnecting");
  expect(call.snapshot.error).toBe("Receiver setup failed");
});

it("keeps moderation received before the join acknowledgement", async () => {
  const { call, wire } = await connected();
  const original = vi.mocked(call.client.command).getMockImplementation()!;
  vi.spyOn(call.client, "command").mockImplementation(
    async (message, ...rest) => {
      if (message.type !== "media.join") return original(message, ...rest);
      const participant = {
        participant_id: "next-self",
        user_id: "me",
        state: {},
        restriction: { muted: false, deafened: false },
      };
      wire({
        type: "media.participant.state",
        participant: {
          ...participant,
          restriction: { muted: true, deafened: true },
        },
      });
      return { type: "media.joined", participant };
    },
  );
  vi.useFakeTimers();
  wire({ type: "media.reconnect_required" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(call.snapshot.status).toBe("connected");
  expect(call.snapshot.restriction).toEqual({ muted: true, deafened: true });
  expect(call.snapshot.state).toMatchObject({ muted: true, deafened: true });
});
