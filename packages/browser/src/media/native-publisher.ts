import type { LocalTracks, TransportContext } from "./types";
import { isAudioPurpose, type MediaState } from "@haunt/core";
import { publicationBlocked } from "./state";
import { nativeCaptures } from "./native-capture";
import { audioBitrate } from "./audio-quality";
import captureWorklet from "./capture-worklet.js?url";
import { videoLayers, type VideoLayer } from "./quality";

export class NativePublisher {
  private id = crypto.randomUUID();
  private closed = false;
  private bridge = window.hauntDesktop!;
  private off?: () => void;
  private audio?: AudioContext;
  private cleanup: (() => void)[] = [];
  private keyframes = new Set<string>();
  constructor(
    private context: TransportContext,
    private state: () => MediaState,
  ) {}
  async publish(tracks: LocalTracks) {
    const mapping: Record<string, string> = {};
    const layers: Record<string, VideoLayer[]> = {};
    const configs = [...tracks].map(([purpose, track]) => {
      mapping[purpose] = purpose;
      const capture = nativeCaptures.get(track);
      if (!isAudioPurpose(purpose) && !capture)
        throw Error("Native publisher requires native video sources");
      if (
        capture &&
        this.context.client.account.instance.capabilities?.includes(
          "media.layers.v1",
        )
      )
        layers[purpose] = videoLayers({
          width: capture.config.width,
          height: capture.config.height,
          fps: capture.config.fps,
        });
      return { purpose, capture: capture?.id, layers: layers[purpose] };
    });
    this.off = this.bridge.onNativeEvent((event) => {
      if (event.id === this.id && event.kind === "keyframe")
        this.keyframes.add(`${event.purpose}:${event.layer}`);
      if (event.id === this.id && event.kind === "error" && !this.closed)
        this.context.failed(Error(event.message));
    });
    try {
      const admission = this.context.admission;
      const { sdp } = await this.bridge.nativeOffer({
        id: this.id,
        tracks: configs,
        ice: (admission.ice_servers ?? []).map((s) => ({
          urls: s.urls ?? [],
          username: s.username,
          credential: s.credential,
        })),
        relay: admission.ice_transport_policy === "relay",
      });
      if (this.closed) return;
      const answer = await this.context.client.command(
        { type: "media.publish", tracks: mapping, layers, sdp },
        "media.answer",
        (e) => !e.publisher_id,
      );
      if (this.closed) return;
      await this.bridge.nativeAnswer(
        this.id,
        answer.sdp as RTCSessionDescriptionInit,
      );
      if (this.closed) return;
      for (const [purpose, track] of tracks) {
        const capture = nativeCaptures.get(track);
        if (!capture) continue;
        for (const layer of layers[purpose]?.slice(1) ?? []) {
          const config: VideoEncoderConfig = {
            codec: capture.config.codec,
            width: layer.width,
            height: layer.height,
            bitrate: Math.max(
              150_000,
              Math.round(layer.width * layer.height * layer.fps * 0.07),
            ),
            framerate: layer.fps,
            latencyMode: "realtime",
            avc: { format: "annexb" },
          };
          if (!(await VideoEncoder.isConfigSupported(config)).supported)
            throw Error(
              `H.264 encoding is unavailable for the ${layer.height}p viewing layer.`,
            );
          if (this.closed) return;
          const key = `${purpose}:${layer.id}`;
          let pending = 0,
            last = -Infinity,
            keyAt = -Infinity,
            needsKey = true;
          const encoder = new VideoEncoder({
            output: (chunk) => {
              if (this.closed || publicationBlocked(this.state(), purpose))
                return;
              if (pending >= 2) {
                needsKey = true;
                this.keyframes.add(key);
                return;
              }
              if (needsKey && chunk.type !== "key") return;
              needsKey = false;
              const data = new Uint8Array(chunk.byteLength);
              chunk.copyTo(data);
              pending++;
              void this.bridge
                .nativeVideo(
                  this.id,
                  purpose,
                  layer.id,
                  data,
                  Math.max(0, chunk.timestamp),
                  chunk.type === "key",
                )
                .catch((error) => {
                  if (!this.closed) this.context.failed(error);
                })
                .finally(() => {
                  pending--;
                });
            },
            error: (error) => {
              if (!this.closed) this.context.failed(error);
            },
          });
          let off: (() => void) | undefined;
          this.cleanup.push(() => {
            off?.();
            if (encoder.state !== "closed") encoder.close();
          });
          encoder.configure(config);
          off = capture.decoded((frame) => {
            if (
              this.closed ||
              encoder.state !== "configured" ||
              encoder.encodeQueueSize >= 2 ||
              pending >= 2 ||
              publicationBlocked(this.state(), purpose) ||
              frame.timestamp - last < 1_000_000 / layer.fps - 500
            )
              return;
            last = frame.timestamp;
            const keyFrame =
              this.keyframes.delete(key) ||
              frame.timestamp - keyAt >= 1_000_000;
            if (keyFrame) keyAt = frame.timestamp;
            encoder.encode(frame, { keyFrame });
          });
        }
      }
      this.audio = new AudioContext({
        sampleRate: 48000,
        latencyHint: "interactive",
      });
      await this.audio.audioWorklet.addModule(captureWorklet);
      if (this.closed) return;
      await this.audio.resume();
      for (const [purpose, track] of tracks) {
        if (!isAudioPurpose(purpose)) continue;
        const channels = purpose === "audio" ? 1 : 2;
        const config = {
          codec: "opus",
          sampleRate: this.audio.sampleRate,
          numberOfChannels: channels,
          bitrate: audioBitrate,
        };
        if (!(await AudioEncoder.isConfigSupported(config)).supported)
          throw Error("Native calls need Opus encoding support");
        if (this.closed) return;
        const encoder = new AudioEncoder({
          output: (chunk) => {
            if (this.closed || publicationBlocked(this.state(), purpose))
              return;
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            this.bridge.nativeAudio(
              this.id,
              purpose,
              data,
              Math.max(0, chunk.timestamp),
            );
          },
          error: (error) => {
            if (!this.closed) this.context.failed(error);
          },
        });
        let source: MediaStreamAudioSourceNode | undefined;
        let node: AudioWorkletNode | undefined;
        this.cleanup.push(() => {
          if (node) {
            node.port.onmessage = null;
            node.port.close();
            node.disconnect();
          }
          source?.disconnect();
          if (encoder.state !== "closed") encoder.close();
        });
        encoder.configure(config);
        source = this.audio.createMediaStreamSource(new MediaStream([track]));
        node = new AudioWorkletNode(this.audio, "haunt-capture", {
          channelCount: channels,
          channelCountMode: "explicit",
          processorOptions: { channels },
        });
        source.connect(node);
        node.connect(this.audio.destination);
        node.port.onmessage = ({ data }) => {
          if (encoder.state !== "configured" || encoder.encodeQueueSize > 4)
            return;
          const samples = data.samples as Float32Array<ArrayBuffer>;
          const frame = new AudioData({
            format: "f32",
            sampleRate: this.audio!.sampleRate,
            numberOfFrames: samples.length / channels,
            numberOfChannels: channels,
            timestamp: data.timestamp,
            data: samples,
          });
          encoder.encode(frame);
          frame.close();
        };
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.off?.();
    for (const cleanup of this.cleanup) cleanup();
    void this.audio?.close();
    void this.bridge.nativeClosePublisher(this.id).catch(() => {});
  }
}
