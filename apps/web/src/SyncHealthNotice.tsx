import { useSyncExternalStore } from "react";
import {
  acknowledgeSyncRecoveryKey,
  subscribeSync,
  syncNow,
  syncStatus,
} from "./sync-runtime";

export function SyncHealthNotice() {
  const status = useSyncExternalStore(subscribeSync, syncStatus);
  if (!status.error && !status.recoveryKey) return null;
  return (
    <div className="sync-global-notices">
      {status.recoveryKey && (
        <aside className="sync-banner" role="status">
          <strong>Save your offline sync recovery key</strong>
          <code>{status.recoveryKey}</code>
          <span>
            Keep it private, outside this device. Both secret values are still
            required for normal sync sign-in.
          </span>
          <button onClick={acknowledgeSyncRecoveryKey}>
            I saved my recovery key
          </button>
        </aside>
      )}
      {status.error && (
        <aside className="sync-banner sync-failure" role="alert">
          <strong>
            {status.session?.resyncRequired
              ? "Full sync needs attention"
              : "Sync needs attention"}
          </strong>
          <span>{status.error}</span>
          {status.session ? (
            <button
              disabled={status.busy}
              onClick={() => void syncNow().catch(() => {})}
            >
              Retry sync
            </button>
          ) : (
            <span>Open encrypted sync settings to sign in again.</span>
          )}
        </aside>
      )}
    </div>
  );
}
