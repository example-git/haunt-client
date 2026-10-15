import { afterEach, expect, it, vi } from "vitest";

vi.mock("../packages/browser/src/media/video-playback", () => ({
  VideoPlayback: class {
    track = { stop: vi.fn() };
    stream = { addTrack: vi.fn(), getTracks: () => [this.track] };
    configure = async () => {};
    close() {}
  },
}));
vi.mock("../packages/browser/src/preferences", () => ({
  getPreferences: () => ({ camera: "", cameraAudio: "" }),
}));
afterEach(() => vi.unstubAllGlobals());
it("uses only the latest format while loading and never feeds new-rate PCM to the old node", async () => {
  let ready!: () => void;
  const loading = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const track = { stop: vi.fn() };
  const destination = {
    stream: { getAudioTracks: () => [track], getTracks: () => [track] },
    disconnect: vi.fn(),
  };
  vi.stubGlobal(
    "AudioContext",
    class {
      audioWorklet = { addModule: () => loading };
      createMediaStreamDestination = () => destination;
      resume = async () => {};
      close = async () => {};
    },
  );
  const nodes: any[] = [];
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = { postMessage: vi.fn(), close: vi.fn() };
      disconnect = vi.fn();
      connect = vi.fn();
      constructor(
        _: unknown,
        _name: string,
        readonly options: any,
      ) {
        nodes.push(this);
      }
    },
  );
  let receive!: (packet: any) => void;
  let id = "";
  const bridge = {
    onNativeEvent: (callback: typeof receive) => {
      receive = callback;
      return vi.fn();
    },
    nativeStart: async (request: { id: string }) => {
      id = request.id;
      return { video: {}, audio: true };
    },
    nativeStop: vi.fn(async () => {}),
  };
  vi.stubGlobal("window", { hauntDesktop: bridge });
  const { NativeCapture } =
    await import("../packages/browser/src/media/native-capture");
  const opening = NativeCapture.open("camera", true);
  // The open result itself waits for the worklet module, as does each config.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const config = (rate: number) =>
    receive({ id, kind: "audio-config", config: { sampleRate: rate } });
  config(44100);
  config(48000);
  expect(nodes).toHaveLength(0);
  ready();
  const capture = (await opening)!;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(nodes).toHaveLength(1);
  expect(nodes[0].options.processorOptions.sampleRate).toBe(48000);
  config(44100);
  receive({ id: capture.id, kind: "audio", data: new Float32Array(1764) });
  expect(nodes[0].disconnect).toHaveBeenCalledOnce();
  expect(nodes[0].port.postMessage).not.toHaveBeenCalled();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(nodes[1].options.processorOptions.sampleRate).toBe(44100);
  receive({ id: capture.id, kind: "audio", data: new Float32Array(1764) });
  expect(nodes[1].port.postMessage).toHaveBeenCalledOnce();
  config(48000);
  capture.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(nodes).toHaveLength(2);
  expect(bridge.nativeStop).toHaveBeenCalledWith(capture.id);
});
