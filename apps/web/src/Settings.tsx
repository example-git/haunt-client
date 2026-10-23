import { UserName } from "./UserName";
import { DMStorageMeter } from "./DMStorage";
import { NoiseControls, useAudioPlugins } from "./NoiseControls";
import { copyText } from "./clipboard";
import { ClientSettingsContent, clientSettingsTabs } from "./ClientSettings";
import { SettingsNavigation } from "./SettingsNavigation";
import { useEffect, useState, type FormEvent } from "react";
import { Copy, LogOut, Monitor, Plus, Trash2 } from "lucide-react";
import {
  friendlyError,
  inviteLink,
  unwrap,
  type InstanceClient,
  type Schemas,
} from "@haunt/core";
import { ErrorNotice, Modal } from "./App";
import { ProfileEditor } from "./Customization";
import { Avatar, displayName } from "./People";
import type { Call } from "@haunt/browser/media/call";
export function AccountSettings({
  instance,
  logout,
  onClose,
  initialTab = "profile",
  onTabChange,
  instances = [instance],
  call,
}: {
  instance: InstanceClient;
  logout: () => Promise<void>;
  onClose: () => void;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
  instances?: InstanceClient[];
  call?: Call;
}) {
  const audioPlugins = useAudioPlugins(instance);
  const [selectedTab, setTab] = useState(initialTab),
    [sessions, setSessions] = useState<Schemas["IdentitySession"][]>([]),
    [invites, setInvites] = useState<Schemas["IdentityInvite"][]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false);
  const tab =
    selectedTab === "audio-plugins" && !audioPlugins.length
      ? "devices"
      : selectedTab;
  const canInvite =
    !!(instance.snapshot.permissions & 8) ||
    instance.account.login.user.is_owner;
  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    if (tab === "account") {
      setSessions(
        (await unwrap(instance.http.GET("/api/v1/sessions"))).sessions ?? [],
      );
    }
    if (tab === "invites")
      setInvites(
        (await unwrap(instance.http.GET("/api/v1/invites"))).invites ?? [],
      );
  };
  useEffect(() => {
    void load().catch((e) => setError(friendlyError(e)));
  }, [tab]);
  return (
    <Modal title="User settings" onClose={onClose} wide settings>
      <div className="settings-layout user-settings-layout">
        <SettingsNavigation
          scope={instance.account.instance.name}
          selected={tab}
          items={[
            ["profile", "Profile"],
            ["account", "Account"],
            ...(canInvite ? [["invites", "Invitations"]] : []),
            ...clientSettingsTabs
              .filter(
                ([id]) => id !== "updates" || !!window.hauntDesktop?.updates,
              )
              .filter(
                ([id]) => id !== "audio-plugins" || audioPlugins.length > 0,
              ),
          ].map(([id, label]) => [id, label] as const)}
          onSelect={(id) => {
            setTab(id);
            onTabChange?.(id);
            setError("");
            setNotice("");
          }}
        />
        <div className="settings-content" key={tab}>
          {tab === "audio-plugins" && <NoiseControls instance={instance} />}
          {[
            "appearance",
            "notifications",
            "devices",
            "narrator",
            "servers",
            "backups",
            "sync",
            "updates",
          ].includes(tab) && (
            <ClientSettingsContent
              key={tab}
              instances={instances}
              instance={instance}
              tab={tab}
              call={call}
            />
          )}
          <ErrorNotice error={error} />
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          {tab === "profile" && <ProfileEditor instance={instance} />}
          {tab === "account" && (
            <>
              <DMStorageMeter instance={instance} />
              <div className="account-summary">
                <Avatar
                  instance={instance}
                  user={instance.account.login.user}
                />
                <div>
                  <strong>
                    <UserName
                      instance={instance}
                      user={instance.account.login.user}
                    />
                  </strong>
                  <small>{instance.origin}</small>
                </div>
              </div>
              <h3>Signed-in devices</h3>
              <label className="remember-device">
                <input
                  type="checkbox"
                  checked={!!instance.account.remember}
                  disabled={busy}
                  onChange={(event) => {
                    const remember = event.target.checked;
                    void run(async () => {
                      await instance.setRemember(remember);
                      await load();
                    });
                  }}
                />
                Remember this device
              </label>
              <p className="muted">
                {instance.account.instance.capabilities?.includes(
                  "sessions.persistent",
                )
                  ? "Saved logins stay signed in until you sign out or access is revoked."
                  : "This server still applies its session expiry to saved logins."}
              </p>
              <div className="device-list">
                {sessions.map((s) => (
                  <div key={s.id}>
                    <Monitor size={19} />
                    <div>
                      <strong>{s.device_name}</strong>
                      <small>
                        {s.id === instance.account.login.session.id
                          ? "This device · "
                          : ""}
                        {s.expires_at
                          ? `Expires ${new Date(s.expires_at).toLocaleDateString()}`
                          : "Stays signed in"}
                      </small>
                    </div>
                    {s.id !== instance.account.login.session.id && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await unwrap(
                              instance.http.DELETE("/api/v1/sessions/{id}", {
                                params: { path: { id: s.id } },
                              }),
                            );
                            await load();
                          })
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <details>
                <summary>Change password</summary>
                <p className="muted">
                  Changing your password signs out every device, including this
                  one.
                </p>
                <form
                  className="form"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void run(async () => {
                      await unwrap(
                        instance.http.PUT("/api/v1/me/password", {
                          body: {
                            current_password: String(data.get("current")),
                            new_password: String(data.get("new")),
                          },
                        }),
                      );
                      await instance.connect();
                      await logout();
                      onClose();
                    });
                  }}
                >
                  <label>
                    Current password
                    <input
                      name="current"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                  <label>
                    New password
                    <input
                      name="new"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </label>
                  <button className="secondary" disabled={busy}>
                    Change password
                  </button>
                </form>
              </details>
              <p className="muted small">
                Message history is stored on this device, separately for each
                account. Browser sign-in lasts for this browser session. Desktop
                sign-in uses the OS credential store when available.
              </p>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await logout();
                    onClose();
                  })
                }
              >
                <LogOut size={16} />
                {instance.snapshot.status === "signed-out"
                  ? "Remove expired sign-in"
                  : "Sign out of this server"}
              </button>
            </>
          )}
          {tab === "invites" && (
            <>
              <p className="muted">
                Invite someone into {instance.account.instance.name}. The invite
                link is shown only when you create it.
              </p>
              <form
                className="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void run(async () => {
                    const invite = await unwrap(
                      instance.http.POST("/api/v1/invites", {
                        body: {
                          uses: Number(data.get("uses")),
                          expires_in_hours: Number(data.get("hours")),
                        },
                      }),
                    );
                    setToken(inviteLink(instance.origin, invite.token ?? ""));
                    await load();
                  });
                }}
              >
                <div className="form-columns">
                  <label>
                    Uses
                    <input
                      name="uses"
                      type="number"
                      min={1}
                      max={100}
                      defaultValue={1}
                      required
                    />
                  </label>
                  <label>
                    Expires in hours
                    <input
                      name="hours"
                      type="number"
                      min={1}
                      max={720}
                      defaultValue={24}
                      required
                    />
                  </label>
                </div>
                <button className="primary" disabled={busy}>
                  <Plus size={16} />
                  Create invitation
                </button>
              </form>
              {token && (
                <div className="invite-code">
                  <code>{token}</code>
                  <button
                    className="icon"
                    aria-label="Copy invite link"
                    onClick={async () => {
                      try {
                        await copyText(token);
                        setNotice("Invite link copied.");
                      } catch {
                        setNotice("Select the invitation text to copy it.");
                      }
                    }}
                  >
                    <Copy size={17} />
                  </button>
                </div>
              )}
              <h3>Active invitations</h3>
              <div className="device-list">
                {invites.map((i) => (
                  <div key={i.id}>
                    <div>
                      <strong>{i.remaining_uses} uses remaining</strong>
                      <small>
                        Expires {new Date(i.expires_at).toLocaleString()}
                      </small>
                    </div>
                    <button
                      className="icon"
                      aria-label="Revoke invitation"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await unwrap(
                            instance.http.DELETE("/api/v1/invites/{id}", {
                              params: { path: { id: i.id } },
                            }),
                          );
                          await load();
                        })
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
