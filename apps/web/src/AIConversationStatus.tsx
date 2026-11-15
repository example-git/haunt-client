import { useEffect, useSyncExternalStore } from "react";
import {
  activeAITurn,
  AIUsePermission,
  AISwitchPermission,
  type InstanceClient,
} from "@haunt/core";
import { Status, useAction } from "./Customization";
import { can, Permission } from "./Permissions";
export function useAIChannel(instance: InstanceClient, channel: string) {
  const connection = useSyncExternalStore(
    instance.subscribe,
    instance.getSnapshot,
  );
  const state = useSyncExternalStore(instance.ai.subscribe, () =>
    instance.ai.channel(channel),
  );
  const isAI = connection.channels.some(
    (c) => c.id === channel && c.kind === "ai",
  );
  useEffect(() => {
    if (isAI && connection.status === "online")
      void instance.ai.refresh(channel).catch(() => {});
  }, [instance, channel, isAI, connection.status]);
  return state;
}
const statusNames: Record<string, string> = {
  queued: "Queued",
  running: "Responding",
  waiting: "Waiting for provider",
  requires_auth: "Reconnect the AI account",
  completed: "Completed",
  failed: "Response failed",
  cancelled: "Cancelled",
  interrupted: "Response interrupted",
};
export function AIConversationStatus({
  instance,
  channel,
}: {
  instance: InstanceClient;
  channel: string;
}) {
  const state = useAIChannel(instance, channel);
  const action = useAction();
  const record = instance.snapshot.channels.find((c) => c.id === channel);
  if (record?.kind !== "ai") return null;
  const permitted =
    can(instance, Permission.Administrator) ||
    !!((record.permissions ?? 0) & AIUsePermission);
  const switching =
    can(instance, Permission.Administrator) ||
    !!((record.permissions ?? 0) & AISwitchPermission);
  const preset = state.presets.find(
    (p) => p.id === state.settings?.active_preset_id,
  );
  const turns = state.turns
    .filter((t) => activeAITurn(t) || t.status !== "completed")
    .slice(-5);
  return (
    <section
      className="ai-conversation-status"
      aria-label="AI conversation status"
    >
      <div>
        <strong>{preset?.name || state.settings?.name || "AI"}</strong>
        <span className="muted">
          {" "}
          ·{" "}
          {state.settings?.model || "Choose an integration in channel settings"}
        </span>
      </div>
      <p className="muted small">
        {permitted
          ? "Your messages automatically request a response."
          : "You can post here. Your role cannot request AI responses."}{" "}
        {switching
          ? "Mention a preset to select it for this channel."
          : "Your role cannot change the active preset."}
      </p>
      {state.error && (
        <p role="alert">
          {state.error}
          <button
            onClick={() => void instance.ai.refresh(channel).catch(() => {})}
          >
            Retry
          </button>
        </p>
      )}
      {turns.map((turn) => (
        <article key={turn.id} data-ai-turn={turn.id}>
          <span role="status">
            {statusNames[turn.status] || turn.status}
            {turn.retry_at
              ? ` · retry available ${new Date(turn.retry_at).toLocaleTimeString()}`
              : ""}
          </span>
          {turn.error_code && (
            <p role="alert">{turn.error_code.replaceAll("_", " ")}</p>
          )}
          {activeAITurn(turn) && turn.partial_text && (
            <div className="ai-stream" aria-label="AI response in progress">
              {turn.partial_text}
            </div>
          )}
          {(turn.actor_id === instance.account.login.user.id ||
            can(instance, Permission.ManageChannels)) && (
            <div className="button-row">
              {activeAITurn(turn) ? (
                <button
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await instance.ai.request(
                        `/api/v1/channels/${channel}/ai/turns/${turn.id}/cancel`,
                        "POST",
                      );
                      await instance.ai.refresh(channel);
                    }, "Response cancelled.")
                  }
                >
                  Cancel response
                </button>
              ) : (
                permitted &&
                [
                  "failed",
                  "interrupted",
                  "requires_auth",
                  "cancelled",
                ].includes(turn.status) && (
                  <button
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await instance.ai.request(
                          `/api/v1/channels/${channel}/ai/turns/${turn.id}/retry`,
                          "POST",
                        );
                        await instance.ai.refresh(channel);
                      }, "Retry queued.")
                    }
                  >
                    Retry response
                  </button>
                )
              )}
            </div>
          )}
        </article>
      ))}
      <Status action={action} />
    </section>
  );
}
