import { useEffect, useState, useSyncExternalStore } from "react";
import { LoaderCircle } from "lucide-react";
import {
  activeAITurn,
  AIUsePermission,
  type AITurn,
  type InstanceClient,
} from "@haunt/core";
import { Status, useAction } from "./Customization";
import { canInChannel, Permission } from "./Permissions";

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
    if (isAI) return instance.ai.watch(channel);
  }, [instance, channel, isAI]);
  return state;
}

const labels: Record<string, string> = {
  queued: "Queued",
  running: "Responding",
  waiting: "Waiting to retry",
  requires_auth: "Reconnect the AI account",
  failed: "Response failed",
  cancelled: "Response cancelled",
  interrupted: "Response interrupted",
  provider: "Responding",
  provider_rate_limited: "Waiting to retry",
  web_search: "Searching the web",
  read_url: "Reading page",
  waiting_for_provider: "Waiting for provider",
  waiting_for_slot: "Waiting for fetch slot",
  tool_running: "Using tool",
  image_generate: "Generating image",
  image_edit: "Editing image",
  switch_personality: "Selecting personality",
};

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  if (!Number.isFinite(seconds)) return null;
  return (
    <span className="muted" aria-label="Time since last activity">
      {seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m"}
    </span>
  );
}

export function AIConversationStatus({
  instance,
  channel,
}: {
  instance: InstanceClient;
  channel: string;
}) {
  const state = useAIChannel(instance, channel);
  const action = useAction();
  if (
    !instance.snapshot.channels.some((c) => c.id === channel && c.kind === "ai")
  )
    return null;
  const turn =
    state.turns.find((t) => t.status === "running" || t.status === "waiting") ??
    state.turns.find((t) => t.status === "queued") ??
    state.turns.at(-1);
  if (state.error && !turn)
    return (
      <div role="alert" className="ai-conversation-status">
        {state.error}
        <button
          disabled={action.busy}
          onClick={() =>
            void action.run(() => instance.ai.refresh(channel), "")
          }
        >
          Retry
        </button>
      </div>
    );
  if (!turn || turn.status === "completed")
    return canInChannel(instance, channel, AIUsePermission) ? null : (
      <p className="ai-conversation-status muted">
        You can post here. Your role cannot request AI responses.
      </p>
    );
  const active = activeAITurn(turn);
  const phase = (active && turn.action) || turn.status;
  const mayAct =
    turn.actor_id === instance.account.login.user.id ||
    canInChannel(instance, channel, Permission.ManageChannels);
  const retry =
    !active &&
    ["failed", "interrupted", "requires_auth", "cancelled"].includes(
      turn.status,
    ) &&
    canInChannel(instance, channel, AIUsePermission);
  const command = active ? "cancel" : "retry";
  return (
    <section
      className="ai-conversation-status"
      aria-label="AI conversation status"
      data-ai-turn={turn.id}
    >
      {active && (
        <LoaderCircle
          size={15}
          className="ai-activity-spinner"
          aria-hidden="true"
        />
      )}
      <span role="status" className="ai-activity-label">
        {labels[phase] ?? phase.replaceAll("_", " ")}
        {(active ? turn.detail : turn.error_code) && (
          <span className="muted">
            {" "}
            · {active ? turn.detail : turn.error_code?.replaceAll("_", " ")}
          </span>
        )}
      </span>
      {active && <Elapsed since={turn.last_progress_at || turn.updated_at} />}
      {mayAct && (active || retry) && (
        <button
          type="button"
          className="text-button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const result = await instance.ai.request<AITurn>(
                `/api/v1/channels/${channel}/ai/turns/${turn.id}/${command}`,
                "POST",
              );
              instance.ai.updateTurn(result);
            }, "")
          }
        >
          {active ? "Cancel response" : "Retry response"}
        </button>
      )}
      <Status action={action} />
    </section>
  );
}
