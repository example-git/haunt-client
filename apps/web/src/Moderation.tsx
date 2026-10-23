import { copyText } from "./clipboard";
import { UserName } from "./UserName";
import { useEffect, useState } from "react";
import {
  api,
  serverOrigin,
  unwrap,
  type InstanceClient,
  type Schemas,
} from "@haunt/core";
import { MenuAction } from "./ContextMenu";
import { ServerSettings, Status, useAction } from "./Customization";

import {
  Permission,
  can,
  canManageServer,
  canManageMembers,
} from "./Permissions";
export {
  Permission,
  can,
  canManageServer,
  canManageMembers,
} from "./Permissions";
export function ModerationMenu({
  instance,
  user,
}: {
  instance: InstanceClient;
  user: string;
}) {
  if (
    !canManageMembers(instance) ||
    user === instance.account.login.user.id ||
    instance.snapshot.users.find((u) => u.id === user)?.is_owner
  )
    return null;
  return (
    <MenuAction
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("haunt:moderate", { detail: { instance, user } }),
        )
      }
    >
      Manage member
    </MenuAction>
  );
}
export function ModerationHost() {
  const [target, setTarget] = useState<{
    instance: InstanceClient;
    user: string;
  }>();
  useEffect(() => {
    const open = (e: Event) => setTarget((e as CustomEvent).detail);
    window.addEventListener("haunt:moderate", open);
    return () => window.removeEventListener("haunt:moderate", open);
  }, []);
  return target ? (
    <ServerSettings
      instance={target.instance}
      initialTab="members"
      initialMemberID={target.user}
      onClose={() => setTarget(undefined)}
    />
  ) : null;
}
export function MemberActions({
  instance,
  member,
  onChange,
}: {
  instance: InstanceClient;
  member: Schemas["IdentityMember"];
  onChange: () => Promise<void>;
}) {
  const [choice, setChoice] = useState<
      "kick" | "ban" | "delete" | "restore" | "password"
    >(),
    [temporary, setTemporary] = useState(""),
    [reason, setReason] = useState(""),
    [ips, setIPs] = useState<Schemas["IdentityMemberIP"][]>(),
    action = useAction();
  const protectedMember =
    member.is_owner ||
    member.id === instance.account.login.user.id ||
    (!instance.account.login.user.is_owner &&
      member.role_position >= instance.snapshot.rolePosition) ||
    member.deleted;
  useEffect(() => {
    setChoice(undefined);
    setTemporary("");
    setReason("");
    setIPs(undefined);
  }, [member.id]);
  return (
    <section className="moderation-actions">
      <h3>Moderation</h3>
      <p className="muted">
        {member.deleted
          ? "Deleted account"
          : member.banned
            ? "Account banned"
            : member.kicked
              ? "Kicked — a new invitation is required to return"
              : member.disabled
                ? "Account disabled"
                : "Active account"}
      </p>
      {!protectedMember && (
        <div className="button-row">
          {can(instance, 128) && !member.kicked && (
            <button className="secondary" onClick={() => setChoice("kick")}>
              Kick member
            </button>
          )}
          {can(instance, 256) && !member.banned && (
            <button className="danger" onClick={() => setChoice("ban")}>
              Ban account
            </button>
          )}
          {can(instance, 256) && (member.kicked || member.disabled) && (
            <button className="secondary" onClick={() => setChoice("restore")}>
              Restore access
            </button>
          )}
          {can(instance, 8192) && (
            <button
              className="secondary"
              onClick={() => {
                setChoice("password");
                setTemporary("");
              }}
            >
              Reset password
            </button>
          )}
          {can(instance, 512) && (
            <button className="danger" onClick={() => setChoice("delete")}>
              Delete account
            </button>
          )}
        </div>
      )}
      {choice && (
        <form
          className="form danger-zone"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              if (choice === "password") {
                const result = await unwrap(
                  instance.http.POST(
                    "/api/v1/admin/members/{id}/password-reset",
                    {
                      params: { path: { id: member.id } },
                      body: { reason },
                    },
                  ),
                );
                setTemporary(result.temporary_password);
              } else
                await unwrap(
                  instance.http.POST("/api/v1/admin/members/{id}/moderate", {
                    params: { path: { id: member.id } },
                    body: { action: choice, reason },
                  }),
                );
              setChoice(undefined);
              setReason("");
              await onChange();
              await instance.refreshAfterChange();
            }, "Member updated.");
          }}
        >
          <strong>
            {choice === "password"
              ? "Reset password for "
              : choice === "delete"
                ? "Permanently delete "
                : `Confirm ${choice} for `}
            <UserName
              instance={instance}
              user={instance.snapshot.users.find(
                (user) => user.id === member.id,
              )}
            >
              @{member.username}
            </UserName>
            {choice === "password" || choice === "delete" ? "?" : ""}
          </strong>
          <p className="muted">
            {choice === "password"
              ? "Signs out every device and creates a temporary password shown once. The member must choose a new password at their next sign-in. Bans and disabled access remain in effect."
              : choice === "delete"
                ? "Removes credentials, profile, roles and device sessions. Existing messages remain attributed to Deleted user. This cannot be undone."
                : choice === "kick"
                  ? "Disconnects all devices and removes assigned roles. Returning requires the existing password and a new invitation."
                  : choice === "ban"
                    ? "Disconnects all devices and blocks this account until the ban is lifted."
                    : "Restores a kicked or disabled account. Any active ban must be lifted separately."}
          </p>
          <label>
            Reason
            <textarea
              required
              maxLength={512}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="button-row">
            <button className="danger" disabled={action.busy || !reason.trim()}>
              {choice === "password"
                ? "Issue temporary password"
                : `Confirm ${choice}`}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setChoice(undefined)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {temporary && (
        <div className="temporary-password" role="status">
          <label>
            Temporary password
            <input
              value={temporary}
              readOnly
              autoComplete="off"
              onFocus={(e) => e.target.select()}
            />
          </label>
          <p className="muted">
            Share this privately with{" "}
            <UserName
              instance={instance}
              user={instance.snapshot.users.find(
                (user) => user.id === member.id,
              )}
            >
              @{member.username}
            </UserName>
            . It is shown only here and stops working when they choose a new
            password.
          </p>
          <button
            className="secondary"
            onClick={() =>
              void action.run(async () => {
                await copyText(temporary);
              }, "Temporary password copied.")
            }
          >
            Copy temporary password
          </button>
          <button className="text-button" onClick={() => setTemporary("")}>
            Dismiss
          </button>
        </div>
      )}
      {can(instance, 2048) && !member.deleted && (
        <>
          <button
            className="text-button"
            disabled={action.busy}
            onClick={() =>
              void action.run(
                async () =>
                  setIPs(
                    (
                      await unwrap(
                        instance.http.GET("/api/v1/admin/members/{id}/ips", {
                          params: { path: { id: member.id } },
                        }),
                      )
                    ).ips ?? [],
                  ),
                "",
              )
            }
          >
            Show recorded IP addresses
          </button>
          {ips && (
            <div className="moderation-records">
              {ips.length === 0 ? (
                <p className="muted">No addresses recorded yet.</p>
              ) : (
                ips.map((ip) => (
                  <div key={ip.ip}>
                    <code>{ip.ip}</code>
                    <small>
                      First {new Date(ip.first_seen).toLocaleString()} · Last{" "}
                      {new Date(ip.last_seen).toLocaleString()}
                    </small>
                  </div>
                ))
              )}
              <small>
                Last 32 addresses, retained up to 90 days. Visible only with
                permission.
              </small>
            </div>
          )}
        </>
      )}
      <Status action={action} />
    </section>
  );
}
export function BanManager({ instance }: { instance: InstanceClient }) {
  const [bans, setBans] = useState<Schemas["IdentityBan"][]>([]),
    [appeals, setAppeals] = useState<Schemas["IdentityAppeal"][]>([]),
    [banMore, setBanMore] = useState(false),
    [appealMore, setAppealMore] = useState(false),
    [network, setNetwork] = useState(""),
    [reason, setReason] = useState(""),
    [revoke, setRevoke] = useState<string>(),
    action = useAction();
  const loadBans = async (after = "") => {
    const v =
      (
        await unwrap(
          instance.http.GET("/api/v1/admin/bans", {
            params: { query: { after } },
          }),
        )
      ).bans ?? [];
    setBans((old) => (after ? [...old, ...v] : v));
    setBanMore(v.length === 100);
  };
  const loadAppeals = async (after = "") => {
    const v =
      (
        await unwrap(
          instance.http.GET("/api/v1/admin/appeals", {
            params: { query: { after } },
          }),
        )
      ).appeals ?? [];
    setAppeals((old) => (after ? [...old, ...v] : v));
    setAppealMore(v.length === 100);
  };
  useEffect(() => {
    void action.run(async () => {
      await loadBans();
      await loadAppeals();
    }, "");
  }, [instance]);
  return (
    <section>
      <h3>Bans & appeals</h3>
      {can(instance, 2048) && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await unwrap(
                instance.http.POST("/api/v1/admin/bans", {
                  body: { network, reason },
                }),
              );
              setNetwork("");
              setReason("");
              await loadBans();
            }, "IP ban added.");
          }}
        >
          <label>
            IP address or CIDR range
            <input
              aria-label="IP address or CIDR range"
              required
              maxLength={64}
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
            />
          </label>
          <label>
            Reason
            <textarea
              required
              maxLength={512}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p className="muted">
            A range blocks every matching address, including people sharing a
            network. Known owner and higher-ranked member addresses are
            protected.
          </p>
          <button className="danger" disabled={action.busy || !reason.trim()}>
            Ban address or range
          </button>
        </form>
      )}
      <h4>Active bans</h4>
      <div className="moderation-records">
        {bans.length === 0 && <p className="muted">No active bans.</p>}
        {bans.map((b) => (
          <div key={b.id}>
            <strong>
              {b.network ??
                (b.user_id ? (
                  <UserName
                    instance={instance}
                    user={instance.snapshot.users.find(
                      (u) => u.id === b.user_id,
                    )}
                  >
                    {instance.snapshot.users.find((u) => u.id === b.user_id)
                      ?.username ?? b.user_id}
                  </UserName>
                ) : (
                  "IP ban"
                ))}
            </strong>
            <p>{b.reason}</p>
            <small>{new Date(b.created_at).toLocaleString()}</small>
            {(b.user_id || can(instance, 2048)) && (
              <button
                className="text-button"
                onClick={() => {
                  setRevoke(b.id);
                  setReason("");
                }}
              >
                Lift ban
              </button>
            )}
          </div>
        ))}
      </div>
      {banMore && (
        <button
          className="secondary"
          disabled={action.busy}
          onClick={() => void action.run(() => loadBans(bans.at(-1)?.id), "")}
        >
          Load more bans
        </button>
      )}
      {revoke && (
        <form
          className="form danger-zone"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await unwrap(
                instance.http.POST("/api/v1/admin/bans/{id}/revoke", {
                  params: { path: { id: revoke } },
                  body: { reason },
                }),
              );
              setRevoke(undefined);
              setReason("");
              await loadBans();
            }, "Ban lifted.");
          }}
        >
          <label>
            Reason for lifting ban
            <textarea
              required
              maxLength={512}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={action.busy || !reason.trim()}
            >
              Confirm lift ban
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setRevoke(undefined)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <h4>Appeals</h4>
      <div className="moderation-records">
        {appeals.length === 0 && <p className="muted">No appeals.</p>}
        {appeals.map((a) => (
          <div key={a.id}>
            <small>
              Ban {a.ban_id} · {new Date(a.created_at).toLocaleString()}
            </small>
            <p className="plain-text">{a.body}</p>
            {a.reviewed_at ? (
              <small>Reviewed {new Date(a.reviewed_at).toLocaleString()}</small>
            ) : (
              <button
                className="secondary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await unwrap(
                      instance.http.POST("/api/v1/admin/appeals/{id}/review", {
                        params: { path: { id: a.id } },
                      }),
                    );
                    await loadAppeals();
                  }, "Appeal marked reviewed. The ban remains in effect.")
                }
              >
                Mark reviewed
              </button>
            )}
          </div>
        ))}
      </div>
      {appealMore && (
        <button
          className="secondary"
          disabled={action.busy}
          onClick={() =>
            void action.run(() => loadAppeals(appeals.at(-1)?.id), "")
          }
        >
          Load more appeals
        </button>
      )}
      <Status action={action} />
    </section>
  );
}
const auditLabels: Record<string, string> = {
  "voice.mute": "Voice member muted",
  "voice.unmute": "Moderator mute removed",
  "voice.deafen": "Voice member deafened",
  "voice.undeafen": "Moderator deafen removed",
  "member.kick": "Member kicked",
  "member.ban": "Account banned",
  "member.delete": "Account deleted",
  "member.restore": "Account restored",
  "member.roles": "Member roles updated",
  "member.ips.read": "IP history viewed",
  "role.save": "Role updated",
  "role.delete": "Role deleted",
  "network.ban": "IP range banned",
  "ban.revoke": "Ban lifted",
  "ban.appeal": "Appeal submitted",
  "appeal.review": "Appeal reviewed",
  "message.delete": "Channel message deleted",
  "auth.login.failed": "Failed sign-in",
  "auth.register.failed": "Failed registration",
  "access.unauthorized": "Invalid or expired session",
  "access.forbidden": "Permission denied",
  "access.banned": "Banned access blocked",
  "gateway.unauthorized": "Invalid gateway session",
  "settings.put": "Settings updated",
  "settings.post": "Settings created",
  "settings.delete": "Settings removed",
};
export function AuditLog({ instance }: { instance: InstanceClient }) {
  const [entries, setEntries] = useState<Schemas["IdentityAuditEntry"][]>([]),
    [more, setMore] = useState(false),
    action = useAction();
  const load = async (before = 0) => {
    const v =
      (
        await unwrap(
          instance.http.GET("/api/v1/admin/audit", {
            params: { query: { before } },
          }),
        )
      ).entries ?? [];
    setEntries((old) => (before ? [...old, ...v] : v));
    setMore(v.length === 100);
  };
  useEffect(() => {
    void action.run(() => load(), "");
  }, [instance]);
  return (
    <section>
      <div className="panel-title">
        <h3>Audit log</h3>
        <button
          className="secondary"
          disabled={action.busy}
          onClick={() => void action.run(() => load(), "")}
        >
          Refresh audit log
        </button>
      </div>
      <p className="muted">
        Moderation and settings changes, plus sampled denied access attempts. Up
        to 10,000 recent records, retained for 90 days; cleanup runs every
        minute.
      </p>
      <div className="moderation-records">
        {entries.length === 0 && <p className="muted">No recorded events.</p>}
        {entries.map((e) => (
          <div key={e.id}>
            <strong>{auditLabels[e.action] ?? e.action}</strong>
            <small>
              {new Date(e.created_at).toLocaleString()} ·{" "}
              <UserName
                instance={instance}
                user={instance.snapshot.users.find((u) => u.id === e.actor_id)}
              >
                {instance.snapshot.users.find((u) => u.id === e.actor_id)
                  ?.username ??
                  (e.actor_id ? "Deleted member" : "Unauthenticated")}
              </UserName>
            </small>
            {e.target_id && (
              <span>
                Target:{" "}
                <UserName
                  instance={instance}
                  user={instance.snapshot.users.find(
                    (u) => u.id === e.target_id,
                  )}
                >
                  {instance.snapshot.users.find((u) => u.id === e.target_id)
                    ?.username ?? e.target_id}
                </UserName>
              </span>
            )}
            {e.reason && <p className="plain-text">{e.reason}</p>}
            {e.ip && <code>{e.ip}</code>}
          </div>
        ))}
      </div>
      {more && (
        <button
          className="secondary"
          disabled={action.busy}
          onClick={() => void action.run(() => load(entries.at(-1)?.id), "")}
        >
          Load older events
        </button>
      )}
      <Status action={action} />
    </section>
  );
}
export function BanAppealPanel({
  server,
  ticket,
}: {
  server: string;
  ticket: string;
}) {
  const [status, setStatus] = useState<Schemas["IdentityBanStatus"]>(),
    [body, setBody] = useState(""),
    [sent, setSent] = useState(false),
    action = useAction();
  const http = () =>
    api(serverOrigin(server), { fetch: globalThis.fetch.bind(globalThis) });
  useEffect(() => {
    void action.run(
      async () =>
        setStatus(
          await unwrap(
            http().POST("/api/v1/auth/ban/status", {
              body: { appeal_ticket: ticket },
            }),
          ),
        ),
      "",
    );
  }, [server, ticket]);
  return (
    <section className="ban-appeal">
      <h3>{status?.ban_type === "ip" ? "Network ban" : "Account ban"}</h3>
      {status && (
        <>
          <p className="plain-text">{status.reason}</p>
          {!status.active ? (
            <p>The ban has been lifted. You can sign in again.</p>
          ) : sent ? (
            <p role="status">Appeal submitted.</p>
          ) : status.next_appeal_at &&
            Date.parse(status.next_appeal_at) > Date.now() ? (
            <p>
              You can appeal again after{" "}
              {new Date(status.next_appeal_at).toLocaleString()}.
            </p>
          ) : (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  await unwrap(
                    http().POST("/api/v1/auth/ban/appeal", {
                      body: { appeal_ticket: ticket, body },
                    }),
                  );
                  setSent(true);
                }, "");
              }}
            >
              <label>
                Appeal
                <textarea
                  required
                  minLength={10}
                  maxLength={1000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <small>
                One appeal per 30 days for this ban. Plain text, 10–1,000
                characters, no URLs or attachments.
              </small>
              <button className="primary" disabled={action.busy}>
                Submit appeal
              </button>
            </form>
          )}
        </>
      )}
      <Status action={action} />
    </section>
  );
}
