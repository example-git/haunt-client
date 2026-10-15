import { useEffect, useState, useSyncExternalStore } from "react";
import type { InstanceClient } from "@haunt/core";
import {
  pluginDownloads,
  pluginFileKey,
} from "@haunt/browser/audio-plugins/progress";
import {
  pluginRevision,
  subscribePlugins,
  syncAudioPlugins,
} from "@haunt/browser/audio-plugins/cache";
import { pluginSelection } from "@haunt/browser/audio-plugins/preferences";
import {
  getPreferences,
  setPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";
import type { Call } from "@haunt/browser/media/call";
import { Modal } from "./App";
import { X } from "lucide-react";

export function usePluginDownload(instance: InstanceClient) {
  useSyncExternalStore(subscribePlugins, pluginRevision);
  useSyncExternalStore(subscribePreferences, getPreferences);
  const store = pluginDownloads(instance);
  const progress = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const selection = pluginSelection(instance);
  const variant = selection?.plugin.manifest.variants.find(
    (v) => v.id === selection.variant,
  );
  const file =
    selection && variant
      ? progress.files[pluginFileKey(selection.plugin, variant.file)]
      : undefined;
  return {
    progress,
    selection,
    file,
    ready:
      progress.catalog === "ready" && (!selection || file?.phase === "ready"),
  };
}
const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export function PluginDownloadProgress({
  instance,
  all = false,
}: {
  instance: InstanceClient;
  all?: boolean;
}) {
  const { progress, file } = usePluginDownload(instance);
  const files = all ? Object.values(progress.files) : file ? [file] : [];
  return (
    <div
      className="plugin-download-progress"
      aria-label="Server audio plugin downloads"
    >
      {progress.catalog === "idle" || progress.catalog === "loading" ? (
        <p role="status">Checking server audio plugins…</p>
      ) : null}
      {progress.error && <p role="alert">{progress.error}</p>}
      {files.map((f) => (
        <div key={f.key} className="plugin-download-file" data-phase={f.phase}>
          <div>
            <strong>{f.label}</strong>
            <span>
              {f.phase === "ready"
                ? "Ready"
                : f.phase === "error"
                  ? "Download failed"
                  : f.phase === "checking"
                    ? "Checking cache…"
                    : f.phase === "verifying"
                      ? "Verifying…"
                      : f.phase === "queued"
                        ? "Waiting"
                        : `${Math.floor((f.received / f.total) * 100)}%`}
            </span>
          </div>
          {f.phase !== "ready" && (
            <progress
              aria-label={`${f.label} download`}
              value={f.received}
              max={f.total}
            />
          )}
          {f.phase === "downloading" && (
            <small>
              {size(f.received)} / {size(f.total)}
            </small>
          )}
          {f.error && <small role="alert">{f.error}</small>}
        </div>
      ))}
    </div>
  );
}
export function VoiceJoinDialog({
  instance,
  room,
  onClose,
  onJoin,
}: {
  instance: InstanceClient;
  room: string;
  onClose: () => void;
  onJoin: (wait: boolean) => void;
}) {
  const { selection, progress, file, ready } = usePluginDownload(instance);
  const connection = useSyncExternalStore(
    instance.subscribe,
    instance.getSnapshot,
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void syncAudioPlugins(instance, false).catch(() => {});
  }, [instance, attempt]);
  useEffect(() => {
    if (selection) void selection.load().catch(() => {});
  }, [instance, selection?.plugin.digest, selection?.variant, attempt]);
  const failed = progress.catalog === "error" || file?.phase === "error";
  return (
    <Modal title="Prepare voice call" onClose={onClose}>
      <div className="form">
        <p>
          {instance.snapshot.channels.find((c) => c.id === room)?.name ??
            "Voice call"}{" "}
          · {instance.account.instance.name}
        </p>
        <p>
          Join with noise suppression when the selected model is ready, or join
          now without it. If you join now, noise suppression turns on
          automatically when ready.
        </p>
        <PluginDownloadProgress instance={instance} />
        {ready && <p role="status">Ready to join with your audio settings.</p>}
        {failed && (
          <button onClick={() => setAttempt((a) => a + 1)}>
            Retry download
          </button>
        )}
        <div className="plugin-join-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            disabled={connection.status !== "online"}
            onClick={() => onJoin(false)}
          >
            Join now
          </button>
          <button
            className="primary"
            disabled={!ready || connection.status !== "online"}
            onClick={() => onJoin(true)}
          >
            Join
          </button>
        </div>
      </div>
    </Modal>
  );
}
export function CallPluginNotice({ call }: { call: Call }) {
  const state = useSyncExternalStore(call.subscribe, call.getSnapshot);
  const { file, selection } = usePluginDownload(call.client);
  const [readyNotice, setReadyNotice] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const loading = state.noiseSuppression === "loading";
  const preferences = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
  );
  useEffect(() => {
    setDismissed(false);
    if (state.noiseSuppression === "active") {
      if (!getPreferences().noiseSuppressionNoticeShown) {
        setReadyNotice(true);
        setPreferences({ noiseSuppressionNoticeShown: true });
      }
    } else {
      setReadyNotice(false);
    }
  }, [call, state.noiseSuppression]);
  useEffect(() => {
    if (!readyNotice) return;
    const timer = setTimeout(() => setReadyNotice(false), 8000);
    return () => clearTimeout(timer);
  }, [readyNotice]);
  // Loading happens on every capture start, even with a fully cached model.
  // Only the first activation after enabling deserves a routine notice.
  const showLoading = loading && !preferences.noiseSuppressionNoticeShown;
  if (
    state.status === "ended" ||
    dismissed ||
    (state.noiseSuppression !== "fallback" && !showLoading && !readyNotice)
  )
    return null;
  return (
    <aside
      className="call-plugin-notice"
      aria-label="Call audio plugin status"
      data-state={state.noiseSuppression}
    >
      <div className="toast-heading">
        <strong role="status">
          {loading
            ? "Preparing noise suppression"
            : state.noiseSuppression === "fallback"
              ? "Noise suppression unavailable"
              : "Noise suppression enabled"}
        </strong>
        <button
          className="icon"
          aria-label="Dismiss audio plugin notice"
          onClick={() => setDismissed(true)}
        >
          <X size={16} />
        </button>
      </div>
      {loading || state.noiseSuppression === "fallback" ? (
        <>
          <p>
            Your microphone is using unfiltered audio. Noise suppression will
            turn on when ready.
          </p>
          <PluginDownloadProgress instance={call.client} />
          {selection && file?.phase === "ready" && loading && (
            <p>Starting noise suppression…</p>
          )}
          {state.noiseSuppression === "fallback" && (
            <button
              className="secondary"
              onClick={() => void call.retryNoiseProcessing()}
            >
              Retry noise suppression
            </button>
          )}
        </>
      ) : (
        <>
          <p>Your microphone is now using your server audio plugin.</p>
          <button className="secondary" onClick={() => setReadyNotice(false)}>
            Dismiss
          </button>
        </>
      )}
    </aside>
  );
}
