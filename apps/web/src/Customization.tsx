import { Permission } from "./Permissions";
import { UserName } from "./UserName";
import { AudioPluginsAdmin } from "./AudioPluginsAdmin";
import { ServerExtensionsAdmin } from "./ServerExtensionsAdmin";
import { SettingsNavigation } from "./SettingsNavigation";
import { useServerMenu, MenuLoadStatus, ServerMenuPage } from "./ServerMenus";
import { ServerConfiguration, StorageSettings } from "./ServerConfiguration";
import {
  ChannelIconPicker,
  channelIconKey,
  type ChannelIconKey,
} from "./ChannelIcon";
import {
  can,
  canManageMembers,
  MemberActions,
  BanManager,
  AuditLog,
} from "./Moderation";
import { EmojiSettings } from "./Emojis";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Plus, Settings, Upload } from "lucide-react";
import {
  friendlyError,
  unwrap,
  type InstanceClient,
  type Schemas,
  type Channel,
} from "@haunt/core";
import { Modal, ErrorNotice } from "./App";
import { Avatar, displayName, useArt } from "./People";

type Role = Schemas["IdentityRole"];
const permissions = [
  [Permission.Administrator, "Administrator"],
  [1, "View channels"],
  [2, "Send messages"],
  [4, "Join voice channels"],
  [8, "Create invitations"],
  [16, "Manage channels"],
  [32, "Manage server appearance & emojis"],
  [64, "Manage lower-ranked roles"],
  [128, "Kick members"],
  [256, "Ban members & review appeals"],
  [Permission.MuteMembers, "Mute members"],
  [Permission.DeafenMembers, "Deafen members"],
  [512, "Delete accounts"],
  [1024, "View audit log"],
  [2048, "View member IPs & manage IP bans"],
  [4096, "Delete channel messages"],
  [8192, "Reset member passwords"],
  [16384, "Manage configuration, storage & extensions"],
] as const;
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const running = useRef(false);
  const run = async (
    task: () => Promise<unknown>,
    message = "Changes saved.",
  ) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      setNotice(message);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, error, notice, run };
}
export function Status({ action }: { action: ReturnType<typeof useAction> }) {
  return (
    <>
      <ErrorNotice error={action.error} />
      {action.notice && (
        <p className="success" role="status">
          {action.notice}
        </p>
      )}
    </>
  );
}
async function prepareArt(file: File, banner: boolean): Promise<Blob> {
  if (
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
      file.type,
    ) ||
    file.size > 20 * 1024 * 1024
  )
    throw Error("Choose a PNG, JPEG, WebP or GIF image up to 20 MiB.");
  if (file.type === "image/gif") return file; // Preserve every animation frame.
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = banner ? 1200 : 256;
    canvas.height = banner ? 400 : 256;
    const context = canvas.getContext("2d");
    if (!context) throw Error("Image editing is unavailable.");
    const scale = Math.max(
      canvas.width / bitmap.width,
      canvas.height / bitmap.height,
    );
    context.drawImage(
      bitmap,
      (canvas.width - bitmap.width * scale) / 2,
      (canvas.height - bitmap.height * scale) / 2,
      bitmap.width * scale,
      bitmap.height * scale,
    );
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(Error("Could not read this image.")),
        "image/png",
      ),
    );
  } finally {
    bitmap.close();
  }
}
function ArtEditor({
  instance,
  kind,
}: {
  instance: InstanceClient;
  kind: "avatar" | "icon" | "banner";
}) {
  const info = instance.account.instance,
    user = instance.account.login.user;
  const version =
    kind === "avatar"
      ? user.avatar_version
      : kind === "icon"
        ? info.icon_version
        : info.banner_version;
  const saved = useArt(
    instance,
    kind,
    version,
    kind === "avatar" ? user.id : undefined,
  );
  const [draft, setDraft] = useState<Blob>(),
    [preview, setPreview] = useState<string>();
  const action = useAction(),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!draft) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(draft);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);
  const label =
    kind === "avatar"
      ? "Profile picture"
      : kind === "icon"
        ? "Server icon"
        : "Server banner";
  return (
    <section className={`art-editor art-${kind}`}>
      <h3>{label}</h3>
      <div className="art-preview">
        {preview || saved ? (
          <img src={preview ?? saved} alt={`${label} preview`} />
        ) : (
          <span>
            {kind === "banner"
              ? ""
              : displayName(user).slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={`Upload ${kind}`}
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void action.run(
              async () => setDraft(await prepareArt(file, kind === "banner")),
              "Preview ready. Save the image to apply it.",
            );
        }}
      />
      <div className="button-row">
        <button
          className="secondary"
          type="button"
          disabled={action.busy}
          onClick={() => input.current?.click()}
        >
          <Upload size={15} />
          {saved ? "Replace image" : "Choose image"}
        </button>
        {draft && (
          <>
            <button
              type="button"
              className="primary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await instance.saveArt(kind, draft);
                  setDraft(undefined);
                }, "Image saved.")
              }
            >
              Save image
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setDraft(undefined)}
            >
              Cancel
            </button>
          </>
        )}
        {!draft && version && (
          <button
            className="text-button danger-text"
            type="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(
                () => instance.saveArt(kind, null),
                "Image removed.",
              )
            }
          >
            Remove image
          </button>
        )}
      </div>
      <small className="muted">
        GIF animation is preserved, up to 20 MiB.{" "}
        {kind === "banner"
          ? "GIF dimensions: up to 2048 × 1024."
          : "GIF dimensions: up to 1024 × 1024."}{" "}
        Static images are cropped:
        {kind === "banner"
          ? "Wide images work best. The preview uses a centered 3:1 crop."
          : "Your image will use a centered square crop."}
      </small>
      <Status action={action} />
    </section>
  );
}
export function ProfileEditor({ instance }: { instance: InstanceClient }) {
  useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  const user = instance.account.login.user,
    action = useAction();
  return (
    <div className="profile-editor">
      <p className="muted">Your profile in {instance.account.instance.name}.</p>
      <ArtEditor instance={instance} kind="avatar" />
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          void action.run(async () => {
            await unwrap(
              instance.http.PUT("/api/v1/me/profile", {
                body: {
                  display_name: String(data.get("display_name")),
                  bio: String(data.get("bio")),
                  accent_color: String(data.get("accent_color")),
                },
              }),
            );
            await instance.refreshAfterChange();
          });
        }}
      >
        <label>
          Display name
          <input
            name="display_name"
            defaultValue={user.display_name ?? ""}
            placeholder={user.username}
            maxLength={64}
          />
        </label>
        <label>
          About me
          <textarea
            name="bio"
            aria-label="About me"
            defaultValue={user.bio ?? ""}
            maxLength={500}
            rows={3}
          />
        </label>
        <label>
          Profile color
          <input
            type="color"
            name="accent_color"
            defaultValue={user.accent_color ?? "#77d9b0"}
          />
        </label>
        <p className="muted small">
          Your sign-in username is{" "}
          <UserName instance={instance} user={user}>
            @{user.username}
          </UserName>
          .
        </p>
        <Status action={action} />
        <button className="primary" disabled={action.busy}>
          {action.busy ? "Saving…" : "Save profile"}
        </button>
      </form>
    </div>
  );
}

export function ChannelSettings({
  instance,
  channel,
  onClose,
  onSaved,
  initialTab = "overview",
  initialMemberID,
  initialCategory,
}: {
  instance: InstanceClient;
  channel?: Channel;
  onClose: () => void;
  onSaved?: (id?: string) => void;
  initialTab?: string;
  initialMemberID?: string;
  initialCategory?: string;
}) {
  const [selectedTab, setTab] = useState(initialTab),
    [confirm, setConfirm] = useState(initialTab === "delete"),
    [confirmName, setConfirmName] = useState("");
  const serverMenu = useServerMenu(instance, channel?.id);
  const dynamic = !!channel && serverMenu.supported;
  const page =
    serverMenu.menu?.pages.find((p) => p.id === selectedTab) ??
    serverMenu.menu?.pages[0];
  const tab = dynamic
    ? page?.builtin
    : selectedTab === "delete"
      ? "overview"
      : selectedTab;
  const action = useAction();
  const [icon, setIcon] = useState<ChannelIconKey>(
    channelIconKey(channel?.icon),
  );
  const [kind, setKind] = useState(channel?.kind ?? "text");
  const supportsIcons = instance.account.instance.capabilities?.includes(
    "community.channel_icons",
  );
  return (
    <Modal
      title={channel ? `Channel settings · ${channel.name}` : "Create channel"}
      onClose={onClose}
    >
      <MenuLoadStatus
        state={dynamic ? serverMenu : { ...serverMenu, supported: false }}
      />
      {dynamic ? (
        <div className="tabs">
          {serverMenu.menu?.pages.map((p) => (
            <button
              key={p.id}
              className={page?.id === p.id ? "active" : ""}
              onClick={() => setTab(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="tabs">
            <button
              className={tab === "overview" ? "active" : ""}
              onClick={() => setTab("overview")}
            >
              Overview
            </button>
            {channel && (
              <button
                className={tab === "permissions" ? "active" : ""}
                onClick={() => setTab("permissions")}
              >
                Permissions
              </button>
            )}
          </div>
        </>
      )}
      {dynamic && page && (
        <ServerMenuPage
          instance={instance}
          page={page}
          onDone={() => {
            onSaved?.();
            onClose();
          }}
        />
      )}
      {tab === "permissions" && channel ? (
        <ChannelPermissions instance={instance} channel={channel} />
      ) : tab === "overview" ? (
        <>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const body = {
                name: String(data.get("name")),
                kind: String(data.get("kind")) as "text" | "voice",
                category_id: String(data.get("category")) || null,
                topic: String(data.get("topic")),
                ...(supportsIcons ? { icon } : {}),
              };
              void action.run(async () => {
                const saved = channel
                  ? await unwrap(
                      instance.http.PUT("/api/v1/channels/{id}", {
                        params: { path: { id: channel.id } },
                        body,
                      }),
                    )
                  : await unwrap(
                      instance.http.POST("/api/v1/channels", { body }),
                    );
                await instance.refreshAfterChange();
                onSaved?.(saved.id);
                onClose();
              });
            }}
          >
            <label>
              Channel name
              <input
                name="name"
                required
                maxLength={64}
                defaultValue={channel?.name}
              />
            </label>
            <label>
              Channel type
              <select
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as "text" | "voice")}
                disabled={!!channel}
              >
                <option value="text">Text</option>
                <option value="voice">Voice</option>
              </select>
              {channel && (
                <input type="hidden" name="kind" value={channel.kind} />
              )}
            </label>
            {supportsIcons && (
              <ChannelIconPicker kind={kind} value={icon} onChange={setIcon} />
            )}
            <label>
              Topic
              <textarea
                name="topic"
                aria-label="Topic"
                maxLength={512}
                rows={3}
                defaultValue={channel?.topic ?? ""}
                placeholder="What is this channel for?"
              />
            </label>
            <label>
              Category
              <select
                name="category"
                defaultValue={channel?.category_id ?? initialCategory ?? ""}
              >
                <option value="">No category</option>
                {instance.snapshot.categories.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <Status action={action} />
            <button className="primary" disabled={action.busy}>
              {channel ? "Save channel" : "Create channel"}
            </button>
          </form>
          {channel && !dynamic && (
            <div className="danger-zone">
              <h3>Delete channel</h3>
              {!confirm ? (
                <button className="danger" onClick={() => setConfirm(true)}>
                  Delete channel
                </button>
              ) : (
                <>
                  <p>
                    Delete <strong>{channel.name}</strong> and its server
                    history? This cannot be undone. Type the channel name to
                    confirm.
                  </p>
                  <input
                    aria-label="Confirm channel name"
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                  />
                  <div className="button-row">
                    <button
                      className="danger"
                      disabled={action.busy || confirmName !== channel.name}
                      onClick={() =>
                        void action.run(async () => {
                          await unwrap(
                            instance.http.DELETE("/api/v1/channels/{id}", {
                              params: { path: { id: channel.id } },
                            }),
                          );
                          await instance.refreshAfterChange();
                          onSaved?.();
                          onClose();
                        })
                      }
                    >
                      Permanently delete channel
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      ) : null}
    </Modal>
  );
}
function ChannelPermissions({
  instance,
  channel,
}: {
  instance: InstanceClient;
  channel: Channel;
}) {
  const [roles, setRoles] = useState<Role[]>([]),
    [overrides, setOverrides] = useState<Schemas["IdentityOverride"][]>([]),
    [selected, setSelected] = useState(""),
    [allow, setAllow] = useState(0),
    [deny, setDeny] = useState(0);
  const action = useAction();
  useEffect(() => {
    void action.run(async () => {
      const [r, o] = await Promise.all([
        unwrap(instance.http.GET("/api/v1/roles")),
        unwrap(
          instance.http.GET("/api/v1/channels/{id}/permissions", {
            params: { path: { id: channel.id } },
          }),
        ),
      ]);
      setRoles(r.roles ?? []);
      setOverrides(o.overrides ?? []);
      setSelected(r.roles?.[0]?.id ?? "");
    }, "");
  }, [channel.id]);
  useEffect(() => {
    const v = overrides.find((o) => o.role_id === selected);
    setAllow(v?.allow ?? 0);
    setDeny(v?.deny ?? 0);
  }, [selected, overrides]);
  return (
    <div className="form">
      <p className="muted">
        Choose a role and override its access here. Inherit uses the server role
        and category permissions. A deny wins when a member has multiple roles.
      </p>
      <label>
        Role
        <select
          aria-label="Role"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.is_default ? " · everyone" : ""}
            </option>
          ))}
        </select>
      </label>
      {permissions
        .filter(([bit]) => bit <= 4)
        .map(([bit, label]) => (
          <label className="permission-row" key={bit}>
            <span>{label}</span>
            <select
              aria-label={label}
              value={deny & bit ? "deny" : allow & bit ? "allow" : "inherit"}
              onChange={(e) => {
                setAllow((v) =>
                  e.target.value === "allow" ? v | bit : v & ~bit,
                );
                setDeny((v) =>
                  e.target.value === "deny" ? v | bit : v & ~bit,
                );
              }}
            >
              <option value="inherit">Inherit</option>
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
            </select>
          </label>
        ))}
      <Status action={action} />
      <button
        className="primary"
        disabled={action.busy || !selected}
        onClick={() =>
          void action.run(async () => {
            await unwrap(
              instance.http.PUT("/api/v1/channels/{id}/permissions/{role}", {
                params: { path: { id: channel.id, role: selected } },
                body: { allow, deny },
              }),
            );
            setOverrides((v) => [
              ...v.filter((o) => o.role_id !== selected),
              { role_id: selected, allow, deny },
            ]);
            await instance.refreshAfterChange();
          }, "Channel permissions saved.")
        }
      >
        Save permissions
      </button>
    </div>
  );
}

export function ServerSettings({
  instance,
  onClose,
  initialTab = "overview",
  initialMemberID,
}: {
  instance: InstanceClient;
  initialTab?: string;
  initialMemberID?: string;
  onClose: () => void;
}) {
  useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  const fallbackTabs = [
    ...(can(instance, Permission.ManageConfiguration) &&
    instance.account.instance.capabilities?.includes("server.extensions.v1")
      ? [["server-extensions", "Server extensions"]]
      : []),
    ...(can(instance, 16384) &&
    instance.account.instance.capabilities?.includes("instance.configuration")
      ? [
          ["configuration", "Limits & access"],
          ["storage", "Storage providers"],
        ]
      : []),
    ...(can(instance, 32)
      ? [
          ["overview", "Overview & appearance"],
          ["emojis", "Emojis"],
        ]
      : []),
    ...(can(instance, 16) ? [["channels", "Channels & categories"]] : []),
    ...(can(instance, 64) ? [["roles", "Roles & permissions"]] : []),
    ...(canManageMembers(instance) ? [["members", "Members"]] : []),
    ...(can(instance, 256) ? [["bans", "Bans & appeals"]] : []),
    ...(can(instance, 1024) ? [["audit", "Audit log"]] : []),
  ];
  const serverMenu = useServerMenu(instance);
  const tabs = serverMenu.supported
    ? (serverMenu.menu?.pages.map((p) => [p.id, p.label]) ?? [])
    : fallbackTabs;
  const [selectedTab, setTab] = useState(initialTab),
    [editing, setEditing] = useState<Channel>(),
    [creating, setCreating] = useState(false);
  const info = instance.account.instance,
    action = useAction();
  const selectedID = tabs.some(([id]) => id === selectedTab)
    ? selectedTab
    : tabs[0]?.[0];
  const page = serverMenu.menu?.pages.find((p) => p.id === selectedID);
  const tab = serverMenu.supported ? page?.builtin : selectedID;
  if (editing || creating)
    return (
      <ChannelSettings
        instance={instance}
        channel={editing}
        onClose={() => {
          setEditing(undefined);
          setCreating(false);
        }}
      />
    );
  return (
    <Modal title="Server settings" onClose={onClose} wide settings>
      <div className="settings-layout">
        <SettingsNavigation
          kind="server"
          scope={info.name}
          selected={selectedID}
          items={tabs.map(([id, label]) => [id, label] as const)}
          onSelect={setTab}
        />
        <div className="settings-content" key={selectedID}>
          <MenuLoadStatus state={serverMenu} />
          {page && <ServerMenuPage instance={instance} page={page} />}
          {tab === "configuration" && (
            <ServerConfiguration instance={instance} />
          )}
          {tab === "storage" && <StorageSettings instance={instance} />}
          {tab === "audio-plugins" && <AudioPluginsAdmin instance={instance} />}
          {tab === "server-extensions" && (
            <ServerExtensionsAdmin
              key={`${instance.scope}:${page?.extension_id ?? ""}`}
              instance={instance}
              extensionID={page?.extension_id}
              onReload={serverMenu.retry}
            />
          )}
          {tab === "bans" && <BanManager instance={instance} />}
          {tab === "audit" && <AuditLog instance={instance} />}
          {tab === "emojis" && <EmojiSettings instance={instance} />}
          {tab === "overview" && (
            <>
              <form
                className="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void action.run(async () => {
                    await unwrap(
                      instance.http.PUT("/api/v1/instance/settings", {
                        body: {
                          name: String(data.get("name")),
                          description: String(data.get("description")),
                          accent_color: String(data.get("accent_color")),
                        },
                      }),
                    );
                    await instance.refreshAfterChange();
                  }, "Server settings saved.");
                }}
              >
                <h3>Server identity</h3>
                <label>
                  Server name
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={info.name}
                  />
                </label>
                <label>
                  Server description
                  <textarea
                    name="description"
                    aria-label="Server description"
                    maxLength={1000}
                    rows={3}
                    defaultValue={info.description ?? ""}
                  />
                </label>
                <label>
                  Server accent color
                  <input
                    type="color"
                    name="accent_color"
                    defaultValue={info.accent_color ?? "#77d9b0"}
                  />
                </label>
                <Status action={action} />
                <button className="primary" disabled={action.busy}>
                  Save server settings
                </button>
              </form>
              <ArtEditor instance={instance} kind="icon" />
              <ArtEditor instance={instance} kind="banner" />
            </>
          )}
          {tab === "channels" && (
            <>
              <div className="panel-title">
                <h3>Channels</h3>
                <button className="secondary" onClick={() => setCreating(true)}>
                  <Plus size={16} /> Create channel
                </button>
              </div>
              <div className="settings-list">
                {instance.snapshot.channels.map((c) => (
                  <button
                    key={c.id}
                    className="settings-list-row"
                    onClick={() => setEditing(c)}
                  >
                    <span>
                      <strong>{c.name}</strong>
                      <small>
                        {c.kind}
                        {c.category_id
                          ? ` · ${instance.snapshot.categories.find((v) => v.id === c.category_id)?.name ?? "Category"}`
                          : ""}
                      </small>
                    </span>
                    <Settings size={17} />
                  </button>
                ))}
              </div>
              <CategoryManager instance={instance} />
            </>
          )}
          {tab === "roles" && <RoleManager instance={instance} />}
          {tab === "members" && (
            <MemberManager instance={instance} initialID={initialMemberID} />
          )}
        </div>
      </div>
    </Modal>
  );
}
function CategoryManager({ instance }: { instance: InstanceClient }) {
  const [id, setID] = useState(""),
    [name, setName] = useState(""),
    [confirm, setConfirm] = useState(false),
    action = useAction();
  return (
    <section className="category-manager">
      <h3>Categories</h3>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            if (id)
              await unwrap(
                instance.http.PUT("/api/v1/categories/{id}", {
                  params: { path: { id } },
                  body: { name },
                }),
              );
            else
              await unwrap(
                instance.http.POST("/api/v1/categories", { body: { name } }),
              );
            await instance.refreshAfterChange();
            setName("");
            setID("");
          });
        }}
      >
        <label>
          Category
          <select
            aria-label="Category"
            value={id}
            onChange={(e) => {
              setID(e.target.value);
              setName(
                instance.snapshot.categories.find(
                  (c) => c.id === e.target.value,
                )?.name ?? "",
              );
              setConfirm(false);
            }}
          >
            <option value="">New category</option>
            {instance.snapshot.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category name
          <input
            value={name}
            maxLength={64}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Status action={action} />
        <div className="button-row">
          <button className="secondary" disabled={action.busy}>
            {id ? "Save category" : "Create category"}
          </button>
          {id && (
            <button
              type="button"
              className="text-button danger-text"
              onClick={() => setConfirm(true)}
            >
              Delete category
            </button>
          )}
        </div>
      </form>
      {confirm && (
        <div className="danger-zone">
          <p>Delete this category? Its channels will become uncategorized.</p>
          <button
            className="danger"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await unwrap(
                  instance.http.DELETE("/api/v1/categories/{id}", {
                    params: { path: { id } },
                  }),
                );
                await instance.refreshAfterChange();
                setID("");
                setName("");
                setConfirm(false);
              }, "Category deleted.")
            }
          >
            Confirm category deletion
          </button>
          <button className="text-button" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
function RoleManager({ instance }: { instance: InstanceClient }) {
  const [roles, setRoles] = useState<Role[]>([]),
    [id, setID] = useState(""),
    [name, setName] = useState(""),
    [bits, setBits] = useState(7),
    [position, setPosition] = useState(1),
    [displaySeparately, setDisplaySeparately] = useState(false),
    [confirm, setConfirm] = useState(false),
    action = useAction();
  const load = async () =>
    setRoles((await unwrap(instance.http.GET("/api/v1/roles"))).roles ?? []);
  useEffect(() => {
    void action.run(load, "");
  }, []);
  const role = roles.find((r) => r.id === id);
  const supportsSections = instance.account.instance.capabilities?.includes(
    "community.role_sections",
  );
  const displaySettings = supportsSections
    ? { display_separately: displaySeparately }
    : {};
  return (
    <section>
      <h3>Roles & permissions</h3>
      <p className="muted">
        The everyone role applies to every member. Additional roles add
        permissions; channel overrides can allow or deny access.
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const saved = id
              ? await unwrap(
                  instance.http.PUT("/api/v1/roles/{id}", {
                    params: { path: { id } },
                    body: {
                      name,
                      permissions: bits,
                      position,
                      ...displaySettings,
                    },
                  }),
                )
              : await unwrap(
                  instance.http.POST("/api/v1/roles", {
                    body: {
                      name,
                      permissions: bits,
                      position,
                      ...displaySettings,
                    },
                  }),
                );
            await load();
            setID(saved.id);
            await instance.refreshAfterChange();
          }, "Role saved.");
        }}
      >
        <label>
          Role
          <select
            aria-label="Role"
            value={id}
            onChange={(e) => {
              const selected = roles.find((r) => r.id === e.target.value);
              setID(e.target.value);
              setName(selected?.name ?? "");
              setBits(selected?.permissions ?? 7);
              setPosition(selected?.position ?? 1);
              setDisplaySeparately(selected?.display_separately ?? false);
              setConfirm(false);
            }}
          >
            <option value="">Create a new role</option>
            {roles.map((r) => (
              <option
                key={r.id}
                value={r.id}
                disabled={
                  !instance.account.login.user.is_owner &&
                  ((r.is_default && !can(instance, Permission.Administrator)) ||
                    r.position >= instance.snapshot.rolePosition)
                }
              >
                {r.name}
                {r.is_default ? " (everyone)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role name
          <input
            value={name}
            required
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Role rank
          <input
            type="number"
            min={role?.is_default ? 0 : 1}
            max={
              instance.account.login.user.is_owner
                ? 1000
                : Math.max(1, instance.snapshot.rolePosition - 1)
            }
            disabled={role?.is_default}
            value={role?.is_default ? 0 : position}
            onChange={(e) => setPosition(Number(e.target.value))}
          />
          <small>
            Higher-ranked roles can moderate lower-ranked members. Equal ranks
            cannot moderate each other.
          </small>
        </label>
        {supportsSections && (
          <div>
            <label className="device-toggle">
              <span>Display members separately</span>
              <input
                type="checkbox"
                checked={displaySeparately}
                onChange={(e) => setDisplaySeparately(e.target.checked)}
              />
            </label>
            <p className="muted small">
              Online members appear under their highest-ranked role with this
              option enabled. Offline members stay in Offline.
            </p>
          </div>
        )}
        <fieldset className="permission-checks">
          <legend>Server permissions</legend>
          {permissions
            .filter(
              ([bit]) =>
                bit !== Permission.Administrator ||
                instance.account.instance.capabilities?.includes(
                  "community.administrator",
                ),
            )
            .map(([bit, label]) => (
              <label key={bit}>
                <input
                  type="checkbox"
                  checked={!!(bits & (bit | Permission.Administrator))}
                  disabled={
                    !can(instance, bit) ||
                    (bit !== Permission.Administrator &&
                      !!(bits & Permission.Administrator))
                  }
                  onChange={(e) =>
                    setBits((v) => (e.target.checked ? v | bit : v & ~bit))
                  }
                />
                {label}
              </label>
            ))}
        </fieldset>
        {!!(bits & Permission.Administrator) && (
          <p className="muted small">
            Administrator grants every server permission, including extensions,
            and bypasses channel permission overrides. Role ranking still
            applies.
          </p>
        )}
        <Status action={action} />
        <div className="button-row">
          <button className="primary" disabled={action.busy}>
            {id ? "Save role" : "Create role"}
          </button>
          {role && !role.is_default && (
            <button
              type="button"
              className="text-button danger-text"
              onClick={() => setConfirm(true)}
            >
              Delete role
            </button>
          )}
        </div>
      </form>
      {confirm && (
        <div className="danger-zone">
          <p>
            Delete {role?.name}? Members will lose permissions granted by this
            role.
          </p>
          <button
            className="danger"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await unwrap(
                  instance.http.DELETE("/api/v1/roles/{id}", {
                    params: { path: { id } },
                  }),
                );
                await load();
                setID("");
                setName("");
                setBits(7);
                setPosition(1);
                setDisplaySeparately(false);
                setConfirm(false);
                await instance.refreshAfterChange();
              }, "Role deleted.")
            }
          >
            Confirm role deletion
          </button>
          <button className="text-button" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
function MemberManager({
  instance,
  initialID = "",
}: {
  instance: InstanceClient;
  initialID?: string;
}) {
  const [members, setMembers] = useState<Schemas["IdentityMember"][]>([]),
    [roles, setRoles] = useState<Role[]>([]),
    [id, setID] = useState(initialID),
    [assigned, setAssigned] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    action = useAction();
  const load = async () => {
    const all: Schemas["IdentityMember"][] = [];
    let after = "";
    for (;;) {
      const page =
        (
          await unwrap(
            instance.http.GET("/api/v1/members", {
              params: { query: { after } },
            }),
          )
        ).members ?? [];
      all.push(...page);
      if (page.length < 100) break;
      after = page[page.length - 1].id;
    }
    setMembers(all);
    if (id) setAssigned(all.find((m) => m.id === id)?.role_ids ?? []);
    setRoles((await unwrap(instance.http.GET("/api/v1/roles"))).roles ?? []);
  };
  useEffect(() => {
    void action.run(load, "");
  }, []);
  const selected = members.find((m) => m.id === id);
  return (
    <section>
      <h3>Members</h3>
      <label className="form">
        Find a member
        <input
          aria-label="Find a member"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Username or display name"
        />
      </label>
      <div className="settings-list">
        {members
          .filter((m) =>
            `${m.username} ${displayName(instance.snapshot.users.find((u) => u.id === m.id))}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((m) => {
            const user =
              instance.snapshot.users.find((u) => u.id === m.id) ?? m;
            return (
              <button
                key={m.id}
                className={`settings-list-row ${id === m.id ? "active" : ""}`}
                onClick={() => {
                  setID(m.id);
                  setAssigned(m.role_ids ?? []);
                }}
              >
                <Avatar instance={instance} user={user} />
                <span>
                  <strong>
                    <UserName instance={instance} user={user} />
                  </strong>
                  <small>
                    <UserName instance={instance} user={user}>
                      @{m.username}
                    </UserName>
                    {m.disabled ? " · Disabled" : ""}
                  </small>
                </span>
                {m.is_owner ? (
                  <span className="role-badge">Owner</span>
                ) : (
                  <Settings size={16} />
                )}
              </button>
            );
          })}
      </div>
      {selected && (
        <div className="member-role-editor">
          <h3>
            Roles for{" "}
            <UserName
              instance={instance}
              user={instance.snapshot.users.find(
                (user) => user.id === selected.id,
              )}
            >
              @{selected.username}
            </UserName>
          </h3>
          {selected.is_owner ? (
            <p className="muted">The server owner has all permissions.</p>
          ) : can(instance, 64) &&
            !selected.deleted &&
            selected.id !== instance.account.login.user.id &&
            (instance.account.login.user.is_owner ||
              selected.role_position < instance.snapshot.rolePosition) ? (
            <>
              <fieldset className="permission-checks">
                <legend>Assigned roles</legend>
                {roles
                  .filter((r) => !r.is_default)
                  .map((r) => (
                    <label key={r.id}>
                      <input
                        type="checkbox"
                        checked={assigned.includes(r.id)}
                        disabled={
                          !instance.account.login.user.is_owner &&
                          (r.position >= instance.snapshot.rolePosition ||
                            (r.permissions & ~instance.snapshot.permissions) !==
                              0)
                        }
                        onChange={(e) =>
                          setAssigned((v) =>
                            e.target.checked
                              ? [...v, r.id]
                              : v.filter((x) => x !== r.id),
                          )
                        }
                      />
                      {r.name}
                    </label>
                  ))}
                {roles.filter((r) => !r.is_default).length === 0 && (
                  <p className="muted">
                    Create a role in Roles & permissions first.
                  </p>
                )}
              </fieldset>
              <button
                className="primary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await unwrap(
                      instance.http.PUT("/api/v1/members/{id}/roles", {
                        params: { path: { id } },
                        body: { role_ids: assigned },
                      }),
                    );
                    await load();
                  }, "Member roles saved.")
                }
              >
                Save member roles
              </button>
            </>
          ) : null}
          <MemberActions
            instance={instance}
            member={selected}
            onChange={load}
          />
        </div>
      )}
      <Status action={action} />
    </section>
  );
}
