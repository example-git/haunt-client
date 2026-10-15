import { zipSync, strToU8 } from "fflate";
import type { InstanceClient, Message } from "@haunt/core";
import { localMedia, mediaKey } from "./media-cache";
import { attachmentMedia } from "./embeds";
const limit = 256 * 1024 * 1024;
export const escapeHTML = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function csvCell(value: string) {
  if (/^[\s]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value))
    value = "'" + value;
  return '"' + value.replaceAll('"', '""') + '"';
}
async function history(instance: InstanceClient, conversation: string) {
  await instance.syncHistory(conversation);
  let before: number | undefined;
  const all: Message[] = [];
  let bytes = 0;
  for (;;) {
    const page = await instance.messages(conversation, { before, limit: 1000 });
    if (!page.length) break;
    for (const m of page) {
      bytes += m.body.length * 3 + 512;
      if (bytes > limit)
        throw Error(
          "Conversation export exceeds the 256 MiB local export limit",
        );
      all.push(m);
    }
    before = page[0].seq;
    if (page.length < 1000) break;
  }
  return all.sort((a, b) => a.seq - b.seq);
}
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function exportConversation(
  instance: InstanceClient,
  conversation: string,
  title: string,
  format: "csv" | "html",
) {
  const messages = await history(instance, conversation),
    name =
      (title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "conversation") +
      "-" +
      new Date().toISOString().slice(0, 10);
  const author = (m: Message) => {
    const user = instance.snapshot.users.find((u) => u.id === m.author_id);
    return user?.display_name || user?.username || m.author_id;
  };
  if (format === "csv") {
    const rows = [
      ["UTC time", "Author", "Message", "Encryption", "Edited UTC", "Deleted"],
      ...messages.map((m) => [
        m.created_at,
        author(m),
        m.deleted ? "Message deleted" : m.body,
        m.security ?? "legacy",
        m.edited_at ?? "",
        String(m.deleted),
      ]),
    ];
    save(
      new Blob(
        ["\ufeff", rows.map((r) => r.map(csvCell).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
      name + ".csv",
    );
    return;
  }
  const files: Record<string, Uint8Array> = {},
    rows: string[] = [];
  let bytes = 0;
  const signal = AbortSignal.timeout(300000),
    recent = Date.now() - 30 * 86400000;
  for (const m of messages) {
    let images = "";
    for (const id of m.attachment_ids ?? []) {
      if (!/^[a-f0-9-]{36}$/i.test(id)) continue;
      let blob = await localMedia(mediaKey(instance, "attachment-image", id));
      if (!blob && Date.parse(m.created_at) >= recent) {
        try {
          blob = await attachmentMedia(instance, id, signal);
        } catch {
          /* unavailable uploads stay explicit in transcript */
        }
      }
      if (
        blob &&
        ["image/webp", "image/jpeg", "image/png", "image/gif"].includes(
          blob.type,
        )
      ) {
        const path = `images/${id}.${blob.type.split("/")[1]}`;
        if (!files[path]) {
          bytes += blob.size;
          if (bytes > limit)
            throw Error(
              "Conversation images exceed the 256 MiB local export limit",
            );
          files[path] = new Uint8Array(await blob.arrayBuffer());
        }
        images += `<a href="${path}"><img loading="lazy" src="${path}" alt="Image attachment"></a>`;
      } else
        images +=
          "<p class=missing>Image unavailable or outside the recent-image window and not cached locally.</p>";
    }
    rows.push(
      `<article><header><strong>${escapeHTML(author(m))}</strong> <time>${escapeHTML(m.created_at)}</time></header><p class=body>${escapeHTML(m.deleted ? "Message deleted" : m.body)}</p>${images}<small>${m.security === "encrypted" ? "Exported from an end-to-end encrypted message" : m.security === "unavailable" ? "Decryption key unavailable" : "Legacy plaintext message"}${m.edited_at ? " · edited " + escapeHTML(m.edited_at) : ""}</small></article>`,
    );
  }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(title)}</title><style>body{font:16px/1.5 system-ui;max-width:900px;margin:2rem auto;padding:0 1rem;background:#202020;color:#eee}article{padding:1rem 0;border-bottom:1px solid #555}.body{white-space:pre-wrap;overflow-wrap:anywhere}time,small,.missing{color:#bbb}img{display:block;max-width:100%;max-height:700px;margin:1rem 0}a{color:inherit}</style><h1>${escapeHTML(title)}</h1><p>${escapeHTML(instance.account.instance.name)} (${escapeHTML(new URL(instance.origin).host)})</p><p>Readable, decrypted backup exported ${escapeHTML(new Date().toISOString())}. Includes available history, cached images and available images from the last 30 days. Keep this copy private.</p>${rows.join("")}</html>`;
  const encoded = strToU8(html);
  if (bytes + encoded.length > limit)
    throw Error("Conversation export exceeds the 256 MiB local export limit");
  files["conversation.html"] = encoded;
  save(
    new Blob([new Uint8Array(zipSync(files, { level: 0 }))], {
      type: "application/zip",
    }),
    name + ".zip",
  );
}
