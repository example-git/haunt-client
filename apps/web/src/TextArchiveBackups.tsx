import { useEffect, useRef, useState } from "react";
import { friendlyError, type ArchivedText } from "@haunt/core";
import { multiServerClient } from "@haunt/browser/client-context";
import { archiveJob } from "@haunt/browser/archive-jobs";
import { saveMedia } from "@haunt/browser/downloads";
import { client, messageStore } from "./runtime";

export function TextArchiveBackups() {
  const [scopes, setScopes] = useState<string[]>([]),
    [scope, setScope] = useState("");
  const [rows, setRows] = useState<ArchivedText[]>([]),
    [before, setBefore] = useState<string>();
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const selected = [...client.instances.values()].find(
    (i) => i.scope === scope,
  );
  useEffect(() => () => controller.current?.abort(), []);
  const allowed = () =>
    multiServerClient()
      ? undefined
      : new Set(
          [...client.instances.values()]
            .filter((i) => i.origin === location.origin)
            .map((i) => i.scope),
        );
  const refresh = async (selected: string, cursor?: string) => {
    const page = await messageStore.archivedMessages(selected, cursor);
    setRows(page.messages);
    setBefore(page.before);
  };
  const run = async (job: (signal: AbortSignal) => Promise<void>) => {
    if (busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await job(abort.signal);
    } catch (error) {
      if (abort.signal.aborted) setNotice("Archive operation cancelled.");
      else setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="form text-archive-backups">
      <h3>Message text archive</h3>
      <p className="muted">
        Keeps downloaded text separately from live chat, including messages
        later deleted from chat. Attachment files, session tokens and encryption
        keys are excluded from text exports. Encrypted sync includes this
        archive when sync is enabled.
      </p>
      <p className="muted">
        Local .jsonl.gz files contain readable text after decompression. Archive
        deletion affects this archive and future sync; previously exported
        copies remain independent.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="button-row">
        <button
          disabled={busy}
          onClick={() =>
            void run(async (signal) => {
              const result = await archiveJob(
                "export",
                allowed(),
                signal,
                (phase, count) =>
                  setNotice(`${phase} ${count.toLocaleString()} messages…`),
              );
              const blob = result.file!;
              const url = URL.createObjectURL(blob);
              await saveMedia(
                url,
                `Haunt-messages-${new Date().toISOString().slice(0, 10)}.jsonl.gz`,
              );
              setTimeout(() => URL.revokeObjectURL(url), 60000);
              setNotice(
                `Text archive download started (${Math.ceil(blob.size / 1024).toLocaleString()} KiB compressed).`,
              );
            })
          }
        >
          Export message text
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(async (signal) => {
              const result = await archiveJob(
                "prepare",
                allowed(),
                signal,
                (phase, count) =>
                  setNotice(`${phase} ${count.toLocaleString()} messages…`),
              );
              const values = result.scopes!;
              setScopes(values);
              setScope(values[0] ?? "");
              if (values[0]) await refresh(values[0]);
              setNotice(
                values.length ? "" : "No downloaded messages on this device.",
              );
            })
          }
        >
          Browse saved text
        </button>
        {busy && (
          <button onClick={() => controller.current?.abort()}>
            Cancel archive operation
          </button>
        )}
      </div>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          const file = new FormData(event.currentTarget).get("archive") as File;
          void run(async (signal) => {
            await archiveJob(
              "import",
              allowed(),
              signal,
              (phase, count) =>
                setNotice(`${phase} ${count.toLocaleString()} messages…`),
              file,
            );
            setNotice(
              "Text restored to the private archive. Live chat is unchanged.",
            );
            if (scope) await refresh(scope);
          });
        }}
      >
        <label>
          Message text archive file
          <input
            name="archive"
            type="file"
            accept=".gz"
            required
            disabled={busy}
          />
        </label>
        <button disabled={busy}>Import message text</button>
      </form>
      {scopes.length > 0 && (
        <>
          <label>
            Archive account
            <select
              value={scope}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                setScope(next);
                void run(async () => refresh(next));
              }}
            >
              {scopes.map((s) => {
                const instance = [...client.instances.values()].find(
                  (i) => i.scope === s,
                );
                return (
                  <option key={s} value={s}>
                    {instance
                      ? `${instance.account.login.user.username} · ${instance.account.instance.name}`
                      : s}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="history-search-results">
            {rows.map((row) => (
              <article key={row.id}>
                <small>
                  {new Date(row.created_at).toLocaleString()} ·{" "}
                  {selected?.snapshot.users.find((u) => u.id === row.author_id)
                    ?.display_name ||
                    selected?.snapshot.users.find((u) => u.id === row.author_id)
                      ?.username ||
                    row.author_id}{" "}
                  ·{" "}
                  {selected?.snapshot.channels.find(
                    (c) => c.id === row.conversation_id,
                  )?.name || row.conversation_id}
                </small>
                <p className="archived-message-text">{row.body}</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await messageStore.removeArchivedMessage(scope, row.id);
                      await refresh(scope);
                    })
                  }
                >
                  Delete from my archive
                </button>
              </article>
            ))}
          </div>
          {before && (
            <button
              disabled={busy}
              onClick={() => void run(async () => refresh(scope, before))}
            >
              More archived messages
            </button>
          )}
        </>
      )}
    </section>
  );
}
