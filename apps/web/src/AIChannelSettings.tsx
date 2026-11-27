import { useEffect, useState } from "react";
import {
  type AIAccount,
  type AIModel,
  type AIProviderInfo,
  type AISettings,
  type InstanceClient,
} from "@haunt/core";
import { Status, useAction } from "./Customization";
import { AIConnections } from "./AIConnections";
import { AIPresets, AIAvatarEditor } from "./AIPresets";
import { useAIChannel } from "./AIConversationStatus";
import { canInChannel, Permission } from "./Permissions";
const mib = (bytes: number) =>
  (bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 });
export function AIChannelSettings({
  instance,
  channel,
}: {
  instance: InstanceClient;
  channel: string;
}) {
  const runtimeSettings = instance.account.instance.capabilities?.includes(
    "messages.ai_media.v1",
  );
  const state = useAIChannel(instance, channel);
  const action = useAction();
  const [accounts, setAccounts] = useState<AIAccount[]>([]);
  const [providers, setProviders] = useState<AIProviderInfo[]>([]);
  const [models, setModels] = useState<AIModel[]>([]);
  const [draft, setDraft] = useState<AISettings>();
  const [modelError, setModelError] = useState("");
  const reload = async () => {
    const [a, p] = await Promise.all([
      instance.ai.request<{ accounts: AIAccount[] }>(
        `/api/v1/ai/accounts?channel_id=${encodeURIComponent(channel)}`,
      ),
      instance.ai.request<{ providers: AIProviderInfo[] }>(
        "/api/v1/ai/providers",
      ),
    ]);
    setAccounts(a.accounts);
    setProviders(p.providers);
  };
  useEffect(() => {
    void action.run(reload, "");
  }, [instance, channel]);
  useEffect(() => {
    if (state.settings) setDraft(state.settings);
  }, [state.settings?.revision, channel]);
  useEffect(() => {
    setModels([]);
    setModelError("");
    if (!draft?.account_id) return;
    let active = true;
    void instance.ai
      .request<{ models: AIModel[] }>(
        `/api/v1/ai/accounts/${draft.account_id}/models?channel_id=${encodeURIComponent(channel)}`,
      )
      .then((result) => {
        if (active) setModels(result.models);
      })
      .catch((error) => {
        if (active)
          setModelError(
            error instanceof Error ? error.message : "Could not load models.",
          );
      });
    return () => {
      active = false;
    };
  }, [instance, channel, draft?.account_id]);
  const refresh = () => instance.ai.refresh(channel, true, true);
  const multiple = state.presets.length > 0;
  if (!canInChannel(instance, channel, Permission.ManageChannels))
    return <p>Your role cannot edit this channel’s AI settings.</p>;
  return (
    <section className="form">
      <h3>AI channel</h3>
      <p className="muted">
        AI generation runs on the server. Permitted messages request responses
        automatically.
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {modelError && <p role="alert">{modelError}</p>}
      {draft && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await instance.ai.request(
                `/api/v1/channels/${channel}/ai`,
                "PUT",
                {
                  account_id: draft.account_id,
                  provider: draft.provider,
                  model: draft.model,
                  name: draft.name,
                  instructions: draft.instructions,
                  max_bytes: draft.max_bytes,
                  ...(runtimeSettings && {
                    timezone: draft.timezone?.trim() ?? "",
                  }),
                  allow_agent_switch: !!draft.allow_agent_switch,
                  allow_consultations: !!draft.allow_consultations,
                  max_consultations: draft.max_consultations ?? 5,
                  switch_during_reply: !!draft.switch_during_reply,
                },
              );
              await refresh();
            }, "AI settings saved.");
          }}
        >
          <div className="channel-settings-pair">
            <label>
              Integration
              <select
                required
                value={draft.provider}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    provider: e.target.value as AISettings["provider"],
                    account_id: "",
                    model: "",
                  })
                }
              >
                <option value="">Choose integration</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Account
              <select
                required
                value={draft.account_id}
                onChange={(e) =>
                  setDraft({ ...draft, account_id: e.target.value, model: "" })
                }
              >
                <option value="">Choose connected account</option>
                {accounts
                  .filter((a) => a.provider === draft.provider)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label || a.provider} · {a.status}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <p role="status">
            Connection: {state.settings?.connection_status || "not configured"}
          </p>
          <label>
            Model
            <select
              required
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            >
              <option value="">Choose model</option>
              {draft.model && !models.some((m) => m.id === draft.model) && (
                <option value={draft.model}>{draft.model} · unavailable</option>
              )}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name || model.id}
                  {model.vision ? " · images" : " · text only"}
                </option>
              ))}
            </select>
          </label>
          {multiple ? (
            <>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={!!draft.allow_agent_switch}
                  onChange={(e) =>
                    setDraft({ ...draft, allow_agent_switch: e.target.checked })
                  }
                />
                Allow the agent to switch personalities
              </label>
              {state.presets.length > 1 && (
                <>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={!!draft.allow_consultations}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          allow_consultations: e.target.checked,
                        })
                      }
                    />
                    Allow personality consultations
                  </label>
                  {draft.allow_consultations && (
                    <label>
                      Maximum consultations per reply
                      <input
                        required
                        type="number"
                        min="1"
                        max="100"
                        value={draft.max_consultations ?? 5}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            max_consultations: e.target.valueAsNumber,
                          })
                        }
                      />
                    </label>
                  )}
                </>
              )}
              {draft.allow_agent_switch && (
                <label>
                  When to switch personalities
                  <select
                    value={draft.switch_during_reply ? "immediate" : "next"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        switch_during_reply: e.target.value === "immediate",
                      })
                    }
                  >
                    <option value="next">After the current reply</option>
                    <option value="immediate">During the current reply</option>
                  </select>
                </label>
              )}
            </>
          ) : (
            <>
              <label>
                AI name
                <input
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                Instructions
                <textarea
                  rows={6}
                  maxLength={32768}
                  value={draft.instructions}
                  onChange={(e) =>
                    setDraft({ ...draft, instructions: e.target.value })
                  }
                />
              </label>
            </>
          )}
          {runtimeSettings && (
            <label>
              Channel timezone (IANA)
              <input
                maxLength={128}
                placeholder="e.g. America/Toronto"
                value={draft.timezone ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, timezone: e.target.value })
                }
              />
            </label>
          )}
          <label>
            Conversation storage (MiB)
            <input
              type="number"
              min={0.00390625}
              step={0.00390625}
              required
              value={draft.max_bytes / 1048576}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  max_bytes: Number(e.target.value) * 1048576,
                })
              }
            />
          </label>
          <p className="muted">
            Oldest conversation history is removed automatically when a limit is
            reached, down to 80% of the limit. Images share the server
            attachment limits.
          </p>
          <button className="primary" disabled={action.busy}>
            Save AI settings
          </button>
        </form>
      )}
      {!draft && (
        <button onClick={() => void refresh().catch(() => {})}>
          Reload AI settings
        </button>
      )}
      <Status action={action} />
      {state.usage && (
        <p role="status">
          Channel: {mib(state.usage.channel_bytes)} /{" "}
          {mib(state.usage.channel_max_bytes)} MiB. All AI conversations:{" "}
          {mib(state.usage.global_bytes)} / {mib(state.usage.global_max_bytes)}{" "}
          MiB.
        </p>
      )}
      {state.settings && !multiple && (
        <AIAvatarEditor
          instance={instance}
          path={`/api/v1/channels/${channel}/ai/avatar`}
          author={{
            id: channel,
            name: state.settings.name,
            avatar_url: state.settings.avatar_url,
          }}
          onSaved={refresh}
        />
      )}
      <AIPresets
        instance={instance}
        channel={channel}
        presets={state.presets}
        active={state.settings?.active_preset_id}
        onSaved={refresh}
      />

      <AIConnections
        instance={instance}
        onChange={() => void reload().catch(() => {})}
      />
    </section>
  );
}
