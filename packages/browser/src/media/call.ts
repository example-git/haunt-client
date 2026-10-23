import { pluginSelection } from "../audio-plugins/preferences";
import { rememberVoice, clearVoiceReconnect } from "./reconnect";
import type { ViewingQuality } from "./quality";
import { ensureAudioPlugins, subscribePlugins } from "../audio-plugins/cache";
import { pluginDownloads, pluginFileKey } from "../audio-plugins/progress";
import { SpeakingActivity, audioActivityKey } from "./speaking";
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
import {
  getPreferences,
  setPreferences,
  subscribePreferences,
} from "../preferences";
import {
  selectedCameraMode,
  exactVideoConstraints,
  matchesVideoMode,
  applyCameraMode,
  applyScreenMode,
  screenFrameRates,
  type VideoMode,
} from "./video-settings";
import { MicrophoneCapture, type NoiseStatus } from "./microphone";
import { openMicrophone } from "./microphone-input";
import {
  effectiveMediaState,
  microphoneLoopbacks,
  publicationBlocked,
  sameMediaState,
  type VoiceIntent,
} from "./state";
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
  state: Readonly<MediaState>;
  restriction: Readonly<{ muted: boolean; deafened: boolean }>;
  microphoneMonitoring: boolean;
  busy: boolean;
  qualities: Record<string, ViewingQuality>;
  noiseSuppression?: NoiseStatus;
}
export class Call {
  private snapshotValue: CallSnapshot;
  get snapshot(): Readonly<CallSnapshot> {
    return this.snapshotValue;
  }
  readonly speaking = new SpeakingActivity();
  private offSpeaking?: () => void;
  private speakingParticipant?: string;
  private sourceMeters = new Map<
    string,
    { track: MediaStreamTrack; close: () => void }
  >();
  private listeners = new Set<() => void>();
  private transport?: MediaTransport;
  private viewingQualities = new Map<string, ViewingQuality>();
  private rosterUpdates?: Map<string, Participant | null>;
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
  private microphones = new Set<MicrophoneCapture>();
  private pendingMicrophones = new Set<MediaStream>();
  private microphoneStream?: MediaStream;
  private offPreferences?: () => void;
  private microphoneAbort?: AbortController;
  private microphoneDevice = "";
  private cameraDevice?: string;
  private microphoneGeneration = 0;
  private microphoneReplacement: Promise<void> = Promise.resolve();
  private microphonePendingDevice?: string;
  private offDeviceChange?: () => void;
  private speakingTrack?: MediaStreamTrack;
  private voiceIntent: VoiceIntent = { muted: false, deafened: false };
  private offLoopback: () => void;
  private stateTask?: Promise<void>;
  private synchronizedState?: MediaState;
  private stateSession = 0;
  private stateReady = false;
  private observedTracks = new Map<MediaStreamTrack, () => void>();
  private publication: Promise<void> = Promise.resolve();
  constructor(
    readonly client: InstanceClient,
    readonly room: string,
    intent?: VoiceIntent,
  ) {
    if (intent) this.voiceIntent = { ...intent };
    this.cues = new VoiceCues(client.account.login.user.id);
    this.snapshotValue = Object.freeze({
      status: "joining",
      room,
      participants: [],
      remote: [],
      local: [],
      restriction: { muted: false, deafened: false },
      state: effectiveMediaState(this.voiceIntent, {
        microphone: false,
        camera: false,
        screen: false,
        loopback: microphoneLoopbacks.getSnapshot(),
      }),
      microphoneMonitoring: microphoneLoopbacks.getSnapshot(),
      busy: false,
      qualities: {},
    });
    this.unsubscribe = client.onWire((e) => this.event(e));
    this.offConnection = client.subscribe(() => {
      if (
        this.snapshot.status === "reconnecting" &&
        client.snapshot.status === "online"
      )
        this.reconnect();
    });
    this.offLoopback = microphoneLoopbacks.subscribe(() => {
      if (!this.ended) {
        this.change();
        this.synchronizeStateInBackground();
      }
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
    const usable = (track?: MediaStreamTrack) =>
      !!track && track.readyState === "live" && !track.muted;
    const restriction = patch.restriction ?? this.snapshot.restriction;
    const state = effectiveMediaState(
      {
        muted: this.voiceIntent.muted || restriction.muted,
        deafened: this.voiceIntent.deafened || restriction.deafened,
      },
      {
        microphone:
          usable(this.tracks.get("audio")) &&
          usable(this.microphoneStream?.getAudioTracks()[0]),
        camera: usable(this.tracks.get("camera")),
        screen: usable(this.tracks.get("screen")),
        loopback: microphoneLoopbacks.getSnapshot(),
      },
    );
    // Gate capture and playback before publishing a snapshot or waiting on the
    // network. UI, meters and signaling all read this same derived value.
    for (const microphone of this.microphones) microphone.setMuted(state.muted);
    for (const stream of this.pendingMicrophones)
      for (const track of stream.getAudioTracks()) track.enabled = !state.muted;
    for (const [purpose, track] of this.tracks)
      track.enabled = !publicationBlocked(state, purpose);
    const remote = patch.remote ?? this.snapshot.remote;
    for (const media of remote)
      for (const track of media.stream.getAudioTracks())
        track.enabled = !state.deafened;
    this.transport?.state(state);
    const next = {
      ...this.snapshot,
      ...patch,
      state,
      microphoneMonitoring: microphoneLoopbacks.getSnapshot(),
    };
    // A delayed server echo must not overwrite our current effective controls.
    next.participants = next.participants.map((participant) =>
      participant.participant_id === next.participantId
        ? { ...participant, state }
        : participant,
    );
    this.snapshotValue = Object.freeze(next);
    const id = this.snapshot.participantId;
    const speakingTrack = this.tracks.get("audio");
    if (
      id !== this.speakingParticipant ||
      speakingTrack !== this.speakingTrack
    ) {
      this.offSpeaking?.();
      this.speakingParticipant = id;
      this.speakingTrack = speakingTrack;
      if (id && speakingTrack)
        this.offSpeaking = this.speaking.observe(
          id,
          new MediaStream([speakingTrack]),
          () =>
            this.snapshot.status === "connected" && !this.snapshot.state.muted
              ? 1
              : 0,
        );
    }
    const sourceKeys = new Set<string>();
    for (const purpose of ["camera_audio", "screen_audio"] as const) {
      const track = this.tracks.get(purpose);
      if (!id || !track) continue;
      const key = audioActivityKey(id, purpose);
      sourceKeys.add(key);
      if (this.sourceMeters.get(key)?.track === track) continue;
      this.sourceMeters.get(key)?.close();
      const close = this.speaking.observe(
        key,
        new MediaStream([track]),
        () =>
          this.snapshot.status === "connected" &&
          !(purpose === "camera_audio"
            ? this.snapshot.state.camera_off
            : this.snapshot.state.screen_off)
            ? 1
            : 0,
        true,
      );
      this.sourceMeters.set(key, { track, close });
    }
    for (const [key, meter] of this.sourceMeters) {
      if (sourceKeys.has(key)) continue;
      meter.close();
      this.sourceMeters.delete(key);
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
      const prefs = getPreferences();
      const stream = await openMicrophone(
        prefs.microphone,
        prefs.automaticGainControl,
      );
      if (this.ended) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const abort = new AbortController();
      this.microphoneAbort = abort;
      this.microphoneStream = stream;
      this.pendingMicrophones.add(stream);
      stream.getAudioTracks()[0].enabled = !(
        this.voiceIntent.muted ||
        this.voiceIntent.deafened ||
        microphoneLoopbacks.getSnapshot()
      );
      const microphone = await MicrophoneCapture.open(
        stream,
        false,
        (noiseSuppression) => {
          if (!this.ended) this.change({ noiseSuppression });
        },
        abort.signal,
        {
          level: prefs.microphoneGain,
          automatic: prefs.automaticGainControl,
        },
        pluginSelection(this.client),
      );
      if (this.ended) {
        microphone.close();
        return;
      }
      this.microphone = microphone;
      this.pendingMicrophones.delete(stream);
      this.microphones.add(microphone);
      this.observeTrack(stream.getAudioTracks()[0]);
      this.observeTrack(microphone.track);
      this.microphoneDevice = prefs.microphone;
      const refreshProcessing = () => {
        const device = getPreferences().microphone;
        if (
          device !== this.microphoneDevice ||
          this.microphonePendingDevice !== undefined
        ) {
          if (this.snapshot.status === "connected")
            void this.replaceMicrophone();
          return;
        }
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
      if (this.ended) return;
      stream.getAudioTracks()[0].onended = () => {
        if (!this.ended && this.microphoneStream === stream)
          void this.replaceMicrophone();
      };
      const deviceChanged = () => void this.replaceMicrophone();
      navigator.mediaDevices.addEventListener("devicechange", deviceChanged);
      this.offDeviceChange = () =>
        navigator.mediaDevices.removeEventListener(
          "devicechange",
          deviceChanged,
        );
      if (
        stream.getAudioTracks()[0].readyState === "ended" ||
        getPreferences().microphone !== this.microphoneDevice
      )
        void this.replaceMicrophone();
    } catch (error) {
      await this.end(
        error instanceof Error ? error.message : "Could not start the call.",
      );
      throw error;
    }
  }
  private replaceMicrophone() {
    const device = getPreferences().microphone;
    // Loading the replacement's audio plugin emits progress updates. Those
    // updates must not cancel and restart the same device change indefinitely.
    if (device === this.microphonePendingDevice)
      return this.microphoneReplacement;
    this.microphonePendingDevice = device;
    const generation = ++this.microphoneGeneration;
    this.microphoneReplacement = this.microphoneReplacement
      .catch(() => {})
      .then(() => this.performMicrophoneReplacement(generation))
      .finally(() => {
        if (generation === this.microphoneGeneration)
          this.microphonePendingDevice = undefined;
      });
    return this.microphoneReplacement;
  }
  private async performMicrophoneReplacement(generation: number) {
    if (
      this.ended ||
      generation !== this.microphoneGeneration ||
      !navigator.mediaDevices?.getUserMedia
    )
      return;
    const prefs = getPreferences();
    let stream: MediaStream | undefined;
    let microphone: MicrophoneCapture | undefined;
    const abort = new AbortController();
    try {
      stream = await openMicrophone(
        prefs.microphone,
        prefs.automaticGainControl,
      );
      stream.getAudioTracks()[0].enabled = !this.snapshot.state.muted;
      if (this.ended || generation !== this.microphoneGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.pendingMicrophones.add(stream);
      microphone = await MicrophoneCapture.open(
        stream,
        prefs.noiseSuppression,
        (noiseSuppression) => {
          if (!this.ended && generation === this.microphoneGeneration)
            this.change({ noiseSuppression });
        },
        abort.signal,
        {
          level: prefs.microphoneGain,
          automatic: prefs.automaticGainControl,
        },
        pluginSelection(this.client),
      );
      if (this.ended || generation !== this.microphoneGeneration) {
        microphone.close();
        return;
      }
      microphone.setMuted(this.snapshot.state.muted);
      this.pendingMicrophones.delete(stream);
      this.microphones.add(microphone);
      const previousMicrophone = this.microphone,
        previousStream = this.microphoneStream,
        previousAbort = this.microphoneAbort,
        previousTrack = this.tracks.get("audio");
      this.microphone = microphone;
      this.microphoneStream = stream;
      this.microphoneAbort = abort;
      this.tracks.set("audio", microphone.track);
      this.updateLocal();
      try {
        await this.publishTracks();
      } catch (error) {
        if (this.ended) throw error;
        this.microphone = previousMicrophone;
        this.microphoneStream = previousStream;
        this.microphoneAbort = previousAbort;
        if (previousTrack) this.tracks.set("audio", previousTrack);
        this.updateLocal();
        this.reconnect(
          error instanceof Error
            ? `Could not switch microphones: ${error.message}`
            : "Could not switch microphones.",
        );
        throw error;
      }
      if (this.ended) {
        microphone.close();
        return;
      }
      this.microphoneDevice = prefs.microphone;
      this.observeTrack(stream.getAudioTracks()[0]);
      this.observeTrack(microphone.track);
      stream.getAudioTracks()[0].onended = () => {
        if (!this.ended && this.microphoneStream === stream)
          void this.replaceMicrophone();
      };
      previousStream?.getAudioTracks().forEach((track) => {
        track.onended = null;
      });
      previousAbort?.abort();
      previousMicrophone?.close();
      if (previousMicrophone) this.microphones.delete(previousMicrophone);
      previousStream?.getTracks().forEach((track) => track.stop());
      this.change();
      this.synchronizeStateInBackground();
      await this.refreshProcessing();
      this.change({ error: undefined });
    } catch (error) {
      abort.abort();
      microphone?.close();
      stream?.getTracks().forEach((track) => track.stop());
      if (!this.ended && generation === this.microphoneGeneration)
        this.change({
          error:
            error instanceof Error
              ? `Could not switch microphones: ${error.message}`
              : "Could not switch microphones.",
        });
    } finally {
      if (stream) this.pendingMicrophones.delete(stream);
      if (microphone && microphone !== this.microphone)
        this.microphones.delete(microphone);
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
    const updates = new Map<string, Participant | null>();
    this.resetStateSynchronization();
    clearTimeout(this.renewal);
    clearTimeout(this.stable);
    this.transport?.close();
    this.transport = undefined;
    this.change({ remote: [], participants: [], qualities: {} });
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
      const admitted = joined.participant as Participant;
      const participant =
        this.snapshot.participants.find(
          (value) => value.participant_id === admitted.participant_id,
        ) ?? admitted;
      this.change({
        restriction: participant.restriction ?? {
          muted: false,
          deafened: false,
        },
        participantId: participant.participant_id,
        participants: [participant],
      });
      const context = {
        client: this.client,
        admission,
        participantId: participant.participant_id,
        viewingQuality: (id: string, purpose: string) =>
          this.viewingQualities.get(`${id}:${purpose}`),
        quality: (id: string, purpose: string, quality: ViewingQuality) => {
          if (generation === this.generation && !this.ended) {
            this.viewingQualities.set(`${id}:${purpose}`, quality);
            this.change({
              qualities: {
                ...this.snapshot.qualities,
                [`${id}:${purpose}`]: quality,
              },
            });
          }
        },
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
      const transport =
        admission.transport === "webrtc"
          ? new WebRTCTransport(context)
          : admission.transport === "websocket"
            ? new EncodedTransport(context)
            : undefined;
      if (!transport)
        throw Error("This server selected an unsupported calling transport.");
      this.transport = transport;
      await transport.start();
      if (
        this.ended ||
        generation !== this.generation ||
        this.transport !== transport
      ) {
        transport.close();
        return;
      }
      this.stateReady = true;
      this.change();
      await this.synchronizeState();
      if (this.ended || generation !== this.generation || !this.transport)
        return;
      await this.publishTracks();
      this.rosterUpdates = updates;
      const { participants } = await unwrap(
        this.client.http.GET("/api/v1/voice/{id}", {
          params: { path: { id: this.room } },
        }),
      );
      if (this.ended || generation !== this.generation) return;
      this.rosterUpdates = undefined;
      const roster = new Map(
        (participants ?? []).map((p) => [p.participant_id, p]),
      );
      for (const [id, participant] of updates)
        if (participant) roster.set(id, participant);
        else roster.delete(id);
      const present = new Set(roster.keys());
      for (const key of this.viewingQualities.keys())
        if (!present.has(key.slice(0, key.lastIndexOf(":"))))
          this.viewingQualities.delete(key);
      for (const p of roster.values()) this.participant(p);
      if (this.ended || generation !== this.generation) return;
      this.change({ status: "connected", error: undefined });
      rememberVoice(this.client, this.room, this.voiceIntent);
      if (getPreferences().microphone !== this.microphoneDevice)
        void this.replaceMicrophone();
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
    } catch (error) {
      if (!this.ended && generation === this.generation) throw error;
    } finally {
      if (this.rosterUpdates === updates) this.rosterUpdates = undefined;
      this.joining = false;
    }
  }
  private participant(participant: Participant) {
    this.change({
      ...(participant.participant_id === this.snapshot.participantId
        ? {
            restriction: participant.restriction ?? {
              muted: false,
              deafened: false,
            },
          }
        : {}),
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
      this.resetStateSynchronization();
      this.transport?.close();
      this.transport = undefined;
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
    ) {
      const participant = event.participant as Participant;
      this.rosterUpdates?.set(participant.participant_id, participant);
      this.participant(participant);
    }
    if (event.type === "media.participant.left") {
      const id = String(event.participant_id);
      this.rosterUpdates?.set(id, null);
      this.transport?.remove(id);
      for (const key of this.viewingQualities.keys())
        if (key.startsWith(`${id}:`)) this.viewingQualities.delete(key);
      this.change({
        participants: this.snapshot.participants.filter(
          (p) => p.participant_id !== id,
        ),
        qualities: Object.fromEntries(
          Object.entries(this.snapshot.qualities).filter(
            ([key]) => !key.startsWith(`${id}:`),
          ),
        ),
      });
    }
    this.transport?.event(event);
  }
  private reconnect(error = "Reconnecting the call…") {
    if (this.ended || this.retry) return;
    this.generation++;
    this.resetStateSynchronization();
    this.transport?.close();
    this.transport = undefined;
    this.change({ status: "reconnecting", error, remote: [] });
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
    for (const track of this.tracks.values()) this.observeTrack(track);
    for (const track of this.microphoneStream?.getTracks() ?? [])
      this.observeTrack(track);
    for (const [track, off] of this.observedTracks) {
      if (
        [
          ...this.tracks.values(),
          ...(this.microphoneStream?.getTracks() ?? []),
        ].includes(track)
      )
        continue;
      off();
      this.observedTracks.delete(track);
    }
    this.change({
      local: [...this.tracks].map(([purpose, track]) => ({
        purpose,
        stream: new MediaStream([track]),
      })),
    });
  }
  private observeTrack(track: MediaStreamTrack) {
    if (this.observedTracks.has(track)) return;
    const changed = () => {
      if (this.ended) return;
      this.change();
      this.synchronizeStateInBackground();
    };
    for (const event of ["mute", "unmute", "ended"])
      track.addEventListener(event, changed);
    this.observedTracks.set(track, () => {
      for (const event of ["mute", "unmute", "ended"])
        track.removeEventListener(event, changed);
    });
  }
  private resetStateSynchronization() {
    this.stateSession++;
    this.stateReady = false;
    this.synchronizedState = undefined;
    this.stateTask = undefined;
  }
  private synchronizeStateInBackground() {
    const session = this.stateSession;
    void this.synchronizeState().catch((error: Error) => {
      if (!this.ended && session === this.stateSession)
        this.reconnect(`Could not synchronize call controls: ${error.message}`);
    });
  }
  private publicationState(): MediaState {
    if (
      !this.client.account.instance.capabilities?.includes(
        "media.moderation.v1",
      )
    )
      return this.snapshot.state;
    return {
      ...this.snapshot.state,
      muted:
        this.voiceIntent.muted ||
        microphoneLoopbacks.getSnapshot() ||
        !this.tracks.get("audio") ||
        this.microphoneStream?.getAudioTracks()[0]?.readyState !== "live",
      deafened: this.voiceIntent.deafened || microphoneLoopbacks.getSnapshot(),
    };
  }
  private synchronizeState(): Promise<void> {
    if (!this.stateReady || this.ended) return Promise.resolve();
    if (this.stateTask) return this.stateTask;
    const session = this.stateSession;
    const task = (async () => {
      while (!this.ended && this.stateReady && session === this.stateSession) {
        const state = this.publicationState();
        if (
          this.synchronizedState &&
          sameMediaState(state, this.synchronizedState)
        )
          return;
        await this.client.command(
          { type: "media.state", state },
          "media.state.accepted",
        );
        if (session !== this.stateSession) return;
        this.synchronizedState = state;
      }
    })();
    this.stateTask = task;
    const finished = (success: boolean) => {
      if (this.stateTask === task) this.stateTask = undefined;
      if (
        success &&
        session === this.stateSession &&
        this.synchronizedState &&
        !sameMediaState(this.publicationState(), this.synchronizedState)
      )
        this.synchronizeStateInBackground();
    };
    void task.then(
      () => finished(true),
      () => finished(false),
    );
    return task;
  }
  async setState(patch: Partial<VoiceIntent>) {
    if (
      Object.entries(patch).some(
        ([key, value]) =>
          !["muted", "deafened"].includes(key) || typeof value !== "boolean",
      )
    )
      throw Error(
        "Only microphone and deafen intent can be set directly. Camera and screen state follow their active sources.",
      );
    if (this.ended) return;
    if (
      patch.muted === false &&
      (this.snapshot.restriction.muted || this.snapshot.restriction.deafened)
    )
      throw Error(
        "A moderator has restricted your microphone in this channel.",
      );
    if (patch.deafened === false && this.snapshot.restriction.deafened)
      throw Error("A moderator has deafened you in this channel.");
    this.voiceIntent = { ...this.voiceIntent, ...patch };
    if (
      this.snapshot.status === "connected" ||
      this.snapshot.status === "reconnecting"
    )
      rememberVoice(this.client, this.room, this.voiceIntent);
    this.change();
    const session = this.stateSession;
    try {
      await this.synchronizeState();
    } catch (error) {
      if (session === this.stateSession)
        this.reconnect("Could not synchronize call controls. Reconnecting…");
      throw error;
    }
  }
  private publishTracks() {
    const transport = this.transport;
    const task = this.publication
      .catch(() => {})
      .then(async () => {
        if (!transport || transport !== this.transport || this.ended) return;
        await transport.publish(new Map(this.tracks));
      });
    this.publication = task;
    return task;
  }
  private stopVideo(purpose: "camera" | "screen") {
    const track = this.tracks.get(purpose);
    if (!track) return;
    this.tracks.delete(purpose);
    track.onended = null;
    nativeCaptures.get(track)?.close();
    track.stop();
    const audioPurpose = purpose === "camera" ? "camera_audio" : "screen_audio";
    this.tracks.get(audioPurpose)?.stop();
    this.tracks.delete(audioPurpose);
  }
  async toggleVideo(purpose: "camera" | "screen") {
    if (this.snapshot.busy || this.snapshot.status !== "connected") return;
    this.change({ busy: true });
    let changed = false;
    try {
      const audioPurpose =
        purpose === "camera" ? "camera_audio" : "screen_audio";
      const sourceAudio =
        this.client.account.instance.capabilities?.includes(
          "media.source_audio",
        ) ?? false;
      const old = this.tracks.get(purpose);
      if (old) {
        this.stopVideo(purpose);
        changed = true;
      } else {
        const prefs = getPreferences();
        const mode =
          purpose === "camera"
            ? await selectedCameraMode(
                prefs.camera,
                prefs.cameraModes[prefs.camera],
              )
            : prefs.screenMode;
        const native = nativeCaptureAvailable()
          ? await NativeCapture.open(purpose, sourceAudio, prefs)
          : undefined;
        if (native === null) return;
        const stream =
          native?.stream ??
          (purpose === "camera"
            ? await navigator.mediaDevices.getUserMedia({
                video: {
                  deviceId: prefs.camera ? { exact: prefs.camera } : undefined,
                  ...exactVideoConstraints(mode),
                },
                audio:
                  sourceAudio &&
                  prefs.cameraAudio &&
                  !prefs.cameraAudio.startsWith("swift:")
                    ? {
                        deviceId: { exact: prefs.cameraAudio },
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        sampleRate: { ideal: 48000 },
                        channelCount: { ideal: 2 },
                      }
                    : false,
              })
            : await navigator.mediaDevices.getDisplayMedia({
                video: {
                  width: { max: mode.width },
                  height: { max: mode.height },
                  frameRate: { ideal: mode.fps, max: mode.fps },
                },
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
          native?.close();
          stream.getTracks().forEach((t) => t.stop());
          throw Error("No video source was selected.");
        }
        if (
          !native &&
          purpose === "camera" &&
          !matchesVideoMode(track.getSettings(), mode)
        ) {
          stream.getTracks().forEach((source) => source.stop());
          throw Error(
            "The camera did not provide the selected resolution and frame rate.",
          );
        }
        if (!native && purpose === "screen") {
          try {
            await applyScreenMode(track, mode);
          } catch (error) {
            stream.getTracks().forEach((source) => source.stop());
            throw error;
          }
        }
        this.tracks.set(purpose, track);
        if (purpose === "camera") this.cameraDevice = prefs.camera;
        changed = true;
        const audio = stream.getAudioTracks()[0];
        if (audio) this.tracks.set(audioPurpose, audio);
        const ended = () => {
          if (this.ended || this.tracks.get(purpose) !== track) return;
          this.stopVideo(purpose);
          this.updateLocal();
          this.synchronizeStateInBackground();
          const generation = this.generation;
          void this.publishTracks().catch((error) => {
            if (generation === this.generation) this.reconnect(error.message);
          });
        };
        track.onended = ended;
        if (native) native.onended = () => ended();
      }
      this.updateLocal();
      await this.synchronizeState();
      await this.publishTracks();
      // The encoded relay permits one reconfiguration/second (with a small burst).
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      if (changed && !this.ended) {
        this.stopVideo(purpose);
        this.updateLocal();
        this.reconnect(
          error instanceof Error
            ? error.message
            : "Could not update the video source.",
        );
      }
      throw error;
    } finally {
      this.change({ busy: false });
    }
  }
  videoSettings(purpose: "camera" | "screen"): VideoMode | undefined {
    const track = this.tracks.get(purpose);
    if (!track) return;
    const native = nativeCaptures.get(track);
    if (native)
      return {
        width: native.config.width,
        height: native.config.height,
        fps: native.config.fps,
      };
    const settings = track.getSettings();
    if (settings.width && settings.height && settings.frameRate)
      return {
        width: settings.width,
        height: settings.height,
        fps: settings.frameRate,
      };
  }
  cameraSettingsDevice() {
    return this.tracks.has("camera")
      ? (this.cameraDevice ?? getPreferences().camera)
      : getPreferences().camera;
  }
  screenFrameRates() {
    const track = this.tracks.get("screen");
    return screenFrameRates(
      track && !nativeCaptures.has(track) ? track : undefined,
    );
  }
  async setViewingQuality(
    participant: string,
    purpose: "camera" | "screen",
    quality: string,
  ) {
    if (!this.transport?.setQuality)
      throw Error(
        "Viewer quality selection is available only for layered WebRTC video.",
      );
    await this.transport.setQuality(participant, purpose, quality);
  }
  async setVideoMode(purpose: "camera" | "screen", mode: VideoMode) {
    if (this.snapshot.busy)
      throw Error("Wait for the current capture change to finish.");
    this.change({ busy: true });
    let applied = false;
    try {
      const prefs = getPreferences();
      const camera = this.cameraSettingsDevice();
      if (purpose === "camera") await selectedCameraMode(camera, mode);
      const track = this.tracks.get(purpose);
      if (track) {
        const native = nativeCaptures.get(track);
        if (native) await native.setMode(mode);
        else if (purpose === "camera") await applyCameraMode(track, mode);
        else await applyScreenMode(track, mode);
        applied = true;
      }
      setPreferences(
        purpose === "camera"
          ? { cameraModes: { ...prefs.cameraModes, [camera]: mode } }
          : { screenMode: mode },
      );
      this.change();
      if (applied) await this.publishTracks();
    } catch (error) {
      if (applied && !this.ended)
        this.reconnect(
          error instanceof Error
            ? error.message
            : "Could not publish the selected video settings.",
        );
      throw error;
    } finally {
      this.change({ busy: false });
    }
  }
  async end(error?: string) {
    if (this.ended) return;
    clearVoiceReconnect(this.client, this.room);
    this.ended = true;
    this.viewingQualities.clear();
    this.offLoopback();
    this.resetStateSynchronization();
    this.generation++;
    clearTimeout(this.retry);
    clearTimeout(this.renewal);
    clearTimeout(this.stable);
    this.unsubscribe();
    this.offConnection();
    this.offPreferences?.();
    this.speaking.close();
    this.sourceMeters.clear();
    this.offSpeaking = undefined;
    this.microphoneGeneration++;
    this.microphoneAbort?.abort();
    this.offDeviceChange?.();
    this.microphoneStream?.getAudioTracks().forEach((track) => {
      track.onended = null;
    });
    for (const microphone of this.microphones) microphone.close();
    this.microphones.clear();
    for (const stream of this.pendingMicrophones)
      stream.getTracks().forEach((track) => track.stop());
    this.pendingMicrophones.clear();
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
    for (const off of this.observedTracks.values()) off();
    this.observedTracks.clear();
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
