import { VideoPlayback } from "./video-playback";
import { getPreferences } from "../preferences";
import type {
  NativeBridge,
  NativeEvent,
  NativeVideoConfig,
} from "./native-types";
import pcmWorklet from "./native-pcm-worklet.js?url";

export const nativeCaptures = new WeakMap<MediaStreamTrack, NativeCapture>();
export const nativeCaptureAvailable = () =>
  window.hauntDesktop?.nativeCaptureAvailable === true;

export class NativeCapture {
  readonly id = crypto.randomUUID();
  readonly stream: MediaStream;
  readonly track: MediaStreamTrack;
  config!: NativeVideoConfig;
  private playback: VideoPlayback;
  private closed = false;
  private off: () => void;
  private listeners = new Set<(packet: NativeEvent) => void>();
  private audio?: AudioContext;
  private audioNode?: AudioWorkletNode;
  private audioReady?: Promise<void>;
  private audioGeneration = 0;
  private audioStream?: MediaStream;
  private error?: Error;
  onended?: (error: Error) => void;
  private constructor(private bridge: NativeBridge) {
    this.playback = new VideoPlayback(
      () => {},
      (error) => this.fail(error),
    );
    this.stream = this.playback.stream;
    this.track = this.playback.track;
    this.off = bridge.onNativeEvent((packet) => {
      if (packet.id !== this.id || this.closed) return;
      try {
        this.receive(packet);
      } catch (error) {
        this.fail(error as Error);
      }
    });
  }
  static async open(purpose: "camera" | "screen", sourceAudio: boolean) {
    const capture = new NativeCapture(window.hauntDesktop!);
    const prefs = getPreferences();
    try {
      // Chromium labels are only needed to migrate an old saved device ID.
      // Native IDs and the system default must not depend on Chromium discovery.
      const legacy = [prefs.camera, sourceAudio ? prefs.cameraAudio : ""].some(
        (id) => id && !id.startsWith("swift:"),
      );
      const devices = legacy
        ? await navigator.mediaDevices.enumerateDevices().catch(() => [])
        : [];
      const result = await capture.bridge.nativeStart({
        id: capture.id,
        purpose,
        audio: sourceAudio,
        device: prefs.camera,
        deviceLabel: devices.find((d) => d.deviceId === prefs.camera)?.label,
        audioDevice: sourceAudio ? prefs.cameraAudio : undefined,
        audioLabel: devices.find((d) => d.deviceId === prefs.cameraAudio)
          ?.label,
      });
      if (!result) {
        capture.close();
        return null;
      }
      if (capture.error) throw capture.error;
      await capture.configure(result.video);
      // Audio configuration may arrive after video. Add a stable destination
      // track now; the worklet joins it when the worker supplies PCM format.
      if (result.audio) {
        await capture.ensureAudio();
        capture.stream.addTrack(capture.audioStream!.getAudioTracks()[0]);
      }
      if (capture.error) throw capture.error;
      nativeCaptures.set(capture.track, capture);
      return capture;
    } catch (error) {
      capture.close();
      throw error;
    }
  }
  private configure(config: NativeVideoConfig) {
    this.config = config;
    return this.playback.configure({
      codec: config.codec,
      codedWidth: config.width,
      codedHeight: config.height,
    });
  }
  private async ensureAudio() {
    if (this.audioReady) return this.audioReady;
    this.audio = new AudioContext({
      sampleRate: 48000,
      latencyHint: "interactive",
    });
    // Keep the destination itself so the worklet can connect after config.
    this.destination = this.audio.createMediaStreamDestination();
    this.audioStream = this.destination.stream;
    this.audioReady = (async () => {
      await this.audio!.audioWorklet.addModule(pcmWorklet);
      if (!this.closed) await this.audio!.resume();
    })();
    return this.audioReady;
  }
  private destination?: MediaStreamAudioDestinationNode;
  private receive(packet: NativeEvent) {
    if (packet.kind === "error") {
      this.fail(Error(packet.message));
      return;
    }
    if (packet.kind === "video-config")
      void this.configure(packet.config!).catch((error) => this.fail(error));
    if (packet.kind === "audio-config") {
      const rate = packet.config?.sampleRate;
      if (!Number.isInteger(rate) || rate! < 8000 || rate! > 192000)
        throw Error("Invalid native PCM sample rate");
      const generation = ++this.audioGeneration;
      // Stop accepting samples into the old-rate worklet immediately when a
      // device changes format, including while module loading is pending.
      this.audioNode?.disconnect();
      this.audioNode?.port.close();
      this.audioNode = undefined;
      void (async () => {
        await this.ensureAudio();
        if (this.closed || generation !== this.audioGeneration) return;
        this.audioNode = new AudioWorkletNode(this.audio!, "haunt-native-pcm", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { sampleRate: rate },
        });
        this.audioNode.connect(this.destination!);
      })().catch((error) => {
        if (!this.closed) this.fail(error);
      });
    }
    if (packet.kind === "audio") this.audioNode?.port.postMessage(packet.data);
    if (packet.kind === "video") {
      for (const listener of this.listeners) listener(packet);
      this.playback.decode(
        new EncodedVideoChunk({
          type: packet.key ? "key" : "delta",
          timestamp: packet.timestamp!,
          data: packet.data as Uint8Array<ArrayBuffer>,
        }),
      );
    }
  }
  subscribe(fn: (packet: NativeEvent) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private fail(error: Error) {
    this.error = error;
    this.onended?.(error);
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.off();
    this.listeners.clear();
    nativeCaptures.delete(this.track);
    this.playback.close();
    this.audioNode?.port.close();
    this.audioNode?.disconnect();
    this.destination?.disconnect();
    void this.audio?.close();
    this.audioStream?.getTracks().forEach((t) => t.stop());
    this.stream.getTracks().forEach((t) => t.stop());
    void this.bridge.nativeStop(this.id).catch(() => {});
  }
}
