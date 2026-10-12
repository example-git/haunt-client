import { useEffect, useState } from "react";
import type { InstanceClient } from "@haunt/core";
import { syncAudioPlugins } from "@haunt/browser/audio-plugins/cache";
import {
  MAX_PLUGIN_BYTES,
  type AudioPlugin,
} from "@haunt/browser/audio-plugins/contract";
import { Status, useAction } from "./Customization";
export function AudioPluginsAdmin({ instance }: { instance: InstanceClient }) {
  const [plugins, setPlugins] = useState<AudioPlugin[]>([]),
    action = useAction();
  const load = async () => setPlugins(await syncAudioPlugins(instance));
  useEffect(() => {
    void action.run(load, "");
  }, [instance]);
  return (
    <section className="form">
      <h3>Audio plugins</h3>
      <p className="muted">
        Install a compatible ZIP containing a settings manifest and WebAssembly
        models. Maximum 50 MiB per package, packed and unpacked; up to four
        installed packages. Clients cache verified files and process audio
        locally.
      </p>
      <Status action={action} />
      <label>
        Install audio plugin
        <input
          aria-label="Install audio plugin"
          type="file"
          accept=".zip,application/zip"
          disabled={action.busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void action.run(async () => {
                if (file.size > MAX_PLUGIN_BYTES)
                  throw Error("Audio plugins must be at most 50 MiB.");
                await instance.pluginBytes(
                  "/api/v1/admin/audio-plugins",
                  256 * 1024,
                  file,
                );
                await load();
              }, "Audio plugin installed.");
          }}
        />
      </label>
      {plugins.map((p) => (
        <div className="storage-provider" key={p.manifest.id}>
          <strong>{p.manifest.name}</strong>
          <small>
            {(p.bytes / 1048576).toFixed(1)} MiB · {p.manifest.variants.length}{" "}
            models
          </small>
          <button
            className="danger-text"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await instance.menuRequest(
                  `/api/v1/admin/audio-plugins/${p.manifest.id}`,
                  "DELETE",
                );
                await load();
              }, "Audio plugin removed.")
            }
          >
            Remove plugin
          </button>
        </div>
      ))}
    </section>
  );
}
