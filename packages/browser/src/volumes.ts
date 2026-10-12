import type { Purpose } from "@haunt/core";
export type AudioSource = "audio" | "camera_audio" | "screen_audio";
export type Volumes = Record<AudioSource, number>;
export const defaultVolumes: Readonly<Volumes> = Object.freeze({
  audio: 100,
  camera_audio: 100,
  screen_audio: 100,
});
const key = "chatxo-user-volumes-v1";
const listeners = new Set<() => void>();
const entryKey = (scope: string, user: string) => JSON.stringify([scope, user]);
function read(): Record<string, Volumes> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw)
        .slice(-2048)
        .filter(
          ([id, value]) =>
            id.length <= 1024 && value && typeof value === "object",
        )
        .map(([id, value]) => [
          id,
          Object.fromEntries(
            Object.keys(defaultVolumes).map((source) => {
              const n = (value as Volumes)[source as AudioSource];
              return [
                source,
                Number.isFinite(n)
                  ? Math.round(Math.max(0, Math.min(100, n)))
                  : 100,
              ];
            }),
          ) as Volumes,
        ]),
    );
  } catch {
    return {};
  }
}
let current = read();
export const getVolumes = () => current;
export const subscribeVolumes = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function userVolumes(scope: string, user: string): Readonly<Volumes> {
  return current[entryKey(scope, user)] ?? defaultVolumes;
}
export function playbackVolume(scope: string, user: string, purpose: Purpose) {
  return (userVolumes(scope, user)[purpose as AudioSource] ?? 100) / 100;
}
export function setUserVolume(
  scope: string,
  user: string,
  source: AudioSource,
  value: number,
) {
  if (!Number.isFinite(value)) return;
  const id = entryKey(scope, user);
  const next = {
    ...userVolumes(scope, user),
    [source]: Math.round(Math.max(0, Math.min(100, value))),
  };
  const entries = Object.entries(current)
    .filter(([k]) => k !== id)
    .slice(-2047);
  current = Object.fromEntries([...entries, [id, next]]);
  try {
    localStorage.setItem(key, JSON.stringify(current));
  } catch {}
  listeners.forEach((fn) => fn());
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) {
      current = read();
      listeners.forEach((fn) => fn());
    }
  });
