import { friendlyError, type InstanceClient, type Schemas } from "@haunt/core";

export const ATTACHMENT_TYPES =
  "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm";
const extensions: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
};
export const hasFiles = (data: DataTransfer) =>
  Array.from(data.types).includes("Files") ||
  Array.from(data.items ?? []).some((item) => item.kind === "file");

// Items and files describe the same clipboard payload; never add both lists.
// Read synchronously while the browser still allows access to the data store.
export function transferredFiles(data: DataTransfer): File[] {
  const items = Array.from(data.items ?? []).filter(
    (item) => item.kind === "file",
  );
  return items.length
    ? items.flatMap((item) => {
        if (item.webkitGetAsEntry?.()?.isDirectory) return [];
        const file = item.getAsFile();
        return file ? [file] : [];
      })
    : Array.from(data.files);
}

type Entry = {
  key: number;
  file: File;
  attachment?: Schemas["AttachmentsAttachment"];
  started: boolean;
};
export class AttachmentDraft {
  private entries: Entry[] = [];
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  private active = 0;
  private serial = 0;
  private locked = false;
  private snapshot = { entries: this.entries, error: "" };
  constructor(
    private instance: InstanceClient,
    private conversation: string,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private changed(error = this.snapshot.error) {
    this.snapshot = { entries: [...this.entries], error };
    for (const listener of this.listeners) listener();
  }
  add = (files: File[]) => {
    if (this.locked || this.controller.signal.aborted) return;
    const errors: string[] = [];
    const dm=this.instance.isDM(this.conversation);
    if(dm&&!this.instance.account.instance.limits.dm?.images_enabled){this.changed("This server has disabled DM image uploads.");return;}
    if (!files.length) errors.push("Drop image or video files, not folders.");
    for (let file of files) {
      if (this.entries.length >= 8) {
        errors.push("A message can have up to 8 attachments.");
        break;
      }
      const type =
        file.type ||
        extensions[file.name.split(".").pop()?.toLowerCase() ?? ""];
      const limit = dm ? (type?.startsWith("image/") ? 20*1024*1024 : 0) : type?.startsWith("image/")
        ? this.instance.account.instance.limits.image_max_bytes
        : type?.startsWith("video/")
          ? this.instance.account.instance.limits.video_max_bytes
          : 0;
      if (!type || !ATTACHMENT_TYPES.split(",").includes(type) || (dm&&!type.startsWith("image/"))) {
        errors.push(
          `${file.name}: ${dm?"DMs support PNG, JPEG, GIF or WebP images only":"choose a PNG, JPEG, GIF, WebP, MP4 or WebM file"}.`,
        );
        continue;
      }
      if (!file.size || file.size > limit) {
        errors.push(
          `${file.name}: ${file.size ? `exceeds this server’s ${Math.round(limit / 1048576)} MiB limit` : "file is empty"}.`,
        );
        continue;
      }
      if (!file.type)
        file = new File([file], file.name, {
          type,
          lastModified: file.lastModified,
        });
      this.entries.push({ key: ++this.serial, file, started: false });
    }
    this.changed([...new Set(errors)].slice(0, 3).join(" "));
    this.pump();
  };
  private pump() {
    if (this.controller.signal.aborted) return;
    while (this.active < 2) {
      const entry = this.entries.find((item) => !item.started);
      if (!entry) return;
      entry.started = true;
      this.active++;
      void this.instance
        .upload(
          this.conversation,
          entry.file,
          entry.file.name,
          this.controller.signal,
        )
        .then((attachment) => {
          if (!this.controller.signal.aborted) entry.attachment = attachment;
        })
        .catch((error) => {
          if (this.controller.signal.aborted) return;
          this.entries = this.entries.filter((item) => item !== entry);
          this.changed(`${entry.file.name}: ${friendlyError(error)}`);
        })
        .finally(() => {
          this.active--;
          if (!this.controller.signal.aborted) {
            this.changed();
            this.pump();
          }
        });
    }
  }
  lock() {
    if (this.locked || this.entries.some((entry) => !entry.attachment))
      return false;
    this.locked = true;
    return true;
  }
  unlock() {
    this.locked = false;
  }
  clear() {
    this.entries = [];
    this.changed("");
  }
  remove(key: number) {
    if (this.locked) return;
    this.entries = this.entries.filter((entry) => entry.key !== key);
    this.changed();
  }
  dispose() {
    this.controller.abort();
    this.listeners.clear();
    this.entries = [];
  }
}
