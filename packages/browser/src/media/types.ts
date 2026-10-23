import type {
  Admission,
  InstanceClient,
  MediaState,
  Participant,
  Purpose,
  WireEvent,
} from "@haunt/core";
import type { ViewingQuality } from "./quality";
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
  viewingQuality?: (
    participant: string,
    purpose: string,
  ) => ViewingQuality | undefined;
  quality?: (
    participant: string,
    purpose: string,
    quality: ViewingQuality,
  ) => void;
}
export interface MediaTransport {
  start(): Promise<void>;
  publish(tracks: LocalTracks): Promise<void>;
  participant(participant: Participant): void;
  remove(id: string): void;
  event(event: WireEvent): void;
  state(state: MediaState): void;
  setQuality?(
    participant: string,
    purpose: "camera" | "screen",
    quality: string,
  ): Promise<void>;
  close(): void;
}
