import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const tick = () => {
  now = Date.now();
  listeners.forEach((fn) => fn());
};
function visibility() {
  clearInterval(timer);
  timer = undefined;
  tick();
  if (!document.hidden && listeners.size) timer = setInterval(tick, 1000);
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", visibility);
    visibility();
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", visibility);
    }
  };
}
export function elapsedCallTime(joinedAt: string, at: number) {
  const start = Date.parse(joinedAt);
  if (!Number.isFinite(start)) return "";
  const seconds = Math.max(0, Math.floor((at - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function CallTimer({ joinedAt }: { joinedAt?: string }) {
  const at = useSyncExternalStore(subscribe, () => now);
  if (!joinedAt) return null;
  const elapsed = elapsedCallTime(joinedAt, at);
  return elapsed ? (
    <time
      className="call-timer"
      dateTime={joinedAt}
      title={`Joined ${new Date(joinedAt).toUTCString()}`}
      aria-label={`Call duration ${elapsed}`}
    >
      {elapsed}
    </time>
  ) : null;
}
