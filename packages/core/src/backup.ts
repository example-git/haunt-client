import { serverOrigin } from "./api.js";
import { validateKnownServer, type KnownServer } from "./known-servers.js";
import type { SavedAccount } from "./types.js";

export interface ClientBackup {
  dmRecovery?: string;
  version: 1;
  createdAt: string;
  accounts: SavedAccount[];
  servers: KnownServer[];
  preferences: Record<string, string>;
  customSound?: { type: string; data: string };
  notificationSounds?: Record<string, { type: string; data: string }>;
}
export const backupPreference = (key: string) =>
  [
    "chatxo-client-preferences-v1",
    "chatxo-user-volumes-v1",
    "chatxo-voice-sounds",
    "chatxo-call-window-v1",
  ].includes(key) ||
  (key.startsWith("chatxo-emoji-recents:") && key.length < 512);
export const maxBackupBytes = 32 * 1024 * 1024;
const encoder = new TextEncoder();
export function base64(bytes: Uint8Array): string {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export function unbase64(value: string): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string" ||
    value.length > maxBackupBytes ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw Error("Invalid backup encoding.");
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export function validateBackup(value: ClientBackup): ClientBackup {
  if (
    !value ||
    value.version !== 1 ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.accounts) ||
    value.accounts.length > 32 ||
    !Array.isArray(value.servers) ||
    value.servers.length > 100 ||
    !value.preferences ||
    typeof value.preferences !== "object" ||
    Array.isArray(value.preferences)
  )
    throw Error("Invalid client backup.");
  if (
    value.dmRecovery !== undefined &&
    (typeof value.dmRecovery !== "string" ||
      value.dmRecovery.length > 16 * 1024 * 1024)
  )
    throw Error("Invalid DM recovery data");
  const ids = new Set<string>();
  const accounts = value.accounts.map((a) => {
    if (
      !a ||
      typeof a.origin !== "string" ||
      serverOrigin(a.origin) !== a.origin ||
      !a.instance ||
      typeof a.instance.instance_id !== "string" ||
      !a.instance.instance_id ||
      a.instance.instance_id.length > 128 ||
      a.instance.api_version !== "v1" ||
      typeof a.instance.name !== "string" ||
      a.instance.name.length > 256 ||
      !a.login ||
      a.login.instance_id !== a.instance.instance_id ||
      a.login.password_change_required ||
      typeof a.login.token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(a.login.token) ||
      a.login.token_type !== "Bearer" ||
      !a.login.user ||
      typeof a.login.user.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(a.login.user.id) ||
      typeof a.login.user.username !== "string" ||
      !/^[a-zA-Z0-9_]{3,32}$/.test(a.login.user.username) ||
      !a.login.session ||
      typeof a.login.session.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(a.login.session.id) ||
      (a.login.session.expires_at !== null &&
        !Number.isFinite(Date.parse(a.login.session.expires_at))) ||
      ids.has(a.instance.instance_id)
    )
      throw Error("Invalid or duplicate saved session in backup.");
    ids.add(a.instance.instance_id);
    return {
      origin: a.origin,
      instance: a.instance,
      login: a.login,
      remember: a.remember !== false,
    };
  });
  const preferences: Record<string, string> = {};
  if (Object.keys(value.preferences).length > 110)
    throw Error("Too many backup preferences.");
  for (const [key, text] of Object.entries(value.preferences)) {
    if (
      !backupPreference(key) ||
      typeof text !== "string" ||
      text.length > 1_000_000
    )
      throw Error("Invalid backup preferences.");
    if (key !== "chatxo-voice-sounds") JSON.parse(text);
    else if (!["on", "off"].includes(text))
      throw Error("Invalid voice sound preference.");
    preferences[key] = text;
  }
  const sound = value.customSound;
  if (
    sound &&
    (typeof sound.type !== "string" ||
      !/^audio\/[a-zA-Z0-9.+-]+$/.test(sound.type) ||
      unbase64(sound.data).length > 2 * 1024 * 1024)
  )
    throw Error("Invalid custom notification sound.");
  const notificationSounds: NonNullable<ClientBackup["notificationSounds"]> =
    {};
  if (value.notificationSounds !== undefined) {
    if (
      !value.notificationSounds ||
      typeof value.notificationSounds !== "object" ||
      Array.isArray(value.notificationSounds) ||
      Object.keys(value.notificationSounds).length > 16
    )
      throw Error("Invalid saved notification sounds.");
    let total = 0;
    for (const [id, clip] of Object.entries(value.notificationSounds)) {
      if (
        !/^clip:[a-f0-9]{64}$/.test(id) ||
        !clip ||
        typeof clip.type !== "string" ||
        !/^audio\/[a-zA-Z0-9.+-]+$/.test(clip.type)
      )
        throw Error("Invalid saved notification sound.");
      const bytes = unbase64(clip.data).length;
      if (
        !bytes ||
        bytes > 2 * 1024 * 1024 ||
        (total += bytes) > 8 * 1024 * 1024
      )
        throw Error("Saved notification sounds exceed their size limit.");
      notificationSounds[id] = { type: clip.type, data: clip.data };
    }
  }
  return {
    version: 1,
    createdAt: value.createdAt,
    ...(value.dmRecovery ? { dmRecovery: value.dmRecovery } : {}),
    accounts,
    servers: value.servers.map(validateKnownServer),
    preferences,
    ...(Object.keys(notificationSounds).length ? { notificationSounds } : {}),
    ...(sound ? { customSound: { type: sound.type, data: sound.data } } : {}),
  };
}
async function key(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (!globalThis.crypto?.subtle)
    throw Error("Encrypted backups need HTTPS, localhost, or the desktop app.");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptBackup(
  value: ClientBackup,
  password: string,
): Promise<string> {
  if ([...password].length < 8 || encoder.encode(password).length > 1024)
    throw Error(
      "Use a backup password of at least 8 characters (at most 1024 bytes).",
    );
  if (!globalThis.crypto?.subtle)
    throw Error("Encrypted backups need HTTPS, localhost, or the desktop app.");
  const plain = encoder.encode(JSON.stringify(validateBackup(value)));
  if (plain.length > 20 * 1024 * 1024) throw Error("The backup is too large.");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(password, salt),
    plain,
  );
  return JSON.stringify({
    format: "chatxo-encrypted-backup",
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: 600_000,
    salt: base64(salt),
    iv: base64(iv),
    data: base64(new Uint8Array(data)),
  });
}
export async function decryptBackup(
  text: string,
  password: string,
): Promise<ClientBackup> {
  if (text.length > maxBackupBytes || password.length > 1024)
    throw Error("The backup is too large.");
  const file = JSON.parse(text);
  if (
    file?.format !== "chatxo-encrypted-backup" ||
    file.version !== 1 ||
    file.kdf !== "PBKDF2-SHA256" ||
    file.iterations !== 600_000
  )
    throw Error("Unsupported client backup format.");
  const salt = unbase64(file.salt),
    iv = unbase64(file.iv),
    data = unbase64(file.data);
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16)
    throw Error("Invalid client backup.");
  const secret = await key(password, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, secret, data);
  } catch {
    throw Error("The backup password is incorrect or the file is damaged.");
  }
  return validateBackup(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)),
  );
}
