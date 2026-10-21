import {
  isClipSound,
  type NotificationSound,
} from "./notification-sound-options";
import { reportNotificationError } from "./notification-health";
import type { CallSnapshot } from "./media/call";
import { followAudioOutput, supportsAudioOutput } from "./audio-output";
import {
  customSound,
  getPreferences,
  saveCustomSound,
  setPreferences,
} from "./preferences";
export type Cue =
  | "connected"
  | "disconnected"
  | "joined"
  | "left"
  | "muted"
  | "unmuted"
  | "deafened"
  | "undeafened"
  | "screen_started";
const preference = "chatxo-voice-sounds";
export function soundsEnabled() {
  try {
    return localStorage.getItem(preference) !== "off";
  } catch {
    return true;
  }
}
export function setSoundsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(preference, enabled ? "on" : "off");
  } catch {}
}
let context: AudioContext | undefined;
let stopOutput: (() => void) | undefined;
let output: AudioNode | undefined;
let outputElement: HTMLAudioElement | undefined;
let last = Number.NEGATIVE_INFINITY;
let lastPing = Number.NEGATIVE_INFINITY;
const clipBuffers = new Map<string, AudioBuffer>();
let customBuffer: AudioBuffer | undefined;
let customVersion = 0;
let pingGeneration = 0;
const pingSources = new Set<AudioScheduledSourceNode>();
function stopPing() {
  pingGeneration++;
  for (const source of pingSources) {
    try {
      source.stop();
    } catch {}
  }
  pingSources.clear();
}
function unlock() {
  if (typeof AudioContext === "undefined") return;
  if (!context) {
    context = new AudioContext();
    output = context.destination;
    if (!("setSinkId" in context) && supportsAudioOutput()) {
      const destination = context.createMediaStreamDestination();
      output = destination;
      outputElement = new Audio();
      outputElement.srcObject = destination.stream;
      const off = followAudioOutput(outputElement);
      stopOutput = () => {
        off();
        outputElement?.pause();
        if (outputElement) outputElement.srcObject = null;
        destination.stream.getTracks().forEach((t) => t.stop());
      };
    } else stopOutput = followAudioOutput(context);
  }
  if (outputElement?.paused)
    void outputElement
      .play()
      .catch((error) =>
        reportNotificationError(`Notification audio failed: ${error.message}`),
      );
  if (context.state === "suspended")
    void context
      .resume()
      .catch((error) =>
        reportNotificationError(`Notification audio failed: ${error.message}`),
      );
}
export function installSounds() {
  const activate = () => unlock();
  document.addEventListener("pointerdown", activate);
  document.addEventListener("keydown", activate);
  return () => {
    document.removeEventListener("pointerdown", activate);
    document.removeEventListener("keydown", activate);
    stopPing();
    stopOutput?.();
    stopOutput = undefined;
    outputElement = undefined;
    output = undefined;
    void context?.close().catch(() => {});
    context = undefined;
    last = Number.NEGATIVE_INFINITY;
    lastPing = Number.NEGATIVE_INFINITY;
  };
}
export function playCue(cue: Cue) {
  if (!soundsEnabled() || !context || context.state !== "running") return;
  const now = context.currentTime;
  if (["connected", "disconnected", "joined", "left"].includes(cue)) {
    if (now - last < 0.12) return;
    last = now;
  }
  const frequencies: Record<Cue, number[]> = {
    connected: [523.25, 783.99],
    disconnected: [523.25, 349.23],
    joined: [659.25, 783.99],
    left: [523.25, 440],
    muted: [392, 293.66],
    unmuted: [392, 587.33],
    deafened: [329.63, 261.63, 196],
    undeafened: [261.63, 392, 659.25],
    screen_started: [698.46, 880, 1046.5],
  };
  frequencies[cue].forEach((frequency, index) => {
    const oscillator = context!.createOscillator(),
      gain = context!.createGain(),
      start = now + index * 0.095;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.045, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
    oscillator.connect(gain);
    gain.connect(output!);
    oscillator.start(start);
    oscillator.stop(start + 0.16);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  });
}
// Compare user membership, not repeated state/track events or device count.
// Each connected/reconnected snapshot establishes a silent member baseline.
export class VoiceCues {
  private status: CallSnapshot["status"] = "joining";
  private members = new Set<string>();
  private connected = false;
  private local?: CallSnapshot["state"];
  private screens = new Map<string, boolean>();
  constructor(
    private self: string,
    private play: (cue: Cue) => void = playCue,
  ) {}
  observe(snapshot: Pick<CallSnapshot, "status" | "participants" | "state">) {
    const users = new Set(
      snapshot.participants
        .map((p) => p.user_id)
        .filter((id) => id !== this.self),
    );
    if (snapshot.status === "connected") {
      if (this.status !== "connected") {
        this.play("connected");
        this.connected = true;
      } else {
        if (this.local && this.local.muted !== snapshot.state.muted)
          this.play(snapshot.state.muted ? "muted" : "unmuted");
        if (this.local && this.local.deafened !== snapshot.state.deafened)
          this.play(snapshot.state.deafened ? "deafened" : "undeafened");
        if (!snapshot.state.deafened) {
          if (
            snapshot.participants.some(
              (p) =>
                this.screens.get(p.participant_id) === true &&
                !p.state.screen_off,
            )
          )
            this.play("screen_started");
          if ([...users].some((id) => !this.members.has(id)))
            this.play("joined");
          else if ([...this.members].some((id) => !users.has(id)))
            this.play("left");
        }
      }
    } else if (snapshot.status === "ended" && this.connected) {
      this.play("disconnected");
      this.connected = false;
    }
    this.status = snapshot.status;
    this.members = users;
    this.local = snapshot.state;
    this.screens = new Map(
      snapshot.participants.map((p) => [p.participant_id, p.state.screen_off]),
    );
  }
}
async function decodeSound(file: File) {
  if (file.size > 2 * 1024 * 1024 || !file.size)
    throw Error("Choose an audio file up to 2 MB.");
  unlock();
  if (!context) throw Error("Audio playback is unavailable in this client.");
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw Error("This audio file could not be read. Try WAV, MP3 or Ogg.");
  }
  if (decoded.duration > 15 || decoded.duration <= 0)
    throw Error("Choose a sound no longer than 15 seconds.");
  return decoded;
}
export async function importPing(file: File) {
  const decoded = await decodeSound(file);
  await saveCustomSound(file);
  customBuffer = decoded;
  customVersion++;
  setPreferences({ sound: "custom", customSoundName: file.name.slice(0, 256) });
}
export async function importNotificationSound(
  file: File,
): Promise<NotificationSound> {
  const decoded = await decodeSound(file);
  const digest = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const id = `clip:${digest}` as const;
  await saveCustomSound(file, id);
  setPreferences({
    savedSounds: {
      ...getPreferences().savedSounds,
      [id]: file.name.slice(0, 256),
    },
  });
  clipBuffers.set(id, decoded);
  while (clipBuffers.size > 4)
    clipBuffers.delete(clipBuffers.keys().next().value!);
  return id;
}
export async function removeNotificationSound(id: string) {
  if (!isClipSound(id)) return;
  await saveCustomSound(null, id);
  customVersion++;
  clipBuffers.delete(id);
  const prefs = getPreferences();
  const savedSounds = { ...prefs.savedSounds };
  delete savedSounds[id];
  setPreferences({
    savedSounds,
    sound: prefs.sound === id ? "ping" : prefs.sound,
    serverSounds: Object.fromEntries(
      Object.entries(prefs.serverSounds).filter(([, value]) => value !== id),
    ),
    userSounds: Object.fromEntries(
      Object.entries(prefs.userSounds).filter(([, value]) => value !== id),
    ),
    conversationSounds: Object.fromEntries(
      Object.entries(prefs.conversationSounds).filter(
        ([, value]) => value !== id,
      ),
    ),
  });
}
export async function removePing() {
  await saveCustomSound(null);
  customVersion++;
  customBuffer = undefined;
  setPreferences({ sound: "ping", customSoundName: "" });
}
export async function playPing(preview = false, selected?: NotificationSound) {
  if (preview) unlock();
  const prefs = getPreferences();
  const sound = selected ?? prefs.sound;
  if (sound === "none" || !prefs.volume)
    return "Sound is disabled or its volume is zero.";
  if (!context || context.state !== "running")
    throw Error(
      "Notification audio is not running. Interact with Haunt and check the selected audio output.",
    );
  const ctx = context,
    now = ctx.currentTime;
  if (!preview && now - lastPing < 1)
    return "Sound was rate-limited after a recent notification.";
  lastPing = now;
  stopPing();
  const generation = pingGeneration;
  const volume = prefs.volume / 100;
  if (sound === "custom" || isClipSound(sound)) {
    const version = customVersion;
    try {
      let buffer = sound === "custom" ? customBuffer : clipBuffers.get(sound);
      if (!buffer) {
        const blob = await customSound(sound === "custom" ? "ping" : sound);
        if (!blob || blob.size > 2 * 1024 * 1024)
          throw Error("Choose your custom sound again.");
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
        if (decoded.duration > 15)
          throw Error("Choose a shorter notification sound.");
        if (version !== customVersion)
          return "Sound was cancelled because its selection changed.";
        buffer = decoded;
        if (sound === "custom") customBuffer = decoded;
        else {
          clipBuffers.set(sound, decoded);
          while (clipBuffers.size > 4)
            clipBuffers.delete(clipBuffers.keys().next().value!);
        }
      }
      if (ctx.state !== "running" || generation !== pingGeneration)
        return "Sound was interrupted before playback.";
      const source = ctx.createBufferSource(),
        gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(output!);
      pingSources.add(source);
      source.onended = () => {
        pingSources.delete(source);
        source.disconnect();
        gain.disconnect();
      };
      source.start();
      return "Sound playback started; speaker output is not confirmed by the audio API.";
    } catch (error) {
      throw error;
    }
  }
  const notes =
    sound === "chime"
      ? [880, 1174.66, 1396.91]
      : sound === "soft"
        ? [440, 554.37]
        : [1046.5, 1318.51];
  notes.forEach((frequency, index) => {
    const tone = ctx.createOscillator(),
      gain = ctx.createGain(),
      start = ctx.currentTime + index * 0.09;
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12 * volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    tone.connect(gain);
    gain.connect(output!);
    pingSources.add(tone);
    tone.onended = () => {
      pingSources.delete(tone);
      tone.disconnect();
      gain.disconnect();
    };
    tone.start(start);
    tone.stop(start + 0.24);
  });
  return "Sound playback started; speaker output is not confirmed by the audio API.";
}
