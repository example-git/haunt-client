import type { ReadState } from "@haunt/core";

export const notificationTestInstance = "haunt-notification-test";
export const notificationTestConversation =
  "4f49557e-936b-4518-86be-47f695df9ec0";
let states: Record<string, ReadState> = {};
const listeners = new Set<() => void>();
let expiry: ReturnType<typeof setTimeout> | undefined;

export const notificationTestReadStates = () => states;
export const notificationTestActive = () => Object.keys(states).length > 0;
export function subscribeNotificationTest(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function clearNotificationTest() {
  clearTimeout(expiry);
  states = {};
  listeners.forEach((listener) => listener());
}
export function beginNotificationTest() {
  clearTimeout(expiry);
  states = {
    [notificationTestConversation]: {
      conversation_id: notificationTestConversation,
      kind: "dm",
      read_seq: 0,
      last_seq: 1,
      unread_count: 1,
      mention_count: 0,
      event_cursor: 0,
    },
  };
  listeners.forEach((listener) => listener());
  expiry = setTimeout(clearNotificationTest, 60_000);
}
