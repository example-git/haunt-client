// Shared by native previews and WebSocket receivers. Keep decoded VideoFrames
// on the media path instead of copying every frame through a UI canvas.
type VideoTrackGenerator = MediaStreamTrack & {
  writable: WritableStream<VideoFrame>;
};
type GeneratorConstructor = new (options: {
  kind: "video";
}) => VideoTrackGenerator;

export class VideoPlayback {
  readonly stream: MediaStream;
  readonly track: MediaStreamTrack;
  private writer?: WritableStreamDefaultWriter<VideoFrame>;
  private canvas?: HTMLCanvasElement;
  private draw?: CanvasRenderingContext2D;
  private writing = false;
  private pending?: VideoFrame;
  private decoder?: VideoDecoder;
  private config?: VideoDecoderConfig;
  private signature = "";
  private ready: Promise<void> = Promise.resolve();
  private startup: EncodedVideoChunk[] = [];
  private startupBytes = 0;
  private generation = 0;
  private closed = false;
  private needsKey = true;
  readonly diagnostics = {
    output: "canvas",
    preference: "no-preference" as HardwareAcceleration,
    decoded: 0,
    presented: 0,
    presentationDrops: 0,
    decoderResets: 0,
    hardwareFallbacks: 0,
  };
  constructor(
    private requestKey: () => void,
    private failed: (error: Error) => void,
    private decoded?: (frame: VideoFrame) => void,
  ) {
    const Generator = (
      globalThis as unknown as {
        MediaStreamTrackGenerator?: GeneratorConstructor;
      }
    ).MediaStreamTrackGenerator;
    if (Generator) {
      const track = new Generator({ kind: "video" });
      this.track = track;
      this.writer = track.writable.getWriter();
      this.stream = new MediaStream([track]);
      this.diagnostics.output = "video-frame";
    } else {
      this.canvas = document.createElement("canvas");
      this.draw = this.canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
      })!;
      this.stream = this.canvas.captureStream(0);
      this.track = this.stream.getVideoTracks()[0];
    }
  }
  configure(config: VideoDecoderConfig): Promise<void> {
    const signature = JSON.stringify(config);
    if (signature === this.signature) return this.ready;
    this.signature = signature;
    this.startup = [];
    this.startupBytes = 0;
    const generation = ++this.generation;
    this.needsKey = true;
    if (this.decoder?.state !== "closed") this.decoder?.close();
    this.decoder = undefined;
    this.ready = (async () => {
      let selected: VideoDecoderConfig = {
        ...config,
        optimizeForLatency: true,
        hardwareAcceleration: "prefer-hardware",
      };
      const supported = await VideoDecoder.isConfigSupported(selected).catch(
        () => ({ supported: false }),
      );
      if (!supported.supported) {
        selected = { ...selected, hardwareAcceleration: "no-preference" };
        if (!(await VideoDecoder.isConfigSupported(selected)).supported)
          throw Error(`Video decoding is unavailable for ${config.codec}.`);
      }
      if (this.closed || generation !== this.generation) return;
      this.config = selected;
      this.diagnostics.preference = selected.hardwareAcceleration!;
      if (this.canvas) {
        this.canvas.width = config.codedWidth ?? 1280;
        this.canvas.height = config.codedHeight ?? 720;
      }
      this.createDecoder();
      const startup = this.startup;
      this.startup = [];
      this.startupBytes = 0;
      for (const chunk of startup) this.decode(chunk);
      if (this.needsKey) this.requestKey();
    })();
    return this.ready;
  }
  private createDecoder() {
    if (this.closed || !this.config) return;
    if (this.decoder?.state !== "closed") this.decoder?.close();
    const decoder = new VideoDecoder({
      output: (frame) => {
        if (this.closed || decoder !== this.decoder) {
          frame.close();
          return;
        }
        this.diagnostics.decoded++;
        this.decoded?.(frame);
        this.present(frame);
      },
      error: () => {
        if (this.closed || decoder !== this.decoder) return;
        // A supported accelerator can fail at runtime (driver/resource loss).
        // Fall back once for this configuration and recover at the next IDR.
        if (this.config?.hardwareAcceleration === "prefer-hardware") {
          this.config = {
            ...this.config,
            hardwareAcceleration: "no-preference",
          };
          this.diagnostics.preference = "no-preference";
          this.diagnostics.hardwareFallbacks++;
        }
        this.needsKey = true;
        this.requestKey();
      },
    });
    this.decoder = decoder;
    decoder.configure(this.config);
  }
  discontinuity() {
    this.needsKey = true;
    this.requestKey();
  }
  decode(chunk: EncodedVideoChunk) {
    if (this.closed) return false;
    if (!this.decoder) {
      // Retain a bounded initial GOP while probing hardware support, otherwise
      // losing its first IDR can leave a new native preview blank for 2 seconds.
      if (!this.signature) return false;
      if (chunk.type === "key") {
        this.startup = [];
        this.startupBytes = 0;
      }
      if (
        this.startup.length >= 16 ||
        this.startupBytes + chunk.byteLength > 8 * 1024 * 1024
      ) {
        this.startup = [];
        this.startupBytes = 0;
        return false;
      }
      if (chunk.type === "key" || this.startup.length) {
        this.startup.push(chunk);
        this.startupBytes += chunk.byteLength;
      }
      return false;
    }
    // A few queued frames are normal for hardware pipelines. The previous
    // 3-frame limit discarded whole GOPs during brief UI scheduling delays.
    if (this.decoder.decodeQueueSize >= 16) this.discontinuity();
    if (this.decoder.state === "closed") this.discontinuity();
    if (this.needsKey) {
      if (chunk.type !== "key") return false;
      this.createDecoder();
      this.diagnostics.decoderResets++;
      this.needsKey = false;
    }
    try {
      this.decoder.decode(chunk);
      return true;
    } catch (error) {
      this.discontinuity();
      if (!(error instanceof DOMException)) this.failed(error as Error);
      return false;
    }
  }
  private present(frame: VideoFrame) {
    if (this.writer) {
      if (this.writing) {
        if (this.pending) {
          this.pending.close();
          this.diagnostics.presentationDrops++;
        }
        this.pending = frame;
      } else this.write(frame);
    } else {
      try {
        this.draw!.drawImage(
          frame,
          0,
          0,
          this.canvas!.width,
          this.canvas!.height,
        );
        (this.track as CanvasCaptureMediaStreamTrack).requestFrame();
        this.diagnostics.presented++;
      } finally {
        frame.close();
      }
    }
  }
  private write(frame: VideoFrame) {
    this.writing = true;
    void this.writer!.write(frame)
      .then(() => {
        this.diagnostics.presented++;
      })
      .catch((error) => {
        if (!this.closed) this.failed(error);
      })
      .finally(() => {
        frame.close();
        this.writing = false;
        const next = this.pending;
        this.pending = undefined;
        if (next) {
          if (this.closed) next.close();
          else this.write(next);
        }
      });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    this.pending?.close();
    this.pending = undefined;
    this.startup = [];
    this.startupBytes = 0;
    if (this.decoder?.state !== "closed") this.decoder?.close();
    void this.writer?.abort().catch(() => {});
    this.stream.getTracks().forEach((t) => t.stop());
  }
}
