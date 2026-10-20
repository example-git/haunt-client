import type { DMEncryptionFactory } from "./dm.js";
import type { components } from "./generated/api.js";
export type Schemas = components["schemas"];
export type Message = Schemas["ChatMessage"] & {
  security?: "legacy" | "encrypted" | "unavailable" | "pending";
  securityError?: string;
  /** Local-only projection metadata. Never sent as message content. */
  displayVersion?: number;
  wire?: { body: string; attachment_ids: string[] };
};
export type ReadState = Schemas["ChatReadState"];
export type History = Schemas["ChatHistory"];
export type Instance = Schemas["HttpapiInstanceResponse"];
export type Login = Schemas["IdentityLogin"];
export type Emoji = Schemas["IdentityEmoji"];
export type User = Schemas["IdentityUser"];
export type Channel = Schemas["IdentityChannel"];
export type Category = Schemas["IdentityCategory"];
export type Conversation = Schemas["ChatConversation"];
export type Participant = Schemas["VoiceSnapshot"];
export type VoicePresenceMember = Schemas["VoicePresenceMember"];
export type Admission = Schemas["VoiceAdmission"];
export type MediaState = Schemas["VoiceState"];
export type EncodedTrack = Schemas["VoiceEncodedTrack"];
export const mediaPurposes = [
  "audio",
  "camera",
  "screen",
  "camera_audio",
  "screen_audio",
] as const;
export type Purpose = (typeof mediaPurposes)[number];
export const isAudioPurpose = (purpose: string) =>
  purpose === "audio" ||
  purpose === "camera_audio" ||
  purpose === "screen_audio";
export type Credentials = Schemas["HttpapiCredentialsRequest"];
export type Scope = string;
export const accountScope = (instance: string, user: string): Scope =>
  JSON.stringify([instance, user]);
export interface SavedAccount {
  origin: string;
  instance: Instance;
  login: Login;
  remember?: boolean;
}
export interface TokenVault {
  list(): Promise<SavedAccount[]>;
  put(account: SavedAccount): Promise<void>;
  remove(instanceId: string): Promise<void>;
}
export interface PendingMessage {
  request_id: string;
  conversation_id: string;
  body: string;
  attachment_ids: string[];
  reply_to_id?: string;
  created_at: string;
  error?: string;
}
/** Implement with IndexedDB on the web or a transactional SQLite adapter on Android. */
export interface MessageStore {
  messages(
    scope: Scope,
    conversation: string,
    options?: { before?: number; limit?: number },
  ): Promise<Message[]>;
  merge(scope: Scope, messages: Message[]): Promise<void>;
  cursor(scope: Scope): Promise<number>;
  setCursor(scope: Scope, cursor: number): Promise<void>;
  pending(scope: Scope): Promise<PendingMessage[]>;
  putPending(scope: Scope, message: PendingMessage): Promise<void>;
  removePending(scope: Scope, requestId: string): Promise<void>;
  clear(scope: Scope): Promise<void>;
}
// Bivariant event handlers accept browser WebSocket and native socket adapters.
type SocketHandler<T> = { handle(event: T): void }["handle"];
export interface SocketLike {
  readyState: number;
  onopen: SocketHandler<unknown> | null;
  onclose: SocketHandler<unknown> | null;
  onerror: SocketHandler<unknown> | null;
  onmessage: SocketHandler<{ data: unknown }> | null;
  send(data: string): void;
  close(): void;
}
export interface Runtime {
  /** Restore local startup resources independently of network connection setup. */
  prepareConnection?: (
    client: import("./client.js").InstanceClient,
  ) => Promise<void>;
  dmEncryption?: DMEncryptionFactory;
  fetch: typeof fetch;
  socket: (url: string) => SocketLike;
  randomUUID: () => string;
}
export type ConnectionStatus =
  "connecting" | "syncing" | "online" | "offline" | "signed-out";
export interface Snapshot {
  status: ConnectionStatus;
  readiness?: "checking" | "ready" | "unavailable" | "unknown";
  error?: string;
  channels: Channel[];
  categories: Category[];
  conversations: Conversation[];
  users: User[];
  emojis: Emoji[];
  voiceRooms: Record<string, VoicePresenceMember[]>;
  readStates: Record<string, ReadState>;
  permissions: number;
  rolePosition: number;
  revision: number;
}
export type WireEvent = { type: string; [key: string]: unknown };
