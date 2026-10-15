import { useEffect, useState } from "react";
import type { InstanceClient } from "@haunt/core";
import {
  syncAudioPlugins,
  serverAudioDefault,
} from "@haunt/browser/audio-plugins/cache";
import {
  MAX_PLUGIN_BYTES,
  type AudioPlugin,
} from "@haunt/browser/audio-plugins/contract";
import { Status, useAction } from "./Customization";
export function AudioPluginsAdmin({ instance }: { instance: InstanceClient }) {
  const [plugins, setPlugins] = useState<AudioPlugin[]>([]),
    action = useAction();
  const [repository, setRepository] = useState("");
  const [commit, setCommit] = useState("");
  const [sha256, setSHA256] = useState("");
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
      <fieldset className="plugin-default-settings">
        <legend>Default</legend>
        <p>
          {plugins.find(
            (p) => p.manifest.id === serverAudioDefault(instance)?.id,
          )?.manifest.name ?? "No plugin installed"}
          {serverAudioDefault(instance) && (
            <>
              {" "}
              ·{" "}
              {
                plugins
                  .find(
                    (p) => p.manifest.id === serverAudioDefault(instance)?.id,
                  )
                  ?.manifest.variants.find(
                    (v) => v.id === serverAudioDefault(instance)?.variant,
                  )?.label
              }
            </>
          )}
        </p>
        <small className="muted">
          Choose a plugin and tune it in User settings → Server audio plugins,
          then select “Set as server default”. New clients will use those
          settings.
        </small>
      </fieldset>
      <fieldset disabled={action.busy} className="form">
        <legend>Install from GitHub</legend>
        <label>
          Repository URL
          <input
            type="url"
            placeholder="https://github.com/owner/audio-plugin"
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
          />
        </label>
        <label>
          Commit ID
          <input
            spellCheck={false}
            autoCapitalize="none"
            placeholder="Full 40-character commit ID"
            value={commit}
            onChange={(e) => setCommit(e.target.value.trim())}
          />
        </label>
        <label>
          Package SHA-256
          <input
            spellCheck={false}
            autoCapitalize="none"
            placeholder="64-character checksum from the publisher"
            value={sha256}
            onChange={(e) => setSHA256(e.target.value.trim())}
          />
        </label>
        <small>
          The server verifies the package at this exact revision before
          installing it. Repository scripts are never run.
        </small>
        <button
          disabled={
            !/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(
              repository.trim(),
            ) ||
            !/^[a-f0-9]{40}$/.test(commit) ||
            !/^[a-f0-9]{64}$/.test(sha256)
          }
          onClick={() =>
            void action.run(async () => {
              await instance.menuRequest(
                "/api/v1/admin/audio-plugins/repository",
                "POST",
                { repository: repository.trim(), commit, sha256 },
              );
              await load();
            }, "Verified audio plugin installed.")
          }
        >
          Install verified plugin
        </button>
      </fieldset>
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
          <small title={p.digest}>SHA-256: {p.digest.slice(0, 16)}…</small>
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
