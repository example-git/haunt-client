import { isAudioPurpose, mediaPurposes } from "@haunt/core";
import type { MediaState, Participant, Purpose, WireEvent } from "@haunt/core";
import type { LocalTracks, MediaTransport, TransportContext } from "./types";
import { audioBitrate, fullBandOpus } from "./audio-quality";
import { NativePublisher } from "./native-publisher";
import { nativeCaptures } from "./native-capture";
import {
  videoLayers,
  QualityController,
  incomingQuality,
  type ViewingQuality,
  type VideoLayer,
} from "./quality";
const purposes: readonly Purpose[] = mediaPurposes;
async function offer(pc: RTCPeerConnection) {
  const description = await pc.createOffer();
  description.sdp = fullBandOpus(description.sdp!);
  await pc.setLocalDescription(description);
  if (pc.iceGatheringState !== "complete")
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", changed);
      };
      const changed = () => {
        if (pc.iceGatheringState === "complete") {
          done();
          resolve();
        }
      };
      const timer = setTimeout(() => {
        done();
        reject(Error("Could not establish the media route."));
      }, 10_000);
      pc.addEventListener("icegatheringstatechange", changed);
      changed();
    });
  return { type: "offer" as const, sdp: pc.localDescription!.sdp };
}
export class WebRTCTransport implements MediaTransport {
  private publisher?: RTCPeerConnection;
  private nativePublisher?: NativePublisher;
  private receivers = new Map<
    string,
    { pc: RTCPeerConnection; signature: string; purposes: Purpose[] }
  >();
  private closed = false;
  private qualities = new Map<
    string,
    ViewingQuality & { controller: QualityController; revision: number }
  >();
  private statistics?: ReturnType<typeof setInterval>;
  private samples = new Map<string, RTCInboundRtpStreamStats>();
  private sampling = false;
  private stateValue: MediaState = {
    muted: true,
    deafened: false,
    camera_off: true,
    screen_off: true,
  };
  constructor(private context: TransportContext) {}
  private peer() {
    const a = this.context.admission;
    const pc = new RTCPeerConnection({
      iceServers: (a.ice_servers ?? []).map((s) => ({
        urls: s.urls ?? [],
        username: s.username,
        credential: s.credential,
      })),
      iceTransportPolicy: a.ice_transport_policy === "relay" ? "relay" : "all",
      bundlePolicy: "max-bundle",
    });
    pc.onconnectionstatechange = () => {
      if (!this.closed && pc.connectionState === "failed")
        this.context.failed(Error("Media connection interrupted"));
    };
    return pc;
  }
  async start() {
    this.statistics = setInterval(() => void this.sampleQuality(), 2000);
  }
  async publish(tracks: LocalTracks) {
    if ([...tracks.values()].some((track) => nativeCaptures.has(track))) {
      const previous = this.nativePublisher;
      const next = new NativePublisher(this.context, () => this.stateValue);
      this.nativePublisher = next;
      try {
        await next.publish(tracks);
      } finally {
        previous?.close();
        this.publisher?.close();
        this.publisher = undefined;
      }
      return;
    }
    this.nativePublisher?.close();
    this.nativePublisher = undefined;
    const pc = this.peer(),
      old = this.publisher;
    this.publisher = pc;
    try {
      const mapping: Record<string, string> = {};
      const layers: Record<string, VideoLayer[]> = {};
      const layered =
        this.context.client.account.instance.capabilities?.includes(
          "media.layers.v1",
        );
      for (const purpose of purposes) {
        const track = tracks.get(purpose);
        if (!track) continue;
        const settings = track.getSettings();
        const copies =
          !isAudioPurpose(purpose) && layered
            ? videoLayers({
                width: settings.width!,
                height: settings.height!,
                fps: settings.frameRate!,
              })
            : undefined;
        if (copies) layers[purpose] = copies;
        const transceiver = copies
          ? pc.addTransceiver(track, {
              direction: "sendonly",
              streams: [new MediaStream([track])],
              sendEncodings: [...copies].reverse().map((layer) => ({
                rid: layer.id,
                scaleResolutionDownBy: Math.max(
                  settings.width! / layer.width,
                  settings.height! / layer.height,
                ),
                maxFramerate: layer.fps,
                maxBitrate: Math.max(
                  150_000,
                  Math.round(layer.width * layer.height * layer.fps * 0.07),
                ),
              })),
            })
          : undefined;
        if (transceiver) {
          const codecs =
            RTCRtpSender.getCapabilities("video")?.codecs.filter(
              (codec) => codec.mimeType.toLowerCase() === "video/vp8",
            ) ?? [];
          if (!codecs.length)
            throw Error(
              "Layered video needs VP8 simulcast support in this browser.",
            );
          transceiver.setCodecPreferences(codecs);
        }
        const sender =
          transceiver?.sender ?? pc.addTrack(track, new MediaStream([track]));
        mapping[purpose] = track.id;
        const parameters = sender.getParameters();
        if (!isAudioPurpose(purpose))
          parameters.degradationPreference =
            "maintain-framerate-and-resolution" as RTCDegradationPreference;
        if (!copies && parameters.encodings?.length) {
          parameters.encodings[0].maxBitrate = isAudioPurpose(purpose)
            ? audioBitrate
            : Math.max(
                500_000,
                Math.round(
                  (settings.width ?? 1920) *
                    (settings.height ?? 1080) *
                    (settings.frameRate ?? 60) *
                    0.07,
                ),
              );
        }
        if (!isAudioPurpose(purpose) || parameters.encodings?.length)
          await sender.setParameters(parameters);
      }
      if (!tracks.size) {
        pc.close();
        old?.close();
        return;
      }
      const answer = await this.context.client.command(
        {
          type: "media.publish",
          tracks: mapping,
          layers,
          sdp: await offer(pc),
        },
        "media.answer",
        (e) => !e.publisher_id,
      );
      if (this.closed || this.publisher !== pc) {
        pc.close();
        return;
      }
      await pc.setRemoteDescription(answer.sdp as RTCSessionDescriptionInit);
    } catch (error) {
      pc.close();
      throw error;
    } finally {
      old?.close();
    }
  }
  participant(participant: Participant) {
    if (
      participant.participant_id === this.context.participantId ||
      this.closed
    )
      return;
    const ordered = [...(participant.tracks ?? [])].sort(
      (a, b) =>
        purposes.indexOf(a.purpose as Purpose) -
        purposes.indexOf(b.purpose as Purpose),
    );
    const signature = JSON.stringify(ordered);
    if (this.receivers.get(participant.participant_id)?.signature === signature)
      return;
    this.remove(participant.participant_id, false);
    if (!ordered.length) return;
    void (async () => {
      let pending: RTCPeerConnection | undefined;
      try {
        const pc = (pending = this.peer());
        this.receivers.set(participant.participant_id, {
          pc,
          signature,
          purposes: ordered.map((track) => track.purpose as Purpose),
        });
        const qualities: Record<string, string> = {};
        for (const track of ordered) {
          const kind = isAudioPurpose(track.purpose) ? "audio" : "video";
          if (kind === "video") {
            const key = `${participant.participant_id}:${track.purpose}`;
            const local = this.qualities.get(key);
            const previous =
              local ??
              this.context.viewingQuality?.(
                participant.participant_id,
                track.purpose,
              );
            const layers = track.layers ?? [];
            const mode =
              previous?.mode && previous.mode !== "single"
                ? previous.mode
                : layers.length
                  ? "auto"
                  : "single";
            const wanted = mode === "auto" ? previous?.current : mode;
            const current =
              layers.find((layer) => layer.id === wanted)?.id ??
              layers[0]?.id ??
              "single";
            const value = {
              mode,
              current,
              layers,
              controller: new QualityController(),
              revision: (local?.revision ?? 0) + 1,
              error:
                mode !== "auto" && mode !== "single" && current !== mode
                  ? "The selected quality is no longer available for this source."
                  : undefined,
            };
            this.qualities.set(key, value);
            this.context.quality?.(
              participant.participant_id,
              track.purpose,
              value,
            );
            if (layers.length) qualities[track.purpose] = current;
          }
          const transceiver = pc.addTransceiver(kind, {
            direction: "recvonly",
          });
          const codec = track.codec;
          const capabilities =
            RTCRtpReceiver.getCapabilities(kind)?.codecs ?? [];
          const preferred = capabilities.filter(
            (c) => c.mimeType.toLowerCase() === codec.MimeType?.toLowerCase(),
          );
          if (preferred.length)
            transceiver.setCodecPreferences([
              ...preferred,
              ...capabilities.filter((c) => !preferred.includes(c)),
            ]);
        }
        pc.ontrack = (event) => {
          if (
            this.closed ||
            this.receivers.get(participant.participant_id)?.pc !== pc
          )
            return;
          if (event.track.kind === "audio")
            event.track.enabled = !this.stateValue.deafened;
          const index = pc
            .getTransceivers()
            .findIndex((t) => t.receiver === event.receiver);
          const purpose = ordered[index]?.purpose as Purpose | undefined;
          if (purpose)
            this.context.remote(
              participant.participant_id,
              purpose,
              new MediaStream([event.track]),
            );
        };
        const sdp = await offer(pc);
        if (
          this.closed ||
          this.receivers.get(participant.participant_id)?.pc !== pc
        )
          return;
        const answer = await this.context.client.command(
          {
            type: "media.subscribe",
            publisher_id: participant.participant_id,
            qualities,
            sdp,
          },
          "media.answer",
          (e) => e.publisher_id === participant.participant_id,
        );
        if (
          !this.closed &&
          this.receivers.get(participant.participant_id)?.pc === pc
        )
          await pc.setRemoteDescription(
            answer.sdp as RTCSessionDescriptionInit,
          );
      } catch (error) {
        if (
          !this.closed &&
          (!pending ||
            this.receivers.get(participant.participant_id)?.pc === pending)
        ) {
          this.remove(participant.participant_id, false);
          this.context.failed(error as Error);
        }
      }
    })();
  }
  remove(id: string, forget = true) {
    this.receivers.get(id)?.pc.close();
    this.receivers.delete(id);
    for (const p of purposes) this.context.remote(id, p, null);
    for (const p of purposes) this.samples.delete(`${id}:${p}`);
    if (forget) for (const p of purposes) this.qualities.delete(`${id}:${p}`);
  }
  event(event: WireEvent) {
    if (event.type !== "media.subscription.quality.changed") return;
    const id = String(event.publisher_id),
      purpose = String(event.purpose),
      layer = String(event.layer);
    const value = this.qualities.get(`${id}:${purpose}`);
    if (!value || !value.layers.some((candidate) => candidate.id === layer))
      return;
    value.current = layer;
    this.samples.delete(`${id}:${purpose}`);
    this.context.quality?.(id, purpose, { ...value });
  }
  async setQuality(id: string, purpose: "camera" | "screen", mode: string) {
    const value = this.qualities.get(`${id}:${purpose}`);
    const receiver = this.receivers.get(id);
    if (
      !value?.layers.length ||
      !receiver ||
      (mode !== "auto" && !value.layers.some((layer) => layer.id === mode))
    )
      throw Error("This source does not offer the selected viewing quality.");
    const revision = ++value.revision;
    value.mode = mode;
    value.controller.reset();
    this.samples.delete(`${id}:${purpose}`);
    value.error = undefined;
    this.context.quality?.(id, purpose, { ...value });
    if (mode === "auto") return;
    try {
      await this.switchQuality(id, purpose, mode, receiver.pc);
    } catch (error) {
      if (
        value.revision === revision &&
        this.qualities.get(`${id}:${purpose}`) === value
      ) {
        value.error =
          error instanceof Error
            ? error.message
            : "Could not change viewing quality.";
        this.context.quality?.(id, purpose, { ...value });
      }
      throw error;
    }
  }
  private async switchQuality(
    id: string,
    purpose: string,
    layer: string,
    pc: RTCPeerConnection,
  ) {
    if (this.closed || this.receivers.get(id)?.pc !== pc) return;
    await this.context.client.command(
      { type: "media.subscription.quality", publisher_id: id, purpose, layer },
      "media.subscription.quality.accepted",
      (event) =>
        event.publisher_id === id &&
        event.purpose === purpose &&
        event.layer === layer,
    );
  }
  private async sampleQuality() {
    if (this.closed || this.sampling) return;
    this.sampling = true;
    try {
      for (const [id, receiver] of this.receivers) {
        if (receiver.pc.connectionState !== "connected") continue;
        for (const [index, transceiver] of receiver.pc
          .getTransceivers()
          .entries()) {
          const purpose = receiver.purposes[index],
            key = `${id}:${purpose}`;
          const value = this.qualities.get(key);
          if (!value || value.mode !== "auto" || value.layers.length < 2)
            continue;
          const revision = value.revision;
          let stats: RTCStatsReport;
          try {
            stats = await transceiver.receiver.getStats();
          } catch {
            if (
              this.qualities.get(key) === value &&
              value.revision === revision
            ) {
              this.samples.delete(key);
              value.controller.sample(
                undefined,
                undefined,
                0,
                value.layers.length,
                performance.now(),
              );
            }
            continue;
          }
          if (
            this.closed ||
            this.receivers.get(id) !== receiver ||
            this.qualities.get(key) !== value ||
            value.revision !== revision ||
            value.mode !== "auto"
          )
            continue;
          let incoming: RTCInboundRtpStreamStats | undefined;
          stats.forEach((stat) => {
            if (stat.type === "inbound-rtp" && stat.kind === "video")
              incoming = stat;
          });
          if (!incoming) {
            this.samples.delete(key);
            value.controller.sample(
              undefined,
              undefined,
              0,
              value.layers.length,
              performance.now(),
            );
            continue;
          }
          const metrics = incomingQuality(this.samples.get(key), incoming);
          this.samples.set(key, incoming);
          const current = value.layers.findIndex(
            (layer) => layer.id === value.current,
          );
          if (current < 0) continue;
          const next = value.controller.sample(
            metrics.loss,
            metrics.drops,
            current,
            value.layers.length,
            performance.now(),
          );
          if (next === current) continue;
          try {
            await this.switchQuality(
              id,
              purpose,
              value.layers[next].id,
              receiver.pc,
            );
          } catch (error) {
            if (
              value.mode !== "auto" ||
              value.revision !== revision ||
              this.qualities.get(key) !== value
            )
              continue;
            value.error =
              error instanceof Error
                ? error.message
                : "Automatic viewing quality could not change.";
            this.context.quality?.(id, purpose, { ...value });
          }
        }
      }
    } finally {
      this.sampling = false;
    }
  }
  state(state: MediaState) {
    this.stateValue = state;
    for (const { pc } of this.receivers.values())
      for (const { track } of pc.getReceivers())
        if (track.kind === "audio") track.enabled = !state.deafened;
  }
  close() {
    this.closed = true;
    clearInterval(this.statistics);
    this.nativePublisher?.close();
    this.publisher?.close();
    for (const id of this.receivers.keys()) this.remove(id);
  }
}
