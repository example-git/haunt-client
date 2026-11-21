import { useEffect, useState } from "react";
import { type AIPreset, type InstanceClient } from "@haunt/core";
import { prepareAIAvatar, Status, useAction } from "./Customization";
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
          accept="image/*"
          disabled={action.busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void action.run(async () => {
                await instance.aiAvatar(path, await prepareAIAvatar(file));
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
  const [draft, setDraft] = useState<{
    editing?: AIPreset;
    requestID: string;
  }>();
  const action = useAction();
  const base = `/api/v1/channels/${channel}/ai/presets`;
  return (
    <section className="form">
      <h3>Personalities</h3>
      {presets.map((preset) => (
        <article key={preset.id} className="ai-preset">
          <AIAvatar instance={instance} author={preset} />
          <strong>{preset.name}</strong>
          {active === preset.id && <span> · active</span>}
          {preset.description && <p>{preset.description}</p>}
          <div className="button-row">
            <button
              onClick={() =>
                setDraft({ editing: preset, requestID: crypto.randomUUID() })
              }
            >
              Edit
            </button>
            <button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await instance.ai.request(`${base}/${preset.id}`, "DELETE");
                  await onSaved();
                }, "Personality removed.")
              }
            >
              Delete
            </button>
          </div>
        </article>
      ))}
      <button onClick={() => setDraft({ requestID: crypto.randomUUID() })}>
        Add personality
      </button>
      {draft && (
        <PresetForm
          key={draft.requestID}
          instance={instance}
          base={base}
          editing={draft.editing}
          requestID={draft.requestID}
          close={() => setDraft(undefined)}
          onSaved={onSaved}
        />
      )}
      <Status action={action} />
    </section>
  );
}

function avatarData(image: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () =>
      reject(Error("Could not read the selected picture."));
    reader.readAsDataURL(image);
  });
}

function PresetForm({
  instance,
  base,
  editing,
  requestID,
  onSaved,
  close,
}: {
  instance: InstanceClient;
  base: string;
  editing?: AIPreset;
  requestID: string;
  onSaved: () => Promise<unknown>;
  close: () => void;
}) {
  const action = useAction();
  const [picture, setPicture] = useState<Blob>();
  const [preview, setPreview] = useState("");
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    if (!picture) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(picture);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [picture]);
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const fields = new FormData(e.currentTarget);
        void action.run(async () => {
          await instance.ai.request(
            editing ? `${base}/${editing.id}` : base,
            editing ? "PUT" : "POST",
            {
              name: String(fields.get("name")),
              description: String(fields.get("description")),
              instructions: String(fields.get("instructions")),
              ...(!editing && { request_id: requestID }),
              ...(picture && { avatar_data: await avatarData(picture) }),
            },
          );
          await onSaved();
          close();
        }, "");
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
        Description
        <textarea
          name="description"
          maxLength={4096}
          rows={2}
          defaultValue={editing?.description ?? ""}
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
      <div className="ai-avatar-editor">
        {preview ? (
          <span className="avatar ai-avatar">
            <img src={preview} alt="Selected picture preview" />
          </span>
        ) : (
          editing &&
          !removed && <AIAvatar instance={instance} author={editing} />
        )}
        <label>
          Profile picture
          <input
            type="file"
            accept="image/*"
            disabled={action.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                void action.run(async () => {
                  setPicture(await prepareAIAvatar(file));
                }, "");
            }}
          />
        </label>
        {picture && (
          <button
            type="button"
            disabled={action.busy}
            onClick={() => setPicture(undefined)}
          >
            Discard selected picture
          </button>
        )}
        {!picture && editing?.avatar_url && !removed && (
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await instance.ai.request(
                  `${base}/${editing.id}/avatar`,
                  "DELETE",
                );
                setRemoved(true);
                await onSaved();
              }, "")
            }
          >
            Remove picture
          </button>
        )}
      </div>
      <div className="button-row">
        <button className="primary" disabled={action.busy}>
          Save personality
        </button>
        <button type="button" disabled={action.busy} onClick={close}>
          Cancel
        </button>
      </div>
      <Status action={action} />
    </form>
  );
}
