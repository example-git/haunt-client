import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { origin } from "../../../packages/browser/src/sync/crypto";
import {
  approveWeb,
  requestHash,
  type WebRequest,
} from "../../../packages/browser/src/sync/oauth";
import {
  SyncService,
  type Session,
} from "../../../packages/browser/src/sync/service";
import { SyncAccountForm } from "../../web/src/SyncAccountForm";
import "./style.css";

function Portal() {
  const [issuer, setIssuer] = useState(
    localStorage.getItem("haunt-sync-data-origin") ?? "",
  );
  const [service, setService] = useState<SyncService>(),
    [session, setSession] = useState<Session>();
  const [request, setRequest] = useState<WebRequest>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const sender = useRef<
    { source: Window; origin: string; request: WebRequest } | undefined
  >(undefined);
  const approved = useRef<
    { service: SyncService; session: Session } | undefined
  >(undefined);
  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      if (
        approved.current &&
        sender.current &&
        event.source === sender.current.source &&
        event.origin === sender.current.origin &&
        event.data?.type === "haunt-sync-consumed" &&
        event.data.authorization_id ===
          sender.current.request.authorization_id &&
        event.data.state === sender.current.request.request.state
      ) {
        try {
          await approved.current.service.logout(approved.current.session);
          approved.current = undefined;
          setSession(undefined);
          sender.current.source.postMessage(
            {
              type: "haunt-sync-locked",
              authorization_id: sender.current.request.authorization_id,
            },
            sender.current.origin,
          );
        } catch {
          setError(
            "Web sign-in completed, but the temporary approval session could not be revoked. Use Lock and sign out to retry.",
          );
        }
        return;
      }
      if (
        !window.opener ||
        event.source !== window.opener ||
        event.data?.type !== "haunt-sync-request" ||
        sender.current
      )
        return;
      try {
        const value: WebRequest = event.data.value;
        if (
          origin(event.origin) !== value.request.client_id ||
          value.portal !== location.origin ||
          value.request.redirect_uri !==
            event.origin + "/?haunt-sync-callback=1" ||
          value.request.code_challenge_method !== "S256" ||
          !/^[A-Za-z0-9_-]{43}$/.test(value.authorization_id) ||
          !/^[A-Za-z0-9_-]{43}$/.test(value.request.state) ||
          (await requestHash(value)) !== value.request.request_hash
        )
          throw Error("Invalid requesting origin or authorization.");
        sender.current = {
          source: event.source as Window,
          origin: event.origin,
          request: value,
        };
        setRequest(value);
        // Display the requested service, but require explicit confirmation before password entry.
        setIssuer(value.issuer);
      } catch {
        setError("The requesting page supplied an invalid authorization.");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  if (window.top !== window.self)
    return (
      <main>
        <p>
          Open this trusted sign-in page directly. It cannot run in an embedded
          frame.
        </p>
      </main>
    );
  return (
    <main>
      <h1>Haunt Sync</h1>
      <p className="muted">
        Optional encrypted backups. Your master password is handled on this
        trusted page, never on a community server or the backup data service.
      </p>
      {request && (
        <section className="request">
          <h2>This server requests sync access</h2>
          <strong>{request.request.client_id}</strong>
          <p>
            It will receive only this server’s settings and saved sign-ins. Your
            complete backup, master password and other servers’ keys stay
            private.
          </p>
        </section>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!service ? (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const selected = new SyncService(issuer.trim(), location.origin);
              if (request && selected.issuer !== request.issuer)
                throw Error("The service differs from the requesting page.");
              localStorage.setItem("haunt-sync-data-origin", selected.issuer);
              setService(selected);
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Invalid service.");
            }
          }}
        >
          <label>
            Confirm your sync data service
            <input
              type="url"
              value={issuer}
              onChange={(event) => setIssuer(event.target.value)}
              required
            />
          </label>
          <button>Continue with this service</button>
        </form>
      ) : !session ? (
        <SyncAccountForm
          service={service}
          onSignIn={async (value) => {
            setSession(value);
          }}
        />
      ) : (
        <>
          <p>Backup unlocked for {session.username}.</p>
          {request ? (
            <div className="form">
              <button
                disabled={busy || !!approved.current}
                onClick={async () => {
                  if (!sender.current) return;
                  setBusy(true);
                  setError("");
                  try {
                    const result = await approveWeb(
                      service,
                      session,
                      sender.current.request,
                      sender.current.origin,
                    );
                    approved.current = { service, session };
                    sender.current.source.postMessage(
                      { type: "haunt-sync-approved", value: result },
                      sender.current.origin,
                    );
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Approval failed.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Allow sync for {request.request.client_id}
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  sender.current?.source.postMessage(
                    { type: "haunt-sync-denied" },
                    sender.current.origin,
                  );
                  await service.logout(session);
                  setSession(undefined);
                  window.close();
                }}
              >
                Decline / lock and sign out
              </button>
            </div>
          ) : (
            <>
              <p>
                Install Haunt desktop to restore and synchronize all your
                servers.
              </p>
              <button
                onClick={async () => {
                  await service.logout(session);
                  setSession(undefined);
                }}
              >
                Lock and sign out
              </button>
            </>
          )}
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Portal />);
