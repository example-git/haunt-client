import { useState, useSyncExternalStore } from "react";
import { friendlyError } from "@haunt/core";
import {
  getPreferences,
  setPreferences,
  subscribePreferences,
  channelPreferenceKey,
} from "@haunt/browser/preferences";
import {
  resolveNotificationSound,
  type NotificationSound,
} from "@haunt/browser/notification-sound-options";
import {
  importNotificationSound,
  playPing,
  removeNotificationSound,
} from "@haunt/browser/sounds";
export function SavedSoundOptions() {
  const prefs = useSyncExternalStore(subscribePreferences, getPreferences);
  return (
    <>
      {Object.entries(prefs.savedSounds).map(([id, name]) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </>
  );
}
export function NotificationSoundControl({
  server,
  conversation,
  user,
  label,
}: {
  server: string;
  conversation?: string;
  user?: string;
  label: string;
}) {
  const prefs = useSyncExternalStore(subscribePreferences, getPreferences);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const field = conversation
    ? "conversationSounds"
    : user
      ? "userSounds"
      : "serverSounds";
  const key = conversation
    ? channelPreferenceKey(server, conversation)
    : user
      ? channelPreferenceKey(server, user)
      : server;
  const save = (value: string) => {
    const overrides = { ...getPreferences()[field] };
    if (value === "inherit") delete overrides[key];
    else overrides[key] = value as NotificationSound;
    setPreferences({ [field]: overrides });
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="notification-sound-override">
      <label>
        Notification sound
        <select
          aria-label={`Notification sound for ${label}`}
          value={prefs[field][key] ?? "inherit"}
          disabled={busy}
          onChange={(e) => save(e.target.value)}
        >
          <option value="inherit">
            {conversation || user ? "Use server default" : "Use client default"}
          </option>
          <option value="ping">Ping</option>
          <option value="chime">Chime</option>
          <option value="soft">Soft</option>
          <option value="none">Silent</option>
          {prefs.customSoundName && (
            <option value="custom">
              Default custom: {prefs.customSoundName}
            </option>
          )}
          <SavedSoundOptions />
        </select>
      </label>
      <div className="button-row">
        <button
          disabled={
            busy ||
            resolveNotificationSound(prefs, server, conversation, user) ===
              "none"
          }
          onClick={() =>
            void run(() =>
              playPing(
                true,
                resolveNotificationSound(
                  getPreferences(),
                  server,
                  conversation,
                  user,
                ),
              ),
            )
          }
        >
          Preview sound
        </button>
        <label className="secondary sound-upload">
          Upload sound
          <input
            type="file"
            accept="audio/*"
            disabled={busy}
            aria-label={`Upload notification sound for ${label}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                void run(async () => save(await importNotificationSound(file)));
            }}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function SavedSounds() {
  const prefs = useSyncExternalStore(subscribePreferences, getPreferences);
  const [error, setError] = useState("");
  if (!Object.keys(prefs.savedSounds).length) return null;
  return (
    <fieldset className="saved-notification-sounds">
      <legend>Saved notification sounds</legend>
      <p className="muted small">
        Up to 16 clips, 8 MiB total. Removing a sound restores inherited sounds
        wherever it was assigned.
      </p>
      {Object.entries(prefs.savedSounds).map(([id, name]) => (
        <div className="button-row" key={id}>
          <span>{name}</span>
          <button
            aria-label={`Remove sound ${name}`}
            onClick={() =>
              void removeNotificationSound(id).catch((e) =>
                setError(friendlyError(e)),
              )
            }
          >
            Remove
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
