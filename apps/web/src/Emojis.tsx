import { useState, useSyncExternalStore, type ReactNode } from "react";
import { friendlyError, type Emoji, type InstanceClient } from "@haunt/core";
import { useArt } from "./People";
import { ErrorNotice } from "./App";

export function EmojiImage({
  instance,
  emoji,
}: {
  instance: InstanceClient;
  emoji: Emoji;
}) {
  const url = useArt(instance, "emoji", emoji.version, emoji.id);
  return url ? (
    <img
      className="custom-emoji"
      src={url}
      alt={`:${emoji.name}:`}
      title={`:${emoji.name}:`}
    />
  ) : (
    <span>:{emoji.name}:</span>
  );
}
export function EmojiSettings({ instance }: { instance: InstanceClient }) {
  const state = useSyncExternalStore(instance.subscribe, instance.getSnapshot);
  const [name, setName] = useState(""),
    [file, setFile] = useState<File>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploadKey, setUploadKey] = useState(0);
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="form emoji-settings">
      <h3>
        Server emojis <small>({state.emojis.length}/100)</small>
      </h3>
      <p className="muted small">
        Use :name: in channels and direct messages on this server. Uploading an
        existing name replaces its image.
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!file) return;
          void run(async () => {
            if (file.size > 1024 * 1024)
              throw Error("Emoji images must be at most 1 MiB.");
            let blob: Blob = file;
            if (file.type !== "image/gif") {
              const bitmap = await createImageBitmap(file);
              try {
                const canvas = document.createElement("canvas"),
                  scale = Math.min(
                    1,
                    128 / Math.max(bitmap.width, bitmap.height),
                  );
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                canvas
                  .getContext("2d")!
                  .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                blob = await new Promise<Blob>((resolve, reject) =>
                  canvas.toBlob(
                    (b) =>
                      b ? resolve(b) : reject(Error("Unable to read image.")),
                    "image/png",
                  ),
                );
              } finally {
                bitmap.close();
              }
            }
            await instance.saveEmoji(name, blob);
            setName("");
            setFile(undefined);
            setUploadKey((v) => v + 1);
          });
        }}
      >
        <label>
          Emoji name
          <input
            aria-label="Emoji name"
            required
            pattern="[a-z0-9_]{2,32}"
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
          />
        </label>
        <label>
          Emoji image
          <input
            key={uploadKey}
            aria-label="Emoji image"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
        </label>
        <small className="muted">
          2–32 letters, digits or underscores. PNG, JPEG, WebP or GIF up to 1
          MiB. Animated GIFs must be at most 256 × 256.
        </small>
        <button className="primary" disabled={busy || !file}>
          Upload emoji
        </button>
      </form>
      <ErrorNotice error={error} />
      <div className="settings-list">
        {state.emojis.map((emoji) => (
          <div className="emoji-settings-row" key={emoji.id}>
            <EmojiImage instance={instance} emoji={emoji} />
            <span>:{emoji.name}:</span>
            <button
              type="button"
              className="text-button danger-text"
              disabled={busy}
              aria-label={`Delete :${emoji.name}:`}
              onClick={() => void run(() => instance.deleteEmoji(emoji.id))}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
