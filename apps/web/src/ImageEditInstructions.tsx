import { useEffect, useState } from "react";
import type { InstanceClient, Schemas } from "@haunt/core";
import { Modal } from "./App";

export function ImageEditInstructions({
  instance,
  channel,
  attachment,
  close,
}: {
  instance: InstanceClient;
  channel: string;
  attachment: string;
  close: () => void;
}) {
  const path = `/api/v1/channels/${channel}/ai/media/${attachment}/instructions`;
  const [spec, setSpec] = useState<Schemas["AiEditSpec"]>();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    void instance.ai
      .request<Schemas["AiEditSpec"]>(path)
      .then((value) => {
        if (current) {
          setSpec(value);
          setText(value.instructions ?? "");
        }
      })
      .catch((e) => {
        if (current)
          setError(e.message || "Could not load image instructions.");
      });
    return () => {
      current = false;
    };
  }, [instance, path]);
  async function save(instructions: string) {
    setBusy(true);
    setError("");
    try {
      await instance.ai.request(path, "PUT", { instructions });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save instructions.");
      setBusy(false);
    }
  }
  return (
    <Modal title="Image edit instructions" onClose={close}>
      {spec ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(text);
          }}
        >
          <label>
            Instructions for this image version
            <textarea
              rows={5}
              maxLength={4096}
              readOnly={!spec.can_edit}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {spec.updated_at && (
            <small>Updated {new Date(spec.updated_at).toLocaleString()}</small>
          )}
          {spec.can_edit && (
            <div className="actions">
              <button type="submit" disabled={busy}>
                Save instructions
              </button>
              <button
                type="button"
                disabled={busy || !spec.instructions}
                onClick={() => void save("")}
              >
                Clear instructions
              </button>
            </div>
          )}
        </form>
      ) : (
        !error && <p>Loading instructions…</p>
      )}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
