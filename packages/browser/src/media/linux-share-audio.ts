import pcmWorklet from "./native-pcm-worklet.js?url";

export const linuxShares = new WeakMap<MediaStreamTrack, LinuxShareAudio>();
export class LinuxShareAudio {
  private readonly id = crypto.randomUUID();
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private track?: MediaStreamTrack;
  private off?: () => void;
  private closed = false;
  private error?: Error;
  onended?: (error: Error) => void;
  static async attach(stream: MediaStream) {
    const bridge = window.hauntDesktop?.linuxAudio;
    if (!bridge || stream.getAudioTracks().length) return;
    const capture = new LinuxShareAudio();
    try {
      const context = (capture.context = new AudioContext({
        sampleRate: 48000,
        latencyHint: "interactive",
      }));
      const destination = context.createMediaStreamDestination();
      capture.track = destination.stream.getAudioTracks()[0];
      await context.audioWorklet.addModule(pcmWorklet);
      capture.node = new AudioWorkletNode(context, "haunt-native-pcm", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { sampleRate: 48000 },
      });
      capture.node.connect(destination);
      await context.resume();
      capture.off = bridge.subscribe((event) => {
        if (event.id !== capture.id || capture.closed) return;
        if (event.error) {
          capture.error = Error(event.error);
          capture.close();
          capture.onended?.(capture.error);
        } else if (event.data) capture.node?.port.postMessage(event.data);
      });
      const result = await bridge.start(capture.id);
      if (capture.error) throw capture.error;
      if (!result) {
        capture.close();
        return;
      }
      const video = stream.getVideoTracks()[0];
      if (!video || video.readyState === "ended")
        throw Error("Screen sharing ended before audio started.");
      stream.addTrack(capture.track);
      linuxShares.set(video, capture);
      video.addEventListener("ended", () => capture.close(), { once: true });
      return capture;
    } catch (error) {
      capture.close();
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.off?.();
    this.node?.disconnect();
    this.node?.port.close();
    this.track?.stop();
    void this.context?.close();
    void window.hauntDesktop?.linuxAudio?.stop(this.id).catch(() => {});
  }
}
