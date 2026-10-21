import { resolveNotificationSound } from "./notification-sound-options";
import {
  mentions,
  shouldNotify,
  type InstanceClient,
  type Message,
  type WireEvent,
} from "@haunt/core";
import { channelPreferenceKey, getPreferences } from "./preferences";
import { playPing } from "./sounds";
import { reportNotificationError } from "./notification-health";
export {
  reportNotificationError,
  notificationError,
  subscribeNotificationHealth,
} from "./notification-health";
export interface Ping {
  direct?: boolean;
  author?: string;
  id: string;
  scope: string;
  instance: string;
  conversation: string;
  title: string;
  body: string;
  at: number;
}
export class NotificationCenter {
  private items: Ping[] = [];
  private listeners = new Set<() => void>();
  private seen = new Set<string>();
  viewing: (scope: string, conversation: string) => boolean = () => false;
  deliver: (ping: Ping) => void = () => {};
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.items;
  private change(items: Ping[]) {
    this.items = items;
    this.listeners.forEach((fn) => fn());
  }
  clear(scope?: string, conversation?: string) {
    this.change(
      this.items.filter(
        (p) =>
          scope &&
          (p.scope !== scope ||
            (conversation && p.conversation !== conversation)),
      ),
    );
  }
  attach(instance: InstanceClient) {
    let floor = instance.liveEventCursor;
    const pending = new Map<string, Message>();
    const deliver = (m: Message) => {
      const channel = instance.snapshot.channels.find(
        (c) => c.id === m.conversation_id,
      );
      const conversation = instance.snapshot.conversations.find(
        (c) => c.id === m.conversation_id,
      );
      if (
        instance.snapshot.status !== "online" ||
        (!channel && !conversation)
      ) {
        pending.set(m.id, m);
        if (pending.size > 128) pending.delete(pending.keys().next().value!);
        return;
      }
      pending.delete(m.id);
      const key = JSON.stringify([instance.scope, m.id]);
      if (this.seen.has(key)) return;
      this.seen.add(key);
      if (this.seen.size > 2048)
        this.seen.delete(this.seen.values().next().value!);
      const prefs = getPreferences(),
        user = instance.account.login.user,
        id = instance.account.instance.instance_id;
      if (
        !shouldNotify(prefs, {
          own: m.author_id === user.id,
          mentioned: m.mention_user_ids
            ? m.mention_user_ids.includes(user.id)
            : mentions(m.body).some(
                (m) => m.username === user.username.toLowerCase(),
              ),
          direct: conversation?.kind === "dm",
          viewing: this.viewing(instance.scope, m.conversation_id),
          serverRule: prefs.servers[id],
          userRule: prefs.users[channelPreferenceKey(id, m.author_id)],
          channelRule:
            prefs.channels[channelPreferenceKey(id, m.conversation_id)],
        })
      )
        return;
      const author = instance.snapshot.users.find((u) => u.id === m.author_id);
      const ping: Ping = {
        direct: conversation?.kind === "dm",
        author: m.author_id,
        id: key,
        scope: instance.scope,
        instance: id,
        conversation: m.conversation_id,
        title:
          `${author?.display_name || author?.username || "Someone"} · ${channel ? `#${channel.name}` : "Direct message"} · ${instance.account.instance.name}`.slice(
            0,
            240,
          ),
        body: m.body.slice(0, 400) || "Sent an attachment",
        at: Date.now(),
      };
      this.change([ping, ...this.items].slice(0, 50));
      this.deliver(ping);
    };
    const prune = () => {
      const s = instance.snapshot;
      if (s.status === "signed-out") {
        pending.clear();
        this.clear(instance.scope);
        return;
      }
      if (s.status !== "online") return;
      for (const m of [...pending.values()]) deliver(m);
      const ids = new Set([...s.channels, ...s.conversations].map((c) => c.id));
      const remaining = this.items.filter(
        (p) => p.scope !== instance.scope || ids.has(p.conversation),
      );
      if (remaining.length !== this.items.length) this.change(remaining);
    };
    const off = instance.onWire((event: WireEvent) => {
      if (event.type === "ready" && Number.isSafeInteger(event.event_cursor)) {
        floor = Number(event.event_cursor);
        pending.clear();
        return;
      }
      if (event.type === "subscription.revoked") {
        for (const [id, m] of pending)
          if (m.conversation_id === event.conversation_id) pending.delete(id);
        this.clear(instance.scope, String(event.conversation_id));
        return;
      }
      if (["message.updated", "message.deleted"].includes(event.type)) {
        const message = event.data as Message;
        if (
          !message ||
          typeof message.id !== "string" ||
          message.conversation_id !== event.conversation_id
        )
          return;
        if (pending.has(message.id)) {
          if (event.type === "message.deleted" || message.deleted)
            pending.delete(message.id);
          else pending.set(message.id, message);
        }
        const key = JSON.stringify([instance.scope, message.id]);
        if (!this.items.some((p) => p.id === key)) return;
        if (event.type === "message.deleted" || message.deleted)
          this.change(this.items.filter((p) => p.id !== key));
        else if (typeof message.body === "string")
          this.change(
            this.items.map((p) =>
              p.id === key
                ? {
                    ...p,
                    body: message.body.slice(0, 400) || "Sent an attachment",
                  }
                : p,
            ),
          );
        return;
      }
      if (
        !["message.created", "message.discovered"].includes(event.type) ||
        !["syncing", "online"].includes(instance.snapshot.status)
      )
        return;
      if (event.type === "message.created") {
        if (!Number.isSafeInteger(event.id) || Number(event.id) <= floor)
          return;
        floor = Number(event.id);
      }
      const m = event.data as Message;
      if (
        !m ||
        typeof m.id !== "string" ||
        typeof m.body !== "string" ||
        typeof m.author_id !== "string" ||
        m.conversation_id !== event.conversation_id ||
        m.deleted
      )
        return;
      deliver(m);
    });
    const unsubscribe = instance.subscribe(prune);
    return () => {
      off();
      unsubscribe();
      this.clear(instance.scope);
    };
  }
}
export const notifications = new NotificationCenter();
export function popupPermission(): string {
  if (window.hauntDesktop) return "desktop";
  return typeof Notification === "undefined"
    ? "unavailable"
    : Notification.permission;
}
export async function enablePopups() {
  if (window.hauntDesktop) {
    if (!(await window.hauntDesktop.notificationAvailable()))
      throw Error("Desktop notifications are unavailable on this system.");
    return;
  }
  if (typeof Notification === "undefined")
    throw Error(
      "Desktop popups need a supported browser on HTTPS or localhost.",
    );
  if ((await Notification.requestPermission()) !== "granted")
    throw Error(
      "Allow notifications for this site in your browser settings to enable desktop popups.",
    );
}
const livePopups = new Set<Notification>();
export async function deliverPing(
  ping: Ping,
  open: (ping: Pick<Ping, "instance" | "conversation">) => void,
) {
  const prefs = getPreferences();
  const sound = playPing(
    false,
    resolveNotificationSound(
      prefs,
      ping.instance,
      ping.conversation,
      ping.direct ? ping.author : undefined,
    ),
  ).catch((error) => {
    const message = `Notification sound failed: ${error instanceof Error ? error.message : String(error)}`;
    reportNotificationError(message);
    return message;
  });
  const popup = showPopup(ping, open);
  return `${await popup} ${await sound}`;
}
async function showPopup(
  ping: Ping,
  open: (ping: Pick<Ping, "instance" | "conversation">) => void,
) {
  const prefs = getPreferences();
  if (!prefs.desktopPopups) return "Desktop popups are disabled in Haunt.";
  if (document.visibilityState === "visible" && document.hasFocus())
    return "Popup suppressed because Haunt still has focus.";
  const payload = {
    title: ping.title,
    body: prefs.previewMessages ? ping.body : "New message",
    instance: ping.instance,
    conversation: ping.conversation,
  };
  if (window.hauntDesktop) {
    try {
      const result = await window.hauntDesktop.showNotification(payload);
      return result === "shown"
        ? "The system acknowledged the popup. Visibility still depends on system notification settings."
        : "Popup delivery is unconfirmed: the system did not acknowledge it.";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportNotificationError(message);
      return `Popup failed: ${message}`;
    }
  }
  if (popupPermission() !== "granted")
    return "Popup blocked: this browser has not granted notification permission.";
  try {
    const popup = new Notification(payload.title, {
      body: payload.body,
      tag: `${ping.scope}:${ping.conversation}`,
      silent: true,
    });
    livePopups.add(popup);
    while (livePopups.size > 50) {
      const oldest = livePopups.values().next().value!;
      oldest.close();
      livePopups.delete(oldest);
    }
    popup.onclose = () => livePopups.delete(popup);
    popup.onclick = () => {
      window.focus();
      open(ping);
      popup.close();
      livePopups.delete(popup);
    };
    return await new Promise<string>((resolve) => {
      const timeout = setTimeout(() => {
        const message =
          "Popup delivery is unconfirmed: the browser did not acknowledge it.";
        reportNotificationError(message);
        resolve(message);
      }, 8000);
      popup.onshow = () => {
        clearTimeout(timeout);
        resolve(
          "The browser acknowledged the popup. Visibility still depends on system notification settings.",
        );
      };
      popup.onerror = () => {
        clearTimeout(timeout);
        const message =
          "The browser could not display a notification. Check site permissions.";
        reportNotificationError(message);
        resolve(`Popup failed: ${message}`);
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportNotificationError(message);
    return `Popup failed: ${message}`;
  }
}
