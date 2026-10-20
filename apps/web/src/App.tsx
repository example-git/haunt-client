import { SyncHealthNotice } from "./SyncHealthNotice";
import { DesktopDownload } from "./DesktopDownload";
import { resumeSync, subscribeSync, syncStatus } from "./sync-runtime";
import {
  DesktopUpdateNotice,
  DesktopRuntimeNotice,
  useDesktopUpdateHealth,
} from "./DesktopUpdates";
import { AccountLabel } from "./AccountLabel";
import { MessageSecurity } from "./MessageSecurity";
import { ToastStack } from "./ToastStack";
import { useAccountDirectory } from "./useAccountDirectory";
import {
  findAccounts,
  type AccountEntry,
} from "@haunt/browser/account-directory";
import { DMStorageWarning } from "./DMStorage";
import { ProfileHost, openProfile } from "./Profile";
import {
  DMRail,
  DirectMessagesHome,
  DirectMessageView,
  useDirectMessages,
} from "./DirectMessages";
import { dmKey, type DirectMessage } from "@haunt/browser/direct-messages";
import { VoiceJoinDialog, CallPluginNotice } from "./AudioPluginProgress";
import {
  pluginDownloads,
  pluginFileKey,
} from "@haunt/browser/audio-plugins/progress";
import { pluginSelection } from "@haunt/browser/audio-plugins/preferences";
import {
  channelPreferenceKey,
  getPreferences,
  setPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";
import { syncAudioPlugins } from "@haunt/browser/audio-plugins/cache";
import { attachNarrator } from "@haunt/browser/narrator";
import { ServerMenuEntries } from "./ServerMenus";
import {
  ATTACHMENT_TYPES,
  AttachmentDraft,
  hasFiles,
  transferredFiles,
} from "@haunt/browser/attachment-input";
import {
  useAttachmentDrop,
  usePreventFileNavigation,
} from "./useAttachmentDrop";
import { ChannelIcon } from "./ChannelIcon";
import { Connect } from "./Connect";
import { Titlebar } from "./Titlebar";
import { ModerationHost, can, canManageServer } from "./Moderation";
import { CallPanel } from "./CallView";
import { VoiceChatToggle } from "./VoiceChatToggle";
import { EmojiImage } from "./Emojis";
import { Fragment, lazy, Suspense } from "react";
const EmojiPicker = lazy(() => import("./EmojiPicker"));
const MessageText = lazy(() => import("./MessageText"));
import { Smile } from "lucide-react";
import { copyText } from "./clipboard";
import { useContextMenu, MenuAction } from "./ContextMenu";
import { Attachment, MessageEmbeds } from "./RichContent";
import { unreadSummary } from "@haunt/core";
import { installBadges } from "@haunt/browser/badges";
import { BRAND_NAME, brandAsset } from "@haunt/browser/brand";
import {
  useEffect,
  useMemo,
  useLayoutEffect,
  type CSSProperties,
  type RefObject,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Hash,
  Headphones,
  LogOut,
  Menu,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Settings,
  Users,
  X,
  MoreHorizontal,
} from "lucide-react";
import {
  friendlyError,
  unwrap,
  type InstanceClient,
  type Message,
  type PendingMessage,
  type Schemas,
} from "@haunt/core";
import { Call } from "@haunt/browser/media/call";
import { installSounds } from "@haunt/browser/sounds";
import { client } from "./runtime";
import { ClientSettings, NotificationRules } from "./ClientSettings";
import {
  notifications,
  deliverPing,
  type Ping,
} from "@haunt/browser/notifications";
import { AccountSettings } from "./Settings";
import { ChannelSettings, ServerSettings } from "./Customization";
import {
  Avatar,
  ServerArt,
  ServerBrandingCache,
  ConnectionDot,
  MemberList,
  VoiceMembers,
  displayName,
  accent,
} from "./People";

const noSubscription = () => () => {};
const noCallSnapshot = () => undefined;

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      aria-label={title}
      className={wide ? "wide-dialog" : undefined}
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
function ServerButton({
  instance,
  selected,
  onClick,
}: {
  instance: InstanceClient;
  selected: boolean;
  onClick: () => void;
}) {
  const snapshot = useSyncExternalStore(
    instance.subscribe,
    instance.getSnapshot,
  );
  const { count, unread } = unreadSummary(
    Object.fromEntries(
      Object.entries(snapshot.readStates).filter(
        ([, state]) => state.kind !== "dm",
      ),
    ),
  );
  const menu = useContextMenu();
  const [settings, setSettings] = useState<string>(),
    [notificationsOpen, setNotificationsOpen] = useState(false);
  return (
    <>
      {settings && (
        <ServerSettings
          instance={instance}
          initialTab={settings}
          onClose={() => setSettings(undefined)}
        />
      )}
      {notificationsOpen && (
        <Modal
          title="Server notifications"
          onClose={() => setNotificationsOpen(false)}
        >
          <NotificationRules instance={instance} />
        </Modal>
      )}
      <button
        {...menu(
          instance.account.instance.name,
          <>
            <MenuAction onClick={onClick}>Open server</MenuAction>
            <ServerMenuEntries
              instance={instance}
              onSelect={setSettings}
              fallback={
                canManageServer(instance) && (
                  <MenuAction onClick={() => setSettings("overview")}>
                    Server settings
                  </MenuAction>
                )
              }
            />
            <MenuAction onClick={() => setNotificationsOpen(true)}>
              Notifications
            </MenuAction>
          </>,
        )}
        className={`server-icon ${selected ? "selected" : ""}`}
        title={`${instance.account.instance.name} · ${snapshot.status}`}
        aria-label={`Open ${instance.account.instance.name}`}
        aria-pressed={selected}
        onClick={onClick}
      >
        <ServerArt
          instance={instance}
          kind="icon"
          className="server-icon-image"
        />
        <i className={`presence ${snapshot.status}`} />
        {count > 0 ? (
          <span
            className="ping-badge"
            aria-label={`${count} unread mentions or direct messages`}
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : unread ? (
          <i className="server-unread" aria-label="Unread messages" />
        ) : null}
      </button>
    </>
  );
}
function NotificationSubscription({ instance }: { instance: InstanceClient }) {
  const { status } = useSyncExternalStore(
    instance.subscribe,
    instance.getSnapshot,
  );
  useEffect(() => {
    if (status === "online") void syncAudioPlugins(instance).catch(() => {});
  }, [instance, status]);
  useEffect(() => {
    const bridge = window.hauntDesktop?.updates;
    const source = instance.account.instance.client_updates;
    if (!bridge || status !== "online" || !source) return;
    void bridge
      .source({
        id: instance.scope,
        origin: instance.account.origin,
        manifestURL: source.manifest_url,
        authenticated: source.authenticated,
        token: instance.account.login.token,
      })
      .catch(() => {});
    return () => {
      void bridge.source({ id: instance.scope, remove: true }).catch(() => {});
    };
  }, [instance, status]);
  useEffect(() => notifications.attach(instance), [instance]);
  return null;
}
export function App() {
  useDesktopUpdateHealth();
  const syncSession = useSyncExternalStore(subscribeSync, syncStatus).session;
  const syncUpdateIssuer =
    syncSession?.scope === "full" ? syncSession.issuer : undefined;
  useEffect(() => {
    const updates = window.hauntDesktop?.updates;
    if (!updates || !syncUpdateIssuer) return;
    const id = "haunt-sync:" + syncUpdateIssuer;
    void updates
      .source({
        id,
        kind: "sync",
        origin: syncUpdateIssuer,
        manifestURL: syncUpdateIssuer + "/client-updates/haunt-updates.json",
      })
      .catch(() => {});
    return () => {
      void updates.source({ id, remove: true }).catch(() => {});
    };
  }, [syncUpdateIssuer]);
  usePreventFileNavigation();
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  useEffect(installSounds, []);
  const [version, setVersion] = useState(0),
    [selected, setSelected] = useState(""),
    [connect, setConnect] = useState(false),
    [restoring, setRestoring] = useState(true),
    [error, setError] = useState("");
  const [connectInitial, setConnectInitial] = useState<{
    origin: string;
    username?: string;
    instanceId?: string;
  }>();
  useEffect(() => {
    if (window.location.hash.startsWith("#invite=")) {
      setConnectInitial({ origin: window.location.href });
      setConnect(true);
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    const reconnect = (e: Event) => {
      setConnectInitial((e as CustomEvent).detail);
      setConnect(true);
    };
    window.addEventListener("haunt:reconnect", reconnect);
    return () => window.removeEventListener("haunt:reconnect", reconnect);
  }, []);
  const [call, setCall] = useState<Call>();
  useEffect(() => (call ? attachNarrator(call) : undefined), [call]);
  useEffect(() => {
    const update = () => {
      document.body.dataset.activeCall = String(
        !!call && call.snapshot.status !== "ended",
      );
    };
    update();
    const off = call?.subscribe(update);
    return () => {
      off?.();
      delete document.body.dataset.activeCall;
    };
  }, [call]);
  const [pendingJoin, setPendingJoin] = useState<{
    instance: InstanceClient;
    room: string;
  }>();
  const joiningCall = useRef(false);

  const [settingsInstance, setSettingsInstance] = useState<InstanceClient>(),
    [settingsTab, setSettingsTab] = useState("notifications");
  const [clientSettings, setClientSettings] = useState(false);
  const [view, setView] = useState<"home" | "server" | "dm">("home");
  const [direct, setDirect] = useState<{ scope: string; id: string }>();
  const instances = useMemo(() => [...client.instances.values()], [version]);
  const directMessages = useDirectMessages(instances);
  const activeDM =
    view === "dm" && direct
      ? directMessages.find((e) => e.key === dmKey(direct.scope, direct.id))
      : undefined;
  const openDM = (target: InstanceClient, id: string) => {
    setSelected(target.account.instance.instance_id);
    setDirect({ scope: target.scope, id });
    setView("dm");
    void target.selectConversation(id).catch((e) => setError(friendlyError(e)));
    notifications.clear(target.scope, id);
  };
  const openDMEntry = (entry: DirectMessage) =>
    openDM(entry.instance, entry.conversation.id);
  const openHome = () => setView("home");
  const pings = useSyncExternalStore(
    notifications.subscribe,
    notifications.getSnapshot,
  );
  const openPing = (ping: Pick<Ping, "instance" | "conversation">) => {
    const target = client.instances.get(ping.instance);
    if (!target) return;
    if (
      target.snapshot.conversations.some(
        (c) => c.id === ping.conversation && c.kind === "dm",
      )
    ) {
      openDM(target, ping.conversation);
      return;
    }
    setView("server");
    setSelected(ping.instance);
    setSelectedConversations((v) => ({
      ...v,
      [ping.instance]: ping.conversation,
    }));
    void target
      .selectConversation(ping.conversation)
      .catch((e) => setError(friendlyError(e)));
    notifications.clear(target.scope, ping.conversation);
  };
  const routing = useRef({ selected: "", conversation: "", open: openPing });
  const [selectedConversations, setSelectedConversations] = useState<
    Record<string, string>
  >({});
  routing.current = {
    selected: view === "home" ? "" : selected,
    conversation:
      view === "dm"
        ? (activeDM?.conversation.id ?? "")
        : view === "server"
          ? (selectedConversations[selected] ?? "")
          : "",
    open: openPing,
  };
  useEffect(() => {
    notifications.viewing = (scope, conversation) =>
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      client.instances.get(routing.current.selected)?.scope === scope &&
      routing.current.conversation === conversation &&
      !(
        getPreferences().voiceChatHidden &&
        client.instances
          .get(routing.current.selected)
          ?.snapshot.channels.some(
            (channel) =>
              channel.id === conversation && channel.kind === "voice",
          )
      );
    notifications.deliver = (ping) =>
      deliverPing(ping, (value) => routing.current.open(value));
    const read = () => {
      const target = client.instances.get(routing.current.selected);
      if (
        target &&
        notifications.viewing(target.scope, routing.current.conversation)
      )
        notifications.clear(target.scope, routing.current.conversation);
    };
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    const off = window.hauntDesktop?.onNotificationClick((value) =>
      routing.current.open(value),
    );
    return () => {
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
      off?.();
      notifications.deliver = () => {};
    };
  }, []);
  useEffect(() => {
    const target = client.instances.get(selected);
    const conversation = routing.current.conversation;
    if (
      target &&
      conversation &&
      notifications.viewing(target.scope, conversation)
    )
      notifications.clear(target.scope, conversation);
  }, [selected, selectedConversations, view, activeDM?.conversation.id]);
  const [callTarget, setCallTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    void client
      .restore()
      .then(() => {
        setSelected(client.instances.keys().next().value ?? "");
        setVersion((v) => v + 1);
        void resumeSync().catch((e) => setError(friendlyError(e)));
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setRestoring(false));
    return () => client.stop();
  }, []);
  useEffect(() => {
    const restored = () => {
      setSelected(
        (current) => current || client.instances.keys().next().value || "",
      );
      setVersion((v) => v + 1);
    };
    window.addEventListener("haunt-sync-restored", restored);
    return () => window.removeEventListener("haunt-sync-restored", restored);
  }, []);
  useEffect(() => installBadges(client.instances.values()), [version]);
  useEffect(() => {
    for (const [id, instance] of client.instances)
      instance.setForeground(view === "server" && id === selected);
  }, [version, selected, view]);
  const instance = client.instances.get(selected);
  const joined = (value: InstanceClient) => {
    setView("server");
    setSelected(value.account.instance.instance_id);
    setVersion(version + 1);
    setConnect(false);
  };
  const logout = async (instance: InstanceClient) => {
    if (call?.client === instance) {
      await call.end();
      setCall(undefined);
    }
    if (instance.snapshot.status === "signed-out")
      await client.forget(instance.account.instance.instance_id);
    else await client.logout(instance.account.instance.instance_id);
    setClientSettings(false);
    setSettingsInstance(undefined);
    setView("home");
    setDirect(undefined);
    setSelected(client.instances.keys().next().value ?? "");
    setVersion((v) => v + 1);
  };
  const startCall = async (
    instance: InstanceClient,
    room: string,
    waitForPlugin: boolean,
  ) => {
    if (joiningCall.current) return;
    if (
      call?.client === instance &&
      call.room === room &&
      call.snapshot.status !== "ended"
    )
      return;
    joiningCall.current = true;
    setPendingJoin(undefined);
    await call?.end();
    const next = new Call(instance, room);
    setCall(next);
    joiningCall.current = false;
    try {
      await next.start(waitForPlugin);
    } catch (e) {
      setError(friendlyError(e));
    }
  };
  const joinCall = async (instance: InstanceClient, room: string) => {
    if (
      call?.client === instance &&
      call.room === room &&
      call.snapshot.status !== "ended"
    )
      return;
    const selection = pluginSelection(instance);
    const variant = selection?.plugin.manifest.variants.find(
      (v) => v.id === selection.variant,
    );
    const progress = pluginDownloads(instance).getSnapshot();
    const ready =
      progress.catalog === "ready" &&
      (!selection ||
        (variant &&
          progress.files[pluginFileKey(selection.plugin, variant.file)]
            ?.phase === "ready"));
    if (
      getPreferences().noiseSuppression &&
      instance.account.instance.capabilities?.includes("audio.plugins.v1") &&
      !ready
    )
      setPendingJoin({ instance, room });
    else await startCall(instance, room, true);
  };
  return (
    <div
      className={`app ${call ? "in-call" : ""} ${view !== "server" ? "dm-shell" : ""}`}
    >
      <Titlebar>
        <div className="global-header-slot" ref={setHeaderTarget}>
          {(view !== "server" || !instance) && (
            <span className="titlebar-name">Haunt</span>
          )}
        </div>
        {instance && (
          <DesktopDownload key={instance.scope} instance={instance} />
        )}
        <DesktopUpdateNotice
          onOpen={() => {
            setSettingsTab("updates");
            setClientSettings(true);
          }}
        />
      </Titlebar>
      <SyncHealthNotice />
      <ModerationHost />
      <ProfileHost
        instances={instances}
        onMessage={(target, user) => {
          void target
            .createDM([user])
            .then((c) => openDM(target, c.id))
            .catch((e) => setError(friendlyError(e)));
        }}
        onEdit={(target) => {
          setSettingsInstance(target);
          setSettingsTab("profile");
          setClientSettings(true);
        }}
      />
      {[...client.instances.values()].map((instance) => (
        <Fragment key={instance.scope}>
          <NotificationSubscription instance={instance} />
          <ServerBrandingCache instance={instance} />
        </Fragment>
      ))}
      <nav className="server-rail" aria-label="Servers">
        <div className="server-rail-scroll">
          <button
            className={`brand-mark rail-notifications ${pings.some((p) => !p.direct) ? "has-notifications" : ""} ${view === "home" ? "selected" : ""}`}
            aria-label="Direct messages and notifications"
            title="Direct messages and notifications"
            aria-current={view === "home" ? "page" : undefined}
            onClick={openHome}
          >
            <img
              src={brandAsset("notification-mark.svg")}
              width="48"
              height="48"
              alt={BRAND_NAME}
            />
          </button>
          <DMRail
            entries={directMessages}
            selected={activeDM?.key}
            onOpen={openDMEntry}
            onHome={openHome}
          />
          <div className="rail-line" />
          {[...client.instances.values()].map((value) => (
            <ServerButton
              key={value.account.instance.instance_id}
              instance={value}
              selected={view === "server" && instance === value}
              onClick={() => {
                setView("server");
                setSelected(value.account.instance.instance_id);
              }}
            />
          ))}
          <button
            className="server-icon add"
            aria-label="Add server"
            title="Add a server"
            onClick={() => {
              setConnectInitial(undefined);
              setConnect(true);
            }}
          >
            <Plus size={24} />
          </button>
        </div>
        {(view !== "server" || !instance) && (
          <button
            className="server-icon client-settings-button"
            aria-label="Client settings"
            title="Client settings"
            onClick={() => {
              setSettingsInstance(instance);
              setSettingsTab("notifications");
              setClientSettings(true);
            }}
          >
            <Settings size={22} />
          </button>
        )}
      </nav>
      {view === "home" && (instances.length > 0 || restoring) ? (
        <DirectMessagesHome
          entries={directMessages}
          instances={instances}
          pings={pings}
          onOpen={openDMEntry}
          onCreated={openDM}
          onPing={openPing}
        />
      ) : view === "dm" ? (
        activeDM ? (
          <DirectMessageView
            entry={activeDM}
            onHome={openHome}
            onServer={() => setView("server")}
          />
        ) : (
          <main className="workspace dm-unavailable">
            <p>This conversation is no longer available.</p>
            <button className="secondary" onClick={openHome}>
              Back to direct messages
            </button>
          </main>
        )
      ) : instance ? (
        <Workspace
          headerTarget={headerTarget}
          key={selected}
          instance={instance}
          activeCall={call?.client === instance ? call : undefined}
          conversation={selectedConversations[selected] ?? ""}
          setConversation={(id) =>
            setSelectedConversations((v) => ({ ...v, [selected]: id }))
          }
          setCallTarget={setCallTarget}
          logout={() => logout(instance)}
          joinCall={(room) => joinCall(instance, room)}
          onOpenDM={(id) => openDM(instance, id)}
        />
      ) : (
        <main className="welcome">
          <img
            className="welcome-logo"
            src={brandAsset("logo-128.png")}
            srcSet={`${brandAsset("logo-256.png")} 2x`}
            width="128"
            height="128"
            alt=""
          />
          <h1>{BRAND_NAME}</h1>
          <button
            className="primary"
            onClick={() => {
              setConnectInitial(undefined);
              setConnect(true);
            }}
            disabled={restoring}
          >
            <Plus size={18} />
            {restoring ? "Reconnecting…" : "Join a server"}
          </button>
        </main>
      )}
      {pendingJoin && (
        <VoiceJoinDialog
          key={`${pendingJoin.instance.scope}:${pendingJoin.room}`}
          {...pendingJoin}
          onClose={() => setPendingJoin(undefined)}
          onJoin={(wait) =>
            void startCall(pendingJoin.instance, pendingJoin.room, wait)
          }
        />
      )}
      <ToastStack>
        <DesktopRuntimeNotice />
        {call && (
          <CallPluginNotice
            key={`${call.client.scope}:${call.room}`}
            call={call}
          />
        )}
        {error && (
          <div className="toast" role="alert">
            {error}
            <button
              className="icon"
              aria-label="Dismiss"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </ToastStack>
      {clientSettings &&
        ((settingsInstance ?? instance) ? (
          <AccountSettings
            instance={(settingsInstance ?? instance)!}
            instances={[...client.instances.values()]}
            call={call}
            initialTab={settingsTab}
            onTabChange={setSettingsTab}
            logout={() => logout((settingsInstance ?? instance)!)}
            onClose={() => setClientSettings(false)}
          />
        ) : (
          <ClientSettings
            instances={[]}
            call={call}
            initialTab={settingsTab}
            onTabChange={setSettingsTab}
            onClose={() => setClientSettings(false)}
          />
        ))}
      {connect && (
        <Connect
          initial={connectInitial}
          onClose={() => setConnect(false)}
          onConnect={joined}
        />
      )}
      {call && (
        <CallPanel
          key={`${call.client.scope}:${call.room}`}
          onSettings={() => {
            setSettingsInstance(call.client);
            setSettingsTab("devices");
            setClientSettings(true);
          }}
          call={call}
          target={view === "server" ? callTarget : null}
          onOpen={() => {
            setView("server");
            const id = call.client.account.instance.instance_id;
            setSelected(id);
            setSelectedConversations((v) => ({ ...v, [id]: call.room }));
          }}
          onClose={async () => {
            await call.end();
            setCall(undefined);
          }}
        />
      )}
    </div>
  );
}
function Workspace({
  headerTarget,
  instance,
  activeCall,
  conversation,
  setConversation,
  setCallTarget,
  logout,
  joinCall,
  onOpenDM,
}: {
  headerTarget: HTMLDivElement | null;
  instance: InstanceClient;
  activeCall?: Call;
  conversation: string;
  setConversation: (id: string) => void;
  setCallTarget: (element: HTMLDivElement | null) => void;
  logout: () => Promise<void>;
  joinCall: (room: string) => Promise<void>;
  onOpenDM: (id: string) => void;
}) {
  const state = useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  const callState = useSyncExternalStore(
    activeCall?.subscribe ?? noSubscription,
    activeCall?.getSnapshot ?? noCallSnapshot,
  );
  const [modal, setModal] = useState<
      "dm" | "channel" | "settings" | "server"
    >(),
    [error, setError] = useState(""),
    [sidebar, setSidebar] = useState(false),
    [channelMenu, setChannelMenu] = useState<string>(),
    [editingChannel, setEditingChannel] =
      useState<Schemas["IdentityChannel"]>(),
    [channelTab, setChannelTab] = useState("overview");
  const [newChannelCategory, setNewChannelCategory] = useState<string>();
  const createChannel = (category?: string) => {
    setNewChannelCategory(category);
    setModal("channel");
  };
  const preferences = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
  );
  const membersOpen =
    !preferences.memberListsCollapsed[instance.account.instance.instance_id];
  const setMembersOpen = (open: boolean) =>
    setPreferences({
      memberListsCollapsed: {
        ...getPreferences().memberListsCollapsed,
        [instance.account.instance.instance_id]: !open,
      },
    });
  const menu = useContextMenu();
  const [serverTab, setServerTab] = useState("overview");
  const [notificationServer, setNotificationServer] = useState(false);
  const [notificationChannel, setNotificationChannel] = useState<string>();
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number }>();
  const channelMenuElement = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!channelMenu) return;
    const entry = document.querySelector(
      `[data-channel-id="${CSS.escape(channelMenu)}"]`,
    );
    const menu = channelMenuElement.current;
    const anchor = entry?.querySelector<HTMLButtonElement>(
      ".channel-menu-button",
    );
    if (!menu || !anchor) return;
    const position = () => {
      const bounds = anchor.getBoundingClientRect();
      const width = menu.offsetWidth,
        height = menu.offsetHeight;
      setMenuPosition({
        left: Math.max(
          8,
          Math.min(
            menuPoint?.x ?? bounds.right - width,
            window.innerWidth - width - 8,
          ),
        ),
        top: Math.max(
          8,
          Math.min(
            menuPoint?.y ??
              (bounds.bottom + height + 8 <= window.innerHeight
                ? bounds.bottom + 4
                : bounds.top - height - 4),
            window.innerHeight - height - 8,
          ),
        ),
      });
    };
    position();
    const resize = new ResizeObserver(position);
    resize.observe(menu);
    menu
      .querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (
        !entry?.contains(event.target as Node) &&
        !menu.contains(event.target as Node)
      )
        setChannelMenu(undefined);
    };
    const scrolled = (event: Event) => {
      // Conversation auto-scroll must not dismiss a menu anchored in the sidebar.
      if (
        event.target instanceof Element &&
        event.target.contains(anchor) &&
        !menu.contains(event.target)
      )
        setChannelMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setChannelMenu(undefined);
      entry?.querySelector<HTMLButtonElement>(".channel-menu-button")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      resize.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [channelMenu, menuPoint]);
  const choose = (id: string) => {
    setConversation(id);
    setSidebar(false);
    void instance
      .selectConversation(id)
      .catch((e) => setError(friendlyError(e)));
  };
  useEffect(() => {
    const text = state.channels.find((c) => c.kind === "text");
    const exists = state.channels.some((c) => c.id === conversation);
    if (!exists && text) choose(text.id);
    else if (!exists && conversation && state.status === "online")
      setConversation("");
  }, [state.channels, state.conversations, conversation]);
  const channel = state.channels.find((c) => c.id === conversation);
  const title = channel?.name || "Channels";
  const canManage =
    !!(state.permissions & 16) || instance.account.login.user.is_owner;
  const canSettings = canManageServer(instance);
  const available = !!channel;
  const textChannel = (c: Schemas["IdentityChannel"]) => (
    <div className="channel-entry-wrap" key={c.id} data-channel-id={c.id}>
      <div
        className="channel-entry"
        onKeyDown={(e) => {
          if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            setMenuPoint(undefined);
            setChannelMenu(c.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuPoint({ x: e.clientX, y: e.clientY });
          setChannelMenu(c.id);
        }}
      >
        <button
          className={`channel ${state.readStates[c.id]?.unread_count ? "unread" : ""} ${conversation === c.id ? "active" : ""} ${activeCall?.room === c.id && callState?.status !== "ended" ? "voice-connected" : ""}`}
          onClick={() => {
            choose(c.id);
            if (
              c.kind === "voice" &&
              ((c.permissions ?? 0) & 4 || instance.account.login.user.is_owner)
            )
              void joinCall(c.id);
          }}
        >
          <ChannelIcon channel={c} />
          <span className="channel-name">{c.name}</span>
          <UnreadBadge state={state.readStates[c.id]} />
          {c.kind === "voice" && (
            <span className="join-label">
              {activeCall?.room === c.id && callState?.status !== "ended"
                ? callState?.status === "connected"
                  ? "Connected"
                  : "Connecting…"
                : (c.permissions ?? 0) & 4 ||
                    instance.account.login.user.is_owner
                  ? "Join"
                  : "Chat"}
            </span>
          )}
        </button>
        {
          <button
            className="icon channel-menu-button"
            aria-label={`Channel menu for ${c.name}`}
            aria-expanded={channelMenu === c.id}
            aria-haspopup="menu"
            onClick={() => {
              setMenuPoint(undefined);
              setChannelMenu(channelMenu === c.id ? undefined : c.id);
            }}
          >
            <MoreHorizontal size={17} />
          </button>
        }
      </div>
      {channelMenu === c.id &&
        createPortal(
          <div
            className="channel-menu"
            ref={channelMenuElement}
            style={menuPosition}
            role="menu"
            aria-label={`${c.name} options`}
            onKeyDown={(e) => {
              const items = Array.from(
                e.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]',
                ),
              );
              const current = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                e.key === "ArrowDown"
                  ? (current + 1) % items.length
                  : e.key === "ArrowUp"
                    ? (current + items.length - 1) % items.length
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? items.length - 1
                        : -1;
              if (next >= 0) {
                e.preventDefault();
                items[next].focus();
              }
            }}
          >
            <ServerMenuEntries
              instance={instance}
              channel={c.id}
              onSelect={(id) => {
                setEditingChannel(c);
                setChannelTab(id);
                setChannelMenu(undefined);
              }}
              fallback={
                <>
                  {canManage && (
                    <>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setEditingChannel(c);
                          setChannelTab("overview");
                          setChannelMenu(undefined);
                        }}
                      >
                        Edit channel
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setEditingChannel(c);
                          setChannelTab("permissions");
                          setChannelMenu(undefined);
                        }}
                      >
                        Channel permissions
                      </button>
                      <button
                        role="menuitem"
                        className="danger-text"
                        onClick={() => {
                          setEditingChannel(c);
                          setChannelTab("delete");
                          setChannelMenu(undefined);
                        }}
                      >
                        Delete channel…
                      </button>
                    </>
                  )}
                </>
              }
            />
            <button
              role="menuitem"
              onClick={() => {
                setNotificationChannel(c.id);
                setChannelMenu(undefined);
              }}
            >
              Notifications
            </button>
            <button
              role="menuitem"
              onClick={() => {
                instance.markRead(c.id, state.readStates[c.id]?.last_seq ?? 0);
                setChannelMenu(undefined);
              }}
            >
              Mark as read
            </button>
            <button role="menuitem" onClick={() => setChannelMenu(undefined)}>
              Close menu
            </button>
          </div>,
          document.body,
        )}
      {c.kind === "voice" && (
        <VoiceMembers
          instance={instance}
          room={c.id}
          call={activeCall?.room === c.id ? activeCall : undefined}
          onEditProfile={() => setModal("settings")}
        />
      )}
    </div>
  );
  return (
    <>
      {notificationServer && (
        <Modal
          title="Server notifications"
          onClose={() => setNotificationServer(false)}
        >
          <NotificationRules instance={instance} />
        </Modal>
      )}
      {notificationChannel && (
        <Modal
          title="Conversation notification settings"
          onClose={() => setNotificationChannel(undefined)}
        >
          <NotificationRules
            instance={instance}
            onlyChannel={notificationChannel}
          />
        </Modal>
      )}
      <aside
        className={`sidebar ${sidebar ? "open" : ""}`}
        style={
          {
            "--server-accent": accent(instance.account.instance.accent_color),
          } as CSSProperties
        }
      >
        <header
          className="community-head"
          tabIndex={0}
          {...menu(
            instance.account.instance.name,
            <>
              <ServerMenuEntries
                instance={instance}
                onSelect={(id) => {
                  setServerTab(id);
                  setModal("server");
                }}
                fallback={
                  <>
                    {canSettings && (
                      <MenuAction
                        onClick={() => {
                          setServerTab("overview");
                          setModal("server");
                        }}
                      >
                        Server settings
                      </MenuAction>
                    )}
                  </>
                }
              />
              {canManage && (
                <MenuAction onClick={() => createChannel()}>
                  Create channel
                </MenuAction>
              )}
              <MenuAction onClick={() => setNotificationServer(true)}>
                Notifications
              </MenuAction>
            </>,
          )}
        >
          <div
            className={`community-cover ${instance.account.instance.banner_version ? "has-banner" : ""}`}
          >
            <ServerArt
              instance={instance}
              kind="banner"
              className="server-banner"
            />
            <div className="community-tools">
              <div className="server-name-label">
                <ConnectionDot
                  status={state.status}
                  readiness={state.readiness}
                />
                <h2>{instance.account.instance.name}</h2>
              </div>
            </div>
          </div>
          {instance.account.instance.description && (
            <p className="server-description">
              {instance.account.instance.description}
            </p>
          )}
          {state.status === "signed-out" && (
            <button
              className="text-button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("haunt:reconnect", {
                    detail: {
                      origin: instance.origin,
                      username: instance.account.login.user.username,
                      instanceId: instance.account.instance.instance_id,
                    },
                  }),
                )
              }
            >
              Sign in again
            </button>
          )}
        </header>
        <div className="channel-scroll">
          <div className="section-label">
            CHANNELS
            {canManage && (
              <button
                className="icon"
                aria-label="Create channel"
                onClick={() => createChannel()}
              >
                <Plus size={15} />
              </button>
            )}
          </div>
          {state.channels.filter((c) => !c.category_id).map(textChannel)}
          {state.categories.map((cat) => {
            const key = channelPreferenceKey(instance.scope, cat.id);
            const collapsed = !!preferences.collapsedCategories[key];
            return (
              <div className="category" key={cat.id} data-category-id={cat.id}>
                <div
                  className="section-label category-heading"
                  {...(canManage
                    ? menu(
                        cat.name,
                        <>
                          <MenuAction
                            onClick={() => {
                              setServerTab("channels");
                              setModal("server");
                            }}
                          >
                            Edit category
                          </MenuAction>
                          <MenuAction onClick={() => createChannel(cat.id)}>
                            Create channel
                          </MenuAction>
                        </>,
                      )
                    : {})}
                >
                  <button
                    className="category-toggle"
                    aria-expanded={!collapsed}
                    aria-controls={`category-${cat.id}`}
                    onClick={() => {
                      const next = { ...getPreferences().collapsedCategories };
                      if (collapsed) delete next[key];
                      else next[key] = true;
                      setPreferences({ collapsedCategories: next });
                    }}
                  >
                    <ChevronDown size={13} />
                    <span>{cat.name}</span>
                  </button>
                  {canManage && (
                    <button
                      className="icon category-add"
                      aria-label={`Add channel to ${cat.name}`}
                      onClick={() => createChannel(cat.id)}
                    >
                      <Plus size={15} />
                    </button>
                  )}
                </div>
                <div id={`category-${cat.id}`} hidden={collapsed}>
                  {state.channels
                    .filter((c) => c.category_id === cat.id)
                    .map(textChannel)}
                </div>
              </div>
            );
          })}
          {state.channels.length === 0 && (
            <p className="sidebar-hint">
              {state.status === "online"
                ? "No channels yet. Create a space for the conversation."
                : "Your channels will appear when connected."}
            </p>
          )}
        </div>
        <footer
          className="profile"
          {...menu(
            displayName(instance.account.login.user),
            <MenuAction onClick={() => setModal("settings")}>
              Edit profile & account
            </MenuAction>,
          )}
        >
          <button
            className="profile-avatar-button"
            aria-label="Edit your profile"
            onClick={() => setModal("settings")}
          >
            <Avatar instance={instance} user={instance.account.login.user} />
          </button>
          <AccountLabel instance={instance} />
          <button
            className="icon"
            aria-label="Account settings"
            onClick={() => setModal("settings")}
          >
            <Settings size={19} />
          </button>
        </footer>
      </aside>
      <main className="workspace">
        {headerTarget &&
          createPortal(
            <div className="conversation-head">
              <button
                className="icon mobile-menu"
                aria-label="Show channels"
                onClick={() => setSidebar(!sidebar)}
              >
                <Menu />
              </button>
              <span className="titlebar-server">
                {instance.account.instance.name}
              </span>
              {canSettings && (
                <button
                  className="icon"
                  aria-label="Server settings"
                  title="Server settings"
                  onClick={() => {
                    setServerTab("overview");
                    setModal("server");
                    setSidebar(false);
                  }}
                >
                  <Settings size={18} />
                </button>
              )}
              <span className="channel-symbol">
                <ChannelIcon channel={channel} size={25} />
              </span>
              <div>
                <h1>{title}</h1>
                {channel?.topic && <p>{channel.topic}</p>}
              </div>
              <button
                className="icon refresh"
                title="Refresh conversations"
                aria-label="Refresh conversations"
                onClick={() =>
                  void instance
                    .refresh()
                    .catch((e) => setError(friendlyError(e)))
                }
              >
                <RefreshCw size={18} />
              </button>
              <button
                className={`header-members ${membersOpen ? "active" : ""}`}
                aria-label={
                  membersOpen ? "Hide member list" : "Show member list"
                }
                aria-expanded={membersOpen}
                aria-controls="member-panel"
                title="Members"
                onClick={() => {
                  setMembersOpen(!membersOpen);
                  if (!membersOpen)
                    void instance
                      .refresh(false)
                      .catch((e) => setError(friendlyError(e)));
                }}
              >
                <Users size={17} />
                {state.users.length}
              </button>
            </div>,
            headerTarget,
          )}
        <ErrorNotice error={error || state.error} />
        <DMStorageWarning instance={instance} />
        {channel?.kind === "voice" ? (
          <div className="voice-workspace">
            {activeCall?.room === channel.id ? (
              <div className="voice-stage-slot" ref={setCallTarget} />
            ) : (
              <section className="voice-lobby" aria-label="Voice channel">
                <VoiceChatToggle instance={instance} room={channel.id} />
                <ChannelIcon channel={channel} size={40} />
                <h2>{channel.name}</h2>
                <VoiceMembers
                  instance={instance}
                  room={channel.id}
                  call={
                    activeCall?.room === channel.id ? activeCall : undefined
                  }
                  onEditProfile={() => setModal("settings")}
                />
                <button
                  className="primary"
                  disabled={
                    !((channel.permissions ?? 0) & 4) &&
                    !instance.account.login.user.is_owner
                  }
                  onClick={() => void joinCall(channel.id)}
                >
                  Join voice
                </button>
              </section>
            )}
            <VoiceChannelChat instance={instance} room={channel.id} />
          </div>
        ) : available ? (
          <ConversationView
            key={conversation}
            instance={instance}
            conversation={conversation}
            title={title}
            writable={
              !!(channel?.permissions! & 2) ||
              instance.account.login.user.is_owner
            }
          />
        ) : (
          <div className="empty-conversation">
            <MessageCircle size={40} />
            <h2>Your people are one message away.</h2>
            <p>Choose a channel, or start a direct message.</p>
            <button className="secondary" onClick={() => setModal("dm")}>
              Start a conversation
            </button>
          </div>
        )}
      </main>
      {membersOpen && (
        <>
          <button
            className="member-scrim"
            aria-label="Dismiss member list"
            onClick={() => setMembersOpen(false)}
          />
          <MemberList
            instance={instance}
            onEditProfile={() => setModal("settings")}
            onMessage={(id) => {
              void unwrap(
                instance.http.POST("/api/v1/dms", { body: { members: [id] } }),
              )
                .then(async (value) => {
                  await instance.refreshAfterChange();
                  onOpenDM(value.id);
                })
                .catch((e) => setError(friendlyError(e)));
            }}
          />
        </>
      )}
      {modal === "dm" && (
        <NewDM
          instance={instance}
          onClose={() => setModal(undefined)}
          onCreated={(id) => {
            onOpenDM(id);
            setModal(undefined);
          }}
        />
      )}
      {modal === "channel" && (
        <ChannelSettings
          instance={instance}
          initialCategory={newChannelCategory}
          onClose={() => setModal(undefined)}
          onSaved={(id) => {
            if (
              id &&
              instance.snapshot.channels.find((c) => c.id === id)?.kind ===
                "text"
            )
              choose(id);
            setModal(undefined);
          }}
        />
      )}
      {editingChannel && (
        <ChannelSettings
          instance={instance}
          channel={editingChannel}
          initialTab={channelTab}
          onClose={() => setEditingChannel(undefined)}
          onSaved={() => {
            if (!instance.snapshot.channels.some((c) => c.id === conversation))
              setConversation("");
          }}
        />
      )}
      {modal === "server" && (
        <ServerSettings
          initialTab={serverTab}
          instance={instance}
          onClose={() => setModal(undefined)}
        />
      )}
      {modal === "settings" && (
        <AccountSettings
          instances={[...client.instances.values()]}
          instance={instance}
          call={activeCall}
          logout={logout}
          onClose={() => setModal(undefined)}
        />
      )}
    </>
  );
}
export function UnreadBadge({
  state,
}: {
  state?: import("@haunt/core").ReadState;
}) {
  if (!state?.unread_count) return null;
  const count = state.kind === "dm" ? state.unread_count : state.mention_count;
  return count ? (
    <span
      className="conversation-badge"
      aria-label={`${count} unread ${state.kind === "dm" ? "direct messages" : "mentions"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  ) : (
    <i className="channel-ping" aria-label="Unread messages" />
  );
}
export function VoiceChannelChat({
  instance,
  room,
}: {
  instance: InstanceClient;
  room: string;
}) {
  const state = useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  const channel = state.channels.find((c) => c.id === room);
  const { voiceChatHidden } = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
  );
  return (
    <section
      className="voice-chat"
      aria-label="Voice channel chat"
      hidden={voiceChatHidden}
    >
      <header>
        <MessageCircle size={17} />
        <strong>{channel?.name ?? "Voice channel"} chat</strong>
      </header>
      {channel ? (
        <ConversationView
          key={room}
          instance={instance}
          conversation={room}
          title={channel.name}
          visible={!voiceChatHidden}
          writable={
            !!((channel.permissions ?? 0) & 2) ||
            instance.account.login.user.is_owner
          }
        />
      ) : (
        <p className="readonly">This channel is no longer available.</p>
      )}
    </section>
  );
}
export function ConversationView({
  instance,
  conversation,
  title,
  writable,
  visible = true,
}: {
  instance: InstanceClient;
  conversation: string;
  title: string;
  writable: boolean;
  visible?: boolean;
}) {
  const state = useSyncExternalStore(instance.subscribe, instance.getSnapshot),
    [messages, setMessages] = useState<Message[]>([]),
    [pending, setPending] = useState<PendingMessage[]>([]),
    [error, setError] = useState(""),
    [limit, setLimit] = useState(100),
    [replyingTo, setReplyingTo] = useState<Message>(),
    [highlighted, setHighlighted] = useState("");
  const dropTarget = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null),
    list = useRef<HTMLDivElement>(null),
    previousHeight = useRef(0),
    stick = useRef(true);
  useEffect(() => {
    let live = true;
    void Promise.all([
      instance.messages(conversation, { limit: limit + 1 }),
      instance.pending(),
    ])
      .then(([items, drafts]) => {
        if (live) {
          setMessages(items);
          setPending(drafts.filter((m) => m.conversation_id === conversation));
        }
      })
      .catch((e) => setError(friendlyError(e)));
    return () => {
      live = false;
    };
  }, [instance, conversation, state.revision, limit]);
  useLayoutEffect(() => {
    if (stick.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [messages.at(-1)?.id, pending.length]);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (stick.current && list.current)
        list.current.scrollTop = list.current.scrollHeight;
    });
    for (const row of element.children) observer.observe(row);
    return () => observer.disconnect();
  }, [messages, pending]);
  const acknowledge = () => {
    if (
      visible &&
      stick.current &&
      list.current?.getClientRects().length &&
      list.current?.ownerDocument.visibilityState === "visible" &&
      list.current.ownerDocument.hasFocus() &&
      messages.length
    ) {
      const last = messages[messages.length - 1];
      if (last.conversation_id === conversation)
        instance.markRead(conversation, last.seq);
    }
  };
  useEffect(() => {
    const document = list.current?.ownerDocument;
    const window = document?.defaultView;
    if (!document || !window) return;
    acknowledge();
    window.addEventListener("focus", acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    return () => {
      window.removeEventListener("focus", acknowledge);
      document.removeEventListener("visibilitychange", acknowledge);
    };
  }, [messages, conversation, state.status, visible]);
  const navigateReply = (id: string) => {
    const reveal = () => {
      const owner = list.current?.ownerDocument;
      if (!owner) return false;
      const target = owner.getElementById(`message-${id}`);
      if (!target) return false;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlighted(id);
      owner.defaultView?.setTimeout(
        () => setHighlighted((current) => (current === id ? "" : current)),
        1600,
      );
      return true;
    };
    if (reveal() || !messages.some((message) => message.id === id)) return;
    setLimit((current) => current + 100);
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  };
  return (
    <div className="conversation-view" ref={dropTarget}>
      <div
        className="messages"
        ref={list}
        onScroll={() => {
          const e = list.current!;
          const resized = previousHeight.current !== e.scrollHeight;
          previousHeight.current = e.scrollHeight;
          // Scroll anchoring can move the viewport when an image loads or the
          // oldest row drops out of the 100-message window. Preserve following
          // through that layout change; scrolling back still disables it.
          if (resized && stick.current) e.scrollTop = e.scrollHeight;
          else
            stick.current = e.scrollHeight - e.scrollTop - e.clientHeight < 120;
          acknowledge();
        }}
      >
        <div className="history-note">
          <span>Downloaded messages stay on this device</span>
        </div>
        {messages.length > limit && (
          <button
            className="text-button load-more"
            onClick={() => {
              stick.current = false;
              setLimit(limit + 100);
            }}
          >
            Show older downloaded messages
          </button>
        )}
        {messages.slice(-limit).map((message, index, items) => (
          <MessageRow
            key={message.id}
            instance={instance}
            message={message}
            reply={messages.find((item) => item.id === message.reply_to_id)}
            highlighted={highlighted === message.id}
            canReply={
              writable &&
              !!instance.account.instance.capabilities?.includes(
                "messages.replies",
              )
            }
            onReply={setReplyingTo}
            onNavigateReply={navigateReply}
            grouped={
              index > 0 &&
              !message.reply_to_id &&
              items[index - 1].author_id === message.author_id &&
              items[index - 1].security === message.security &&
              items[index - 1].securityError === message.securityError &&
              items[index - 1].deleted === message.deleted &&
              Date.parse(message.created_at) -
                Date.parse(items[index - 1].created_at) <
                300_000
            }
          />
        ))}
        {pending.map((message) => (
          <div className="pending-message" key={message.request_id}>
            <p>{message.body || "Attachment message"}</p>
            <small>{message.error || "Sending…"}</small>
            {message.error && (
              <>
                <button
                  className="text-button"
                  onClick={() =>
                    void instance
                      .retry(message)
                      .catch((e) => setError(friendlyError(e)))
                  }
                >
                  Retry
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void instance
                      .discard(message.request_id)
                      .catch((e) => setError(friendlyError(e)))
                  }
                >
                  Discard
                </button>
              </>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <ErrorNotice error={error} />
      {writable ? (
        <Composer
          instance={instance}
          conversation={conversation}
          title={title}
          dropTarget={dropTarget}
          replyTo={replyingTo}
          onCancelReply={() => setReplyingTo(undefined)}
        />
      ) : (
        <p className="readonly">
          You can read this conversation. Sending messages is disabled by the
          server.
        </p>
      )}
      {writable && (
        <div className="file-drop-overlay" aria-hidden="true">
          <Paperclip size={32} />
          <strong>Drop images or videos</strong>
          <span>Add attachments to {title}</span>
        </div>
      )}
    </div>
  );
}
function MessageRow({
  instance,
  message,
  reply,
  grouped,
  highlighted,
  canReply,
  onReply,
  onNavigateReply,
}: {
  instance: InstanceClient;
  message: Message;
  reply?: Message;
  grouped: boolean;
  highlighted: boolean;
  canReply: boolean;
  onReply: (message: Message) => void;
  onNavigateReply: (id: string) => void;
}) {
  const user = instance.snapshot.users.find((u) => u.id === message.author_id),
    own = message.author_id === instance.account.login.user.id;
  const canRemove =
    own ||
    (can(instance, 4096) &&
      instance.snapshot.channels.some((c) => c.id === message.conversation_id));
  const [edit, setEdit] = useState(false),
    [remove, setRemove] = useState(false),
    [error, setError] = useState("");
  const menu = useContextMenu();
  const actions = menu(
    "Message options",
    <>
      {!message.deleted && (
        <>
          {canReply && (
            <MenuAction onClick={() => onReply(message)}>Reply</MenuAction>
          )}
          <MenuAction
            onClick={() => {
              void copyText(message.body).catch((e) =>
                setError(friendlyError(e)),
              );
            }}
          >
            Copy text
          </MenuAction>
        </>
      )}
      {canRemove && !message.deleted && (
        <>
          {own && (
            <MenuAction onClick={() => setEdit(true)}>Edit message</MenuAction>
          )}
          <MenuAction danger onClick={() => setRemove(true)}>
            Delete message…
          </MenuAction>
        </>
      )}
    </>,
  );
  return (
    <article
      id={`message-${message.id}`}
      className={`message ${grouped ? "grouped" : ""} ${highlighted ? "highlighted" : ""}`}
      tabIndex={0}
      onKeyDown={actions.onKeyDown}
      onContextMenu={(e) => {
        if (
          !(e.target as HTMLElement).closest("input, textarea, a, img, video")
        )
          actions.onContextMenu(e);
      }}
    >
      <div className="message-avatar">
        {!grouped && <Avatar instance={instance} user={user} />}
      </div>
      <div className="message-content">
        {!grouped && (
          <div className="message-meta">
            {instance.isDM(message.conversation_id) && !message.deleted && (
              <MessageSecurity message={message} />
            )}
            {user ? (
              <button
                className="user-name"
                onClick={() => openProfile(instance, user.id)}
              >
                {displayName(user)}
              </button>
            ) : (
              <strong>Deleted user</strong>
            )}
            {own && <span className="you">you</span>}
            <time
              dateTime={message.created_at}
              title={new Date(message.created_at).toLocaleString()}
            >
              {new Date(message.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>
        )}
        {!message.deleted && message.reply_to_id && (
          <button
            type="button"
            className="message-reply-reference"
            disabled={!reply}
            onClick={() => onNavigateReply(message.reply_to_id!)}
          >
            <span>
              {reply ? "Replying to" : "Original message unavailable"}
            </span>
            {reply && (
              <>
                <strong>
                  {displayName(
                    instance.snapshot.users.find(
                      (user) => user.id === reply.author_id,
                    ),
                  )}
                </strong>
                <q>
                  {reply.deleted
                    ? "Message deleted"
                    : reply.body || "Attachment message"}
                </q>
              </>
            )}
          </button>
        )}
        {message.deleted ? (
          <p className="deleted">Message deleted</p>
        ) : edit ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const body = String(
                new FormData(event.currentTarget).get("body"),
              );
              void instance
                .edit(message, body)
                .then(() => setEdit(false))
                .catch((e) => setError(friendlyError(e)));
            }}
          >
            <textarea name="body" defaultValue={message.body} autoFocus />
            <div className="button-row">
              <button className="secondary">Save</button>
              <button
                type="button"
                className="text-button"
                onClick={() => setEdit(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <Suspense fallback={<p className="message-body">{message.body}</p>}>
              <MessageText text={message.body} instance={instance} />
            </Suspense>
            {message.edited_at && <span className="edited">edited</span>}
            <MessageEmbeds
              key={`${message.id}:${message.edited_at ?? ""}`}
              instance={instance}
              message={message}
            />
            {(message.attachment_ids ?? []).map((id) => (
              <Attachment key={id} instance={instance} id={id} />
            ))}
          </>
        )}
        <ErrorNotice error={error} />
      </div>
      {(canReply || canRemove) && !message.deleted && !edit && (
        <div className="message-actions">
          {canReply && <button onClick={() => onReply(message)}>Reply</button>}
          {own && <button onClick={() => setEdit(true)}>Edit</button>}
          {canRemove && <button onClick={() => setRemove(true)}>Delete</button>}
        </div>
      )}
      {remove && (
        <Modal title="Delete this message?" onClose={() => setRemove(false)}>
          <p>This clears the message for everyone in the conversation.</p>
          <div className="button-row">
            <button
              className="danger"
              onClick={() =>
                void instance
                  .deleteMessage(message)
                  .then(() => setRemove(false))
                  .catch((e) => {
                    setError(friendlyError(e));
                    setRemove(false);
                  })
              }
            >
              Delete message
            </button>
            <button className="secondary" onClick={() => setRemove(false)}>
              Keep it
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}
function Composer({
  instance,
  conversation,
  title,
  dropTarget,
  replyTo,
  onCancelReply,
}: {
  instance: InstanceClient;
  conversation: string;
  title: string;
  dropTarget: RefObject<HTMLDivElement | null>;
  replyTo?: Message;
  onCancelReply: () => void;
}) {
  const direct = instance.isDM(conversation);
  const uploadsAllowed =
    !direct || !!instance.account.instance.limits.dm?.images_enabled;
  const key = `chatxo-draft:${instance.scope}:${conversation}`;
  const [body, setBody] = useState(() => sessionStorage.getItem(key) ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    file = useRef<HTMLInputElement>(null);
  const [uploads] = useState(() => new AttachmentDraft(instance, conversation));
  const uploadState = useSyncExternalStore(
    uploads.subscribe,
    uploads.getSnapshot,
  );
  const attachments = uploadState.entries.flatMap((entry) =>
    entry.attachment ? [entry.attachment] : [],
  );
  const uploading = uploadState.entries.some((entry) => !entry.attachment);
  useEffect(() => () => uploads.dispose(), [uploads]);
  useAttachmentDrop(dropTarget, uploads, busy);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo?.id]);
  const [emojiOpen, setEmojiOpen] = useState(false),
    [emojiIndex, setEmojiIndex] = useState(0),
    [emojiDismissed, dismissEmoji] = useState(false);
  const [caret, setCaret] = useState(0),
    [mentionIndex, setMentionIndex] = useState(0),
    [mentionDismissed, dismissMention] = useState(false);
  const query =
    !mentionDismissed &&
    /(^|[\s([{"'.,!?:;])@([a-zA-Z0-9_]{0,32})$/.exec(body.slice(0, caret));
  const candidates = query
    ? instance.snapshot.users
        .filter(
          (u) =>
            u.username.toLowerCase().startsWith(query[2].toLowerCase()) ||
            (u.display_name ?? "")
              .toLowerCase()
              .includes(query[2].toLowerCase()),
        )
        .slice(0, 8)
    : [];
  const emojiQuery =
    !emojiDismissed &&
    /(^|[\s([{]):([a-zA-Z0-9_]{0,32})$/.exec(body.slice(0, caret));
  const emojiCandidates = emojiQuery
    ? instance.snapshot.emojis
        .filter((e) => e.name.startsWith(emojiQuery[2].toLowerCase()))
        .slice(0, 8)
    : [];
  const insertEmoji = (value: string, completion = false, literal = false) => {
    const start =
      completion && emojiQuery ? caret - emojiQuery[2].length - 1 : caret;
    const end = completion ? caret : (input.current?.selectionEnd ?? caret);
    const text = literal ? `${value} ` : `:${value}: `;
    draft(body.slice(0, start) + text + body.slice(end));
    const next = start + text.length;
    setCaret(next);
    dismissEmoji(true);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next, next);
    });
  };
  const insertMention = (username: string) => {
    if (!query) return;
    const start = caret - query[2].length - 1,
      text = `@${username} `;
    draft(body.slice(0, start) + text + body.slice(caret));
    dismissMention(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        start + text.length,
        start + text.length,
      );
    });
  };
  const draft = (value: string) => {
    setBody(value);
    sessionStorage.setItem(key, value);
  };
  const send = async () => {
    if (busy || uploading || (!body.trim() && !attachments.length)) return;
    if (!uploads.lock()) return;
    setBusy(true);
    setError("");
    try {
      await instance.send(
        conversation,
        body,
        attachments.map((a) => a.id),
        replyTo?.id,
      );
      draft("");
      uploads.clear();
      onCancelReply();
    } catch (e) {
      setError(friendlyError(e));
      const pending = await instance.pending();
      if (
        pending.some(
          (m) => m.conversation_id === conversation && m.body === body,
        )
      ) {
        draft("");
        uploads.clear();
        onCancelReply();
      }
    } finally {
      uploads.unlock();
      setBusy(false);
    }
  };
  return (
    <div
      className="composer-wrap"
      data-update-busy={busy || uploadState.entries.length > 0}
      data-update-upload={busy || uploading}
      data-update-draft={!!body.trim() || uploadState.entries.length > 0}
    >
      {emojiOpen && (
        <Suspense
          fallback={
            <div className="emoji-picker" role="status">
              Loading emojis…
            </div>
          }
        >
          <EmojiPicker
            instance={instance}
            onPick={(text) => insertEmoji(text, false, true)}
            onClose={() => {
              setEmojiOpen(false);
              input.current?.focus();
            }}
          />
        </Suspense>
      )}
      {!emojiOpen && emojiCandidates.length > 0 && (
        <div
          className="mention-picker"
          id="emoji-completions"
          role="listbox"
          aria-label="Emoji suggestions"
        >
          {emojiCandidates.map((emoji, index) => (
            <button
              type="button"
              key={emoji.id}
              id={`emoji-option-${index}`}
              role="option"
              aria-selected={index === emojiIndex % emojiCandidates.length}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertEmoji(emoji.name, true)}
            >
              <EmojiImage instance={instance} emoji={emoji} />
              <span>:{emoji.name}:</span>
            </button>
          ))}
        </div>
      )}
      {candidates.length > 0 && (
        <div
          className="mention-picker"
          id="mention-picker"
          role="listbox"
          aria-label="Mention a person"
        >
          {candidates.map((user, index) => (
            <button
              type="button"
              id={`mention-option-${index}`}
              role="option"
              aria-selected={index === mentionIndex % candidates.length}
              key={user.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertMention(user.username)}
            >
              <Avatar instance={instance} user={user} />
              <span>
                {displayName(user)}
                <small>@{user.username}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <ErrorNotice error={error || uploadState.error} />
      {replyTo && (
        <div className="composer-reply" role="status">
          <div>
            <span>Replying to</span>
            <strong>
              {displayName(
                instance.snapshot.users.find(
                  (user) => user.id === replyTo.author_id,
                ),
              )}
            </strong>
            <small>{replyTo.body || "Attachment message"}</small>
          </div>
          <button
            type="button"
            className="icon"
            aria-label="Cancel reply"
            onClick={onCancelReply}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {uploadState.entries.length > 0 && (
        <div className="attachment-chips" aria-live="polite">
          {uploadState.entries.map((entry) => (
            <span key={entry.key} aria-busy={!entry.attachment}>
              <Paperclip size={12} />
              {entry.file.name}
              {!entry.attachment ? (
                <small>Uploading…</small>
              ) : (
                <button
                  className="icon"
                  disabled={busy}
                  aria-label={`Remove ${entry.file.name}`}
                  onClick={() => {
                    uploads.remove(entry.key);
                    void unwrap(
                      instance.http.DELETE("/api/v1/attachments/{id}", {
                        params: { path: { id: entry.attachment!.id } },
                      }),
                    ).catch((e) => setError(friendlyError(e)));
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {direct &&
        uploadState.entries.some((e) => e.file.type === "image/gif") && (
          <small className="muted">
            GIF uploads are sent as a still image.
          </small>
        )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {uploadsAllowed && (
          <button
            type="button"
            className="attach icon"
            aria-label={direct ? "Attach image" : "Attach image or video"}
            disabled={busy || uploadState.entries.length >= 8}
            onClick={() => file.current?.click()}
          >
            <Plus size={20} />
          </button>
        )}
        <input
          type="file"
          ref={file}
          hidden
          multiple
          accept={
            direct
              ? "image/png,image/jpeg,image/webp,image/gif"
              : ATTACHMENT_TYPES
          }
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) {
              setError("");
              uploads.add(files);
            }
          }}
        />
        <textarea
          aria-label="Message"
          ref={input}
          aria-autocomplete="list"
          aria-controls={
            emojiCandidates.length
              ? "emoji-completions"
              : candidates.length
                ? "mention-picker"
                : undefined
          }
          aria-activedescendant={
            emojiCandidates.length
              ? `emoji-option-${emojiIndex % emojiCandidates.length}`
              : candidates.length
                ? `mention-option-${mentionIndex % candidates.length}`
                : undefined
          }
          value={body}
          rows={1}
          placeholder={uploading ? "Uploading attachment…" : `Message ${title}`}
          onChange={(e) => {
            draft(e.target.value);
            setCaret(e.target.selectionStart);
            setMentionIndex(0);
            dismissMention(false);
            dismissEmoji(false);
            setEmojiIndex(0);
          }}
          onPaste={(e) => {
            if (!hasFiles(e.clipboardData)) return;
            e.preventDefault();
            if (busy) return;
            setError("");
            uploads.add(transferredFiles(e.clipboardData));
            // Preserve accompanying text, without inserting OS file paths/URIs.
            const text = e.clipboardData.getData("text/plain");
            if (text && !e.clipboardData.types.includes("text/uri-list")) {
              const start = e.currentTarget.selectionStart,
                end = e.currentTarget.selectionEnd;
              draft(body.slice(0, start) + text + body.slice(end));
              setCaret(start + text.length);
              requestAnimationFrame(() =>
                input.current?.setSelectionRange(
                  start + text.length,
                  start + text.length,
                ),
              );
            }
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (!emojiOpen && emojiCandidates.length) {
              if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                e.preventDefault();
                setEmojiIndex(
                  (v) =>
                    (v +
                      (e.key === "ArrowDown"
                        ? 1
                        : emojiCandidates.length - 1)) %
                    emojiCandidates.length,
                );
                return;
              }
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                e.preventDefault();
                insertEmoji(
                  emojiCandidates[emojiIndex % emojiCandidates.length].name,
                  true,
                );
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                dismissEmoji(true);
                return;
              }
            }
            if (candidates.length) {
              if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                e.preventDefault();
                setMentionIndex(
                  (v) =>
                    (v + (e.key === "ArrowDown" ? 1 : candidates.length - 1)) %
                    candidates.length,
                );
                return;
              }
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                e.preventDefault();
                insertMention(
                  candidates[mentionIndex % candidates.length].username,
                );
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                dismissMention(true);
                return;
              }
            }
            if (e.key === "Escape" && replyTo) {
              e.preventDefault();
              onCancelReply();
              return;
            }
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {instance.account.instance.capabilities?.includes(
          "community.emojis",
        ) && (
          <button
            type="button"
            className="icon"
            aria-label="Choose emoji"
            aria-expanded={emojiOpen}
            onClick={() => setEmojiOpen((v) => !v)}
          >
            <Smile size={20} />
          </button>
        )}
        <button
          className="send"
          aria-label="Send message"
          disabled={busy || uploading || (!body.trim() && !attachments.length)}
        >
          <ArrowUp size={19} />
        </button>
      </form>
      <div className="composer-hint">
        <span>
          <strong>Enter</strong> to send · <strong>Shift + Enter</strong> for a
          new line
        </span>
      </div>
    </div>
  );
}
export function NewDM({
  instance,
  instances,
  onClose,
  onCreated,
}: {
  instance?: InstanceClient;
  instances?: InstanceClient[];
  onClose: () => void;
  onCreated: (id: string, instance: InstanceClient) => void;
}) {
  const sources = useMemo(
    () => instances ?? (instance ? [instance] : []),
    [instances, instance],
  );
  const people = useAccountDirectory(sources);
  const [selected, setSelected] = useState<AccountEntry[]>([]),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(100);
  const matches = findAccounts(people, search);
  const target = selected[0]?.instance;
  return (
    <Modal title="Start a conversation" onClose={onClose}>
      <p className="muted">
        Choose up to 15 people. Group conversations stay on one server.
      </p>
      <input
        aria-label="Find people"
        placeholder="username@serveraddress"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setLimit(100);
        }}
      />
      <div className="people-list">
        {matches.slice(0, limit).map((entry) => (
          <label key={entry.key}>
            <Avatar instance={entry.instance} user={entry.user} />
            <span>
              {displayName(entry.user)}{" "}
              <small className="muted account-address">
                {entry.address}
                {!entry.online && " · Disconnected"}
              </small>
            </span>
            <input
              type="checkbox"
              aria-label={entry.address}
              checked={selected.some((person) => person.key === entry.key)}
              disabled={
                !entry.online ||
                (!!target && target !== entry.instance) ||
                (!selected.some((person) => person.key === entry.key) &&
                  selected.length >= 15)
              }
              onChange={() =>
                setSelected((v) =>
                  v.some((person) => person.key === entry.key)
                    ? v.filter((person) => person.key !== entry.key)
                    : [...v, entry],
                )
              }
            />
          </label>
        ))}
        {!matches.length && <p className="muted">No matching people.</p>}
        {matches.length > limit && (
          <button
            className="text-button"
            onClick={() => setLimit((value) => value + 100)}
          >
            Show more people
          </button>
        )}
      </div>
      <ErrorNotice error={error} />
      <button
        className="primary"
        disabled={
          busy || !selected.length || target?.snapshot.status !== "online"
        }
        onClick={() => {
          setBusy(true);
          void target!
            .createDM(selected.map((person) => person.user.id))
            .then((c) => onCreated(c.id, target!))
            .catch((e) => setError(friendlyError(e)))
            .finally(() => setBusy(false));
        }}
      >
        Start conversation
      </button>
    </Modal>
  );
}
