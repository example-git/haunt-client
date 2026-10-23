import type { InstanceClient } from "@haunt/core";
import type { VoiceIntent } from "./state";

export interface VoiceReconnect {
  instance: string;
  user: string;
  channel: string;
  intent: VoiceIntent;
}
const key = "haunt-voice-reconnect-v1";
const listeners = new Set<() => void>();
function read(): VoiceReconnect | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      value &&
      [value.instance, value.user, value.channel].every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 200,
      ) &&
      typeof value.intent?.muted === "boolean" &&
      typeof value.intent?.deafened === "boolean"
    )
      return value;
  } catch {}
}
let current = read();
export const getVoiceReconnect = () => current;
export const subscribeVoiceReconnect = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function write(value?: VoiceReconnect) {
  current = value;
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {}
  for (const listener of listeners) listener();
}
export function rememberVoice(
  instance: InstanceClient,
  channel: string,
  intent: VoiceIntent,
) {
  write({
    instance: instance.account.instance.instance_id,
    user: instance.account.login.user.id,
    channel,
    intent: { ...intent },
  });
}
export function clearVoiceReconnect(
  instance?: InstanceClient,
  channel?: string,
) {
  if (
    instance &&
    (current?.instance !== instance.account.instance.instance_id ||
      current.user !== instance.account.login.user.id)
  )
    return;
  if (channel && current?.channel !== channel) return;
  write();
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key !== key) return;
    current = read();
    for (const listener of listeners) listener();
  });
