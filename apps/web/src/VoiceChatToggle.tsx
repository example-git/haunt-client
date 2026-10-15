import { useSyncExternalStore } from "react";
import { MessageSquare } from "lucide-react";
import type { InstanceClient } from "@haunt/core";
import {
  getPreferences,
  setPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";

export function VoiceChatToggle({
  instance,
  room,
  onOpen,
}: {
  instance: InstanceClient;
  room: string;
  onOpen?: () => void;
}) {
  const { voiceChatHidden } = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
  );
  const state = useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  const hidden = voiceChatHidden || !!onOpen;
  const unread = hidden ? (state.readStates[room]?.unread_count ?? 0) : 0;
  const label = hidden ? "Show chat" : "Hide chat";
  return (
    <button
      className={`icon voice-chat-toggle ${hidden ? "" : "active"}`}
      aria-label={label}
      title={label}
      aria-expanded={!hidden}
      onClick={() => {
        setPreferences({ voiceChatHidden: !hidden });
        if (hidden) onOpen?.();
      }}
    >
      <MessageSquare size={18} />
      {unread > 0 && (
        <span
          className="voice-chat-badge"
          aria-label={`${unread} unread chat messages`}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
