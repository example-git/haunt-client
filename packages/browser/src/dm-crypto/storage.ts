import { openDB, type DBSchema } from "idb";
import type { EngineState } from "./engine";
import type { Schemas } from "@haunt/core";
export interface SecretImage {
  id: string;
  token: string;
  key: string;
  type: string;
  name: string;
  bytes: number;
  conversation: string;
  author: string;
}
export interface PlainPayload {
  version: 1;
  instance: string;
  conversation: string;
  author: string;
  device: string;
  request: string;
  edit?: string;
  body: string;
  images: SecretImage[];
}
export interface CryptoAccount {
  version: 1;
  device: string;
  engine: EngineState;
  archive?: string;
  groups: Record<string, { revision: number; members: string[] }>;
  published: { id: string; device_id: string; data: string }[];
  publishedAt?: number;
  pending?: {
    conversation: string;
    body: Schemas["ChatDMCryptoCommit"];
    engine: EngineState;
  };
  pins: Record<string, string>;
}
interface DB extends DBSchema {
  accounts: { key: string; value: CryptoAccount };
  archives: { key: [string, string]; value: CryptoAccount };
  delivered: { key: [string, string]; value: string };
  decoded: { key: [string, string]; value: PlainPayload };
  outgoing: {
    key: [string, string];
    value: { wire: string; payload: PlainPayload };
  };
  images: { key: [string, string]; value: SecretImage };
}
let database: ReturnType<typeof openDB<DB>> | undefined;
export function cryptoDB() {
  return (database ??= openDB<DB>("haunt-dm-crypto-v1", 2, {
    upgrade(db) {
      for (const name of [
        "accounts",
        "archives",
        "delivered",
        "decoded",
        "outgoing",
        "images",
      ] as const)
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    },
  }));
}
export async function cryptoLock<T>(
  scope: string,
  fn: () => Promise<T>,
): Promise<T> {
  // A ratchet must have exactly one writer across all windows/tabs.
  if (!navigator.locks)
    throw Error(
      "Encrypted DMs require a secure browser context with Web Locks support. Open the client using HTTPS or localhost.",
    );
  return navigator.locks.request("haunt-dm:" + scope, fn);
}
export async function cipherHash(wire: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(wire)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
