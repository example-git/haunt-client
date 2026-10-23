import { isAudioPurpose, mediaPurposes } from "@haunt/core";
import type { MediaState, Participant, Purpose, WireEvent } from "@haunt/core";
import type { LocalTracks, MediaTransport, TransportContext } from "./types";
import { audioBitrate, fullBandOpus } from "./audio-quality";
import { NativePublisher } from "./native-publisher";
import { nativeCaptures } from "./native-capture";
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
    { pc: RTCPeerConnection; signature: string }
  >();
  private closed = false;
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
  async start() {}
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
    const mapping: Record<string, string> = {};
    for (const purpose of purposes) {
      const track = tracks.get(purpose);
      if (!track) continue;
      const sender = pc.addTrack(track, new MediaStream([track]));
      mapping[purpose] = track.id;
      const parameters = sender.getParameters();
      if (parameters.encodings?.length) {
        parameters.encodings[0].maxBitrate = isAudioPurpose(purpose)
          ? audioBitrate
          : purpose === "camera"
            ? 1_200_000
            : 2_000_000;
        await sender.setParameters(parameters);
      }
    }
    if (!tracks.size) {
      pc.close();
      old?.close();
      return;
    }
    try {
      const answer = await this.context.client.command(
        { type: "media.publish", tracks: mapping, sdp: await offer(pc) },
        "media.answer",
        (e) => !e.publisher_id,
      );
      if (this.closed || this.publisher !== pc) {
        pc.close();
        return;
      }
      await pc.setRemoteDescription(answer.sdp as RTCSessionDescriptionInit);
      old?.close();
    } catch (error) {
      pc.close();
      old?.close();
      throw error;
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
    this.remove(participant.participant_id);
    if (!ordered.length) return;
    const pc = this.peer();
    this.receivers.set(participant.participant_id, { pc, signature });
    for (const track of ordered) {
      const kind = isAudioPurpose(track.purpose) ? "audio" : "video";
      const transceiver = pc.addTransceiver(kind, { direction: "recvonly" });
      const codec = track.codec;
      const capabilities = RTCRtpReceiver.getCapabilities(kind)?.codecs ?? [];
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
    void (async () => {
      try {
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
          this.receivers.get(participant.participant_id)?.pc === pc
        )
          this.context.failed(error as Error);
      }
    })();
  }
  remove(id: string) {
    this.receivers.get(id)?.pc.close();
    this.receivers.delete(id);
    for (const p of purposes) this.context.remote(id, p, null);
  }
  event(_event: WireEvent) {}
  state(state: MediaState) {
    this.stateValue = state;
    for (const { pc } of this.receivers.values())
      for (const { track } of pc.getReceivers())
        if (track.kind === "audio") track.enabled = !state.deafened;
  }
  close() {
    this.closed = true;
    this.nativePublisher?.close();
    this.publisher?.close();
    for (const id of this.receivers.keys()) this.remove(id);
  }
}
