import { useState } from "react";
import { aiMention, type AIPreset, type InstanceClient } from "@haunt/core";
import { Status, useAction } from "./Customization";
import { AIAvatar } from "./AIIdentity";
export function AIAvatarEditor({
  instance,
  path,
  author,
  onSaved,
}: {
  instance: InstanceClient;
  path: string;
  author: { id: string; name: string; avatar_url?: string };
  onSaved: () => Promise<unknown>;
}) {
  const action = useAction();
  return (
    <div className="ai-avatar-editor">
      <AIAvatar instance={instance} author={author} />
      <label>
        Avatar
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={action.busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void action.run(async () => {
                await instance.aiAvatar(path, file);
                await onSaved();
              }, "Avatar saved.");
            e.target.value = "";
          }}
        />
      </label>
      {author.avatar_url && (
        <button
          type="button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await instance.ai.request(path, "DELETE");
              await onSaved();
            }, "Avatar removed.")
          }
        >
          Remove avatar
        </button>
      )}
      <Status action={action} />
    </div>
  );
}
export function AIPresets({
  instance,
  channel,
  presets,
  active,
  onSaved,
}: {
  instance: InstanceClient;
  channel: string;
  presets: AIPreset[];
  active?: string;
  onSaved: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<AIPreset>();
  const [creating, setCreating] = useState(false);
  const action = useAction();
  const base = `/api/v1/channels/${channel}/ai/presets`;
  return (
    <section className="form">
      <h3>Persona presets</h3>
      <p className="muted">
        Mention a preset to select it for the channel. It applies to that
        message and subsequent messages; a response already running keeps its
        original preset.
      </p>
      {presets.map((preset) => (
        <article key={preset.id} className="ai-preset">
          <strong>{preset.name}</strong>
          {active === preset.id && <span> · active</span>}
          <code>{aiMention(preset.id)}</code>
          <div className="button-row">
            <button
              onClick={() => {
                setEditing(preset);
                setCreating(false);
              }}
            >
              Edit
            </button>
            <button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await instance.ai.request(`${base}/${preset.id}`, "DELETE");
                  await onSaved();
                }, "Preset removed.")
              }
            >
              Delete
            </button>
          </div>
        </article>
      ))}
      <button
        onClick={() => {
          setEditing(undefined);
          setCreating(true);
        }}
      >
        Add preset
      </button>
      {(editing || creating) && (
        <div key={editing?.id ?? "new"} className="form">
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void action.run(async () => {
                await instance.ai.request(
                  editing ? `${base}/${editing.id}` : base,
                  editing ? "PUT" : "POST",
                  {
                    name: String(data.get("name")),
                    instructions: String(data.get("instructions")),
                  },
                );
                setEditing(undefined);
                setCreating(false);
                await onSaved();
              }, "Preset saved.");
            }}
          >
            <label>
              Name
              <input
                name="name"
                required
                maxLength={80}
                defaultValue={editing?.name ?? ""}
              />
            </label>
            <label>
              Instructions
              <textarea
                name="instructions"
                rows={5}
                maxLength={32768}
                defaultValue={editing?.instructions ?? ""}
              />
            </label>
            <div className="button-row">
              <button className="primary" disabled={action.busy}>
                Save preset
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(undefined);
                  setCreating(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
          {editing && (
            <AIAvatarEditor
              instance={instance}
              path={`${base}/${editing.id}/avatar`}
              author={presets.find((p) => p.id === editing.id) ?? editing}
              onSaved={onSaved}
            />
          )}
        </div>
      )}
      <Status action={action} />
    </section>
  );
}
