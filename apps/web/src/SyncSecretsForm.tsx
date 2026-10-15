import { useState, useSyncExternalStore } from "react";
import { changeSyncSecrets, subscribeSync, syncStatus } from "./sync-runtime";

export function SyncSecretsForm() {
  const status = useSyncExternalStore(subscribeSync, syncStatus);
  const [error, setError] = useState(""),
    [recoveryKey, setRecoveryKey] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details>
      <summary>Change sync password or private keyword</summary>
      <p>
        This re-encrypts every stored snapshot, signs out other sync devices,
        and forces a full resync. Keep a local backup until it finishes. You
        will receive a new offline recovery key.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {recoveryKey && (
        <section role="status">
          <strong>Full resync completed. Save your new recovery key.</strong>
          <code>{recoveryKey}</code>
          <p>
            Your previous recovery key no longer unlocks the synchronized copy.
          </p>
          <button onClick={() => setRecoveryKey("")}>
            I saved my new recovery key
          </button>
        </section>
      )}
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            values = new FormData(form);
          setError("");
          setBusy(true);
          try {
            const password = String(values.get("newPassword"));
            if (password !== String(values.get("confirm")))
              throw Error("The new master passwords do not match.");
            setRecoveryKey(
              await changeSyncSecrets(
                String(values.get("currentPassword")),
                String(values.get("currentKeyword")),
                password,
                String(values.get("newKeyword")),
              ),
            );
            form.reset();
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Secret change or full resync failed. Your local data is unchanged.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Current master password
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
          />
        </label>
        {status.session?.derivation === "secret-pair-v1" && (
          <label>
            Current private sync keyword
            <input
              name="currentKeyword"
              type="password"
              required
              autoComplete="off"
            />
          </label>
        )}
        <label>
          New master password
          <input
            name="newPassword"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirm new master password
          <input
            name="confirm"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
          />
        </label>
        <label>
          New private sync keyword
          <input
            name="newKeyword"
            type="password"
            required
            autoComplete="off"
          />
        </label>
        <button disabled={busy || status.busy || !!recoveryKey}>
          {busy
            ? "Changing secrets and resyncing…"
            : "Change secrets and fully resync"}
        </button>
      </form>
    </details>
  );
}
