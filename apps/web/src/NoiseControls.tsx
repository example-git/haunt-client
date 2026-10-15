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
          Server audio plugin
          <select
            aria-label="Server audio plugin"
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
