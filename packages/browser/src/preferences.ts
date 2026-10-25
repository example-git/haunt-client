import { normalizeSavedThemes, type SavedTheme } from "./saved-themes";
import {
  defaultScreenMode,
  validVideoMode,
  type VideoMode,
} from "./media/video-settings";
import {
  defaultTheme,
  normalizeTheme,
  restoreTheme,
  type ThemePreferences,
} from "./themes";
import {
  isNotificationSound,
  soundOverrides,
  soundLibrary,
  type NotificationSound,
} from "./notification-sound-options";
import {
  parsePluginPreferences,
  type ServerPluginPreferences,
} from "./audio-plugins/saved-settings";
import { openDB } from "idb";
import { defaultAccent, normalizeAccent } from "./palette";
import type { NotificationPolicy, NotificationRule } from "@haunt/core";
import {
  normalizeNarratorSettings,
  normalizeNarratorServers,
  type NarratorSettings,
} from "./narrator/settings";
export interface ClientPreferences extends NotificationPolicy {
  narrator: NarratorSettings;
  narratorServers: Record<string, NarratorSettings>;
  audioPlugins: Record<string, ServerPluginPreferences>;
  accentColor: string;
  chatDisplay: "default" | "compact";
  theme: ThemePreferences;
  savedThemes: SavedTheme[];
  microphone: string;
  audioOutput: string;
  camera: string;
  cameraAudio: string;
  cameraModes: Record<string, VideoMode>;
  screenMode: VideoMode;
  noiseSuppression: boolean;
  noiseSuppressionNoticeShown: boolean;
  automaticGainControl: boolean;
  microphoneGain: number;
  sound: NotificationSound;
  serverSounds: Record<string, NotificationSound>;
  conversationSounds: Record<string, NotificationSound>;
  userSounds: Record<string, NotificationSound>;
  users: Record<string, NotificationRule>;
  savedSounds: Record<string, string>;
  memberListsCollapsed: Record<string, boolean>;
  collapsedCategories: Record<string, boolean>;
  voiceChatHidden: boolean;
  dmFavorites: Record<string, boolean>;
  volume: number;
  desktopPopups: boolean;
  previewMessages: boolean;
  customSoundName: string;
  servers: Record<string, NotificationRule>;
  channels: Record<string, NotificationRule>;
}
const defaults: ClientPreferences = {
  narrator: normalizeNarratorSettings(undefined),
  narratorServers: {},
  audioPlugins: {},
  accentColor: defaultAccent,
  chatDisplay: "default",
  theme: defaultTheme,
  savedThemes: [],
  enabled: true,
  mentions: true,
  directMessages: true,
  channelMessages: false,
  whileViewing: false,
  microphone: "",
  audioOutput: "",
  camera: "",
  cameraAudio: "",
  cameraModes: {},
  screenMode: defaultScreenMode,
  noiseSuppression: true,
  noiseSuppressionNoticeShown: false,
  automaticGainControl: true,
  microphoneGain: 100,
  sound: "ping",
  serverSounds: {},
  conversationSounds: {},
  userSounds: {},
  users: {},
  savedSounds: {},
  memberListsCollapsed: {},
  collapsedCategories: {},
  voiceChatHidden: false,
  dmFavorites: {},
  volume: 50,
  desktopPopups: false,
  previewMessages: true,
  customSoundName: "",
  servers: {},
  channels: {},
};
const key = "chatxo-client-preferences-v1";
const listeners = new Set<() => void>();
function rules(raw: unknown): Record<string, NotificationRule> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .slice(0, 2048)
      .filter(
        ([key, value]) =>
          key.length <= 200 &&
          ["inherit", "all", "mentions", "mute"].includes(String(value)),
      ),
  ) as Record<string, NotificationRule>;
}
function collapsedLists(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .slice(0, 128)
      .filter(([id, value]) => id.length <= 128 && typeof value === "boolean"),
  ) as Record<string, boolean>;
}
function favorites(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .slice(0, 2048)
      .filter(([id, value]) => id.length <= 300 && value === true),
  );
}
function read(): ClientPreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
    const next = { ...defaults };
    next.narrator = normalizeNarratorSettings(raw.narrator);
    next.narratorServers = normalizeNarratorServers(raw.narratorServers);
    next.audioPlugins = parsePluginPreferences(raw.audioPlugins);
    next.accentColor = normalizeAccent(raw.accentColor);
    if (raw.chatDisplay === "compact") next.chatDisplay = "compact";
    next.theme = restoreTheme(raw.theme);
    next.savedThemes = normalizeSavedThemes(raw.savedThemes);
    if (
      raw.cameraModes &&
      typeof raw.cameraModes === "object" &&
      !Array.isArray(raw.cameraModes)
    )
      next.cameraModes = Object.fromEntries(
        Object.entries(raw.cameraModes).filter(
          ([key, mode]) => key.length <= 256 && validVideoMode(mode),
        ),
      ) as Record<string, VideoMode>;
    if (
      typeof window !== "undefined" &&
      window.hauntDesktop?.nativeCaptureAvailable
    )
      next.cameraModes = Object.fromEntries(
        Object.entries(next.cameraModes).map(([id, mode]) => [
          id,
          mode.fps >= 0.5 ? { ...mode, fps: Math.round(mode.fps) } : mode,
        ]),
      );
    if (validVideoMode(raw.screenMode)) next.screenMode = raw.screenMode;
    for (const field of [
      "enabled",
      "mentions",
      "directMessages",
      "channelMessages",
      "whileViewing",
      "desktopPopups",
      "previewMessages",
      "noiseSuppression",
      "noiseSuppressionNoticeShown",
      "automaticGainControl",
      "voiceChatHidden",
    ] as const)
      if (typeof raw[field] === "boolean") next[field] = raw[field];
    for (const field of [
      "microphone",
      "audioOutput",
      "camera",
      "cameraAudio",
      "customSoundName",
    ] as const)
      if (typeof raw[field] === "string")
        next[field] = raw[field].slice(0, 256);
    if (isNotificationSound(raw.sound)) next.sound = raw.sound;
    if (Number.isFinite(raw.volume))
      next.volume = Math.max(0, Math.min(100, raw.volume));
    if (Number.isFinite(raw.microphoneGain))
      next.microphoneGain = Math.round(
        Math.max(0, Math.min(200, raw.microphoneGain)),
      );
    next.memberListsCollapsed = collapsedLists(raw.memberListsCollapsed);
    next.collapsedCategories = favorites(raw.collapsedCategories);
    next.dmFavorites = favorites(raw.dmFavorites);
    next.serverSounds = soundOverrides(raw.serverSounds);
    next.conversationSounds = soundOverrides(raw.conversationSounds);
    next.userSounds = soundOverrides(raw.userSounds);
    next.users = rules(raw.users);
    next.savedSounds = soundLibrary(raw.savedSounds);
    next.servers = rules(raw.servers);
    next.channels = rules(raw.channels);
    return next;
  } catch {
    return { ...defaults, servers: {}, channels: {} };
  }
}
let current = read();
export const getPreferences = () => current;
export const subscribePreferences = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export function setPreferences(patch: Partial<ClientPreferences>) {
  if (patch.screenMode && !validVideoMode(patch.screenMode))
    throw Error("Invalid screen-share video setting.");
  if (
    patch.cameraModes &&
    Object.values(patch.cameraModes).some((mode) => !validVideoMode(mode))
  )
    throw Error("Invalid camera video setting.");
  if (
    patch.cameraModes &&
    typeof window !== "undefined" &&
    window.hauntDesktop?.nativeCaptureAvailable &&
    Object.values(patch.cameraModes).some((mode) => !Number.isInteger(mode.fps))
  )
    throw Error("Choose a whole-number camera frame rate.");
  if (
    "chatDisplay" in patch &&
    patch.chatDisplay !== "default" &&
    patch.chatDisplay !== "compact"
  )
    throw new Error("Choose Default or Compact message display.");
  const enablingSuppression =
    patch.noiseSuppression === true && !current.noiseSuppression;
  current = { ...current, ...patch };
  current.narrator = normalizeNarratorSettings(current.narrator);
  current.narratorServers = normalizeNarratorServers(current.narratorServers);
  if (enablingSuppression) current.noiseSuppressionNoticeShown = false;
  current.audioPlugins = parsePluginPreferences(current.audioPlugins);
  current.memberListsCollapsed = collapsedLists(current.memberListsCollapsed);
  current.collapsedCategories = favorites(current.collapsedCategories);
  current.dmFavorites = favorites(current.dmFavorites);
  current.serverSounds = soundOverrides(current.serverSounds);
  current.conversationSounds = soundOverrides(current.conversationSounds);
  current.userSounds = soundOverrides(current.userSounds);
  current.users = rules(current.users);
  current.savedSounds = soundLibrary(current.savedSounds);
  if (!isNotificationSound(current.sound)) current.sound = "ping";
  current.accentColor = normalizeAccent(current.accentColor);
  current.theme = normalizeTheme(current.theme);
  current.savedThemes = normalizeSavedThemes(current.savedThemes);
  current.microphoneGain = Number.isFinite(current.microphoneGain)
    ? Math.round(Math.max(0, Math.min(200, current.microphoneGain)))
    : 100;
  try {
    localStorage.setItem(key, JSON.stringify(current));
  } catch {}
  listeners.forEach((fn) => fn());
}
export const channelPreferenceKey = (instance: string, channel: string) =>
  JSON.stringify([instance, channel]);
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key === key) {
      current = read();
      listeners.forEach((fn) => fn());
    }
  });
const soundDB = () =>
  openDB("chatxo-client-sound-v1", 1, {
    upgrade(db) {
      db.createObjectStore("sounds");
    },
  });
export async function customSound(id = "ping"): Promise<Blob | undefined> {
  const db = await soundDB();
  try {
    return await db.get("sounds", id);
  } finally {
    db.close();
  }
}
export async function saveCustomSound(blob: Blob | null, id = "ping") {
  const db = await soundDB();
  try {
    const tx = db.transaction("sounds", "readwrite");
    if (blob && id !== "ping") {
      const keys = await tx.store.getAllKeys(),
        values = await tx.store.getAll();
      const used = values.reduce(
        (n, value, i) =>
          n + (keys[i] !== id && keys[i] !== "ping" ? value.size : 0),
        0,
      );
      if (
        blob.size + used > 8 * 1024 * 1024 ||
        (!keys.includes(id) && keys.filter((k) => k !== "ping").length >= 16)
      ) {
        await tx.done;
        throw Error(
          "Saved notification sounds are full. Remove an unused sound in Notification Settings.",
        );
      }
    }
    if (blob) await tx.store.put(blob, id);
    else await tx.store.delete(id);
    await tx.done;
  } finally {
    db.close();
  }
}

/** Replace the saved clip library atomically so a failed restore retains old audio. */
export async function restoreNotificationSounds(clips: Record<string, Blob>) {
  const entries = Object.entries(clips);
  if (
    entries.length > 16 ||
    entries.reduce((n, [, blob]) => n + blob.size, 0) > 8 * 1024 * 1024 ||
    entries.some(
      ([id, blob]) =>
        !/^clip:[a-f0-9]{64}$/.test(id) ||
        !blob.size ||
        blob.size > 2 * 1024 * 1024,
    )
  )
    throw Error("Invalid notification sound library.");
  const db = await soundDB();
  try {
    const tx = db.transaction("sounds", "readwrite");
    for (const id of await tx.store.getAllKeys())
      if (id !== "ping") await tx.store.delete(id);
    for (const [id, blob] of entries) await tx.store.put(blob, id);
    await tx.done;
  } finally {
    db.close();
  }
}
