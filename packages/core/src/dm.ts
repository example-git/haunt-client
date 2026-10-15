import type { InstanceClient } from "./client.js";
import type { Message, PendingMessage, Schemas } from "./types.js";
export interface DMImageMetadata {
  id: string;
  type: string;
  name: string;
  bytes: number;
  conversation: string;
  author: string;
}
export interface DMEncryption {
  start(): Promise<void>;
  sync(conversation: string): Promise<void>;
  encode(
    message: PendingMessage,
    edit?: string,
    renew?: boolean,
  ): Promise<string>;
  decode(message: Message): Promise<Message>;
  prepareImage(
    conversation: string,
    file: Blob,
    filename: string,
  ): Promise<{
    blob: Blob;
    finish: (attachment: Schemas["AttachmentsAttachment"]) => Promise<void>;
  }>;
  image(id: string, blob: Blob): Promise<Blob>;
  imageMetadata(id: string): Promise<DMImageMetadata | undefined>;
}
export type DMEncryptionFactory = (instance: InstanceClient) => DMEncryption;
