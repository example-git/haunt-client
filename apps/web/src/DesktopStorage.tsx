import { useEffect, useState } from "react";
import { friendlyError } from "@haunt/core";
import type {
  DesktopDownload,
  DesktopCacheState,
} from "@haunt/browser/storage";
const size = (bytes: number) =>
  `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;

export function DesktopStorage() {
  const desktop = window.hauntDesktop;
  const [cache, setCache] = useState<DesktopCacheState>(),
    [folder, setFolder] = useState(""),
    [downloads, setDownloads] = useState<DesktopDownload[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    const state = await desktop!.storage!.state();
    setCache(state);
    setFolder(state.downloadDirectory);
  };
  const run = async (job: () => Promise<unknown>) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await job();
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void Promise.all([
      refresh(),
      desktop!.downloads!.list().then(setDownloads),
    ]).catch((error) => setError(friendlyError(error)));
    return desktop!.downloads!.subscribe(setDownloads);
  }, []);
  return (
    <section className="form">
      <h3>Desktop downloads & storage</h3>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <p>Download folder: {folder}</p>
      <div className="button-row">
        <button
          disabled={busy}
          onClick={() =>
            void run(async () =>
              setFolder(await desktop!.storage!.chooseDownloads()),
            )
          }
        >
          Choose download folder
        </button>
        <button
          disabled={busy}
          onClick={() => void run(() => desktop!.storage!.reveal("downloads"))}
        >
          Open downloads folder
        </button>
      </div>
      {cache && (
        <>
          <p>
            {size(cache.bytes)} of {size(cache.budget)} used by{" "}
            {cache.entries.toLocaleString()} cached media items.
          </p>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              const budget = Number(
                new FormData(event.currentTarget).get("budget"),
              );
              void run(async () => {
                setCache(await desktop!.storage!.budget(budget * 1024 * 1024));
                setNotice("Media cache budget saved.");
              });
            }}
          >
            <label>
              Media cache budget (MiB)
              <input
                key={cache.budget}
                name="budget"
                type="number"
                min="16"
                max="8192"
                step="1"
                required
                defaultValue={cache.budget / 1024 / 1024}
              />
            </label>
            <button disabled={busy}>Save cache budget</button>
          </form>
          <p className="muted">
            Clearing cached media keeps your message archives and account
            settings.
          </p>
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setCache(await desktop!.storage!.clear());
                  setNotice("Media cache cleared.");
                })
              }
            >
              Clear media cache
            </button>
            <button
              disabled={busy}
              onClick={() => void run(() => desktop!.storage!.reveal("media"))}
            >
              Open media cache folder
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(() => desktop!.storage!.reveal("application"))
              }
            >
              Open application storage
            </button>
            <button disabled={busy} onClick={() => void run(refresh)}>
              Refresh storage usage
            </button>
          </div>
        </>
      )}
      <h3>Downloads</h3>
      {!downloads.length && (
        <p className="muted">Downloads from this session appear here.</p>
      )}
      {downloads.map((item) => (
        <article
          className="form"
          key={item.id}
          aria-label={`Download ${item.name}`}
        >
          <strong>{item.name}</strong>
          {item.error && (
            <p role="alert" className="error">
              {item.error}
            </p>
          )}
          <span>
            {item.state} · {size(item.received)}
            {item.total > 0 ? ` / ${size(item.total)}` : ""}
          </span>
          {item.state === "progressing" && (
            <progress
              aria-label={`Download progress for ${item.name}`}
              max={item.total || undefined}
              value={item.total ? item.received : undefined}
            />
          )}
          <div className="button-row">
            {(item.active
              ? item.state === "interrupted"
                ? ["retry", "cancel"]
                : ["cancel"]
              : item.state === "completed"
                ? ["reveal", "remove"]
                : ["retry", "remove"]
            ).map((action) => (
              <button
                key={action}
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    desktop!.downloads!.action(
                      item.id,
                      action as "cancel" | "retry" | "reveal" | "remove",
                    ),
                  )
                }
              >
                {
                  {
                    cancel: "Cancel download",
                    retry: "Retry download",
                    reveal: "Show in folder",
                    remove: "Remove from list",
                  }[action]
                }
              </button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
