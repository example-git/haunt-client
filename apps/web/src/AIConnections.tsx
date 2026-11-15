import { useEffect, useRef, useState } from "react";
import {
  type AIAccount,
  type AIOAuthSession,
  type AIProvider,
  type InstanceClient,
} from "@haunt/core";
import { Status, useAction } from "./Customization";
import { can, Permission } from "./Permissions";
const integrations: [AIProvider, string][] = [
  ["claude", "Claude OAuth"],
  ["codex", "Codex / ChatGPT OAuth"],
  ["antigravity", "Antigravity OAuth"],
];
export function AIConnections({
  instance,
  onChange,
}: {
  instance: InstanceClient;
  onChange?: () => void;
}) {
  const [accounts, setAccounts] = useState<AIAccount[]>([]);
  const [provider, setProvider] = useState<AIProvider>("claude");
  const [pending, setPending] = useState<AIOAuthSession>();
  const [paste, setPaste] = useState("");
  const reserved = useRef<string | undefined>(undefined);
  const action = useAction();
  const desktop = window.hauntDesktop?.aiOAuth;
  const permitted = can(instance, Permission.ManageConfiguration);
  const reload = async () => {
    const data = await instance.ai.request<{ accounts: AIAccount[] }>(
      "/api/v1/ai/accounts",
    );
    setAccounts(data.accounts);
    onChange?.();
  };
  useEffect(() => {
    if (permitted) void action.run(reload, "");
    return () => {
      if (reserved.current)
        void desktop?.cancel(reserved.current).catch(() => {});
    };
  }, [instance, permitted]);
  if (!permitted) return null;
  const complete = async (
    session: AIOAuthSession,
    code: string,
    state: string,
  ) => {
    await instance.ai.request(
      `/api/v1/ai/oauth/${session.id}/complete`,
      "POST",
      { code, state },
    );
    setPending(undefined);
    setPaste("");
    if (reserved.current)
      await desktop?.cancel(reserved.current).catch(() => {});
    reserved.current = undefined;
    await reload();
  };
  const connect = async (kind: AIProvider, account_id?: string) => {
    if (!desktop) throw Error("Connect this account from Haunt desktop.");
    const reservation = await desktop.reserve(kind);
    reserved.current = reservation.id;
    try {
      const session = await instance.ai.request<AIOAuthSession>(
        "/api/v1/ai/oauth/start",
        "POST",
        {
          provider: kind,
          redirect_uri: reservation.redirect_uri,
          ...(account_id ? { account_id } : {}),
        },
      );
      const result = await desktop.launch(
        reservation.id,
        session.authorization_url,
      );
      if (result.paste) setPending(session);
      else if (result.code && result.state)
        await complete(session, result.code, result.state);
      else throw Error("The provider did not return an authorization code.");
    } catch (error) {
      await desktop.cancel(reservation.id).catch(() => {});
      reserved.current = undefined;
      throw error;
    }
  };
  return (
    <section className="form">
      <h3>AI connections</h3>
      <p className="muted">
        Accounts are shared through authorized AI channels. The server stores
        credentials and refreshes connections.
      </p>
      {!desktop && (
        <p>
          Use Haunt desktop to connect or reconnect an account. Configured AI
          channels work in this browser.
        </p>
      )}
      {accounts.map((account) => (
        <div className="ai-account" key={account.id}>
          <strong>{account.label || account.provider}</strong>
          <span> · {account.status}</span>
          <div className="button-row">
            <button
              disabled={!desktop || action.busy}
              onClick={() =>
                void action.run(
                  () => connect(account.provider, account.id),
                  "Connection updated.",
                )
              }
            >
              Reconnect
            </button>
            <button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await instance.ai.request(
                    `/api/v1/ai/accounts/${account.id}`,
                    "DELETE",
                  );
                  await reload();
                }, "Account disconnected.")
              }
            >
              Disconnect
            </button>
          </div>
        </div>
      ))}
      <label>
        Integration
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as AIProvider)}
        >
          {integrations.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="primary"
        disabled={!desktop || action.busy || !!pending}
        onClick={() => void action.run(() => connect(provider), "")}
      >
        {action.busy ? "Connecting…" : "Connect account"}
      </button>
      {pending && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(
              () => complete(pending, paste.trim(), pending.state),
              "Account connected.",
            );
          }}
        >
          <label>
            Authorization code or callback URL
            <input
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <p className="muted">
            Copy the code or complete address from the provider callback page.
          </p>
          <div className="button-row">
            <button disabled={action.busy}>Finish connection</button>
            <button
              type="button"
              onClick={() => {
                if (reserved.current)
                  void desktop?.cancel(reserved.current).catch(() => {});
                reserved.current = undefined;
                setPending(undefined);
                setPaste("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <Status action={action} />
    </section>
  );
}
