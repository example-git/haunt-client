import type { InstanceClient } from "@haunt/core";
import type { AudioPlugin } from "./contract";
export type FilePhase =
  "queued" | "checking" | "downloading" | "verifying" | "ready" | "error";
export interface PluginFileProgress {
  key: string;
  label: string;
  plugin: string;
  phase: FilePhase;
  received: number;
  total: number;
  error?: string;
}
export interface PluginDownloadSnapshot {
  catalog: "idle" | "loading" | "ready" | "error";
  error?: string;
  files: Record<string, PluginFileProgress>;
}
const stores = new WeakMap<InstanceClient, PluginDownloadStore>();
export const pluginFileKey = (plugin: AudioPlugin, name: string) =>
  `${plugin.digest}/${name}`;
class PluginDownloadStore {
  private state: PluginDownloadSnapshot = { catalog: "idle", files: {} };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(state: PluginDownloadSnapshot) {
    this.state = state;
    for (const fn of this.listeners) fn();
  }
  catalog(
    catalog: PluginDownloadSnapshot["catalog"],
    plugins?: AudioPlugin[],
    error?: string,
  ) {
    let files = this.state.files;
    if (plugins) {
      files = {};
      for (const plugin of plugins)
        for (const file of plugin.files) {
          const key = pluginFileKey(plugin, file.name);
          files[key] = this.state.files[key] ?? {
            key,
            label: plugin.manifest.variants.find((v) => v.file === file.name)!
              .label,
            plugin: plugin.manifest.name,
            phase: "queued",
            received: 0,
            total: file.bytes,
          };
        }
    }
    this.publish({ catalog, files, error });
  }
  file(
    plugin: AudioPlugin,
    name: string,
    phase: FilePhase,
    received = 0,
    error?: string,
  ) {
    const key = pluginFileKey(plugin, name),
      file = plugin.files.find((f) => f.name === name)!;
    this.publish({
      ...this.state,
      files: {
        ...this.state.files,
        [key]: {
          key,
          label: plugin.manifest.variants.find((v) => v.file === name)!.label,
          plugin: plugin.manifest.name,
          phase,
          received,
          total: file.bytes,
          error,
        },
      },
    });
  }
}
export function pluginDownloads(client: InstanceClient) {
  let store = stores.get(client);
  if (!store) {
    store = new PluginDownloadStore();
    stores.set(client, store);
  }
  return store;
}
