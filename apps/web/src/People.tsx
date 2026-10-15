import { openProfile } from "./Profile";
import { memberGroups } from "@haunt/browser/member-groups";
import { subscribeArt, type Art } from "@haunt/browser/art";
import type { Call } from "@haunt/browser/media/call";
import { useSpeaking } from "./Speaking";
import { Mic, Video, MonitorUp } from "lucide-react";
import { CallTimer } from "./CallTimer";
import { useContextMenu, MenuAction } from "./ContextMenu";
import { UserVolume } from "./UserVolume";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { Search, MessageCircle, MicOff, HeadphoneOff } from "lucide-react";
import { userAddress, type InstanceClient, type User } from "@haunt/core";
import { Modal } from "./App";
export function ConnectionDot({
  status,
  readiness,
}: {
  status: InstanceClient["snapshot"]["status"];
  readiness?: InstanceClient["snapshot"]["readiness"];
}) {
  const label =
    status === "online"
      ? "Connected"
      : status === "signed-out"
        ? "Sign in required"
        : status === "offline" && readiness === "unavailable"
          ? "Server not ready · reconnecting"
          : status === "syncing"
            ? "Syncing messages"
            : status === "offline"
              ? "Reconnecting"
              : "Connecting";
  return (
    <span className="connection" title={label} role="status" aria-label={label}>
      <i className={`presence ${status}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
export const displayName = (user?: User) =>
  user?.display_name || user?.username || "Member";
export const accent = (value?: string) =>
  /^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : "#77d9b0";
export function UserStatus({
  instance,
  user,
  text = false,
}: {
  instance: InstanceClient;
  user: string;
  text?: boolean;
}) {
  const subscribe = useCallback(
    (listener: () => void) => instance.presence.subscribe(user, listener),
    [instance, user],
  );
  const status = useSyncExternalStore(subscribe, () =>
    instance.presence.status(user),
  );
  const label =
    status === "online"
      ? "Online"
      : status === "offline"
        ? "Offline"
        : "Status unavailable";
  return text ? (
    <span className={`user-status-text ${status}`}>{label}</span>
  ) : (
    <span
      className={`user-status ${status}`}
      data-user-id={user}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
export function useArt(
  instance: InstanceClient,
  kind: Art,
  version?: string,
  id?: string,
) {
  const [url, setURL] = useState<string>();
  useEffect(() => {
    setURL(undefined);
    if (!version) return;
    return subscribeArt(instance, kind, version, id, setURL);
  }, [instance, kind, version, id]);
  return url;
}
export function Avatar({
  instance,
  user,
  size = "",
  label = false,
}: {
  instance: InstanceClient;
  user?: User;
  size?: string;
  label?: boolean;
}) {
  const url = useArt(instance, "avatar", user?.avatar_version, user?.id);
  const color = accent(user?.accent_color);
  return (
    <span
      className={`avatar ${size}`}
      style={{
        color: `color-mix(in srgb, ${color}, var(--text) var(--identity-text-mix, 0%))`,
        backgroundColor: url ? "transparent" : color + "22",
      }}
      aria-label={label ? displayName(user) : undefined}
    >
      {url ? (
        <img src={url} alt="" />
      ) : (
        displayName(user).slice(0, 1).toUpperCase()
      )}
      {user && <UserStatus instance={instance} user={user.id} />}
    </span>
  );
}
export function ServerArt({
  instance,
  kind,
  className,
}: {
  instance: InstanceClient;
  kind: "icon" | "banner";
  className?: string;
}) {
  const info = instance.account.instance;
  const url = useArt(
    instance,
    kind,
    kind === "icon" ? info.icon_version : info.banner_version,
  );
  if (kind === "banner" && !url) return null;
  return url ? (
    <img className={className} src={url} alt="" />
  ) : (
    <span>{info.name.slice(0, 2).toUpperCase()}</span>
  );
}
/** Warm both persistent art entries, including banners of unselected servers. */
export function ServerBrandingCache({
  instance,
}: {
  instance: InstanceClient;
}) {
  useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  const { banner_version, icon_version } = instance.account.instance;
  useArt(instance, "banner", banner_version);
  useArt(instance, "icon", icon_version);
  return null;
}
export function DMAvatar({
  instance,
  members = [],
}: {
  instance: InstanceClient;
  members?: string[];
}) {
  const peers = members.filter((id) => id !== instance.account.login.user.id);
  const users = peers
    .slice(0, 2)
    .map((id) => instance.snapshot.users.find((u) => u.id === id));
  if (users.length <= 1)
    return <Avatar instance={instance} user={users[0]} size="tiny" />;
  return (
    <span className="dm-avatar-group">
      {users.map((user, index) => (
        <Avatar
          key={peers[index]}
          instance={instance}
          user={user}
          size="tiny"
        />
      ))}
    </span>
  );
}
export function MemberList({
  instance,
  onMessage,
  onEditProfile,
}: {
  instance: InstanceClient;
  onMessage: (id: string) => void;
  onEditProfile: () => void;
}) {
  const menu = useContextMenu();
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string>();
  const state = instance.snapshot;
  const searchable = state.users.length >= 20;
  // One pass over the gateway roster, shared by all visible member rows.
  // A user can have several sessions; any active source should show up here.
  const activity = useMemo(() => {
    const users = new Map<
      string,
      { room: string; camera: boolean; screen: boolean }
    >();
    for (const [room, people] of Object.entries(state.voiceRooms)) {
      for (const person of people) {
        const next = users.get(person.user_id) ?? {
          room,
          camera: false,
          screen: false,
        };
        if (person.state.screen_off === false) next.room = room;
        next.camera ||= person.state.camera_off === false;
        next.screen ||= person.state.screen_off === false;
        users.set(person.user_id, next);
      }
    }
    return users;
  }, [state.voiceRooms]);
  const presenceRevision = useSyncExternalStore(
    instance.presence.subscribeRoster,
    instance.presence.rosterRevision,
  );
  const groups = useMemo(
    () =>
      memberGroups(
        state.users,
        instance.presence.status,
        searchable ? search : "",
      ),
    [state.users, instance, presenceRevision, search, searchable],
  );
  const person = state.users.find((u) => u.id === selected);
  return (
    <>
      <aside
        className="member-panel"
        id="member-panel"
        aria-label="Member list"
      >
        <header className="member-panel-header">
          <h2>Members</h2>
        </header>
        {searchable && (
          <label className="member-search">
            <Search size={16} />
            <input
              aria-label="Search members"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a member"
            />
          </label>
        )}
        <div className="member-list">
          {groups.map((group) => (
            <section
              className="member-section"
              key={group.id}
              data-section-id={group.id}
              aria-label={group.label}
            >
              <h3>
                {group.label} <span>{group.users.length}</span>
              </h3>
              {group.users.map((user) => {
                const voice = activity.get(user.id);
                const roomName =
                  voice &&
                  (state.channels.find((c) => c.id === voice.room)?.name ??
                    "voice");
                return (
                  <button
                    className="member-row"
                    {...menu(
                      displayName(user),
                      <>
                        <MenuAction onClick={() => setSelected(user.id)}>
                          View profile
                        </MenuAction>
                        {user.id === instance.account.login.user.id ? (
                          <MenuAction onClick={onEditProfile}>
                            Edit your profile
                          </MenuAction>
                        ) : (
                          <MenuAction onClick={() => onMessage(user.id)}>
                            Message
                          </MenuAction>
                        )}
                        <UserVolume instance={instance} user={user.id} />
                      </>,
                    )}
                    key={user.id}
                    onClick={() => setSelected(user.id)}
                  >
                    <Avatar instance={instance} user={user} />
                    <span>
                      <strong>{displayName(user)}</strong>
                      <small
                        className={
                          voice?.screen || voice?.camera
                            ? "member-media-status"
                            : undefined
                        }
                      >
                        {voice?.screen || voice?.camera ? (
                          <>
                            {voice.screen ? (
                              <MonitorUp size={12} aria-hidden="true" />
                            ) : (
                              <Video size={12} aria-hidden="true" />
                            )}
                            <span>
                              {voice.screen
                                ? voice.camera
                                  ? "Streaming + camera"
                                  : "Streaming"
                                : "Camera on"}{" "}
                              · {roomName}
                            </span>
                          </>
                        ) : voice ? (
                          `In ${roomName}`
                        ) : (
                          `@${user.username}`
                        )}
                      </small>
                    </span>
                    {user.is_owner && <span className="role-badge">Owner</span>}
                  </button>
                );
              })}
            </section>
          ))}
          {!groups.length && <p className="muted">No matching members.</p>}
        </div>
      </aside>
      {person && (
        <Modal title="Member profile" onClose={() => setSelected(undefined)}>
          <div
            className="member-profile"
            style={
              {
                "--profile-accent": accent(person.accent_color),
              } as CSSProperties
            }
          >
            <Avatar instance={instance} user={person} size="large" />
            <h2>{displayName(person)}</h2>
            <p className="muted account-address">
              {userAddress(instance, person)}{" "}
              {person.is_owner && "· Server owner"}
            </p>
            <p>
              <UserStatus instance={instance} user={person.id} text />
            </p>
            {person.bio && <p className="profile-bio">{person.bio}</p>}
            <small>
              Member since {new Date(person.created_at).toLocaleDateString()}
            </small>
            <div className="button-row">
              {person.id === instance.account.login.user.id ? (
                <button
                  className="primary"
                  onClick={() => {
                    setSelected(undefined);
                    onEditProfile();
                  }}
                >
                  Edit your profile
                </button>
              ) : (
                <button
                  className="primary"
                  onClick={() => {
                    setSelected(undefined);
                    onMessage(person.id);
                  }}
                >
                  <MessageCircle size={16} /> Message
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
export function VoiceMembers({
  instance,
  room,
  call,
  onEditProfile,
}: {
  instance: InstanceClient;
  room: string;
  call?: Call;
  onEditProfile?: () => void;
}) {
  const menu = useContextMenu();
  const members = (instance.snapshot.voiceRooms[room] ?? []).filter((p) =>
    instance.snapshot.users.some((u) => u.id === p.user_id),
  );
  if (!members.length) return null;
  return (
    <div className="voice-members" aria-label="Voice participants">
      {members.map((p) => {
        const user = instance.snapshot.users.find((u) => u.id === p.user_id);
        return (
          <button
            className="voice-member"
            onClick={() => openProfile(instance, p.user_id)}
            key={p.participant_id}
            aria-label={displayName(user)}
            aria-haspopup="menu"
            {...menu(
              displayName(user),
              <>
                {p.user_id === instance.account.login.user.id &&
                  onEditProfile && (
                    <MenuAction onClick={onEditProfile}>
                      Edit your profile
                    </MenuAction>
                  )}
                <UserVolume instance={instance} user={p.user_id} />
              </>,
            )}
          >
            <Avatar instance={instance} user={user} size="tiny" />
            <span>{displayName(user)}</span>
            <CallTimer joinedAt={p.joined_at} />
            {(p.state.screen_off === false || p.state.camera_off === false) && (
              <span className="voice-media-icons">
                {p.state.screen_off === false && (
                  <span
                    role="img"
                    aria-label="Sharing screen"
                    title="Sharing screen"
                  >
                    <MonitorUp size={13} aria-hidden="true" />
                  </span>
                )}
                {p.state.camera_off === false && (
                  <span role="img" aria-label="Camera on" title="Camera on">
                    <Video size={13} aria-hidden="true" />
                  </span>
                )}
              </span>
            )}
            {p.state.deafened ? (
              <HeadphoneOff size={13} aria-label="Deafened" />
            ) : p.state.muted ? (
              <MicOff size={13} aria-label="Muted" />
            ) : null}
            {!p.state.muted && (
              <SpeakingMic call={call} participant={p.participant_id} />
            )}
          </button>
        );
      })}
    </div>
  );
}

function SpeakingMic({
  call,
  participant,
}: {
  call?: Call;
  participant: string;
}) {
  const speaking = useSpeaking(call, participant);
  return speaking ? (
    <Mic className="speaking-mic" size={13} aria-label="Speaking" />
  ) : null;
}
