import { useEffect, useRef, useState } from "react";
import {
  parseExtensionConfiguration,
  type InstanceClient,
  type ServerExtensionConfiguration,
} from "@haunt/core";
import { followAudioOutput } from "@haunt/browser/audio-output";
import { Status, useAction } from "./Customization";
import { ExtensionVoiceSelect } from "./ExtensionVoiceSelect";
import { useServerExtensions } from "./useServerExtensions";
import { can, Permission } from "./Permissions";
import "./tts-settings.css";

export function ServerExtensionsAdmin({
  instance,
  extensionID,
  onReload,
}: {
  instance: InstanceClient;
  extensionID?: string;
  onReload?: () => void;
}) {
  const catalog = useServerExtensions(instance);
  const [selected, setSelected] = useState(extensionID ?? "");
  const id = extensionID ?? selected;
  const [configuration, setConfiguration] =
    useState<ServerExtensionConfiguration>();
  const [enabled, setEnabled] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [voice, setVoice] = useState("");
  const [text, setText] = useState("The speech extension is ready.");
  const [audioURL, setAudioURL] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const testing = useRef<AbortController>(undefined);
  const action = useAction();
  const allowed = can(instance, Permission.ManageConfiguration);
  const path = `/api/v1/admin/server-extensions/${id}`;
  const apply = (raw: unknown) => {
    const next = parseExtensionConfiguration(raw, id);
    setConfiguration(next);
    setEnabled(next.enabled);
    setValues(next.values);
    setVoice((current) => current || next.default_voice);
  };
  useEffect(() => {
    setConfiguration(undefined);
    setVoice("");
    setAudioURL("");
    if (!allowed || !id) return;
    const abort = new AbortController();
    void action.run(async () => {
      const value = await instance.menuRequest(
        path,
        "GET",
        undefined,
        abort.signal,
      );
      if (!abort.signal.aborted) apply(value);
    }, "");
    return () => {
      abort.abort();
      testing.current?.abort();
    };
  }, [instance, allowed, id]);
  useEffect(() => {
    if (!audioURL) return;
    const off = audio.current ? followAudioOutput(audio.current) : undefined;
    return () => {
      off?.();
      URL.revokeObjectURL(audioURL);
    };
  }, [audioURL]);
  if (!allowed)
    return (
      <p>
        Managing server extensions requires Manage configuration or
        Administrator.
      </p>
    );
  const dirty =
    !!configuration &&
    (enabled !== configuration.enabled ||
      configuration.fields.some(
        (field) =>
          (values[field.key] ?? "") !== (configuration.values[field.key] ?? ""),
      ));
  return (
    <section className="form extension-settings">
      <h3>{configuration?.name ?? "Server extensions"}</h3>
      <p className="muted small">
        {configuration?.description ??
          "Installed server extensions provide their settings and voices to this client."}
      </p>
      <Status action={action} />
      {!extensionID && (
        <>
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await instance.menuRequest(
                  "/api/v1/admin/server-extensions/reload",
                  "POST",
                );
                catalog.refresh();
                onReload?.();
              }, "Installed extensions reloaded.")
            }
          >
            Reload installed extensions
          </button>
          {catalog.error && <p role="alert">{catalog.error}</p>}
          {!catalog.loading && !catalog.extensions.length && (
            <p>No server extensions are installed.</p>
          )}
          <label>
            Extension
            <select
              aria-label="Server extension"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Choose an extension</option>
              {catalog.extensions.map((extension) => (
                <option key={extension.id} value={extension.id}>
                  {extension.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {id && !configuration && (
        <button
          disabled={action.busy}
          onClick={() =>
            void action.run(
              async () => apply(await instance.menuRequest(path)),
              "",
            )
          }
        >
          Refresh extension
        </button>
      )}
      {configuration && (
        <>
          <p role="status" className="muted small">
            {configuration.enabled ? "Enabled" : "Disabled"} ·{" "}
            {configuration.configured ? "Configured" : "Setup required"}
          </p>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                testing.current?.abort();
                audio.current?.pause();
                apply(
                  await instance.menuRequest(path, "PUT", {
                    revision: configuration.revision,
                    enabled,
                    values,
                  }),
                );
                setAudioURL("");
                catalog.refresh();
              }, "Extension configuration saved.");
            }}
          >
            <fieldset disabled={action.busy} className="form">
              <label className="sound-setting">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                Enable for this server’s clients
              </label>
              {configuration.fields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  {field.type === "select" ? (
                    <select
                      value={values[field.key] ?? ""}
                      onChange={(event) =>
                        setValues((old) => ({
                          ...old,
                          [field.key]: event.target.value,
                        }))
                      }
                    >
                      {!field.required && <option value="">Not set</option>}
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      autoComplete="off"
                      spellCheck={false}
                      value={values[field.key] ?? ""}
                      maxLength={field.max_length || 4096}
                      placeholder={
                        field.type === "password" &&
                        configuration.configured_secrets.includes(field.key)
                          ? "Configured; leave blank to keep"
                          : undefined
                      }
                      onChange={(event) =>
                        setValues((old) => ({
                          ...old,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  )}
                  {field.help && <small className="muted">{field.help}</small>}
                </label>
              ))}
              <div className="button-row">
                <button className="primary" type="submit">
                  Save configuration
                </button>
                {!!configuration.configured_secrets.length && (
                  <button
                    type="button"
                    onClick={() =>
                      void action.run(async () => {
                        testing.current?.abort();
                        audio.current?.pause();
                        setAudioURL("");
                        apply(
                          await instance.menuRequest(path, "PUT", {
                            revision: configuration.revision,
                            enabled: false,
                            values: {},
                            clear_secrets: configuration.configured_secrets,
                          }),
                        );
                        catalog.refresh();
                      }, "Extension disabled and credentials removed.")
                    }
                  >
                    Clear credentials
                  </button>
                )}
              </div>
            </fieldset>
          </form>
          <h4>Test extension</h4>
          <p className="muted small">
            Save configuration before testing. Tests work while disabled and do
            not use device fallback.
          </p>
          <div className="tts-grid">
            <ExtensionVoiceSelect
              label="Test voice"
              value={voice}
              voices={configuration.voices}
              pattern={configuration.voice_pattern}
              onChange={setVoice}
            />
            <label>
              Test text
              <input
                value={text}
                maxLength={120}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
          </div>
          <div className="button-row">
            <button
              disabled={
                action.busy ||
                dirty ||
                !configuration.configured ||
                !text.trim()
              }
              onClick={() =>
                void action.run(async () => {
                  testing.current?.abort();
                  const abort = new AbortController();
                  testing.current = abort;
                  const bytes = await instance.extensionSpeech(
                    id,
                    { text, voice },
                    abort.signal,
                    true,
                  );
                  if (!abort.signal.aborted)
                    setAudioURL(
                      URL.createObjectURL(
                        new Blob([new Uint8Array(bytes)], {
                          type: "audio/mpeg",
                        }),
                      ),
                    );
                }, "Extension test succeeded. Generated audio is ready below.")
              }
            >
              Test and play speech
            </button>
            <button disabled={!audioURL} onClick={() => audio.current?.pause()}>
              Stop test audio
            </button>
          </div>
          {dirty && (
            <p className="muted small">Save your changes before testing.</p>
          )}
          {audioURL && (
            <audio
              ref={audio}
              controls
              autoPlay
              src={audioURL}
              aria-label="Extension test audio"
            />
          )}
        </>
      )}
    </section>
  );
}
