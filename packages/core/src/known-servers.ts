import { serverOrigin } from "./api.js";
import type { SavedAccount } from "./types.js";
export interface KnownServer {
  origin: string;
  instanceId: string;
  name: string;
  username: string;
  lastUsed: number;
}
export interface KnownServerStore {
  list(): Promise<KnownServer[]>;
  put(server: KnownServer): Promise<void>;
  remove(origin: string, username: string): Promise<void>;
}
export function knownServer(account: SavedAccount): KnownServer {
  return {
    origin: serverOrigin(account.origin),
    instanceId: account.instance.instance_id,
    name: account.instance.name,
    username: account.login.user.username,
    lastUsed: Date.now(),
  };
}
export function validateKnownServer(value: KnownServer): KnownServer {
  if (
    !value ||
    typeof value.origin !== "string" ||
    serverOrigin(value.origin) !== value.origin ||
    typeof value.instanceId !== "string" ||
    !value.instanceId ||
    value.instanceId.length > 128 ||
    typeof value.name !== "string" ||
    value.name.length > 256 ||
    typeof value.username !== "string" ||
    !/^[a-zA-Z0-9_]{3,32}$/.test(value.username) ||
    !Number.isFinite(value.lastUsed)
  )
    throw Error("Invalid saved server.");
  return {
    origin: value.origin,
    instanceId: value.instanceId,
    name: value.name,
    username: value.username,
    lastUsed: value.lastUsed,
  };
}
