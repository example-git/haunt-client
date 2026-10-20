import { useEffect, useRef, useState } from "react";
import type { InstanceClient, ServerExtensionConfiguration } from "@haunt/core";
import { followAudioOutput } from "@haunt/browser/audio-output";
import { Status, useAction } from "./Customization";
import "./tts-settings.css";

export function ServerExtensionsAdmin({
  instance,
}: {
  instance: InstanceClient;
}) {
  const [configuration, setConfiguration] =
    useState<ServerExtensionConfiguration>();
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState(
    "https://api16-normal-useast5.us.tiktokv.com",
  );
  const [token, setToken] = useState("");
  const [voice, setVoice] = useState("en_us_001");
  const [text, setText] = useState("Haunt's speech extension is ready.");
  const [audioURL, setAudioURL] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const testing = useRef<AbortController>(undefined);
  const action = useAction();
  const owner = instance.account.login.user.is_owner;
  const path = "/api/v1/admin/server-extensions/tiktok-tts";
  const apply = (value: unknown) => {
    const next = value as ServerExtensionConfiguration;
    if (next?.id !== "tiktok-tts" || !Number.isSafeInteger(next.revision))
      throw Error("Invalid extension configuration.");
    setConfiguration(next);
    setEnabled(next.enabled);
    setEndpoint(next.endpoint);
    setToken("");
  };
  useEffect(() => {
    if (!owner) return;
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
  }, [instance, owner]);
  useEffect(() => {
    if (!audioURL) return;
    const off = audio.current ? followAudioOutput(audio.current) : undefined;
    return () => {
      off?.();
      URL.revokeObjectURL(audioURL);
    };
  }, [audioURL]);
  if (!owner) return <p>Only the server owner can configure extensions.</p>;
  const dirty =
    !!configuration &&
    (token !== "" ||
      endpoint !== configuration.endpoint ||
      enabled !== configuration.enabled);
  return (
    <section className="form extension-settings">
      <h3>Server extensions</h3>
      <p className="muted small">
        Server-hosted integrations, separate from voice processing plugins.
        Credentials stay on this server; users configure playback in their
        client’s Text to speech section.
      </p>
      <Status action={action} />
      {!configuration ? (
        <button
          disabled={action.busy}
          onClick={() =>
            void action.run(
              async () => apply(await instance.menuRequest(path)),
              "",
            )
          }
        >
          Refresh extensions
        </button>
      ) : (
        <>
          <label>
            Extension
            <select
              aria-label="Server extension"
              value="tiktok-tts"
              onChange={() => {}}
            >
              <option value="tiktok-tts">TikTok TTS · speech relay</option>
            </select>
          </label>
          <p role="status" className="muted small">
            {configuration.enabled ? "Enabled" : "Disabled"} ·{" "}
            {configuration.configured
              ? "Session token configured"
              : "Setup required"}
          </p>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                const value = await instance.menuRequest(path, "PUT", {
                  revision: configuration.revision,
                  enabled,
                  endpoint,
                  ...(token ? { session_token: token } : {}),
                });
                apply(value);
                setAudioURL("");
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
              <label>
                TikTok session token
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  maxLength={32}
                  placeholder={
                    configuration.configured
                      ? "Configured — leave blank to keep"
                      : "TikTok sessionid (32 hex characters)"
                  }
                  onChange={(event) => setToken(event.target.value.trim())}
                />
              </label>
              <label>
                API region
                <select
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                >
                  <option value="https://api16-normal-useast5.us.tiktokv.com">
                    US East 5
                  </option>
                  <option value="https://api16-normal-useast5.tiktokv.us">
                    US East 5 · alternate
                  </option>
                </select>
              </label>
              <div className="button-row">
                <button className="primary" type="submit">
                  Save configuration
                </button>
                <button
                  type="button"
                  disabled={!configuration.configured}
                  onClick={() =>
                    void action.run(async () => {
                      testing.current?.abort();
                      audio.current?.pause();
                      setAudioURL("");
                      apply(
                        await instance.menuRequest(path, "PUT", {
                          revision: configuration.revision,
                          enabled: false,
                          endpoint: configuration.endpoint,
                          clear_token: true,
                        }),
                      );
                    }, "Extension disabled and credentials removed.")
                  }
                >
                  Clear credentials
                </button>
              </div>
            </fieldset>
          </form>
          <details>
            <summary>About credentials</summary>
            <p className="muted small">
              Use a TikTok sessionid obtained from an account you control. This
              endpoint uses a session token, not the old Worker’s relay API key.
              Saved credentials are encrypted at rest and never returned by the
              API. Update an expired token here.
            </p>
          </details>
          <h4>Test extension</h4>
          <p className="muted small">
            Save configuration first, then test actual speech before enabling
            the extension for clients. Tests work while disabled and never use
            device fallback.
          </p>
          <div className="tts-grid">
            <label>
              Test voice
              <input
                value={voice}
                maxLength={64}
                onChange={(event) => setVoice(event.target.value)}
              />
            </label>
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
                !text.trim() ||
                !voice.trim()
              }
              onClick={() =>
                void action.run(async () => {
                  testing.current?.abort();
                  const abort = new AbortController();
                  testing.current = abort;
                  const bytes = await instance.extensionSpeech(
                    "tiktok-tts",
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
                }, "Live provider test succeeded. Generated audio is ready below.")
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
