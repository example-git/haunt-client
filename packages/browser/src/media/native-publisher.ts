import type { LocalTracks, TransportContext } from "./types";
import { isAudioPurpose } from "@haunt/core";
import { nativeCaptures } from "./native-capture";
import { audioBitrate } from "./audio-quality";
import captureWorklet from "./capture-worklet.js?url";

// Video stays in Electron's private worker pipe. Only processed microphone and
// source-audio Opus packets cross renderer IPC. Receiving remains standard RTC.
export class NativePublisher {
  private id = crypto.randomUUID();
  private closed = false;
  private bridge = window.hauntDesktop!;
  private off?: () => void;
  private audio?: AudioContext;
  private cleanup: (() => void)[] = [];
  constructor(private context: TransportContext) {}
  async publish(tracks: LocalTracks) {
    const mapping: Record<string, string> = {};
    const configs = [...tracks].map(([purpose, track]) => {
      mapping[purpose] = purpose;
      const capture = nativeCaptures.get(track);
      if (!isAudioPurpose(purpose) && !capture)
        throw Error("Native publisher requires native video sources");
      return { purpose, capture: capture?.id };
    });
    this.off = this.bridge.onNativeEvent((event) => {
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
        { type: "media.publish", tracks: mapping, sdp },
        "media.answer",
        (e) => !e.publisher_id,
      );
      if (this.closed) return;
      await this.bridge.nativeAnswer(
        this.id,
        answer.sdp as RTCSessionDescriptionInit,
      );
      if (this.closed) return;
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
            if (this.closed) return;
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
        encoder.configure(config);
        const source = this.audio.createMediaStreamSource(
          new MediaStream([track]),
        );
        const node = new AudioWorkletNode(this.audio, "haunt-capture", {
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
        this.cleanup.push(() => {
          node.port.onmessage = null;
          node.port.close();
          node.disconnect();
          source.disconnect();
          if (encoder.state !== "closed") encoder.close();
        });
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
