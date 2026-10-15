import { useEffect, useState, useSyncExternalStore } from "react";
import { friendlyError, type InstanceClient } from "@haunt/core";
import {
  getPreferences,
  setPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";
import {
  audioPlugins,
  syncAudioPlugins,
  subscribePlugins,
  pluginRevision,
  serverAudioDefault,
} from "@haunt/browser/audio-plugins/cache";
import { normalizePluginPreferences } from "@haunt/browser/audio-plugins/contract";
import {
  pluginSelection,
  savePluginPreferences,
} from "@haunt/browser/audio-plugins/preferences";
import { PluginDownloadProgress } from "./AudioPluginProgress";
import { MicrophoneMeter } from "./MicrophoneMeter";
const microphoneAccessGranted = () => {};
export function useAudioPlugins(instance?: InstanceClient) {
  useSyncExternalStore(subscribePlugins, pluginRevision);
  useEffect(() => {
    if (instance) void syncAudioPlugins(instance).catch(() => {});
  }, [instance]);
  return instance ? audioPlugins(instance) : [];
}
export function NoiseControls({ instance }: { instance: InstanceClient }) {
  const prefs = useSyncExternalStore(subscribePreferences, getPreferences),
    plugins = useAudioPlugins(instance);
  const [error, setError] = useState("");
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultNotice, setDefaultNotice] = useState("");
  const selection = pluginSelection(instance),
    plugin = selection?.plugin;
  if (!plugin)
    return (
      <section className="form">
        <PluginDownloadProgress instance={instance} />
        <p className="muted">No server audio plugin is selected.</p>
        <button
          onClick={() =>
            void syncAudioPlugins(instance).catch((e) =>
              setError(friendlyError(e)),
            )
          }
        >
          Refresh plugins
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  const saved =
    prefs.audioPlugins[instance.account.instance.instance_id]?.plugins[
      plugin.manifest.id
    ];
  const options = normalizePluginPreferences(plugin, saved),
    variant = plugin.manifest.variants.find((v) => v.id === options.variant)!;
  const save = (patch: Partial<typeof options>) =>
    savePluginPreferences(instance, { ...options, ...patch });
  return (
    <section className="form noise-options">
      {plugins.length > 1 && (
        <label>
          <strong>Active Server Audio Plugin:</strong>
          <select
            aria-label="Active Server Audio Plugin:"
            value={plugin.manifest.id}
            onChange={(e) => {
              const next = plugins.find(
                (p) => p.manifest.id === e.target.value,
              )!;
              savePluginPreferences(
                instance,
                normalizePluginPreferences(
                  next,
                  prefs.audioPlugins[instance.account.instance.instance_id]
                    ?.plugins[next.manifest.id],
                ),
              );
            }}
          >
            {plugins.map((p) => (
              <option key={p.manifest.id} value={p.manifest.id}>
                {p.manifest.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="muted">
        Saved on this device for {instance.account.instance.name}. Audio is
        processed locally.
      </p>
      {!prefs.noiseSuppression && (
        <p className="muted">
          Noise suppression is off. Enable it in Devices to use this plugin.
        </p>
      )}
      {selection?.plugin.manifest.id !== plugin.manifest.id && (
        <button onClick={() => save({})}>Use this plugin</button>
      )}
      <label>
        Noise processing model
        <select
          aria-label="Noise processing model"
          value={options.variant}
          onChange={(e) => save({ variant: e.target.value })}
        >
          {plugin.manifest.variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <PluginDownloadProgress instance={instance} />
      {variant.description && (
        <p className="muted small">{variant.description}</p>
      )}
      {plugin.manifest.fields
        .filter(
          (f) => !f.variants?.length || f.variants.includes(options.variant),
        )
        .map((f) => (
          <label key={f.key} className="microphone-gain">
            <span>
              {f.label}
              <output>{options.values[f.key]}</output>
            </span>
            <input
              type={f.type}
              aria-label={f.label}
              min={f.min}
              max={f.max}
              step={f.step}
              value={options.values[f.key]}
              onChange={(e) =>
                save({
                  values: {
                    ...options.values,
                    [f.key]: e.target.valueAsNumber,
                  },
                })
              }
            />
            {f.help && <small className="muted">{f.help}</small>}
          </label>
        ))}
      <button
        onClick={() => {
          savePluginPreferences(instance, normalizePluginPreferences(plugin));
          setPreferences({ noiseSuppression: true });
        }}
      >
        Reset noise defaults
      </button>
      {(instance.account.login.user.is_owner ||
        (instance.snapshot.permissions & 16384) !== 0) && (
        <fieldset className="plugin-default-settings">
          <legend>Default</legend>
          <p className="muted small">
            New clients start with the server default. Existing personal choices
            stay unchanged.
          </p>
          <button
            disabled={savingDefault}
            onClick={() => {
              setSavingDefault(true);
              setDefaultNotice("");
              setError("");
              void instance
                .menuRequest(
                  "/api/v1/admin/audio-plugins/default",
                  "PUT",
                  options,
                )
                .then(() => syncAudioPlugins(instance, false))
                .then(() =>
                  setDefaultNotice(
                    "Current plugin, model and settings saved as the server default.",
                  ),
                )
                .catch((e) => setError(friendlyError(e)))
                .finally(() => setSavingDefault(false));
            }}
          >
            Set as server default
          </button>
          {serverAudioDefault(instance)?.id === plugin.manifest.id && (
            <small className="muted">
              This plugin is the current server default.
            </small>
          )}
          {defaultNotice && <p role="status">{defaultNotice}</p>}
          {error && <p role="alert">{error}</p>}
        </fieldset>
      )}
      <MicrophoneMeter
        showDiagnostics
        device={prefs.microphone}
        gain={prefs.microphoneGain}
        automaticGain={prefs.automaticGainControl}
        noiseSuppression={prefs.noiseSuppression}
        noiseOptions={selection}
        onAccessGranted={microphoneAccessGranted}
      />
    </section>
  );
}
