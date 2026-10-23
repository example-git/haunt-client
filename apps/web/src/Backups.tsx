import {
  exportDMRecovery,
  importDMRecovery,
  validateDMRecovery,
} from "@haunt/browser/dm-crypto/backup";
import { useState } from "react";
import { UserName } from "./UserName";
import { multiServerClient } from "@haunt/browser/client-context";
import {
  backupPreference,
  base64,
  unbase64,
  decryptBackup,
  encryptBackup,
  maxBackupBytes,
  friendlyError,
  type ClientBackup,
} from "@haunt/core";
import {
  customSound,
  saveCustomSound,
  getPreferences,
  restoreNotificationSounds,
} from "@haunt/browser/preferences";
import { client, knownServers, messageStore } from "./runtime";
import { ErrorNotice } from "./App";

export function Backups() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<ClientBackup>(),
    [notice, setNotice] = useState(""),
    [restored, setRestored] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="form backup-settings">
      <h3>Client backup</h3>
      <p className="warning">
        Includes saved sessions. Anyone with the file and its backup password
        can access those accounts and create independent device sessions while
        the saved sessions are valid, and can read the included DM history and
        recovery keys. Store it privately.
      </p>
      <p className="muted">
        Includes known servers, usernames, device preferences, notification
        settings, notification sounds, per-user volumes, DM encryption recovery
        keys and cached DM text. Image files and channel history are not
        included. This manual export stays local.
      </p>
      <ErrorNotice error={error} />
      {notice && <p role="status">{notice}</p>}
      {restored && (
        <button className="primary" onClick={() => window.location.reload()}>
          Reload client
        </button>
      )}
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void run(async () => {
            const password = String(form.get("password"));
            if (password !== form.get("confirm"))
              throw Error("The backup passwords do not match.");
            const preferences: Record<string, string> = {};
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i)!;
              if (backupPreference(key))
                preferences[key] = localStorage.getItem(key)!;
            }
            const sound = await customSound();
            const notificationSounds: NonNullable<
              ClientBackup["notificationSounds"]
            > = {};
            for (const id of Object.keys(getPreferences().savedSounds)) {
              const clip = await customSound(id);
              if (!clip)
                throw Error(
                  "A saved notification sound is missing. Re-upload or remove it in Notification Settings before exporting.",
                );
              notificationSounds[id] = {
                type: clip.type,
                data: base64(new Uint8Array(await clip.arrayBuffer())),
              };
            }
            const backup: ClientBackup = {
              dmRecovery: await exportDMRecovery(messageStore),
              version: 1,
              createdAt: new Date().toISOString(),
              accounts: await client.vault.list(),
              servers: await knownServers.list(),
              preferences,
              notificationSounds,
              ...(sound
                ? {
                    customSound: {
                      type: sound.type,
                      data: base64(new Uint8Array(await sound.arrayBuffer())),
                    },
                  }
                : {}),
            };
            const encrypted = await encryptBackup(backup, password);
            if (window.hauntDesktop) {
              if (await window.hauntDesktop.backupSave(encrypted))
                setNotice(
                  "Encrypted backup saved. Keep its password separately; it cannot be recovered.",
                );
              return;
            }
            const url = URL.createObjectURL(
              new Blob([encrypted], { type: "application/json" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = `Haunt-backup-${new Date().toISOString().slice(0, 10)}.chatxo`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 30_000);
            setNotice(
              "Encrypted backup downloaded. Keep its password separately; it cannot be recovered.",
            );
          });
        }}
      >
        <label>
          Backup password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirm backup password
          <input
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <button className="primary" disabled={busy}>
          Export encrypted backup
        </button>
      </form>
      <h3>Restore a backup</h3>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setPreview(undefined);
          void run(async () => {
            const file = form.get("file") as File;
            if (!file?.size || file.size > maxBackupBytes)
              throw Error("Choose a client backup smaller than 32 MiB.");
            const value = await decryptBackup(
              await file.text(),
              String(form.get("password")),
            );
            if (
              !multiServerClient() &&
              (value.accounts.some(
                (account) => account.origin !== location.origin,
              ) ||
                value.servers.some(
                  (server) => server.origin !== location.origin,
                ))
            )
              throw Error(
                "This backup includes another server. Install Haunt desktop to restore multiple servers.",
              );
            if (value.dmRecovery) await validateDMRecovery(value.dmRecovery);
            setPreview(value);
          });
        }}
      >
        <label>
          Backup file
          <input
            name="file"
            type="file"
            accept=".chatxo,.json"
            required
            onChange={() => setPreview(undefined)}
          />
        </label>
        <label>
          Backup password
          <input name="password" type="password" autoComplete="off" required />
        </label>
        <button className="secondary" disabled={busy}>
          Preview backup
        </button>
      </form>
      {preview && (
        <div className="form backup-preview">
          <strong>
            {preview.accounts.length} sessions · {preview.servers.length} saved
            sign-ins
          </strong>
          <small>Created {new Date(preview.createdAt).toLocaleString()}</small>
          <ul>
            {preview.accounts.map((a) => (
              <li key={a.instance.instance_id}>
                {a.origin} ·{" "}
                <UserName user={a.login.user}>
                  @{a.login.user.username}
                </UserName>
              </li>
            ))}
          </ul>
          <p className="muted">
            Accounts already signed in on this client are kept. Imported
            settings replace this device’s matching preferences. Each restored
            account creates its own device session, leaving the source device
            signed in. Unavailable servers and expired or revoked sessions keep
            their saved address and username so you can sign in again. Reloading
            disconnects any active call. Restored DM keys recover history; this
            installation uses its own device identity for new messages.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const existing = new Set(
                  [...client.instances.values()]
                    .filter((i) => i.snapshot.status !== "signed-out")
                    .map((i) => i.account.instance.instance_id),
                );
                const current = await client.vault.list();
                for (const a of current) existing.add(a.instance.instance_id);
                const additions = preview.accounts.filter(
                  (a) => !existing.has(a.instance.instance_id),
                );
                if (existing.size + additions.length > 32)
                  throw Error("This import would exceed 32 signed-in servers.");
                // Restore the validated sound library before changing saved settings.
                // It replaces the old library, just like the preferences it belongs to.
                if (preview.dmRecovery)
                  await importDMRecovery(preview.dmRecovery, messageStore);
                await restoreNotificationSounds(
                  Object.fromEntries(
                    Object.entries(preview.notificationSounds ?? {}).map(
                      ([id, clip]) => [
                        id,
                        new Blob([unbase64(clip.data)], { type: clip.type }),
                      ],
                    ),
                  ),
                );
                for (const s of preview.servers) await knownServers.put(s);
                const failed: string[] = [];
                for (const a of additions) {
                  try {
                    await client.restoreAccount(
                      a,
                      `${window.hauntDesktop ? "Desktop" : "Browser"} · backup restore`,
                    );
                  } catch (error) {
                    failed.push(
                      `${a.login.user.username}@${new URL(a.origin).host}: ${friendlyError(error)}`,
                    );
                  }
                }
                for (const [key, value] of Object.entries(preview.preferences))
                  localStorage.setItem(key, value);
                if (preview.customSound)
                  await saveCustomSound(
                    new Blob([unbase64(preview.customSound.data)], {
                      type: preview.customSound.type,
                    }),
                  );
                void navigator.storage?.persist?.().catch(() => {});
                if (failed.length) {
                  setPreview(undefined);
                  setRestored(true);
                  setNotice(
                    `Settings restored. ${additions.length - failed.length} independent device sessions created. These accounts need another sign-in: ${failed.join("; ")}`,
                  );
                } else window.location.reload();
              })
            }
          >
            Restore and reload client
          </button>
          <button className="text-button" onClick={() => setPreview(undefined)}>
            Cancel import
          </button>
        </div>
      )}
    </section>
  );
}
