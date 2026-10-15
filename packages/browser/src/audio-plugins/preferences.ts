import type { InstanceClient } from "@haunt/core";
import { audioPlugins, pluginAsset } from "./cache";
import {
  normalizePluginPreferences,
  type PluginSelection,
  type PluginPreferences,
} from "./contract";
import { getPreferences, setPreferences } from "../preferences";
import type { ServerPluginPreferences } from "./saved-settings";
export function pluginSelection(
  client?: InstanceClient,
): PluginSelection | undefined {
  if (!client) return;
  const items = audioPlugins(client),
    saved = getPreferences().audioPlugins[client.account.instance.instance_id];
  const plugin =
    items.find((p) => p.manifest.id === saved?.selected) ?? items[0];
  if (!plugin) return;
  const options = normalizePluginPreferences(
    plugin,
    saved?.plugins[plugin.manifest.id],
  );
  return {
    plugin,
    variant: options.variant,
    values: options.values,
    load: () =>
      pluginAsset(
        client,
        plugin,
        plugin.manifest.variants.find((v) => v.id === options.variant)!.file,
      ),
  };
}
export function savePluginPreferences(
  client: InstanceClient,
  value: PluginPreferences,
) {
  const prefs = getPreferences(),
    id = client.account.instance.instance_id,
    old = prefs.audioPlugins[id];
  setPreferences({
    audioPlugins: {
      ...prefs.audioPlugins,
      [id]: {
        selected: value.id,
        plugins: { ...old?.plugins, [value.id]: value },
      },
    },
  });
}
