import {
  accountScope,
  backupPreference,
  base64,
  unbase64,
  validateBackup,
  type ClientBackup,
} from "@haunt/core";
import {
  exportDMRecovery,
  importDMRecovery,
  validateDMRecovery,
} from "@haunt/browser/dm-crypto/backup";
import {
  customSound,
  getPreferences,
  restoreNotificationSounds,
  saveCustomSound,
} from "@haunt/browser/preferences";
import { client, knownServers, messageStore } from "./runtime";

function scopedPreferences(values: Record<string, string>, ids: Set<string>) {
  const output: Record<string, string> = {};
  const matches = (key: string) => {
    if (ids.has(key)) return true;
    try {
      const value = JSON.parse(key);
      return Array.isArray(value) && ids.has(value[0]);
    } catch {
      return false;
    }
  };
  for (const [key, text] of Object.entries(values)) {
    if (
      key.startsWith("chatxo-emoji-recents:") &&
      ![...ids].some((id) => key.includes(id))
    )
      continue;
    if (key === "chatxo-client-preferences-v1") {
      const value = JSON.parse(text);
      for (const field of [
        "servers",
        "channels",
        "users",
        "serverSounds",
        "conversationSounds",
        "userSounds",
        "dmFavorites",
        "collapsedCategories",
        "memberListsCollapsed",
      ])
        if (value[field] && typeof value[field] === "object")
          value[field] = Object.fromEntries(
            Object.entries(value[field]).filter(([entry]) => matches(entry)),
          );
      // Plugin source/selection maps are scoped by community, rather than copied wholesale.
      if (value.audioPlugins) delete value.audioPlugins;
      output[key] = JSON.stringify(value);
    } else if (key === "chatxo-user-volumes-v1") {
      output[key] = JSON.stringify(
        Object.fromEntries(
          Object.entries(JSON.parse(text)).filter(([entry]) => matches(entry)),
        ),
      );
    } else output[key] = text;
  }
  return output;
}
export async function collectSyncBackup(
  scopeOrigin?: string,
): Promise<ClientBackup> {
  const accounts = (await client.vault.list()).filter(
    (a) => !scopeOrigin || a.origin === scopeOrigin,
  );
  const preferences: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (backupPreference(key)) preferences[key] = localStorage.getItem(key)!;
  }
  const sound = await customSound();
  const notificationSounds: NonNullable<ClientBackup["notificationSounds"]> =
    {};
  for (const id of Object.keys(getPreferences().savedSounds)) {
    const clip = await customSound(id);
    if (!clip)
      throw Error(
        "A saved notification sound is missing. Restore or remove it before syncing.",
      );
    notificationSounds[id] = {
      type: clip.type,
      data: base64(new Uint8Array(await clip.arrayBuffer())),
    };
  }
  const scopes = scopeOrigin
    ? new Set(
        accounts.map((a) =>
          accountScope(a.instance.instance_id, a.login.user.id),
        ),
      )
    : undefined;
  return validateBackup({
    version: 1,
    createdAt: new Date().toISOString(),
    accounts,
    servers: (await knownServers.list()).filter(
      (s) => !scopeOrigin || s.origin === scopeOrigin,
    ),
    preferences: scopeOrigin
      ? scopedPreferences(
          preferences,
          new Set(accounts.map((a) => a.instance.instance_id)),
        )
      : preferences,
    dmRecovery: await exportDMRecovery(messageStore, scopes),
    notificationSounds,
    ...(sound
      ? {
          customSound: {
            type: sound.type,
            data: base64(new Uint8Array(await sound.arrayBuffer())),
          },
        }
      : {}),
  });
}
export async function applySyncBackup(raw: ClientBackup, scopeOrigin?: string) {
  const backup = validateBackup(raw);
  if (
    scopeOrigin &&
    (backup.accounts.some((a) => a.origin !== scopeOrigin) ||
      backup.servers.some((s) => s.origin !== scopeOrigin))
  )
    throw Error("A web backup contains another server. Restore was stopped.");
  if (backup.dmRecovery) {
    const recovery = await validateDMRecovery(backup.dmRecovery);
    if (scopeOrigin) {
      const scopes = new Set(
        backup.accounts.map((a) =>
          accountScope(a.instance.instance_id, a.login.user.id),
        ),
      );
      if (
        recovery.accounts.some((a) => !scopes.has(a.scope)) ||
        recovery.messages.some((a) => !scopes.has(a.scope)) ||
        [recovery.decoded, recovery.images, recovery.delivered].some((items) =>
          items.some((a) => !scopes.has(a.key[0])),
        )
      )
        throw Error("A web backup contains another server's DM data.");
    }
    await importDMRecovery(backup.dmRecovery, messageStore);
  }
  await restoreNotificationSounds(
    Object.fromEntries(
      Object.entries(backup.notificationSounds ?? {}).map(([id, clip]) => [
        id,
        new Blob([unbase64(clip.data)], { type: clip.type }),
      ]),
    ),
  );
  for (const server of backup.servers) await knownServers.put(server);
  const failures: string[] = [];
  for (const account of backup.accounts) {
    try {
      await client.restoreAccount(account, "Haunt · sync restore", true);
    } catch {
      failures.push(
        account.login.user.username + "@" + new URL(account.origin).host,
      );
    }
  }
  for (const [key, value] of Object.entries(backup.preferences)) {
    let restored = value;
    if (scopeOrigin && key === "chatxo-client-preferences-v1") {
      const previous = JSON.parse(localStorage.getItem(key) ?? "{}"),
        incoming = JSON.parse(value);
      const merged = { ...previous, ...incoming };
      for (const field of [
        "servers",
        "channels",
        "users",
        "serverSounds",
        "conversationSounds",
        "userSounds",
        "dmFavorites",
        "collapsedCategories",
        "memberListsCollapsed",
      ])
        merged[field] = {
          ...(previous[field] ?? {}),
          ...(incoming[field] ?? {}),
        };
      restored = JSON.stringify(merged);
    } else if (scopeOrigin && key === "chatxo-user-volumes-v1")
      restored = JSON.stringify({
        ...JSON.parse(localStorage.getItem(key) ?? "{}"),
        ...JSON.parse(value),
      });
    localStorage.setItem(key, restored);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        newValue: restored,
        storageArea: localStorage,
      }),
    );
  }
  if (backup.customSound)
    await saveCustomSound(
      new Blob([unbase64(backup.customSound.data)], {
        type: backup.customSound.type,
      }),
    );
  window.dispatchEvent(new Event("haunt-sync-restored"));
  return failures.length
    ? [
        "Settings restored. These saved accounts need another sign-in: " +
          failures.join(", ") +
          ".",
      ]
    : [];
}
