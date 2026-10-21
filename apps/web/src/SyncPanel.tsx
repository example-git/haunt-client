import { useState, useSyncExternalStore } from "react";
import { multiServerClient } from "@haunt/browser/client-context";
import { BrowserSyncPairing, DesktopSyncPairing } from "./SyncPairing";
import { SyncSecretsForm } from "./SyncSecretsForm";
import { SyncService } from "@haunt/browser/sync/service";
import { SyncAccountForm } from "./SyncAccountForm";
import {
  disableSync,
  enableSync,
  subscribeSync,
  syncNow,
  syncStatus,
} from "./sync-runtime";

export function SyncBanner() {
  if (multiServerClient()) return null;
  return (
    <aside className="sync-banner">
      <strong>Your servers, together</strong>
      <span>
        This web client syncs only this server. Install Haunt desktop to sync
        all your servers and sign-ins under one master password.
      </span>
      <a
        href="https://github.com/example-git/haunt/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
      >
        Get Haunt desktop
      </a>
    </aside>
  );
}
export function SyncPanel() {
  const status = useSyncExternalStore(subscribeSync, syncStatus);
  const [issuer, setIssuer] = useState(
    localStorage.getItem("haunt-sync-issuer") ?? "",
  );
  const [service, setService] = useState<SyncService>();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [devices, setDevices] =
    useState<{ id: string; name: string; scope: string; origin: string }[]>();
  const [emailChallenge, setEmailChallenge] = useState("");
  const refreshDevices = async () => {
    const current = status.session!;
    setDevices(
      (
        await new SyncService(current.issuer, current.portal).request<{
          devices: NonNullable<typeof devices>;
        }>("/v1/devices", "GET", undefined, current.keys, current.token)
      ).devices,
    );
  };
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="form sync-panel" aria-label="Optional encrypted sync">
      <h3>Encrypted sync · optional</h3>
      <p className="muted">
        Choose your group’s sync service to keep settings and saved sign-ins in
        sync. Community accounts work without it; working settings stay on this
        device.
      </p>
      <SyncBanner />
      {(error || status.error) && (
        <p className="error" role="alert">
          {error || status.error}
        </p>
      )}
      {status.session ? (
        <>
          <p>
            Connected to <strong>{status.session.issuer}</strong>
          </p>
          <p className="muted small">
            {status.session.scope === "full"
              ? "All servers on this client"
              : "Only " + status.session.origin}
            . Sync runs every minute while this client is open. This session
            stays signed in until you sign out or revoke it.
          </p>
          {status.lastSync && (
            <p role="status">Last synchronized: {status.lastSync}</p>
          )}
          {status.notice && <p role="status">{status.notice}</p>}
          {status.conflict && (
            <div className="sync-conflict">
              <button
                disabled={busy || status.busy}
                onClick={() => void run(() => syncNow("local"))}
              >
                Keep this device’s conflicting changes
              </button>
              <button
                disabled={busy || status.busy}
                onClick={() => void run(() => syncNow("cloud"))}
              >
                Keep the sync copy’s conflicting changes
              </button>
            </div>
          )}
          <button
            disabled={busy || status.busy}
            onClick={() => void run(() => syncNow())}
          >
            {status.busy ? "Syncing…" : "Sync now"}
          </button>
          <button
            disabled={busy || status.busy}
            onClick={() => void run(disableSync)}
          >
            Sign out of sync
          </button>
          {status.session.scope === "full" && (
            <>
              <DesktopSyncPairing session={status.session} />
              <SyncSecretsForm />
              <button disabled={busy} onClick={() => void run(refreshDevices)}>
                Signed-in sync devices
              </button>
              {devices?.map((device) => (
                <div className="sync-device" key={device.id}>
                  <span>
                    {device.name} ·{" "}
                    {device.origin ||
                      (device.scope === "email"
                        ? "Email recovery"
                        : "Trusted client")}
                    {device.id === status.session!.device
                      ? " · this device"
                      : ""}
                  </span>
                  {device.id !== status.session!.device && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const current = status.session!;
                          await new SyncService(
                            current.issuer,
                            current.portal,
                          ).request(
                            "/v1/devices/" + device.id,
                            "DELETE",
                            undefined,
                            current.keys,
                            current.token,
                          );
                          await refreshDevices();
                        })
                      }
                    >
                      Revoke device
                    </button>
                  )}
                </div>
              ))}
              <details>
                <summary>Add or update a recovery email</summary>
                <form
                  className="form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void run(async () => {
                      const current = status.session!,
                        selected = new SyncService(
                          current.issuer,
                          current.portal,
                        ),
                        email = String(form.get("email"));
                      if (!emailChallenge) {
                        setEmailChallenge(
                          (
                            await selected.emailStart(
                              email,
                              "link",
                              current.keys,
                            )
                          ).challenge_id,
                        );
                        return;
                      }
                      const url = new URL(String(form.get("verification"))),
                        values = new URLSearchParams(url.hash.slice(1));
                      if (
                        url.origin !== current.issuer ||
                        values.get("issuer") !== current.issuer ||
                        values.get("email_id") !== emailChallenge
                      )
                        throw Error(
                          "The email link does not match this request.",
                        );
                      const ticket = await selected.emailVerify(
                        emailChallenge,
                        values.get("email_token") ?? "",
                        current.keys,
                      );
                      await selected.request(
                        "/v1/email/link",
                        "POST",
                        { email, email_ticket: ticket.email_ticket },
                        current.keys,
                        current.token,
                      );
                      setEmailChallenge("");
                    });
                  }}
                >
                  <label>
                    Recovery email
                    <input
                      type="email"
                      name="email"
                      required
                      onChange={() => setEmailChallenge("")}
                    />
                  </label>
                  {emailChallenge && (
                    <>
                      <p>
                        Paste the verification link from your email. Your
                        offline recovery key is still required if you forget the
                        master password.
                      </p>
                      <label>
                        Verification link
                        <input type="url" name="verification" required />
                      </label>
                    </>
                  )}
                  <button disabled={busy}>
                    {emailChallenge
                      ? "Verify and save email"
                      : "Send verification email"}
                  </button>
                </form>
              </details>
            </>
          )}
        </>
      ) : (
        <>
          <p className="muted small">
            Sync is off. Choose your group’s sync service. Encryption and
            decryption happen in the client; the service stores encrypted data.
          </p>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              try {
                const selected = new SyncService(issuer.trim());
                setService(selected);
                localStorage.setItem("haunt-sync-issuer", selected.issuer);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Invalid sync service.",
                );
              }
            }}
          >
            <label>
              Sync data service
              <input
                type="url"
                value={issuer}
                onChange={(event) => {
                  setIssuer(event.target.value);
                  setService(undefined);
                }}
                placeholder="https://sync.your-domain.example"
                required
              />
            </label>
            <button>Choose this sync service</button>
          </form>
          {service &&
            (multiServerClient() ? (
              <SyncAccountForm service={service} onSignIn={enableSync} />
            ) : (
              <BrowserSyncPairing service={service} onSignIn={enableSync} />
            ))}
        </>
      )}
    </section>
  );
}
