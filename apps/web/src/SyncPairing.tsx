import { useState } from "react";
import {
  approvePairing,
  beginWebPairing,
  pairingFingerprint,
  parsePairingRequest,
  type WebRequest,
} from "@haunt/browser/sync/oauth";
import { SyncService, type Session } from "@haunt/browser/sync/service";

export function BrowserSyncPairing({
  service,
  onSignIn,
}: {
  service: SyncService;
  onSignIn: (session: Session) => Promise<void>;
}) {
  const [pair, setPair] =
    useState<Awaited<ReturnType<typeof beginWebPairing>>>();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form" aria-label="Pair this browser">
      <p>
        Approve this browser from your signed-in Haunt desktop. It receives only
        this server’s key. Your master password and private keyword stay on
        desktop.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => setPair(await beginWebPairing(service)))
        }
      >
        {pair
          ? "Start a new pairing request"
          : "Pair this browser with desktop"}
      </button>
      {pair && (
        <>
          <p>
            Keep this tab open. In desktop sync settings, open Approve browser
            access and paste this request. Check that both clients show{" "}
            <strong>{pair.request.request.client_id}</strong> and the same
            fingerprint: <code>{pairingFingerprint(pair.request)}</code>.
            Requests expire after five minutes.
          </p>
          <label>
            Browser pairing request
            <textarea
              aria-label="Browser pairing request"
              readOnly
              value={pair.requestCode}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const code = String(
                new FormData(e.currentTarget).get("approval"),
              );
              void run(async () => onSignIn(await pair.complete(code)));
            }}
          >
            <label>
              Desktop approval code
              <textarea
                aria-label="Desktop approval code"
                name="approval"
                required
                autoComplete="off"
              />
            </label>
            <button disabled={busy}>Finish browser pairing</button>
          </form>
        </>
      )}
    </section>
  );
}
export function DesktopSyncPairing({ session }: { session: Session }) {
  const [text, setText] = useState(""),
    [request, setRequest] = useState<WebRequest>(),
    [approval, setApproval] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details>
      <summary>Approve browser access</summary>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setApproval("");
          try {
            const value = await parsePairingRequest(text);
            if (value.issuer !== session.issuer)
              throw Error("Choose the same sync instance on both devices.");
            setRequest(value);
          } catch (e) {
            setRequest(undefined);
            setError(
              e instanceof Error ? e.message : "Invalid pairing request.",
            );
          }
        }}
      >
        <label>
          Browser pairing request
          <textarea
            aria-label="Browser pairing request"
            value={text}
            required
            onChange={(e) => {
              setText(e.target.value);
              setRequest(undefined);
              setApproval("");
            }}
          />
        </label>
        <button disabled={busy}>Review browser request</button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {request && (
        <section className="form">
          <p>
            Requested server: <strong>{request.request.client_id}</strong>
          </p>
          <p>
            Sync instance: {request.issuer}. Fingerprint:{" "}
            <code>{pairingFingerprint(request)}</code>
          </p>
          <p>
            Confirm the server and fingerprint match the browser. Approval
            shares only this server’s key, never either secret or your other
            servers’ keys.
          </p>
          <button
            disabled={busy || !!approval}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setApproval(await approvePairing(session, text));
              } catch (e) {
                setError(e instanceof Error ? e.message : "Approval failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve {request.request.client_id}
          </button>
        </section>
      )}
      {approval && (
        <label>
          Desktop approval code
          <textarea
            aria-label="Desktop approval code"
            readOnly
            value={approval}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      )}
    </details>
  );
}
