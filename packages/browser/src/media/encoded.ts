import { VideoPlayback } from "./video-playback";
import { isAudioPurpose } from "@haunt/core";
import {
  socketURL,
  type EncodedTrack,
  type MediaState,
  type Participant,
  type Purpose,
  type WireEvent,
} from "@haunt/core";
import type { LocalTracks, MediaTransport, TransportContext } from "./types";
import { pack, unpack } from "./framing";
import { KeyframeRequests } from "./keyframes";
import { audioBitrate } from "./audio-quality";
import { nativeCaptures } from "./native-capture";
import { publicationBlocked } from "./state";
import captureWorklet from "./capture-worklet.js?url";
type Chunk = EncodedAudioChunk | EncodedVideoChunk;
type Publisher = {
  config: EncodedTrack;
  revision: number;
  sequence: number;
  key: boolean;
  pending: Chunk[];
  close: () => void;
};
type Receiver = {
  revision: number;
  decode: (chunk: ReturnType<typeof unpack>) => void;
  close: () => void;
  deafen?: (deafened: boolean) => void;
};
const base64 = (buffer: AllowSharedBufferSource) => {
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};
function description(value?: string) {
  return value
    ? Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
    : undefined;
}
export class EncodedTransport implements MediaTransport {
  private socket?: WebSocket;
  private audio?: AudioContext;
  private publishers = new Map<Purpose, Publisher>();
  private receivers = new Map<string, Receiver>();
  private closed = false;
  private configured?: { resolve: () => void; reject: (error: Error) => void };
  private keyframes = new KeyframeRequests((publisher_id, purpose) => {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(
        JSON.stringify({ type: "keyframe", publisher_id, purpose }),
      );
  });
  private stateValue: MediaState = {
    muted: false,
    deafened: false,
    camera_off: true,
    screen_off: true,
  };
  constructor(private context: TransportContext) {}
  async start() {
    if (
      !globalThis.AudioEncoder ||
      !globalThis.AudioDecoder ||
      !globalThis.VideoEncoder ||
      !globalThis.VideoDecoder ||
      !globalThis.AudioWorkletNode
    )
      throw Error(
        "Calling on this server needs a browser with WebCodecs audio and video support. Use the desktop app or a current Chromium browser.",
      );
    this.audio = new AudioContext({
      sampleRate: 48000,
      latencyHint: "interactive",
    });
    await this.audio.resume();
    await this.audio.audioWorklet.addModule(captureWorklet);
    const path = this.context.admission.media_path;
    if (path !== "/api/v1/media")
      throw Error("Unsupported server media endpoint");
    const ws = new WebSocket(socketURL(this.context.client.origin, path));
    this.socket = ws;
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(Error("Media connection timed out"));
        ws.close();
      }, 10_000);
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            type: "authenticate",
            token: this.context.client.account.login.token,
            participant_id: this.context.participantId,
          }),
        );
      ws.onmessage = (event) => {
        try {
          if (typeof event.data === "string") {
            const message = JSON.parse(event.data);
            if (message.type === "ready") {
              if (message.protocol !== "chatxo-encoded-v1")
                throw Error("Unsupported media protocol");
              clearTimeout(timer);
              resolve();
            } else if (message.type === "tracks")
              this.tracks(message.participant_id, message.tracks ?? []);
            else if (message.type === "keyframe") {
              const publisher = this.publishers.get(message.purpose);
              if (publisher) publisher.key = true;
            }
          } else {
            const packet = unpack(event.data);
            const receiver = this.receivers.get(
              `${packet.publisher}:${packet.purpose}`,
            );
            if (
              receiver?.revision === packet.revision &&
              !(isAudioPurpose(packet.purpose) && this.stateValue.deafened)
            )
              receiver.decode(packet);
          }
        } catch (error) {
          this.context.failed(error as Error);
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(Error("Media connection failed"));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        reject(Error("Media connection closed"));
        this.configured?.reject(Error("Media connection closed"));
        if (!this.closed)
          this.context.failed(Error("Media connection interrupted"));
      };
    });
  }
  private send(chunk: Chunk, purpose: Purpose, publisher: Publisher) {
    if (
      this.closed ||
      publicationBlocked(this.stateValue, purpose) ||
      !publisher.revision ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return;
    if (this.socket.bufferedAmount > 512_000) {
      publisher.key = true;
      return;
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    try {
      this.socket.send(
        pack({
          purpose,
          revision: publisher.revision,
          sequence: publisher.sequence,
          timestamp: Math.max(0, chunk.timestamp),
          duration: chunk.duration ?? 0,
          key: chunk.type === "key",
          data,
        }) as Uint8Array<ArrayBuffer>,
      );
      publisher.sequence = (publisher.sequence + 1) >>> 0;
    } catch {
      publisher.key = true;
    }
  }
  async publish(tracks: LocalTracks) {
    for (const publisher of this.publishers.values()) publisher.close();
    this.publishers.clear();
    const configs = await Promise.all(
      [...tracks].map(([purpose, track]) => this.capture(purpose, track)),
    );
    if (this.closed) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.configured = undefined;
        reject(Error("Media configuration timed out"));
      }, 8_000);
      this.configured = {
        resolve: () => {
          clearTimeout(timer);
          this.configured = undefined;
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          this.configured = undefined;
          reject(error);
        },
      };
      this.socket!.send(JSON.stringify({ type: "configure", tracks: configs }));
    });
  }
  private async capture(
    purpose: Purpose,
    track: MediaStreamTrack,
  ): Promise<EncodedTrack> {
    let first!: () => void, fail!: (error: Error) => void;
    const initialized = new Promise<void>((resolve, reject) => {
      first = resolve;
      fail = reject;
    });
    const publisher: Publisher = {
      config: { purpose, codec: isAudioPurpose(purpose) ? "opus" : "vp8" },
      revision: 0,
      sequence: 0,
      key: true,
      pending: [],
      close: () => {},
    };
    this.publishers.set(purpose, publisher);
    const output = (
      chunk: Chunk,
      metadata?: EncodedAudioChunkMetadata | EncodedVideoChunkMetadata,
    ) => {
      if (metadata?.decoderConfig?.description)
        publisher.config.description = base64(
          metadata.decoderConfig.description,
        );
      if (publicationBlocked(this.stateValue, purpose)) {
        publisher.key = true;
      } else if (!publisher.revision) {
        if (publisher.pending.length < 8) publisher.pending.push(chunk);
        else publisher.key = true;
      } else this.send(chunk, purpose, publisher);
      first();
    };
    const error = (e: DOMException) => {
      fail(e);
      if (!this.closed) this.context.failed(e);
    };
    const native = nativeCaptures.get(track);
    if (native) {
      Object.assign(publisher.config, {
        codec: native.config.codec,
        width: native.config.width,
        height: native.config.height,
      });
      let synchronized = false;
      publisher.close = native.subscribe((packet) => {
        if (!synchronized && !packet.key) return;
        synchronized = true;
        output(
          new EncodedVideoChunk({
            type: packet.key ? "key" : "delta",
            timestamp: packet.timestamp!,
            data: packet.data as Uint8Array<ArrayBuffer>,
          }),
        );
      });
    } else if (isAudioPurpose(purpose)) {
      const context = this.audio!;
      const channels = purpose === "audio" ? 1 : 2;
      const config: AudioEncoderConfig = {
        codec: "opus",
        sampleRate: context.sampleRate,
        numberOfChannels: channels,
        bitrate: audioBitrate,
      };
      if (!(await AudioEncoder.isConfigSupported(config)).supported)
        throw Error("This browser cannot encode audio for this server.");
      Object.assign(publisher.config, {
        sample_rate: config.sampleRate,
        channels,
      });
      const encoder = new AudioEncoder({ output, error });
      encoder.configure(config);
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const worklet = new AudioWorkletNode(context, "haunt-capture", {
        numberOfOutputs: 0,
        channelCount: channels,
        channelCountMode: "explicit",
        processorOptions: { channels },
      });
      source.connect(worklet);
      worklet.port.onmessage = (event) => {
        if (encoder.state !== "configured" || encoder.encodeQueueSize > 4)
          return;
        const samples = event.data.samples as Float32Array;
        const data = new AudioData({
          format: "f32",
          sampleRate: context.sampleRate,
          numberOfFrames: samples.length / channels,
          numberOfChannels: channels,
          timestamp: event.data.timestamp,
          data: samples as Float32Array<ArrayBuffer>,
        });
        encoder.encode(data);
        data.close();
      };
      publisher.close = () => {
        worklet.port.onmessage = null;
        worklet.port.close();
        source.disconnect();
        worklet.disconnect();
        if (encoder.state !== "closed") encoder.close();
      };
    } else {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([track]);
      await video.play();
      const settings = track.getSettings(),
        scale = Math.min(1, 1280 / (settings.width || 1280));
      const width = Math.max(
        2,
        Math.round(((settings.width || video.videoWidth || 640) * scale) / 2) *
          2,
      );
      const height = Math.max(
        2,
        Math.round(
          ((settings.height || video.videoHeight || 480) * scale) / 2,
        ) * 2,
      );
      const config: VideoEncoderConfig = {
        codec: "vp8",
        width,
        height,
        bitrate: purpose === "camera" ? 900_000 : 1_500_000,
        framerate: 24,
        latencyMode: "realtime",
      };
      if (!(await VideoEncoder.isConfigSupported(config)).supported)
        throw Error("This browser cannot encode video for this server.");
      Object.assign(publisher.config, { width, height });
      const encoder = new VideoEncoder({ output, error });
      encoder.configure(config);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const draw = canvas.getContext("2d")!;
      let tick = 0;
      const started = performance.now();
      const timer = setInterval(() => {
        if (
          encoder.state !== "configured" ||
          video.readyState < 2 ||
          encoder.encodeQueueSize > 2
        )
          return;
        draw.drawImage(video, 0, 0, width, height);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((performance.now() - started) * 1000),
          duration: 41_667,
        });
        const keyFrame = publisher.key || tick++ % 48 === 0;
        publisher.key = false;
        encoder.encode(frame, { keyFrame });
        frame.close();
      }, 1000 / 24);
      publisher.close = () => {
        clearInterval(timer);
        video.pause();
        video.srcObject = null;
        if (encoder.state !== "closed") encoder.close();
      };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        initialized,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Media capture did not produce frames")),
            8_000,
          );
        }),
      ]);
    } catch (error) {
      publisher.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
    return publisher.config;
  }
  private tracks(id: string, tracks: EncodedTrack[]) {
    if (id === this.context.participantId) {
      for (const track of tracks) {
        const publisher = this.publishers.get(track.purpose as Purpose);
        if (!publisher) continue;
        publisher.revision = track.revision!;
        for (const chunk of publisher.pending)
          this.send(chunk, track.purpose as Purpose, publisher);
        publisher.pending = [];
        publisher.key = true;
      }
      this.configured?.resolve();
      return;
    }
    this.remove(id);
    for (const track of tracks) {
      try {
        this.receive(id, track);
      } catch (error) {
        this.context.failed(error as Error);
      }
    }
  }
  private requestKey(id: string, purpose: Purpose) {
    this.keyframes.request(id, purpose);
  }
  private receive(id: string, config: EncodedTrack) {
    const purpose = config.purpose as Purpose,
      key = `${id}:${purpose}`;
    let last: number | undefined;
    if (isAudioPurpose(purpose)) {
      const context = this.audio!,
        destination = context.createMediaStreamDestination();
      let next = context.currentTime;
      const sources = new Set<AudioBufferSourceNode>();
      const decoder = new AudioDecoder({
        output: (data) => {
          try {
            if (this.stateValue.deafened || next - context.currentTime > 0.3)
              return;
            const buffer = context.createBuffer(
              data.numberOfChannels,
              data.numberOfFrames,
              // Preserve decoder metadata. AudioBufferSourceNode performs any
              // conversion to the graph rate; the selected sink handles hardware.
              data.sampleRate,
            );
            for (let channel = 0; channel < data.numberOfChannels; channel++)
              data.copyTo(buffer.getChannelData(channel), {
                planeIndex: channel,
                format: "f32-planar",
              });
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(destination);
            sources.add(source);
            source.onended = () => {
              sources.delete(source);
              source.disconnect();
            };
            next = Math.max(context.currentTime + 0.03, next);
            source.start(next);
            next += buffer.duration;
          } finally {
            data.close();
          }
        },
        error: () => {
          if (!this.closed)
            this.context.failed(Error("Audio decoding was interrupted"));
        },
      });
      const decoderConfig: AudioDecoderConfig = {
        codec: config.codec!,
        sampleRate: config.sample_rate!,
        numberOfChannels: config.channels!,
        description: description(config.description),
      };
      decoder.configure(decoderConfig);
      destination.stream.getAudioTracks().forEach((track) => {
        track.enabled = !this.stateValue.deafened;
      });
      this.context.remote(id, purpose, destination.stream);
      this.receivers.set(key, {
        revision: config.revision!,
        deafen: (deafened) => {
          destination.stream.getAudioTracks().forEach((track) => {
            track.enabled = !deafened;
          });
          if (!deafened) return;
          // Discard buffered playback as well as packets arriving after deafen.
          for (const source of sources) {
            source.stop();
            source.disconnect();
          }
          sources.clear();
          next = context.currentTime;
          if (decoder.state !== "closed") {
            decoder.reset();
            decoder.configure(decoderConfig);
          }
        },
        decode: (packet) => {
          if (decoder.state === "configured" && decoder.decodeQueueSize < 8)
            decoder.decode(
              new EncodedAudioChunk({
                type: packet.key ? "key" : "delta",
                timestamp: packet.timestamp,
                duration: packet.duration || undefined,
                data: packet.data as Uint8Array<ArrayBuffer>,
              }),
            );
        },
        close: () => {
          if (decoder.state !== "closed") decoder.close();
          for (const source of sources) {
            source.stop();
            source.disconnect();
          }
          destination.disconnect();
          destination.stream.getTracks().forEach((t) => t.stop());
        },
      });
    } else {
      const playback = new VideoPlayback(
        () => this.requestKey(id, purpose),
        (error) => this.context.failed(error),
      );
      const receiver = {
        revision: config.revision!,
        decode: (packet: ReturnType<typeof unpack>) => {
          if (last !== undefined && packet.sequence !== (last + 1) >>> 0)
            playback.discontinuity();
          last = packet.sequence;
          if (
            playback.decode(
              new EncodedVideoChunk({
                type: packet.key ? "key" : "delta",
                timestamp: packet.timestamp,
                duration: packet.duration || undefined,
                data: packet.data as Uint8Array<ArrayBuffer>,
              }),
            ) &&
            packet.key
          )
            this.keyframes.satisfied(id, purpose);
        },
        close: () => playback.close(),
      };
      this.receivers.set(key, receiver);
      this.context.remote(id, purpose, playback.stream);
      void playback
        .configure({
          codec: config.codec!,
          codedWidth: config.width,
          codedHeight: config.height,
          description: description(config.description),
        })
        .catch((error) => {
          if (this.receivers.get(key) === receiver) this.context.failed(error);
        });
    }
  }
  participant(_participant: Participant) {}
  remove(id: string) {
    this.keyframes.remove(id);
    for (const [key, receiver] of this.receivers)
      if (key.startsWith(id + ":")) {
        receiver.close();
        this.receivers.delete(key);
        this.context.remote(id, key.split(":")[1] as Purpose, null);
      }
  }
  event(_event: WireEvent) {}
  state(state: MediaState) {
    const wasDeafened = this.stateValue.deafened;
    this.stateValue = state;
    for (const [purpose, publisher] of this.publishers) {
      if (publicationBlocked(state, purpose)) {
        publisher.pending = [];
        publisher.key = true;
      }
    }
    if (state.deafened !== wasDeafened)
      for (const receiver of this.receivers.values())
        receiver.deafen?.(state.deafened);
  }
  close() {
    this.closed = true;
    this.keyframes.close();
    this.configured?.reject(Error("Call ended"));
    this.socket?.close();
    for (const p of this.publishers.values()) p.close();
    this.publishers.clear();
    for (const [key, r] of this.receivers) {
      r.close();
      this.context.remote(
        key.split(":")[0],
        key.split(":")[1] as Purpose,
        null,
      );
    }
    this.receivers.clear();
    void this.audio?.close();
  }
}
