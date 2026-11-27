import { useEffect, useState, useSyncExternalStore } from "react";
import { Bot, LoaderCircle } from "lucide-react";
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
  attach_image: "Attaching image",
  preview_image: "Inspecting draft",
  search_conversation: "Searching channel history",
  resolve_media: "Looking up media",
  clock: "Checking date and time",
  image_generate: "Generating image",
  image_edit: "Editing image",
  consult_personality: "Consulting personality",
  switch_personality: "Selecting personality",
  view_user_profile: "Viewing profile",
};

export function AIChannelHeader({
  instance,
  channel,
}: {
  instance: InstanceClient;
  channel: string;
}) {
  const settings = useSyncExternalStore(
    instance.ai.subscribe,
    () => instance.ai.channel(channel).settings,
  );
  if (!settings) return null;
  return (
    <section className="ai-channel-header" aria-label="AI provider and model">
      <Bot size={16} aria-hidden="true" />
      <strong>{settings.provider_name || settings.provider}</strong>
      <span className="ai-model-name">
        {settings.model_name || settings.model || "No model selected"}
      </span>
    </section>
  );
}

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
      <div role="alert" className="composer-header ai-conversation-status">
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
      <p className="composer-header ai-conversation-status muted">
        You can post here. Your role cannot request AI responses.
      </p>
    );
  const active = activeAITurn(turn);
  const phase = (active && turn.action) || turn.status;
  const mayAct =
    turn.actor_id === instance.account.login.user.id ||
    turn.participant_ids?.includes(instance.account.login.user.id) ||
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
      className="composer-header ai-conversation-status"
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
