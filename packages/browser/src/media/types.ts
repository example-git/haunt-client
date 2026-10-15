import type {
  Admission,
  InstanceClient,
  MediaState,
  Participant,
  Purpose,
  WireEvent,
} from "@haunt/core";
export type LocalTracks = Map<Purpose, MediaStreamTrack>;
export interface TransportContext {
  client: InstanceClient;
  admission: Admission;
  participantId: string;
  remote: (
    participantId: string,
    purpose: Purpose,
    stream: MediaStream | null,
  ) => void;
  failed: (error: Error) => void;
}
export interface MediaTransport {
  start(): Promise<void>;
  publish(tracks: LocalTracks): Promise<void>;
  participant(participant: Participant): void;
  remove(id: string): void;
  event(event: WireEvent): void;
  state(state: MediaState): void;
  close(): void;
}
