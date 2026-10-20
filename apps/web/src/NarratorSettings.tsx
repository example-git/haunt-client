import { useEffect, useState, useSyncExternalStore } from "react";
import { friendlyError, type InstanceClient } from "@haunt/core";
import {
  getPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";
import {
  deviceVoices,
  narratorPlayback,
} from "@haunt/browser/narrator/playback";
import {
  getNarratorSettings,
  setNarratorSettings,
  serverNarratorSource,
} from "@haunt/browser/narrator/preferences";
import {
  narrationTemplates,
  narratorUserKey,
  type NarrationEvent,
  type NarratorSettings as Settings,
} from "@haunt/browser/narrator/settings";
import { useServerExtensions } from "./useServerExtensions";
import { TikTokVoiceSelect } from "./TikTokVoiceSelect";
import { SlidersHorizontal, TextCursorInput, Users } from "lucide-react";
import "./tts-settings.css";

export function NarratorSettings({ instance }: { instance?: InstanceClient }) {
  useSyncExternalStore(subscribePreferences, getPreferences);
  const settings = getNarratorSettings(instance?.scope);
  const playback = useSyncExternalStore(
    narratorPlayback.subscribe,
    narratorPlayback.getSnapshot,
  );
  const providers = useServerExtensions(instance);
  const [voices, setVoices] = useState(deviceVoices);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState("");
  const [preview, setPreview] = useState("Welcome to Haunt.");
  const userKey = instance && user ? narratorUserKey(instance.scope, user) : "";
  const override = settings.users[userKey];
  const selected = providers.extensions.find(
    (provider) => provider.id === settings.provider,
  );
  const set = (patch: Partial<Settings>) => {
    narratorPlayback.stop();
    narratorPlayback.clearCache();
    setNarratorSettings(instance?.scope, patch);
  };
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const update = () => setVoices(deviceVoices());
    update();
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  const changeUser = (patch: Partial<NonNullable<typeof override>>) => {
    if (!userKey) return;
    const users = {
      ...settings.users,
      [userKey]: { ...(override ?? { voice: "", ignored: false }), ...patch },
    };
    if (!users[userKey].ignored && !users[userKey].voice) delete users[userKey];
    set({ users });
  };
  return (
    <section className="form tts-settings">
      <div className="tts-heading">
        <h3>Text to speech</h3>
        <label className="sound-setting">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => set({ enabled: event.target.checked })}
          />
          Enabled
        </label>
      </div>
      <p className="muted small">
        {instance
          ? `Personal settings for ${instance.account.instance.name}.`
          : "Local device speech."}{" "}
        Announce participants’ actions in your current call. Only you hear
        announcements.
      </p>
      <div className="tts-grid">
        <label>
          Speech provider
          <select
            aria-label="Speech provider"
            value={settings.provider}
            onChange={(event) => set({ provider: event.target.value })}
          >
            <option value="device">Device TTS</option>
            {settings.provider !== "device" && !selected && (
              <option value={settings.provider} disabled>
                {settings.provider} · unavailable
              </option>
            )}
            {providers.extensions.map((provider) => (
              <option
                key={provider.id}
                value={provider.id}
                disabled={!provider.enabled || !provider.configured}
              >
                {provider.name} · server extension
                {!provider.enabled || !provider.configured
                  ? " (unavailable)"
                  : ""}
              </option>
            ))}
          </select>
        </label>
        {settings.provider === "device" ? (
          <label>
            Device voice
            <select
              value={settings.deviceVoice}
              onChange={(event) => set({ deviceVoice: event.target.value })}
            >
              <option value="">System default local voice</option>
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} · {voice.lang}
                </option>
              ))}
            </select>
          </label>
        ) : settings.provider === "tiktok-tts" ? (
          <TikTokVoiceSelect
            label="TikTok voice"
            value={settings.voice}
            onChange={(voice) => set({ voice })}
          />
        ) : (
          <label>
            Extension voice ID
            <input
              value={settings.voice}
              maxLength={64}
              onChange={(event) => set({ voice: event.target.value })}
            />
          </label>
        )}
      </div>
      {settings.provider !== "device" && (
        <>
          <label className="sound-setting">
            <input
              type="checkbox"
              checked={settings.fallback}
              onChange={(event) => set({ fallback: event.target.checked })}
            />
            Use device TTS if this extension fails
          </label>
          {!settings.fallback && (
            <p className="muted small">
              Extension only. Failures stay silent; device TTS will not be used.
            </p>
          )}
        </>
      )}
      {providers.loading && (
        <p role="status" className="muted small">
          Loading this server’s extensions…
        </p>
      )}
      {providers.error && (
        <p role="alert" className="error">
          {providers.error} <button onClick={providers.refresh}>Retry</button>
        </p>
      )}
      {settings.provider !== "device" &&
        (!selected?.enabled || !selected.configured) &&
        !providers.loading && (
          <p className="muted small">
            This extension is unavailable on this server. Your provider choice
            and fallback preference are unchanged.
          </p>
        )}
      <div className="tts-grid tts-sliders">
        <label>
          Volume · {settings.volume}%
          <input
            type="range"
            min="0"
            max="100"
            value={settings.volume}
            onChange={(event) => set({ volume: Number(event.target.value) })}
          />
        </label>
        <label>
          Speed · {settings.rate}×
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={settings.rate}
            onChange={(event) => set({ rate: Number(event.target.value) })}
          />
        </label>
      </div>
      <div className="tts-events">
        {(
          [
            ["joins", "Joins"],
            ["leaves", "Leaves"],
            ["mute", "Mute / unmute"],
            ["deafen", "Deafen / undeafen"],
            ["screen", "Screen sharing"],
            ["ignoreSelf", "Ignore myself"],
          ] as const
        ).map(([key, label]) => (
          <label className="sound-setting" key={key}>
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(event) => set({ [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <details>
        <summary>
          <SlidersHorizontal size={15} aria-hidden="true" />
          Advanced speech options
        </summary>
        <div className="form">
          <label>
            Per-user cooldown (seconds)
            <input
              type="number"
              min="0"
              max="30"
              step="0.5"
              value={settings.cooldownMs / 1000}
              onChange={(event) =>
                set({ cooldownMs: Number(event.target.value) * 1000 })
              }
            />
          </label>
          {settings.provider !== "device" && (
            <label>
              Fallback device voice
              <select
                value={settings.deviceVoice}
                onChange={(event) => set({ deviceVoice: event.target.value })}
              >
                <option value="">System default local voice</option>
                {voices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} · {voice.lang}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!voices.length && (
            <p className="muted small">
              No local system voices are available. Install a system voice to
              use device speech.
            </p>
          )}
          <p className="muted small">
            Device speech uses the system output. Extension audio follows
            Devices. Initial room occupants and reconnects are not announced.
          </p>
        </div>
      </details>
      <details>
        <summary>
          <TextCursorInput size={15} aria-hidden="true" />
          Announcement text
        </summary>
        <div className="form">
          <p className="muted small">
            Use {"{{USER}}"}, {"{{DISPLAY_NAME}}"} and {"{{CHANNEL}}"}. Blank
            text silences that event.
          </p>
          {(Object.keys(narrationTemplates) as NarrationEvent[]).map(
            (event) => (
              <label key={event}>
                {event.replace(/([A-Z])/g, " $1")}
                <input
                  maxLength={300}
                  value={settings.templates[event]}
                  onChange={(change) =>
                    set({
                      templates: {
                        ...settings.templates,
                        [event]: change.target.value,
                      },
                    })
                  }
                />
              </label>
            ),
          )}
        </div>
      </details>
      {instance && (
        <details>
          <summary>
            <Users size={15} aria-hidden="true" />
            Voices and ignored users · this server
          </summary>
          <div className="form">
            <label>
              User
              <select
                aria-label="User"
                value={user}
                onChange={(event) => setUser(event.target.value)}
              >
                <option value="">Choose a user</option>
                {instance.snapshot.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name || user.username} (@{user.username})
                  </option>
                ))}
              </select>
            </label>
            {userKey && (
              <>
                {settings.provider === "tiktok-tts" ? (
                  <TikTokVoiceSelect
                    key={userKey}
                    label="Extension voice override"
                    value={override?.voice ?? ""}
                    defaultLabel="Use default voice"
                    onChange={(voice) => changeUser({ voice })}
                  />
                ) : (
                  <label>
                    Extension voice override
                    <input
                      value={override?.voice ?? ""}
                      maxLength={64}
                      placeholder="Default voice"
                      onChange={(event) =>
                        changeUser({ voice: event.target.value })
                      }
                    />
                  </label>
                )}
                <label className="sound-setting">
                  <input
                    type="checkbox"
                    checked={override?.ignored ?? false}
                    onChange={(event) =>
                      changeUser({ ignored: event.target.checked })
                    }
                  />
                  Ignore this user
                </label>
              </>
            )}
          </div>
        </details>
      )}
      <div className="tts-preview">
        <input
          aria-label="Preview text"
          maxLength={120}
          value={preview}
          onChange={(event) => setPreview(event.target.value)}
        />
        <button
          disabled={busy || !preview.trim()}
          onClick={() => {
            setBusy(true);
            setError("");
            void narratorPlayback
              .preview(
                preview,
                instance ? serverNarratorSource(instance) : undefined,
              )
              .catch((error) => setError(friendlyError(error)))
              .finally(() => setBusy(false));
          }}
        >
          Preview
        </button>
        <button onClick={() => narratorPlayback.stop()}>Stop</button>
      </div>
      <p role="status" className={playback.error ? "error" : "muted small"}>
        {playback.message}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
