import { DMInfo } from "./DMStorage";
import { PeopleSearch } from "./PeopleSearch";
import { useAccountDirectory } from "./useAccountDirectory";
import type { AccountEntry } from "@haunt/browser/account-directory";
import { openProfile } from "./Profile";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  Bell,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Star,
} from "lucide-react";
import { friendlyError, type InstanceClient } from "@haunt/core";
import {
  DirectMessageDirectory,
  dmPreview,
  sortDMs,
  type DirectMessage,
} from "@haunt/browser/direct-messages";
import {
  getPreferences,
  setPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";
import { notifications, type Ping } from "@haunt/browser/notifications";
import { messageStore } from "./runtime";
import {
  ConversationView,
  ErrorNotice,
  Modal,
  NewDM,
  UnreadBadge,
} from "./App";
import { DMAvatar } from "./People";
import { MenuAction, useContextMenu } from "./ContextMenu";
import { NotificationRules } from "./ClientSettings";

export function useDirectMessages(instances: InstanceClient[]) {
  const [directory] = useState(() => new DirectMessageDirectory());
  useEffect(
    () => directory.start(instances, messageStore),
    [directory, instances],
  );
  const entries = useSyncExternalStore(
    directory.subscribe,
    directory.getSnapshot,
  );
  const preferences = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
  );
  return useMemo(
    () => sortDMs(entries, preferences.dmFavorites),
    [entries, preferences.dmFavorites],
  );
}
function favorite(entry: DirectMessage) {
  const next = { ...getPreferences().dmFavorites };
  if (next[entry.key]) delete next[entry.key];
  else next[entry.key] = true;
  setPreferences({ dmFavorites: next });
}
function useDMMenu(entry: DirectMessage, onOpen: () => void) {
  const menu = useContextMenu();
  const [settings, setSettings] = useState(false);
  const { dmFavorites } = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
  );
  return {
    binding: menu(
      `${entry.title} via ${entry.server}`,
      <>
        <MenuAction onClick={onOpen}>Open conversation</MenuAction>
        <MenuAction onClick={() => favorite(entry)}>
          {dmFavorites[entry.key]
            ? "Remove from favorites"
            : "Add to favorites"}
        </MenuAction>
        <MenuAction onClick={() => setSettings(true)}>
          Notification Settings
        </MenuAction>
        <MenuAction
          onClick={() =>
            entry.instance.markRead(
              entry.conversation.id,
              entry.read?.last_seq ?? 0,
            )
          }
        >
          Mark as read
        </MenuAction>
      </>,
    ),
    dialog: settings && (
      <Modal
        title="Direct message notifications"
        onClose={() => setSettings(false)}
      >
        <NotificationRules
          instance={entry.instance}
          onlyChannel={entry.conversation.id}
        />
      </Modal>
    ),
  };
}
function DMEntry({
  entry,
  rail = false,
  selected,
  onOpen,
}: {
  entry: DirectMessage;
  rail?: boolean;
  selected?: boolean;
  onOpen: () => void;
}) {
  const { binding, dialog } = useDMMenu(entry, onOpen);
  const { dmFavorites } = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
  );
  const Wrapper = rail ? "button" : "div";
  return (
    <>
      {dialog}
      <Wrapper
        {...binding}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          binding.onKeyDown(e);
          if (
            !e.defaultPrevented &&
            e.target === e.currentTarget &&
            (e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            onOpen();
          }
        }}
        className={`dm-entry ${rail ? "dm-rail-icon server-icon" : "dm-home-entry"} ${selected ? "selected" : ""} ${entry.read?.unread_count ? "unread" : ""}`}
        data-dm-key={entry.key}
        title={`${entry.title} via ${entry.server} · ${entry.address}`}
        aria-label={`Message ${entry.title} via ${entry.server}`}
        aria-current={selected ? "page" : undefined}
        onClick={onOpen}
      >
        <DMAvatar
          instance={entry.instance}
          members={entry.users.map((user) => user.id)}
        />
        {!rail && (
          <span className="dm-entry-text">
            <span className="dm-user-names">
              {entry.users.map((user, index) => (
                <span key={user.id}>
                  {index > 0 ? ", " : ""}
                  <button
                    className="user-name"
                    onClick={(e) => {
                      e.stopPropagation();
                      openProfile(entry.instance, user.id);
                    }}
                  >
                    {user.display_name || user.username}
                  </button>
                </span>
              ))}
            </span>
            <small>{entry.address}</small>
            <span className="dm-preview">
              {entry.latest?.author_id ===
                entry.instance.account.login.user.id && !entry.latest.deleted
                ? "You: "
                : ""}
              {dmPreview(entry.latest)}
            </span>
          </span>
        )}
        {!rail && (
          <span className="dm-entry-meta">
            {entry.latest && (
              <time
                dateTime={entry.latest.created_at}
                title={new Date(entry.latest.created_at).toLocaleString()}
              >
                {new Date(entry.latest.created_at).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })}
              </time>
            )}
            {dmFavorites[entry.key] && <Star size={13} aria-label="Favorite" />}
          </span>
        )}
        <UnreadBadge state={entry.read} />
      </Wrapper>
    </>
  );
}
export function DMRail({
  entries,
  selected,
  onOpen,
  onHome,
}: {
  entries: DirectMessage[];
  selected?: string;
  onOpen: (entry: DirectMessage) => void;
  onHome: () => void;
}) {
  const shown = entries.filter((entry) => (entry.read?.unread_count ?? 0) > 0);
  if (!shown.length) return null;
  return (
    <div className="dm-rail" role="group" aria-label="Direct messages">
      {shown.map((entry) => (
        <DMEntry
          key={entry.key}
          entry={entry}
          rail
          selected={entry.key === selected}
          onOpen={() => onOpen(entry)}
        />
      ))}
      {shown.length < entries.length && (
        <button
          className="icon"
          onClick={onHome}
          aria-label="Show all direct messages"
        >
          <MoreHorizontal size={20} />
        </button>
      )}
    </div>
  );
}
export function DirectMessagesHome({
  entries,
  instances,
  pings,
  onOpen,
  onCreated,
  onPing,
}: {
  entries: DirectMessage[];
  instances: InstanceClient[];
  pings: Ping[];
  onOpen: (entry: DirectMessage) => void;
  onCreated: (instance: InstanceClient, id: string) => void;
  onPing: (ping: Ping) => void;
}) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const people = useAccountDirectory(instances);
  const { dmFavorites } = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
  );
  const available = instances.filter((i) => i.snapshot.status === "online");
  const choosePerson = async (entry: AccountEntry) => {
    if (busy || !entry.online) return;
    setBusy(true);
    setError("");
    try {
      const conversation = await entry.instance.createDM([entry.user.id]);
      onCreated(entry.instance, conversation.id);
      setSearch("");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const filtered = entries.filter((e) =>
    `${e.title} ${e.address} ${e.server}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  const shown = filtered.slice(0, limit);
  return (
    <main className="dm-home">
      <section className="dm-directory" aria-label="Direct messages">
        <header className="dm-page-heading">
          <MessageCircle size={21} />
          <h1>Direct messages</h1>
        </header>
        <div className="dm-tools">
          <PeopleSearch
            people={people}
            query={search}
            onQuery={(value) => {
              setSearch(value);
              setLimit(100);
            }}
            onChoose={(entry) => void choosePerson(entry)}
            busy={busy}
          />
          <div className="dm-new">
            <button
              className="icon"
              aria-label="New direct message"
              title="New direct message"
              disabled={!available.length}
              onClick={() => setComposing(true)}
            >
              <Plus size={20} />
            </button>
          </div>
          <ErrorNotice error={error} />
        </div>
        <div className="dm-directory-list">
          {[true, false].map((pinned) => {
            const group = shown.filter((e) => !!dmFavorites[e.key] === pinned);
            return (
              group.length > 0 && (
                <section
                  key={String(pinned)}
                  aria-label={pinned ? "Favorites" : "Recent conversations"}
                >
                  <h2>{pinned ? "Favorites" : "Recent conversations"}</h2>
                  {group.map((entry) => (
                    <DMEntry
                      key={entry.key}
                      entry={entry}
                      onOpen={() => onOpen(entry)}
                    />
                  ))}
                </section>
              )
            );
          })}
          {!shown.length && (
            <p className="muted dm-empty">
              {search
                ? "No matching conversations."
                : "No direct messages yet."}
            </p>
          )}
          {filtered.length > shown.length && (
            <button
              className="text-button"
              onClick={() => setLimit((n) => n + 100)}
            >
              Show more conversations
            </button>
          )}
        </div>
      </section>
      <section className="dm-notifications" aria-label="Notification center">
        <header className="dm-page-heading">
          <Bell size={20} />
          <h2>Notifications</h2>
          {pings.length > 0 && (
            <button
              className="text-button"
              onClick={() => notifications.clear()}
            >
              Clear all
            </button>
          )}
        </header>
        <div className="notification-inbox">
          {[...pings]
            .sort((a, b) => b.at - a.at)
            .map((ping) => (
              <button key={ping.id} onClick={() => onPing(ping)}>
                <strong>{ping.title}</strong>
                <span>{ping.body}</span>
                <time dateTime={new Date(ping.at).toISOString()}>
                  {new Date(ping.at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </button>
            ))}
          {!pings.length && (
            <p className="muted dm-empty">No unread notifications.</p>
          )}
        </div>
      </section>
      {composing && (
        <NewDM
          instances={instances}
          onClose={() => setComposing(false)}
          onCreated={(id, target) => {
            setComposing(false);
            onCreated(target, id);
          }}
        />
      )}
    </main>
  );
}
export function DirectMessageView({
  entry,
  onHome,
  onServer,
}: {
  entry: DirectMessage;
  onHome: () => void;
  onServer: () => void;
}) {
  const { binding, dialog } = useDMMenu(entry, () => {});
  const { dmFavorites } = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
  );
  return (
    <main className="workspace dm-workspace">
      <header className="conversation-head dm-conversation-head" {...binding}>
        <button
          className="icon"
          aria-label="Back to direct messages"
          onClick={onHome}
        >
          <ArrowLeft size={20} />
        </button>
        <DMAvatar
          instance={entry.instance}
          members={entry.users.map((user) => user.id)}
        />
        <div className="dm-heading-text">
          <h1>
            {entry.users.map((user, index) => (
              <span key={user.id}>
                {index > 0 ? ", " : ""}
                <button
                  className="user-name"
                  onClick={() => openProfile(entry.instance, user.id)}
                >
                  {user.display_name || user.username}
                </button>
              </span>
            ))}{" "}
            <span>via </span>
            <button className="dm-origin" onClick={onServer}>
              {entry.server}
            </button>
          </h1>
          <p>{entry.address}</p>
        </div>
        <button
          className={`icon dm-favorite ${dmFavorites[entry.key] ? "active" : ""}`}
          aria-label={
            dmFavorites[entry.key]
              ? "Remove from favorites"
              : "Add to favorites"
          }
          aria-pressed={!!dmFavorites[entry.key]}
          onClick={() => favorite(entry)}
        >
          <Star size={18} />
        </button>
        <button
          className="icon"
          aria-label="Direct message options"
          onClick={binding.onContextMenu}
        >
          <MoreHorizontal size={20} />
        </button>
      </header>
      <DMInfo
        instance={entry.instance}
        conversation={entry.conversation.id}
        title={entry.title}
      />
      <ErrorNotice error={entry.instance.snapshot.error} />
      <ConversationView
        key={entry.key}
        instance={entry.instance}
        conversation={entry.conversation.id}
        title={entry.title}
        writable
      />
      {dialog}
    </main>
  );
}
