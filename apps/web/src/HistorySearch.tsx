import { useEffect, useState, useSyncExternalStore } from "react";
import { friendlyError, type InstanceClient, type Message } from "@haunt/core";
import { messageLink } from "@haunt/browser/deep-links";
import { copyText } from "./clipboard";

export function HistorySearch({
  instance,
  conversation,
  onNavigate,
}: {
  instance: InstanceClient;
  conversation: string;
  onNavigate: (id: string) => Promise<void>;
}) {
  const state = useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const [rows, setRows] = useState<Message[]>([]),
    [before, setBefore] = useState<number>();
  const [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [indexed, setIndexed] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    setRows([]);
    setQuery("");
    setBefore(undefined);
  }, [instance, conversation]);
  useEffect(() => {
    if (!open || !query.trim()) {
      setRows([]);
      setBusy(false);
      setMore(false);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setIndexed(0);
    const timer = setTimeout(() => {
      void instance.store
        .search(instance.scope, conversation, query, {
          before,
          signal: controller.signal,
          onProgress: setIndexed,
        })
        .then((page) => {
          if (!controller.signal.aborted) {
            setRows(page.messages);
            setMore(page.hasMore);
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(friendlyError(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    instance,
    conversation,
    query,
    before,
    open,
    state.messageRevisions?.[conversation],
  ]);
  const archive = state.archives?.[conversation];
  return (
    <section className="history-tools" aria-label="Conversation history">
      <div className="history-search-bar">
        <input
          type="search"
          aria-label="Search downloaded messages"
          placeholder="Search downloaded messages"
          value={query}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setBefore(undefined);
            setOpen(true);
          }}
        />
        {open && (
          <button className="text-button" onClick={() => setOpen(false)}>
            Close search
          </button>
        )}
      </div>
      <div className="button-row">
        <button
          className="text-button"
          onClick={() => {
            void copyText(messageLink(instance.origin, conversation)).catch(
              (error) => setError(friendlyError(error)),
            );
          }}
        >
          Copy channel link
        </button>
        <span className="muted small" role="status">
          {archive?.state === "complete"
            ? "History downloaded"
            : archive?.state === "downloading"
              ? "Downloading history…"
              : archive?.state === "waiting"
                ? "Archive waiting for download budget"
                : archive?.state === "error"
                  ? "Archive interrupted"
                  : "Archive paused"}
        </span>
        {archive?.state !== "complete" && (
          <button
            className="text-button"
            onClick={() => {
              const job =
                archive?.state === "waiting" || archive?.state === "downloading"
                  ? instance.pauseArchive(conversation)
                  : instance.resumeArchive(conversation);
              void job.catch((error) => setError(friendlyError(error)));
            }}
          >
            {archive?.state === "waiting" || archive?.state === "downloading"
              ? "Pause archive"
              : "Download history"}
          </button>
        )}
      </div>
      {(error || archive?.error) && (
        <p role="alert" className="error">
          {error || archive?.error}
        </p>
      )}
      {open && (
        <div className="history-search">
          <p className="muted small" role="status">
            {busy
              ? `Searching local history${indexed ? ` · ${indexed.toLocaleString()} messages indexed` : ""}…`
              : query.trim()
                ? `${rows.length} results in downloaded history`
                : "Matches all words. Messages not downloaded to this device are not searched."}
          </p>
          {!busy && (
            <div className="history-search-results">
              {rows.map((message) => (
                <button
                  key={message.id}
                  onClick={() => {
                    void onNavigate(message.id)
                      .then(() => setOpen(false))
                      .catch((error) => setError(friendlyError(error)));
                  }}
                >
                  <small>
                    {state.users.find((user) => user.id === message.author_id)
                      ?.username ?? "Member"}{" "}
                    · {new Date(message.created_at).toLocaleString()}
                  </small>
                  <span>{message.body.slice(0, 400)}</span>
                </button>
              ))}
            </div>
          )}
          {more && !busy && (
            <button
              className="text-button"
              onClick={() => setBefore(rows.at(-1)?.seq)}
            >
              Older search results
            </button>
          )}
          {before !== undefined && (
            <button
              className="text-button"
              onClick={() => setBefore(undefined)}
            >
              Newest search results
            </button>
          )}
        </div>
      )}
    </section>
  );
}
