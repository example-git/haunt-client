import type { MediaState, Purpose } from "@haunt/core";

export type VoiceIntent = Pick<MediaState, "muted" | "deafened">;

/** Every microphone playback surface acquires its own lease before playing. */
export class MicrophoneLoopbacks {
  private leases = new Set<symbol>();
  private listeners = new Set<() => void>();
  getSnapshot = () => this.leases.size > 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  acquire() {
    const lease = Symbol();
    this.leases.add(lease);
    this.notify();
    return () => {
      if (this.leases.delete(lease)) this.notify();
    };
  }
  private notify() {
    for (const listener of this.listeners) listener();
  }
}

export const microphoneLoopbacks = new MicrophoneLoopbacks();

export function effectiveMediaState(
  intent: VoiceIntent,
  inputs: {
    microphone: boolean;
    camera: boolean;
    screen: boolean;
    loopback: boolean;
  },
): Readonly<MediaState> {
  const deafened = intent.deafened || inputs.loopback;
  return Object.freeze({
    muted: intent.muted || deafened || !inputs.microphone,
    deafened,
    camera_off: !inputs.camera,
    screen_off: !inputs.screen,
  });
}

export function sameMediaState(a: MediaState, b: MediaState) {
  return (
    a.muted === b.muted &&
    a.deafened === b.deafened &&
    a.camera_off === b.camera_off &&
    a.screen_off === b.screen_off
  );
}

export function publicationBlocked(state: MediaState, purpose: Purpose) {
  if (purpose === "audio") return state.muted || state.deafened;
  if (purpose === "camera" || purpose === "camera_audio")
    return state.camera_off;
  return state.screen_off;
}
