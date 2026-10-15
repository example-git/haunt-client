import { useRef, useState, type FormEvent } from "react";
import { proofKeys, type ProofKeys } from "@haunt/browser/sync/crypto";
import { SyncService, type Session } from "@haunt/browser/sync/service";

export function SyncAccountForm({
  service,
  onSignIn,
}: {
  service: SyncService;
  onSignIn: (session: Session) => Promise<void>;
}) {
  const [mode, setMode] = useState<"signin" | "register" | "recovery">(
    "signin",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [recoveryKey, setRecoveryKey] = useState("");
  const [emailChallenge, setEmailChallenge] = useState("");
  const keys = useRef<ProofKeys | undefined>(undefined);
  const verified = useRef<string | undefined>(undefined);
  const emailSession = useRef<
    Awaited<ReturnType<SyncService["emailLogin"]>> | undefined
  >(undefined);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const element = event.currentTarget,
      form = new FormData(element);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const username = String(form.get("username")).trim().toLowerCase(),
        password = String(form.get("password"));
      keys.current ??= await proofKeys();
      let ticket: string | undefined;
      if (
        mode === "recovery" ||
        (mode === "register" && username.includes("@"))
      ) {
        if (!emailChallenge) {
          const reply = await service.emailStart(
            username,
            mode === "register" ? "registration" : "recovery",
            keys.current,
          );
          setEmailChallenge(reply.challenge_id);
          setNotice(
            "Check your email. Paste the verification link here to continue.",
          );
          return;
        }
        if (!verified.current) {
          const link = new URL(String(form.get("emailLink")));
          const fields = new URLSearchParams(link.hash.slice(1));
          if (
            link.origin !== service.portal ||
            fields.get("issuer") !== service.issuer ||
            fields.get("email_id") !== emailChallenge
          )
            throw Error("The verification link does not match this request.");
          verified.current = (
            await service.emailVerify(
              emailChallenge,
              fields.get("email_token") ?? "",
              keys.current,
            )
          ).email_ticket;
        }
        ticket = verified.current;
      }
      if (mode === "register") {
        if (password !== String(form.get("confirm")))
          throw Error("The master passwords do not match.");
        const result = await service.register(
          username,
          password,
          keys.current,
          ticket,
        );
        setRecoveryKey(result.recoveryKey);
        setNotice(
          "Save this recovery key somewhere private. Email recovery cannot unlock your backup without it.",
        );
        setMode("signin");
        setEmailChallenge("");
        // Keep the recovery key on screen until explicitly acknowledged.
        return;
      }
      const session =
        mode === "recovery"
          ? await service.recover(
              emailSession.current ??
                (emailSession.current = await service.emailLogin(
                  ticket!,
                  keys.current,
                )),
              keys.current,
              String(form.get("recoveryKey")).trim(),
              password,
            )
          : await service.signIn(username, password, keys.current);
      element.reset();
      await onSignIn(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sync-account">
      <div className="tabs">
        {(["signin", "register", "recovery"] as const).map((value) => (
          <button
            type="button"
            key={value}
            className={value === mode ? "active" : ""}
            disabled={busy}
            onClick={() => {
              setMode(value);
              setEmailChallenge("");
              verified.current = undefined;
              emailSession.current = undefined;
              setError("");
            }}
          >
            {value === "signin"
              ? "Sign in"
              : value === "register"
                ? "Create sync account"
                : "Email recovery"}
          </button>
        ))}
      </div>
      {recoveryKey && (
        <section className="sync-recovery" role="status">
          <strong>Save your recovery key</strong>
          <code>{recoveryKey}</code>
          <p>
            Keep it outside this device. Anyone with this key and email access
            can restore your backup.
          </p>
          <button
            type="button"
            onClick={() => {
              setRecoveryKey("");
              setNotice("");
            }}
          >
            I saved my recovery key
          </button>
        </section>
      )}
      <form className="form" onSubmit={submit}>
        <label>
          {mode === "recovery" ? "Verified email" : "Sync username or email"}
          <input
            name="username"
            type={mode === "recovery" ? "email" : "text"}
            required
            autoComplete="username"
            onChange={() => {
              setEmailChallenge("");
              verified.current = undefined;
              emailSession.current = undefined;
            }}
          />
        </label>
        <label>
          {mode === "recovery" ? "New master password" : "Master password"}
          <input
            name="password"
            type="password"
            required
            minLength={mode === "signin" ? undefined : 12}
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
          />
        </label>
        {mode === "register" && (
          <label>
            Confirm master password
            <input
              name="confirm"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
            />
          </label>
        )}
        {mode === "recovery" && (
          <label>
            Offline recovery key
            <input name="recoveryKey" required autoComplete="off" />
          </label>
        )}
        {emailChallenge && (
          <label>
            Verification link from your email
            <input name="emailLink" type="url" required autoComplete="off" />
          </label>
        )}
        <p className="muted small">
          Your master password stays in this trusted client. The sync operator
          stores encrypted backups.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <button disabled={busy || !!recoveryKey}>
          {busy
            ? "Working…"
            : emailChallenge
              ? "Verify and continue"
              : mode === "register"
                ? "Create sync account"
                : mode === "recovery"
                  ? "Start email recovery"
                  : "Sign in and restore"}
        </button>
      </form>
    </section>
  );
}
