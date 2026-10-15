import { useEffect, useState } from "react";
import type { DesktopUpdateState } from "@haunt/browser/storage";
import { Download } from "lucide-react";

export function DesktopUpdateNotice({ onOpen }: { onOpen: () => void }) {
  const [state, setState] = useState<DesktopUpdateState>();
  useEffect(() => {
    const bridge = window.hauntDesktop?.updates;
    if (!bridge) return;
    const off = bridge.subscribe(setState);
    void bridge
      .state()
      .then(setState)
      .catch(() => {});
    return off;
  }, []);
  if (
    !state ||
    ![
      "available",
      "runtime-required",
      "downloading",
      "ready",
      "installer-ready",
    ].includes(state.phase)
  )
    return null;
  return (
    <button
      className="desktop-update-notice"
      onClick={onOpen}
      title="Client updates"
      aria-label="Client update available"
    >
      <Download size={16} />
      <span>
        {state.phase === "downloading"
          ? `${Math.round((state.progress ?? 0) * 100)}%`
          : state.phase === "ready" || state.phase === "installer-ready"
            ? "Update ready"
            : "Update available"}
      </span>
    </button>
  );
}

export function DesktopUpdates() {
  const bridge = window.hauntDesktop?.updates;
  const [state, setState] = useState<DesktopUpdateState>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!bridge) return;
    const off = bridge.subscribe(setState);
    void bridge
      .state()
      .then(setState)
      .catch(() =>
        setError("Updates are available in packaged desktop builds."),
      );
    return off;
  }, [bridge]);
  if (!bridge) return null;
  const run = (action: () => Promise<unknown>) => {
    setError("");
    void action().catch((e) =>
      setError(
        e instanceof Error ? e.message : "The update could not be completed.",
      ),
    );
  };
  const busy = state?.phase === "checking" || state?.phase === "downloading";
  return (
    <section className="form desktop-updates" aria-label="Client updates">
      <h3>Client updates</h3>
      {state && (
        <p>
          Installed version {state.current}
          {state.available ? ` · Available ${state.available}` : ""}
        </p>
      )}
      <p className="muted small">
        Client updates keep your saved servers, sessions, encryption keys and
        preferences. Restart when you have finished your calls and uploads.
      </p>
      <p role="status">
        {state?.phase === "checking"
          ? "Checking for updates…"
          : state?.phase === "downloading"
            ? `Downloading… ${Math.round((state.progress ?? 0) * 100)}%`
            : state?.phase === "ready"
              ? "Update ready. It will load the next time you start Haunt."
              : state?.phase === "installer-ready"
                ? "Desktop runtime downloaded."
                : state?.message}
      </p>
      {state?.phase === "downloading" && (
        <progress
          aria-label="Update download"
          value={state.progress ?? 0}
          max={1}
        />
      )}
      {state?.notes && <p className="update-release-notes">{state.notes}</p>}
      <div className="actions">
        <button
          disabled={
            busy ||
            state?.phase === "disabled" ||
            state?.phase === "ready" ||
            state?.phase === "installer-ready"
          }
          onClick={() => run(bridge.check)}
        >
          Check for updates
        </button>
        {(state?.phase === "available" ||
          state?.phase === "runtime-required" ||
          (state?.phase === "error" && state.available)) && (
          <button onClick={() => run(bridge.download)}>Download update</button>
        )}
        {(state?.phase === "ready" || state?.phase === "installer-ready") && (
          <button onClick={() => run(bridge.apply)}>
            {state.phase === "ready" ||
            window.hauntDesktop?.platform === "linux"
              ? "Restart to update"
              : "Open installer"}
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

// Startup success is local UI readiness, never server/plugin/login readiness.
export function useDesktopUpdateHealth() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void window.hauntDesktop?.updates?.healthy().catch(() => {});
    }, 5000);
    return () => window.clearTimeout(timer);
  }, []);
}
