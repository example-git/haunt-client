import { DesktopUpdates } from "./DesktopUpdates";
import {
  NotificationSoundControl,
  SavedSoundOptions,
  SavedSounds,
} from "./NotificationSound";
import { Backups } from "./Backups";
import { SyncPanel } from "./SyncPanel";
import { desktopClient } from "@haunt/browser/client-context";
import { AppearanceSettings } from "./AppearanceSettings";
import { NarratorSettings } from "./NarratorSettings";
import { MicrophoneMeter } from "./MicrophoneMeter";
import { NoiseControls, useAudioPlugins } from "./NoiseControls";
import { pluginSelection } from "@haunt/browser/audio-plugins/preferences";
import { nativeCaptureAvailable } from "@haunt/browser/media/native-capture";
import type { NativeDevice } from "@haunt/browser/media/native-types";
import {
  supportsAudioOutput,
  canSelectAudioOutput,
  selectAudioOutput,
} from "@haunt/browser/audio-output";
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  friendlyError,
  type InstanceClient,
  type NotificationRule,
} from "@haunt/core";
import {
  channelPreferenceKey,
  getPreferences,
  setPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";
import {
  importPing,
  playPing,
  removePing,
  setSoundsEnabled,
  soundsEnabled,
} from "@haunt/browser/sounds";
import { enablePopups, popupPermission } from "@haunt/browser/notifications";
import { ErrorNotice, Modal } from "./App";
import type { Call } from "@haunt/browser/media/call";
const ruleOptions = (
  <>
    <option value="inherit">Use defaults</option>
    <option value="all">All messages</option>
    <option value="mentions">Mentions only</option>
    <option value="mute">Muted</option>
  </>
);
export function NotificationRules({
  instance,
  onlyChannel,
}: {
  instance: InstanceClient;
  onlyChannel?: string;
}) {
  const prefs = useSyncExternalStore(subscribePreferences, getPreferences);
  const state = useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  const id = instance.account.instance.instance_id;
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const host = new URL(instance.account.origin).host;
  // Use exactly the directory supplied to this account, as the member list does.
  const matches = query
    ? state.users
        .filter(
          (user) =>
            user.id !== instance.account.login.user.id &&
            `${user.display_name ?? ""} ${user.username}@${host}`
              .toLocaleLowerCase()
              .includes(query),
        )
        .sort((a, b) => a.username.localeCompare(b.username))
    : [];
  const channels = state.channels.map((c) => ({
    id: c.id,
    name: `#${c.name}`,
  }));
  const conversations = onlyChannel
    ? [
        ...channels,
        ...state.conversations
          .filter((c) => c.kind === "dm")
          .map((c) => ({
            id: c.id,
            name:
              (c.members ?? [])
                .filter((id) => id !== instance.account.login.user.id)
                .map((id) => state.users.find((u) => u.id === id))
                .filter((u) => !!u)
                .map((u) => u.display_name || u.username)
                .join(", ") || "Direct message",
          })),
      ].filter((c) => c.id === onlyChannel)
    : channels;
  return (
    <div className="form notification-rules">
      {!onlyChannel && (
        <section
          className="notification-user-search"
          aria-label="User notification overrides"
        >
          <label>
            Find a user
            <input
              type="search"
              aria-label="Find a user for notifications"
              placeholder="username or display name"
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <p className="muted small">
            Applies to direct messages. Conversation overrides take priority.
          </p>
          {query && matches.length === 0 && (
            <p className="muted small" role="status">
              No matching users on this server.
            </p>
          )}
          {matches.slice(0, 20).map((user) => {
            const key = channelPreferenceKey(id, user.id);
            const label = `${user.username}@${host}`;
            return (
              <section
                key={key}
                className="notification-rule notification-user-result"
              >
                <label>
                  <strong>{user.display_name || user.username}</strong>
                  <span className="muted small">{label}</span>
                  <select
                    aria-label={`Notifications for ${label}`}
                    value={prefs.users[key] ?? "inherit"}
                    onChange={(event) =>
                      setPreferences({
                        users: {
                          ...getPreferences().users,
                          [key]: event.target.value as NotificationRule,
                        },
                      })
                    }
                  >
                    {ruleOptions}
                  </select>
                </label>
                <NotificationSoundControl
                  server={id}
                  user={user.id}
                  label={label}
                />
              </section>
            );
          })}
          {matches.length > 20 && (
            <p className="muted small" role="status">
              Showing the first 20 matches. Keep typing to narrow your search.
            </p>
          )}
        </section>
      )}
      {!onlyChannel && (
        <section className="notification-rule">
          <label>
            {instance.account.instance.name}
            <select
              aria-label={`Notifications for ${instance.account.instance.name}`}
              value={prefs.servers[id] ?? "inherit"}
              onChange={(e) =>
                setPreferences({
                  servers: {
                    ...prefs.servers,
                    [id]: e.target.value as NotificationRule,
                  },
                })
              }
            >
              {ruleOptions}
            </select>
          </label>
          <NotificationSoundControl
            server={id}
            label={instance.account.instance.name}
          />
        </section>
      )}
      {!onlyChannel && <h4>Channel overrides</h4>}
      {conversations.map((c) => {
        const key = channelPreferenceKey(id, c.id);
        return (
          <section key={key} className="notification-rule">
            <label>
              {c.name}
              <select
                aria-label={`Notifications for ${c.name}`}
                value={prefs.channels[key] ?? "inherit"}
                onChange={(e) =>
                  setPreferences({
                    channels: {
                      ...prefs.channels,
                      [key]: e.target.value as NotificationRule,
                    },
                  })
                }
              >
                {ruleOptions}
              </select>
            </label>
            <NotificationSoundControl
              server={id}
              conversation={c.id}
              label={c.name}
            />
          </section>
        );
      })}
      {prefs.servers[id] === "mute" && (
        <p className="muted small">
          This server is muted. Unmute it to receive notifications from its
          channels and direct messages.
        </p>
      )}
      <p className="muted small">
        Sounds stay on this device and are included in client backups. Custom
        clips can be up to 2 MiB and 15 seconds.
      </p>
    </div>
  );
}

export const clientSettingsTabs = [
  ["appearance", "Appearance"],
  ["notifications", "Notification Settings"],
  ["devices", "Devices"],
  ["audio-plugins", "Server audio plugins"],
  ["narrator", "Text to speech"],
  ["backups", "Backup & restore"],
  ["sync", "Encrypted sync"],
  ["updates", "Client updates"],
] as const;

function ServerNotificationRules({
  instances,
  instance,
}: {
  instances: InstanceClient[];
  instance?: InstanceClient;
}) {
  const [scope, setScope] = useState(instance?.scope ?? instances[0]?.scope);
  const selected =
    instances.find((candidate) => candidate.scope === scope) ??
    instances.find((candidate) => candidate.scope === instance?.scope) ??
    instances[0];
  if (!selected)
    return <p>Connect to a server to set its notification rules.</p>;
  return (
    <>
      <label>
        Server
        <select
          aria-label="Server for notifications"
          value={selected.scope}
          onChange={(event) => setScope(event.target.value)}
        >
          {[...instances]
            .sort((a, b) =>
              a.account.instance.name.localeCompare(b.account.instance.name),
            )
            .map((candidate) => (
              <option key={candidate.scope} value={candidate.scope}>
                {candidate.account.instance.name} —{" "}
                {new URL(candidate.account.origin).host}
              </option>
            ))}
        </select>
      </label>
      <NotificationRules key={selected.scope} instance={selected} />
    </>
  );
}

export function ClientSettings({
  instances,
  call,
  onClose,
  initialTab = "notifications",
  onTabChange,
}: {
  instances: InstanceClient[];
  call?: Call;
  onClose: () => void;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
}) {
  const [selectedTab, setTab] = useState(initialTab);
  const plugins = useAudioPlugins(instances[0]);
  const tab =
    selectedTab === "audio-plugins" && !plugins.length
      ? "devices"
      : selectedTab;
  return (
    <Modal title="User settings" onClose={onClose} wide>
      <div className="tabs">
        {clientSettingsTabs
          .filter(([id]) => id !== "updates" || !!window.hauntDesktop?.updates)
          .filter(([id]) => id !== "audio-plugins" || plugins.length > 0)
          .map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                onTabChange?.(id);
              }}
            >
              {label}
            </button>
          ))}
      </div>
      <ClientSettingsContent
        key={tab}
        instances={instances}
        tab={tab}
        call={call}
      />
    </Modal>
  );
}
export function ClientSettingsContent({
  instances,
  tab,
  instance,
  call,
}: {
  instances: InstanceClient[];
  instance?: InstanceClient;
  call?: Call;
  tab: string;
}) {
  const [audioServer, setAudioServer] = useState(
    instance?.scope ?? instances[0]?.scope,
  );
  const selectedServer =
    instance ?? instances.find((i) => i.scope === audioServer) ?? instances[0];
  const audioPlugins = useAudioPlugins(selectedServer);
  const prefs = useSyncExternalStore(subscribePreferences, getPreferences);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [voice, setVoice] = useState(soundsEnabled);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [captureAccess, setCaptureAccess] = useState({
    audio: false,
    video: false,
  });
  const microphoneGranted = useCallback(() => {
    setCaptureAccess((previous) => ({ ...previous, audio: true }));
  }, []);
  const [nativeDevices, setNativeDevices] = useState<{
    cameras: NativeDevice[];
    audio: NativeDevice[];
  }>();
  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setDevices((await navigator.mediaDevices?.enumerateDevices()) ?? []);
    if (nativeCaptureAvailable())
      setNativeDevices(await window.hauntDesktop!.nativeDevices());
  };
  useEffect(() => {
    if (tab !== "devices") return;
    let active = true;
    const permissionListeners: (() => void)[] = [];
    void refresh().catch(() => {});
    const changed = () => {
      void refresh().catch(() => {});
    };
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    for (const kind of ["audio", "video"] as const) {
      void (async () => {
        try {
          const permission = await navigator.permissions.query({
            name: (kind === "audio"
              ? "microphone"
              : "camera") as PermissionName,
          });
          if (!active) return;
          const update = () => {
            setCaptureAccess((previous) => ({
              ...previous,
              [kind]: permission.state === "granted",
            }));
            changed();
          };
          update();
          permission.addEventListener("change", update);
          permissionListeners.push(() =>
            permission.removeEventListener("change", update),
          );
        } catch {
          // Some engines do not expose capture permissions through this API.
          // Successful explicit capture below still updates this settings view.
        }
      })();
    }
    return () => {
      active = false;
      permissionListeners.forEach((remove) => remove());
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
    };
  }, [tab]);
  const requestDevices = async (kind: "audio" | "video") => {
    if (kind === "video" && nativeCaptureAvailable()) {
      setNativeDevices(await window.hauntDesktop!.nativeDevices(true));
      return;
    }
    if (captureAccess[kind]) {
      await refresh();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error(
        "Device selection needs the desktop app or a browser on HTTPS or localhost.",
      );
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === "audio"
        ? {
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          }
        : { video: true },
    );
    stream.getTracks().forEach((track) => track.stop());
    setCaptureAccess((previous) => ({ ...previous, [kind]: true }));
    await refresh();
  };
  return (
    <>
      <p className="muted small">
        Saved on this device for{" "}
        {desktopClient() ? "all your servers" : "this server"}.
      </p>
      <ErrorNotice error={error} />
      {tab === "updates" && <DesktopUpdates />}
      {tab === "audio-plugins" && (
        <section className="form">
          <label>
            Server
            <select
              aria-label="Audio plugin server"
              value={selectedServer?.scope ?? ""}
              onChange={(e) => setAudioServer(e.target.value)}
            >
              {instances.map((i) => (
                <option key={i.scope} value={i.scope}>
                  {i.account.instance.name}
                </option>
              ))}
            </select>
          </label>
          {selectedServer && (
            <NoiseControls
              key={selectedServer.scope}
              instance={selectedServer}
            />
          )}
        </section>
      )}
      {tab === "appearance" && <AppearanceSettings />}
      {tab === "narrator" && <NarratorSettings instance={instance ?? instances[0]} />}
      {tab === "backups" && <Backups />}
      {tab === "sync" && <SyncPanel />}
      {(tab === "notifications" || tab === "servers") && (
        <div className="form client-preferences">
          <label className="sound-setting">
            <input
              type="checkbox"
              checked={prefs.enabled}
              onChange={(e) => setPreferences({ enabled: e.target.checked })}
            />
            Enable message notifications
          </label>
          <fieldset disabled={!prefs.enabled}>
            <legend>Notify me about</legend>
            {(
              [
                ["mentions", "Mentions of me"],
                ["directMessages", "Direct messages"],
                ["channelMessages", "All channel messages"],
                ["whileViewing", "Messages in the conversation I’m viewing"],
              ] as const
            ).map(([key, label]) => (
              <label className="sound-setting" key={key}>
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  onChange={(e) => setPreferences({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
            <p className="muted small">
              Server and channel rules can override these triggers. Muting a
              server silences all its channels.
            </p>
          </fieldset>
          <div className="form-columns">
            <label>
              Ping sound
              <select
                aria-label="Ping sound"
                value={prefs.sound}
                onChange={(e) =>
                  setPreferences({
                    sound: e.target.value as typeof prefs.sound,
                  })
                }
              >
                <option value="ping">Ping (default)</option>
                <option value="chime">Chime</option>
                <option value="soft">Soft</option>
                <option value="none">Silent</option>
                <SavedSoundOptions />
                {prefs.customSoundName && (
                  <option value="custom">
                    Custom: {prefs.customSoundName}
                  </option>
                )}
              </select>
            </label>
            <label>
              Ping volume ({prefs.volume}%)
              <input
                aria-label="Ping volume"
                type="range"
                min="0"
                max="100"
                value={prefs.volume}
                onChange={(e) =>
                  setPreferences({ volume: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy || prefs.sound === "none"}
              onClick={() => void run(() => playPing(true))}
            >
              Preview ping
            </button>
            <label className="secondary sound-upload">
              Choose custom sound
              <input
                aria-label="Custom ping sound"
                type="file"
                accept="audio/*"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void run(() => importPing(file));
                }}
              />
            </label>
            {prefs.customSoundName && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void run(removePing)}
              >
                Remove custom sound
              </button>
            )}
          </div>
          <p className="muted small">
            Custom audio stays on this device. Up to 2 MB and 15 seconds.
          </p>
          <SavedSounds />
          <label className="sound-setting">
            <input
              type="checkbox"
              checked={voice}
              onChange={(e) => {
                setVoice(e.target.checked);
                setSoundsEnabled(e.target.checked);
              }}
            />
            Voice connection and participant sounds
          </label>
          <p className="muted small">
            Includes joining, leaving, your mute/deafen controls and
            screen-share starts.
          </p>
          <label className="sound-setting">
            <input
              type="checkbox"
              checked={prefs.desktopPopups}
              disabled={busy}
              onChange={(e) => {
                if (!e.target.checked) setPreferences({ desktopPopups: false });
                else
                  void run(async () => {
                    await enablePopups();
                    setPreferences({ desktopPopups: true });
                  });
              }}
            />
            Desktop popups when the app is in the background
          </label>
          {prefs.desktopPopups && (
            <>
              <label className="sound-setting">
                <input
                  type="checkbox"
                  checked={prefs.previewMessages}
                  onChange={(e) =>
                    setPreferences({ previewMessages: e.target.checked })
                  }
                />
                Show message previews in desktop popups
              </label>
              {!["granted", "desktop"].includes(popupPermission()) && (
                <p className="muted small">
                  Browser permission is blocked or unavailable. Re-enable popups
                  after allowing notifications in site settings.
                </p>
              )}
            </>
          )}
          <p className="muted small">
            Keep the app open and connected to receive notifications. Browser
            sound starts after your first click or keypress.
          </p>
          <h3>Server, channel & direct message overrides</h3>
          <p className="muted small">
            Use defaults follows your client triggers, or the server rule for a
            conversation. The master notification switch always applies.
          </p>
          <ServerNotificationRules instances={instances} instance={instance} />
        </div>
      )}
      {tab === "devices" && (
        <div className="form">
          {(
            [
              ["audioOutput", "audiooutput", "Output device"],
              ["microphone", "audioinput", "Default microphone"],
              ["camera", "videoinput", "Default webcam"],
              ["cameraAudio", "audioinput", "Camera audio source"],
            ] as const
          ).map(([field, kind, label]) => {
            const nativeList =
              field === "camera"
                ? nativeDevices?.cameras
                : field === "cameraAudio"
                  ? nativeDevices?.audio
                  : undefined;
            const available = nativeList
              ? nativeList.map((d) => ({
                  deviceId: `swift:${d.id}`,
                  label: d.label,
                }))
              : devices.filter(
                  (d) =>
                    d.kind === kind && d.deviceId && d.deviceId !== "default",
                );
            return (
              <Fragment key={field}>
                <label>
                  {label}
                  <select
                    aria-label={label}
                    disabled={field === "audioOutput" && !supportsAudioOutput()}
                    value={prefs[field]}
                    onChange={(e) =>
                      setPreferences({ [field]: e.target.value })
                    }
                  >
                    <option value="">
                      {field === "cameraAudio" ? "None" : "System default"}
                    </option>
                    {prefs[field] &&
                      !available.some((d) => d.deviceId === prefs[field]) && (
                        <option value={prefs[field]}>
                          Saved device (unavailable)
                        </option>
                      )}
                    {available.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `${label.replace("Default ", "")} ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                {field === "audioOutput" && (
                  <>
                    {!supportsAudioOutput() && (
                      <p className="muted small">
                        This browser uses your system output device. Change it
                        in your operating system's sound settings.
                      </p>
                    )}
                    {canSelectAudioOutput() && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          void run(async () => {
                            const device = await selectAudioOutput();
                            if (device)
                              setPreferences({ audioOutput: device.deviceId });
                            await refresh();
                          })
                        }
                      >
                        Choose an output device…
                      </button>
                    )}
                    <p className="muted small">
                      Applies to calls and notification sounds immediately.
                      Unavailable devices fall back to the system default. Saved
                      here even when you sign out.
                    </p>
                  </>
                )}
                {field === "microphone" && (
                  <>
                    <MicrophoneMeter
                      onAccessGranted={microphoneGranted}
                      onListeningChange={(listening) =>
                        call?.setMicrophoneMonitoring(listening)
                      }
                      device={prefs.microphone}
                      noiseSuppression={
                        audioPlugins.length > 0 && prefs.noiseSuppression
                      }
                      gain={prefs.microphoneGain}
                      automaticGain={prefs.automaticGainControl}
                      noiseOptions={pluginSelection(selectedServer)}
                    />
                    <div className="microphone-controls">
                      <label className="device-toggle">
                        <span>Noise suppression</span>
                        <input
                          type="checkbox"
                          checked={
                            audioPlugins.length > 0 && prefs.noiseSuppression
                          }
                          disabled={audioPlugins.length === 0}
                          onChange={(e) =>
                            setPreferences({
                              noiseSuppression: e.target.checked,
                            })
                          }
                        />
                      </label>
                      {selectedServer && audioPlugins.length > 0 ? (
                        <p className="muted small">
                          Plugin options for{" "}
                          {selectedServer.account.instance.name} are on the
                          Server audio plugins page.
                        </p>
                      ) : (
                        <p className="muted small">
                          {selectedServer
                            ? "This server has no audio plugins installed."
                            : "Connect to a server with an audio plugin to use noise suppression."}
                        </p>
                      )}
                      <label className="device-toggle">
                        <span>Automatic gain</span>
                        <input
                          type="checkbox"
                          checked={prefs.automaticGainControl}
                          onChange={(e) =>
                            setPreferences({
                              automaticGainControl: e.target.checked,
                            })
                          }
                        />
                      </label>
                      <label
                        className={`microphone-gain ${prefs.automaticGainControl ? "automatic" : ""}`}
                      >
                        <span>
                          Microphone gain{" "}
                          <output>{prefs.microphoneGain}%</output>
                        </span>
                        <input
                          type="range"
                          aria-label="Microphone gain"
                          min="0"
                          max="200"
                          step="1"
                          value={prefs.microphoneGain}
                          disabled={prefs.automaticGainControl}
                          onChange={(e) =>
                            setPreferences({
                              microphoneGain: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <p className="muted small">
                        {prefs.automaticGainControl
                          ? "Your microphone level adjusts automatically."
                          : "Adjust your microphone level using the meter above."}{" "}
                        Changes apply during calls.
                      </p>
                    </div>
                  </>
                )}
              </Fragment>
            );
          })}
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run(() => requestDevices("audio"))}
            >
              {captureAccess.audio
                ? "Refresh microphones"
                : "Allow microphone access"}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run(() => requestDevices("video"))}
            >
              {captureAccess.video ? "Refresh cameras" : "Allow camera access"}
            </button>
          </div>
          <p className="muted small">
            Choose a camera audio source for a capture card; leave it at None
            for a regular webcam. Your microphone preference applies when you
            next join a call; your webcam preference applies when you next turn
            on the camera. An unavailable microphone or webcam falls back to the
            system default. A selected camera audio source must be available.
            Screen audio is shared when the browser or desktop capture source
            provides it.
          </p>
        </div>
      )}
    </>
  );
}
