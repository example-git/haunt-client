import { useEffect, useState } from "react";
import type { DesktopUpdateState } from "@haunt/browser/storage";
import { Download, X } from "lucide-react";

function runtimeInstructions(localSigning = false) {
  switch (window.hauntDesktop?.platform) {
    case "darwin":
      if (localSigning)
        return "Update app prepares and signs the new version with your local key, then replaces Haunt and relaunches. macOS may ask for installation permission.";
      return "Open the downloaded DMG, quit Haunt, and replace your installed app with the latest copy. Apply your usual local signing step if needed.";
    case "win32":
      return "Run the downloaded installer to update your existing installation.";
    default:
      return "Haunt can replace its current AppImage and restart. If you use another installation format, reinstall using the latest full app.";
  }
}

export function DesktopRuntimeNotice() {
  const bridge = window.hauntDesktop?.updates;
  const [state, setState] = useState<DesktopUpdateState>();
  const [dismissed, setDismissed] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    const off = bridge.subscribe(setState);
    void bridge
      .state()
      .then(setState)
      .catch(() => {});
    return off;
  }, [bridge]);
  const ready = state?.phase === "installer-ready";
  const key = `haunt-runtime-notice:${state?.available}:${ready ? "ready" : "available"}`;
  let alreadyDismissed = dismissed === key;
  try {
    alreadyDismissed ||= sessionStorage.getItem(key) === "dismissed";
  } catch {}
  if (
    !bridge ||
    !state?.available ||
    alreadyDismissed ||
    !(
      state.phase === "runtime-required" ||
      ready ||
      (state.kind === "installer" &&
        ["checking", "downloading", "installing", "error"].includes(
          state.phase,
        ))
    )
  )
    return null;
  const downloading = state.phase === "downloading";
  const installing = state.phase === "installing";
  const failure = error || (state.phase === "error" ? state.message : "");
  const run = async () => {
    setError("");
    setWorking(true);
    try {
      await (ready ? bridge.apply() : bridge.download());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The update could not be completed.",
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <aside
      className="call-plugin-notice desktop-runtime-notice"
      aria-label="Full app update required"
    >
      <div className="toast-heading">
        <strong role="status">Full app update required</strong>
        <button
          className="icon"
          aria-label="Dismiss full app update notice"
          onClick={() => {
            setDismissed(key);
            try {
              sessionStorage.setItem(key, "dismissed");
            } catch {}
          }}
        >
          <X size={16} />
        </button>
      </div>
      <p>
        Haunt {state.available} needs the latest full app. A small in-app update
        cannot install this release. Your saved accounts and settings stay on
        this device.
      </p>
      <p>{runtimeInstructions(state?.localSigning)}</p>
      {installing && <p role="status">{state.message}</p>}
      {(downloading || installing) && (
        <progress
          aria-label={installing ? "Update installation" : "Installer download"}
          value={state.progress}
          max={1}
        />
      )}
      <button
        className="secondary"
        disabled={
          working || downloading || installing || state.phase === "checking"
        }
        onClick={() => void run()}
      >
        {installing
          ? "Installing…"
          : downloading
            ? "Downloading installer…"
            : ready
              ? state.localSigning
                ? "Update app"
                : window.hauntDesktop?.platform === "linux"
                  ? "Install and restart"
                  : "Open installer"
              : "Download full app"}
      </button>
      {failure && (
        <p role="alert" className="error">
          {failure}
        </p>
      )}
    </aside>
  );
}

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
      "installing",
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
        {state.phase === "installing"
          ? "Installing…"
          : state.phase === "downloading"
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
  const busy =
    state?.phase === "checking" ||
    state?.phase === "downloading" ||
    state?.phase === "installing";
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
        preferences. Updates are checked automatically every 15 minutes and when
        you return to the app. Restarting during a call or with unfinished
        messages asks for confirmation.
      </p>
      <p role="status">
        {state?.phase === "checking"
          ? "Checking for updates…"
          : state?.phase === "downloading"
            ? `Downloading… ${Math.round((state.progress ?? 0) * 100)}%`
            : state?.phase === "ready"
              ? "Update ready. It will load the next time you start Haunt."
              : state?.phase === "installer-ready"
                ? state.message || "Desktop runtime downloaded."
                : state?.message}
      </p>
      {(state?.phase === "downloading" || state?.phase === "installing") && (
        <progress
          aria-label={
            state.phase === "installing"
              ? "Update installation"
              : "Update download"
          }
          value={state.progress}
          max={1}
        />
      )}
      {state?.notes && <p className="update-release-notes">{state.notes}</p>}
      {(state?.phase === "runtime-required" ||
        state?.phase === "installer-ready") && (
        <p>{runtimeInstructions(state?.localSigning)}</p>
      )}
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
            {state.localSigning && state.phase === "installer-ready"
              ? "Update app"
              : state.phase === "ready" ||
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
