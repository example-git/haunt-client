import { pluginSelection } from "../audio-plugins/preferences";
import { ensureAudioPlugins, subscribePlugins } from "../audio-plugins/cache";
import { pluginDownloads, pluginFileKey } from "../audio-plugins/progress";
import { SpeakingActivity } from "./speaking";
import { isAudioPurpose } from "@haunt/core";
import {
  unwrap,
  type InstanceClient,
  type MediaState,
  type Participant,
  type Purpose,
  type WireEvent,
} from "@haunt/core";
import { EncodedTransport } from "./encoded";
import { WebRTCTransport } from "./webrtc";
import type { LocalTracks, MediaTransport } from "./types";
import { VoiceCues } from "../sounds";
import { getPreferences, subscribePreferences } from "../preferences";
import { MicrophoneCapture, type NoiseStatus } from "./microphone";
import {
  NativeCapture,
  nativeCaptures,
  nativeCaptureAvailable,
} from "./native-capture";
export interface RemoteMedia {
  participant: string;
  purpose: Purpose;
  stream: MediaStream;
}
export interface CallSnapshot {
  status: "joining" | "connected" | "reconnecting" | "ended";
  error?: string;
  room: string;
  participantId?: string;
  participants: Participant[];
  remote: RemoteMedia[];
  local: { purpose: Purpose; stream: MediaStream }[];
  state: MediaState;
  busy: boolean;
  noiseSuppression?: NoiseStatus;
}
export class Call {
  snapshot: CallSnapshot;
  readonly speaking = new SpeakingActivity();
  private offSpeaking?: () => void;
  private speakingParticipant?: string;
  private listeners = new Set<() => void>();
  private transport?: MediaTransport;
  private tracks: LocalTracks = new Map();
  private unsubscribe: () => void;
  private offConnection: () => void;
  private renewal?: ReturnType<typeof setTimeout>;
  private stable?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private ended = false;
  private joining = false;
  private failures = 0;
  private cues: VoiceCues;
  private microphone?: MicrophoneCapture;
  private microphoneStream?: MediaStream;
  private offPreferences?: () => void;
  private microphoneAbort = new AbortController();
  constructor(
    readonly client: InstanceClient,
    readonly room: string,
  ) {
    this.cues = new VoiceCues(client.account.login.user.id);
    this.snapshot = {
      status: "joining",
      room,
      participants: [],
      remote: [],
      local: [],
      state: {
        muted: false,
        deafened: false,
        camera_off: true,
        screen_off: true,
      },
      busy: false,
    };
    this.unsubscribe = client.onWire((e) => this.event(e));
    this.offConnection = client.subscribe(() => {
      if (
        this.snapshot.status === "reconnecting" &&
        client.snapshot.status === "online"
      )
        this.reconnect();
    });
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;
  private change(patch: Partial<CallSnapshot> = {}) {
    this.snapshot = { ...this.snapshot, ...patch };
    const id = this.snapshot.participantId;
    if (id !== this.speakingParticipant) {
      this.offSpeaking?.();
      this.speakingParticipant = id;
      const track = this.tracks.get("audio");
      if (id && track)
        this.offSpeaking = this.speaking.observe(
          id,
          new MediaStream([track]),
          () =>
            this.snapshot.status === "connected" && !this.snapshot.state.muted
              ? 1
              : 0,
        );
    }
    this.speaking.sample();
    this.cues.observe(this.snapshot);
    for (const fn of this.listeners) fn();
  }
  async start(waitForPlugin = true) {
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error(
          "Voice and video need the desktop app or a browser page served over HTTPS (or localhost).",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: getPreferences().microphone
            ? { ideal: getPreferences().microphone }
            : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 1 },
          autoGainControl: getPreferences().automaticGainControl,
        },
        video: false,
      });
      if (this.ended) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.microphoneStream = stream;
      const microphone = await MicrophoneCapture.open(
        stream,
        false,
        (noiseSuppression) => {
          if (!this.ended) this.change({ noiseSuppression });
        },
        this.microphoneAbort.signal,
        {
          level: getPreferences().microphoneGain,
          automatic: getPreferences().automaticGainControl,
        },
        pluginSelection(this.client),
      );
      if (this.ended) {
        microphone.close();
        return;
      }
      this.microphone = microphone;
      const refreshProcessing = () => {
        void this.refreshProcessing();
      };
      const offPrefs = subscribePreferences(refreshProcessing),
        offPlugins = subscribePlugins(refreshProcessing);
      const downloads = pluginDownloads(this.client);
      let previous = "";
      const offDownloads = downloads.subscribe(() => {
        const state = downloads.getSnapshot(),
          selected = pluginSelection(this.client);
        const file = selected?.plugin.manifest.variants.find(
          (v) => v.id === selected.variant,
        )?.file;
        const phase =
          selected && file
            ? state.files[pluginFileKey(selected.plugin, file)]?.phase
            : "";
        const key = `${state.catalog}:${selected?.plugin.digest}:${file}:${phase}`;
        if (key === previous) return;
        previous = key;
        if (
          state.catalog === "error" ||
          (state.catalog === "ready" && (!selected || phase === "ready"))
        )
          refreshProcessing();
      });
      this.offPreferences = () => {
        offPrefs();
        offPlugins();
        offDownloads();
      };
      const prepare = this.retryNoiseProcessing();
      if (waitForPlugin && getPreferences().noiseSuppression) await prepare;
      if (this.ended) return;
      this.tracks.set("audio", microphone.track);
      this.updateLocal();
      await this.join();
    } catch (error) {
      await this.end(
        error instanceof Error ? error.message : "Could not start the call.",
      );
      throw error;
    }
  }
  private preparing?: Promise<void>;
  private async refreshProcessing() {
    const microphone = this.microphone;
    if (this.ended || !microphone) return;
    const prefs = getPreferences();
    await microphone.setGain(prefs.microphoneGain, prefs.automaticGainControl);
    if (this.ended) return;
    const catalog = pluginDownloads(this.client).getSnapshot().catalog;
    if (catalog !== "ready" && getPreferences().noiseSuppression) {
      await microphone.setSuppression(false);
      this.change({
        noiseSuppression: catalog === "error" ? "fallback" : "loading",
      });
      return;
    }
    await microphone.setSuppression(
      getPreferences().noiseSuppression,
      pluginSelection(this.client),
    );
  }
  retryNoiseProcessing(): Promise<void> {
    if (this.ended) return Promise.resolve();
    if (this.preparing) return this.preparing;
    const task = (async () => {
      if (getPreferences().noiseSuppression)
        this.change({ noiseSuppression: "loading" });
      try {
        await ensureAudioPlugins(this.client);
        if (this.ended) return;
        await this.microphone?.setSuppression(false);
        await this.refreshProcessing();
      } catch {
        if (!this.ended)
          this.change({
            noiseSuppression: getPreferences().noiseSuppression
              ? "fallback"
              : "off",
          });
      }
    })();
    this.preparing = task;
    void task.finally(() => {
      if (this.preparing === task) this.preparing = undefined;
    });
    return task;
  }
  private async join() {
    if (this.joining || this.ended || !this.tracks.has("audio")) return;
    this.joining = true;
    const generation = ++this.generation;
    clearTimeout(this.renewal);
    clearTimeout(this.stable);
    this.transport?.close();
    this.transport = undefined;
    this.change({ remote: [], participants: [] });
    try {
      if (this.snapshot.participantId)
        await this.client
          .command({ type: "media.leave" }, "media.left")
          .catch(() => {});
      const admission = await unwrap(
        this.client.http.POST("/api/v1/voice/{id}/admissions", {
          params: { path: { id: this.room } },
        }),
      );
      if (this.ended || generation !== this.generation) return;
      const joined = await this.client.command(
        { type: "media.join", admission_id: admission.admission_id },
        "media.joined",
      );
      if (this.ended || generation !== this.generation) return;
      const participant = joined.participant as Participant;
      this.change({
        participantId: participant.participant_id,
        participants: [participant],
      });
      const context = {
        client: this.client,
        admission,
        participantId: participant.participant_id,
        remote: (id: string, purpose: Purpose, stream: MediaStream | null) => {
          if (generation !== this.generation || this.ended) return;
          const remote = this.snapshot.remote.filter(
            (r) => r.participant !== id || r.purpose !== purpose,
          );
          if (stream) remote.push({ participant: id, purpose, stream });
          this.change({ remote });
        },
        failed: (error: Error) => {
          if (generation === this.generation && !this.ended)
            this.reconnect(error.message);
        },
      };
      if (admission.transport === "webrtc")
        this.transport = new WebRTCTransport(context);
      else if (admission.transport === "websocket")
        this.transport = new EncodedTransport(context);
      else
        throw Error("This server selected an unsupported calling transport.");
      await this.transport.start();
      if (this.ended || generation !== this.generation) {
        this.transport.close();
        return;
      }
      this.transport.state(this.snapshot.state);
      await this.client.command(
        { type: "media.state", state: this.snapshot.state },
        "media.state.accepted",
      );
      await this.transport.publish(this.tracks);
      const { participants } = await unwrap(
        this.client.http.GET("/api/v1/voice/{id}", {
          params: { path: { id: this.room } },
        }),
      );
      if (this.ended || generation !== this.generation) return;
      for (const p of participants ?? []) this.participant(p);
      this.change({ status: "connected", error: undefined });
      this.stable = setTimeout(() => {
        this.failures = 0;
      }, 30_000);
      if (admission.ice_expires_at)
        this.renewal = setTimeout(
          () => this.reconnect(),
          Math.max(
            1000,
            Date.parse(admission.ice_expires_at) - Date.now() - 120_000,
          ),
        );
    } finally {
      this.joining = false;
    }
  }
  private participant(participant: Participant) {
    this.change({
      participants: [
        ...this.snapshot.participants.filter(
          (p) => p.participant_id !== participant.participant_id,
        ),
        participant,
      ],
    });
    this.transport?.participant(participant);
  }
  private event(event: WireEvent) {
    if (this.ended) return;
    if (event.type === "connection.lost") {
      this.generation++;
      this.transport?.close();
      this.change({
        status: "reconnecting",
        remote: [],
        error: "Reconnecting the call…",
      });
      return;
    }
    if (event.type === "media.revoked") {
      void this.end("You no longer have permission to join this call.");
      return;
    }
    if (event.type === "media.reconnect_required") {
      this.reconnect();
      return;
    }
    if (
      [
        "media.participant.joined",
        "media.participant.state",
        "media.tracks",
      ].includes(event.type)
    )
      this.participant(event.participant as Participant);
    if (event.type === "media.participant.left") {
      const id = String(event.participant_id);
      this.transport?.remove(id);
      this.change({
        participants: this.snapshot.participants.filter(
          (p) => p.participant_id !== id,
        ),
      });
    }
    this.transport?.event(event);
  }
  private reconnect(error = "Reconnecting the call…") {
    if (this.ended || this.retry) return;
    this.change({ status: "reconnecting", error });
    if (this.client.snapshot.status !== "online") return;
    if (this.failures++ >= 4) {
      void this.end(
        "The call could not reconnect. Check your connection and join again.",
      );
      return;
    }
    this.retry = setTimeout(
      () => {
        this.retry = undefined;
        if (this.joining) {
          this.failures--;
          this.reconnect(error);
          return;
        }
        void this.join().catch((e) => this.reconnect(e.message));
      },
      Math.min(8000, 500 * 2 ** this.failures),
    );
  }
  private updateLocal() {
    this.change({
      local: [...this.tracks]
        .filter(([p]) => !isAudioPurpose(p))
        .map(([purpose, track]) => ({
          purpose,
          stream: new MediaStream([track]),
        })),
    });
  }
  async setState(patch: Partial<MediaState>) {
    const state = { ...this.snapshot.state, ...patch };
    if (this.snapshot.status !== "connected") return;
    await this.client.command(
      { type: "media.state", state },
      "media.state.accepted",
    );
    this.tracks.get("audio")!.enabled = !state.muted;
    this.microphone?.setMuted(state.muted);
    this.transport?.state(state);
    this.change({ state });
  }
  async toggleVideo(purpose: "camera" | "screen") {
    if (this.snapshot.busy || this.snapshot.status !== "connected") return;
    this.change({ busy: true });
    try {
      const audioPurpose =
        purpose === "camera" ? "camera_audio" : "screen_audio";
      const sourceAudio =
        this.client.account.instance.capabilities?.includes(
          "media.source_audio",
        ) ?? false;
      const old = this.tracks.get(purpose);
      if (old) {
        nativeCaptures.get(old)?.close();
        old.onended = null;
        old.stop();
        this.tracks.delete(purpose);
        this.tracks.get(audioPurpose)?.stop();
        this.tracks.delete(audioPurpose);
      } else {
        const native = nativeCaptureAvailable()
          ? await NativeCapture.open(purpose, sourceAudio)
          : undefined;
        if (native === null) return;
        const stream =
          native?.stream ??
          (purpose === "camera"
            ? await navigator.mediaDevices.getUserMedia({
                video: {
                  deviceId: getPreferences().camera
                    ? { ideal: getPreferences().camera }
                    : undefined,
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                  frameRate: { ideal: 24, max: 30 },
                },
                audio:
                  sourceAudio &&
                  getPreferences().cameraAudio &&
                  !getPreferences().cameraAudio.startsWith("swift:")
                    ? {
                        deviceId: { exact: getPreferences().cameraAudio },
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        sampleRate: { ideal: 48000 },
                        channelCount: { ideal: 2 },
                      }
                    : false,
              })
            : await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 24, max: 30 } },
                audio: sourceAudio
                  ? {
                      sampleRate: { ideal: 48000 },
                      channelCount: { ideal: 2 },
                      echoCancellation: false,
                      noiseSuppression: false,
                      autoGainControl: false,
                    }
                  : false,
              }));
        if (this.ended) {
          native?.close();
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const track = stream.getVideoTracks()[0];
        if (!track) {
          stream.getTracks().forEach((t) => t.stop());
          throw Error("No video source was selected.");
        }
        this.tracks.set(purpose, track);
        const audio = stream.getAudioTracks()[0];
        if (audio) this.tracks.set(audioPurpose, audio);
        const ended = () => {
          if (this.ended || this.tracks.get(purpose) !== track) return;
          if (this.snapshot.busy) {
            setTimeout(ended, 100);
            return;
          }
          void this.toggleVideo(purpose).catch((error) =>
            this.reconnect(error.message),
          );
        };
        track.onended = ended;
        if (native) native.onended = () => ended();
      }
      await this.setState({
        [purpose === "camera" ? "camera_off" : "screen_off"]:
          !this.tracks.has(purpose),
      });
      this.updateLocal();
      await this.transport?.publish(this.tracks);
      // The encoded relay permits one reconfiguration/second (with a small burst).
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      this.change({ busy: false });
    }
  }
  async end(error?: string) {
    if (this.ended) return;
    this.ended = true;
    this.generation++;
    clearTimeout(this.retry);
    clearTimeout(this.renewal);
    clearTimeout(this.stable);
    this.unsubscribe();
    this.offConnection();
    this.offPreferences?.();
    this.speaking.close();
    this.offSpeaking = undefined;
    this.microphoneAbort.abort();
    this.microphone?.close();
    this.microphone = undefined;
    this.microphoneStream?.getTracks().forEach((track) => track.stop());
    this.microphoneStream = undefined;
    this.transport?.close();
    for (const track of this.tracks.values()) {
      nativeCaptures.get(track)?.close();
      track.onended = null;
      track.stop();
    }
    this.tracks.clear();
    this.change({
      status: "ended",
      error,
      remote: [],
      local: [],
      participants: [],
    });
    if (this.client.snapshot.status === "online")
      await this.client
        .command({ type: "media.leave" }, "media.left")
        .catch(() => {});
  }
}
