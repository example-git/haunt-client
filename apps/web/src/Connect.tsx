import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  APIError,
  PasswordChangeRequired,
  friendlyError,
  parseAccountAddress,
  parseInviteLink,
  signinAddress,
  type InstanceClient,
  type Invitation,
  type KnownServer,
} from "@haunt/core";
import { client, knownServers } from "./runtime";
import { Modal, ErrorNotice } from "./App";
import { BanAppealPanel } from "./Moderation";
import { SyncPanel, SyncBanner } from "./SyncPanel";
import { desktopClient } from "@haunt/browser/client-context";

function initialAccount(origin?: string, username?: string) {
  if (!origin) return "";
  try {
    return signinAddress(parseInviteLink(origin)?.origin ?? origin, username);
  } catch {
    return origin;
  }
}

export function Connect({
  onClose,
  onConnect,
  initial,
}: {
  onClose: () => void;
  onConnect: (instance: InstanceClient) => void;
  initial?: { origin: string; username?: string; instanceId?: string };
}) {
  const [address, setAddress] = useState(initial?.origin ?? ""),
    [username, setUsername] = useState(initial?.username ?? ""),
    [account, setAccount] = useState(() =>
      initialAccount(initial?.origin, initial?.username),
    ),
    [https, setHTTPS] = useState(!initial?.origin.startsWith("http://")),
    [expected, setExpected] = useState(initial?.instanceId),
    [saved, setSaved] = useState<KnownServer[]>([]),
    [invitation, setInvitation] = useState<Invitation>(),
    [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reset, setReset] = useState<PasswordChangeRequired>(),
    [ban, setBan] = useState<{ server: string; ticket: string }>();
  const pending = useRef<PasswordChangeRequired | undefined>(undefined);
  let signin: ReturnType<typeof parseAccountAddress> | undefined;
  try {
    signin = parseAccountAddress(account, https);
  } catch {
    // Incomplete input is normal while typing. Report errors only on submit.
  }
  const savedSignin = saved.findIndex(
    (s) => s.origin === signin?.origin && s.username === signin?.username,
  );
  const useServer = (origin: string, name: string) => {
    setAddress(origin);
    setUsername(name);
    setAccount(signinAddress(origin, name));
    setHTTPS(new URL(origin).protocol === "https:");
  };
  const addressChanged = (value: string) => {
    if (register) setAddress(value);
    else setAccount(value);
    setExpected(undefined);
    setInvitation(undefined);
    setError("");
    try {
      const invite = parseInviteLink(value);
      if (invite) {
        setInvitation(invite);
        setAddress(invite.origin);
        setHTTPS(new URL(invite.origin).protocol === "https:");
        setRegister(true);
      }
    } catch (e) {
      setError(friendlyError(e));
    }
  };
  const changeMode = () => {
    if (register) {
      setAccount(initialAccount(address, username));
      setHTTPS(!address.startsWith("http://"));
    } else if (signin) {
      setAddress(signin.origin);
      setUsername(signin.username);
    }
    setRegister(!register);
    setError("");
    setBan(undefined);
  };
  useEffect(() => {
    void knownServers
      .list()
      .then(setSaved)
      .catch((e) => setError(friendlyError(e)));
    if (initial?.origin.includes("#")) addressChanged(initial.origin);
    return () => {
      void pending.current?.cancel();
    };
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setBan(undefined);
    const form = new FormData(event.currentTarget);
    let destination = address;
    try {
      if (reset) {
        const password = String(form.get("new"));
        if (password !== form.get("confirm"))
          throw Error("The passwords do not match.");
        const instance = await reset.complete(password);
        pending.current = undefined;
        onConnect(instance);
      } else {
        const target = register
          ? { origin: address.trim(), username }
          : parseAccountAddress(account, https);
        if (!desktopClient() && target.origin !== location.origin)
          throw Error(
            "This web client signs in only to this server. Install Haunt desktop to add other servers.",
          );
        destination = target.origin;
        const instance = await client.login(
          target.origin,
          {
            username: target.username,
            password: String(form.get("password")),
            device_name: window.hauntDesktop ? "Desktop" : "Browser",
            remember: form.get("remember") === "on",
            ...(register
              ? {
                  invitation:
                    invitation?.token ?? String(form.get("invitation")),
                }
              : {}),
          },
          register,
          expected,
        );
        void navigator.storage?.persist?.().catch(() => {});
        onConnect(instance);
      }
    } catch (e) {
      if (e instanceof PasswordChangeRequired) {
        pending.current = e;
        setReset(e);
      } else {
        setError(friendlyError(e));
        if (e instanceof APIError && e.details?.appeal_ticket)
          setBan({ server: destination, ticket: e.details.appeal_ticket });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        reset
          ? "Choose a new password"
          : register
            ? "Join server"
            : "Connect to a server"
      }
      onClose={onClose}
      wide={desktopClient()}
    >
      <div className={desktopClient() ? "connect-sync-columns" : ""}>
        <section>
          {reset ? (
            <p className="muted">
              Your administrator reset the password for @{reset.username} on{" "}
              <strong>{reset.origin}</strong>. Choose your own password to
              finish signing in.
            </p>
          ) : (
            <p className="muted">
              {register
                ? "Use your invitation to create an account on this server."
                : "Sign in with username@serveraddress, or paste an invite link to join."}
            </p>
          )}
          {!reset && !register && saved.length > 0 && (
            <label className="form">
              Saved sign-ins
              <select
                aria-label="Saved sign-ins"
                value={savedSignin}
                onChange={(e) => {
                  const value = saved[Number(e.target.value)];
                  if (!value) return;
                  useServer(value.origin, value.username);
                  setExpected(value.instanceId);
                  setInvitation(undefined);
                  setRegister(false);
                  setError("");
                }}
              >
                <option value={-1}>Choose a server and account</option>
                {saved.map((s, i) => (
                  <option key={`${s.origin}/${s.username}`} value={i}>
                    {signinAddress(s.origin, s.username)} · {s.name}
                  </option>
                ))}
              </select>
              {savedSignin >= 0 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={async () => {
                    const selected = saved[savedSignin];
                    await knownServers.remove(
                      selected.origin,
                      selected.username,
                    );
                    setSaved(await knownServers.list());
                  }}
                >
                  Forget saved sign-in
                </button>
              )}
            </label>
          )}
          <form className="form" onSubmit={submit}>
            {reset ? (
              <>
                <label>
                  New password
                  <input
                    name="new"
                    type="password"
                    minLength={8}
                    required
                    autoFocus
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    name="confirm"
                    type="password"
                    minLength={8}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <small className="muted">
                  At least 8 characters. Your temporary password will stop
                  working.
                </small>
              </>
            ) : (
              <>
                {!register ? (
                  <>
                    <label>
                      Account address
                      <input
                        name="account"
                        value={account}
                        onChange={(e) => addressChanged(e.target.value)}
                        placeholder="username@serveraddress"
                        autoFocus
                        required
                        autoComplete="username"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </label>
                    <label className="remember-device">
                      <input
                        type="checkbox"
                        name="https"
                        checked={https}
                        onChange={(e) => {
                          setHTTPS(e.target.checked);
                          setExpected(undefined);
                          setInvitation(undefined);
                          setError("");
                        }}
                      />
                      Use HTTPS
                    </label>
                    {!https && (
                      <small className="muted">
                        HTTP is available for localhost and private-network IP
                        addresses.
                      </small>
                    )}
                  </>
                ) : invitation ? (
                  <div className="invite-destination">
                    <strong>{invitation.origin}</strong>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setInvitation(undefined);
                        setAccount(initialAccount(address, username));
                        setRegister(false);
                      }}
                    >
                      Change server
                    </button>
                  </div>
                ) : (
                  <label>
                    Server address
                    <input
                      name="server"
                      value={address}
                      onChange={(e) => addressChanged(e.target.value)}
                      placeholder="Server address or invite link"
                      autoFocus
                      required
                      autoComplete="url"
                    />
                  </label>
                )}
                {register && (
                  <label>
                    Username
                    <input
                      name="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      pattern="[a-zA-Z0-9_]{3,32}"
                      autoComplete="username"
                    />
                  </label>
                )}
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={register ? 8 : undefined}
                    autoComplete={
                      register ? "new-password" : "current-password"
                    }
                  />
                </label>
                {register && (
                  <small className="muted">At least 8 characters.</small>
                )}
                {register && !invitation && (
                  <label>
                    Invitation code
                    <input name="invitation" required autoComplete="off" />
                  </label>
                )}
                <label className="remember-device">
                  <input name="remember" type="checkbox" defaultChecked />
                  Remember this device
                </label>
              </>
            )}
            <ErrorNotice error={error} />
            <button className="primary" disabled={busy}>
              {busy
                ? "Connecting…"
                : reset
                  ? "Change password and sign in"
                  : register
                    ? "Create account"
                    : "Sign in"}
            </button>
            {!reset && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={changeMode}
              >
                {register
                  ? "Already have an account? Sign in"
                  : "Have an invitation? Create an account"}
              </button>
            )}
          </form>
          {ban && <BanAppealPanel server={ban.server} ticket={ban.ticket} />}
        </section>
        {desktopClient() && (
          <aside>
            <SyncPanel />
          </aside>
        )}
      </div>
      <SyncBanner />
    </Modal>
  );
}
