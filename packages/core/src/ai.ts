import { Permission } from "./generated/permissions.js";
import type { InstanceClient } from "./client.js";
import type { Message, User, Schemas } from "./types.js";
export type AIProvider = "claude" | "codex" | "antigravity";
export type AIAuthor = Schemas["ChatAIAuthor"];
export type AISettings = Schemas["AiSettings"];
export type AIPreset = Schemas["AiPreset"];
export type AIAccount = Omit<Schemas["AiAccount"], "provider"> & {
  provider: AIProvider;
};
export type AIModel = Schemas["ProviderModel"];
export type AIProviderInfo = Schemas["AiProviderInfo"];
export type AIOAuthSession = Schemas["AiOAuthSession"];
export type AITurn = Schemas["AiTurn"];
export type AIUsage = Schemas["AiUsage"];
export interface AIChannelState {
  settings?: AISettings;
  presets: AIPreset[];
  turns: AITurn[];
  usage?: AIUsage;
  loading?: boolean;
  error?: string;
}
export const AIUsePermission = Permission.UseAI;
export const AISwitchPermission = Permission.SwitchAIPreset;
export const aiMention = (id: string) => `<@ai:${id}>`;
export function aiMentions(text: string) {
  return [
    ...text.matchAll(
      /<@ai:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})>/gi,
    ),
  ].map((m) => ({
    id: m[1].toLowerCase(),
    start: m.index!,
    end: m.index! + m[0].length,
  }));
}
export const messageAuthorKey = (
  message: Pick<Message, "author_id" | "ai_author">,
) =>
  message.ai_author
    ? `ai:${message.ai_author.id}`
    : `user:${message.author_id}`;
export const messageAuthorName = (
  message: Pick<Message, "author_id" | "ai_author">,
  users: User[],
) => {
  const user = users.find((u) => u.id === message.author_id);
  return (
    message.ai_author?.name ||
    user?.display_name ||
    user?.username ||
    "Deleted user"
  );
};
export const activeAITurn = (turn: AITurn) =>
  ["queued", "running", "waiting"].includes(turn.status);
export function mergeAITurn(turns: AITurn[], next: AITurn) {
  const old = turns.find((turn) => turn.id === next.id);
  if (old && old.revision >= next.revision) return turns;
  return [...turns.filter((turn) => turn.id !== next.id), next]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-100);
}
const empty: AIChannelState = { presets: [], turns: [] };
export class AIClient {
  revision = 0;
  preset(id: string) {
    for (const channel of this.channels.values()) {
      const preset = channel.presets.find((p) => p.id === id);
      if (preset) return preset;
    }
  }
  private channels = new Map<string, AIChannelState>();
  private listeners = new Set<() => void>();
  private pending = new Map<string, Promise<void>>();
  private dirty = new Set<string>();
  private watching = new Map<string, number>();
  watch(id: string) {
    const count = this.watching.get(id) ?? 0;
    this.watching.set(id, count + 1);
    if (!count && this.instance.snapshot.status === "online")
      void this.refresh(id).catch(() => {});
    return () => {
      const remaining = (this.watching.get(id) ?? 1) - 1;
      if (remaining) this.watching.set(id, remaining);
      else this.watching.delete(id);
    };
  }
  constructor(private instance: InstanceClient) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  channel = (id: string) => this.channels.get(id) ?? empty;
  private change(id: string, patch: Partial<AIChannelState>) {
    this.channels.set(id, { ...this.channel(id), ...patch });
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!/^\/api\/v1\/(?:ai\/|channels\/[a-f0-9-]+\/ai(?:\/|$))/.test(path))
      throw Error("Invalid AI API path");
    return this.instance.aiRequest(path, method, body, signal) as Promise<T>;
  }
  async refresh(id: string, settingsOnly = false, invalidate = false) {
    const running = this.pending.get(id);
    if (running) {
      if (invalidate) this.dirty.add(id);
      return running;
    }
    const base = `/api/v1/channels/${id}/ai`;
    const read = async (configurationOnly: boolean) => {
      const initial = new Map(
        this.channel(id).turns.map((turn) => [turn.id, turn.revision]),
      );
      this.change(id, { loading: true, error: undefined });
      try {
        const [settings, presets, snapshot] = await Promise.all([
          this.request<AISettings>(base),
          this.request<{ presets: AIPreset[] }>(base + "/presets"),
          configurationOnly
            ? undefined
            : Promise.all([
                this.request<{ turns: AITurn[] }>(base + "/turns"),
                this.request<AIUsage>(base + "/usage"),
              ]),
        ]);
        const available = () =>
          this.channels.has(id) &&
          this.instance.snapshot.channels.some(
            (c) => c.id === id && c.kind === "ai",
          );
        if (!available()) return;
        const patch: Partial<AIChannelState> = {
          settings,
          presets: presets.presets,
          loading: false,
        };
        if (snapshot) {
          const [listed, usage] = snapshot;
          await this.instance.pruneAIHistory(id, usage.pruned_through);
          if (!available()) return;
          let merged = listed.turns.reduce(mergeAITurn, [] as AITurn[]);
          for (const turn of this.channel(id).turns)
            if (
              initial.get(turn.id) !== turn.revision ||
              listed.turns.some((r) => r.id === turn.id)
            )
              merged = mergeAITurn(merged, turn);
          patch.turns = merged;
          patch.usage = usage;
        }
        this.change(id, patch);
      } catch (error) {
        if (!this.channels.has(id)) return;
        this.change(id, {
          error:
            error instanceof Error
              ? error.message
              : "AI channel could not load.",
          loading: false,
        });
        throw error;
      }
    };
    const job = (async () => {
      await read(settingsOnly && !!this.channel(id).settings);
      while (this.dirty.delete(id) && this.channels.has(id)) await read(true);
    })();
    this.pending.set(id, job);
    try {
      await job;
    } finally {
      this.pending.delete(id);
      this.dirty.delete(id);
    }
  }
  updateTurn(turn: AITurn) {
    const old = this.channel(turn.channel_id).turns;
    const turns = mergeAITurn(old, turn);
    if (turns !== old) this.change(turn.channel_id, { turns });
  }
  receive(event: { type: string; [key: string]: unknown }) {
    if (event.type === "subscription.revoked") {
      this.channels.delete(String(event.conversation_id));
      this.dirty.delete(String(event.conversation_id));
      this.revision++;
      for (const listener of this.listeners) listener();
    }
    if (
      event.type === "ai.settings.updated" &&
      typeof event.conversation_id === "string"
    ) {
      const id = event.conversation_id;
      if (this.watching.has(id) || this.pending.has(id))
        void this.refresh(id, true, true).catch(() => {});
    }
    if (event.type !== "ai.turn.updated") return;
    const turn = event.data as AITurn;
    if (
      !turn ||
      !turn.id ||
      !turn.channel_id ||
      !Number.isSafeInteger(turn.revision)
    )
      return;
    if (
      this.instance.snapshot.channels.some(
        (c) => c.id === turn.channel_id && c.kind === "ai",
      )
    )
      this.updateTurn(turn);
  }
  reconnect() {
    for (const id of this.watching.keys())
      if (
        this.instance.snapshot.channels.some(
          (c) => c.id === id && c.kind === "ai",
        )
      )
        void this.refresh(id).catch(() => {});
  }
}
