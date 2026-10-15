import { useCallback, useSyncExternalStore } from "react";
import type { Call } from "@haunt/browser/media/call";

export function useSpeaking(call: Call | undefined, participant: string) {
  return useSyncExternalStore(
    useCallback(
      (listener) =>
        call?.speaking.subscribe(participant, listener) ?? (() => {}),
      [call, participant],
    ),
    useCallback(
      () => call?.speaking.isSpeaking(participant) ?? false,
      [call, participant],
    ),
  );
}
