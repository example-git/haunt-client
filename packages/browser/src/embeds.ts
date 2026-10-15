import {
  type InstanceClient,
  type Message,
  type Schemas,
  unwrap,
} from "@haunt/core";
export type Embed = Schemas["EmbedsPreview"];
import { cachedMedia, mediaKey, retryMedia } from "./media-cache";
export { mediaTask } from "./media-queue";
const cards = new Map<string, { at: number; cards: Embed[] }>();
export async function messageEmbeds(
  instance: InstanceClient,
  message: Message,
  signal: AbortSignal,
): Promise<Embed[]> {
  if (
    message.security === "encrypted" ||
    message.security === "unavailable" ||
    message.security === "pending"
  )
    return [];
  const key = mediaKey(
    instance,
    "embed-metadata",
    message.id,
    message.edited_at ?? message.created_at,
  );
  const cached = cards.get(key);
  if (cached && Date.now() - cached.at < 300000) return cached.cards;
  const blob = await retryMedia(
    () =>
      cachedMedia(
        key,
        async (requestSignal) => {
          const result = await unwrap(
            instance.http.GET(
              "/api/v1/conversations/{id}/messages/{message}/embeds",
              {
                params: {
                  path: { id: message.conversation_id, message: message.id },
                },
                signal: requestSignal,
              },
            ),
          );
          const value = result.embeds ?? [];
          // Empty previews can be a temporary upstream failure. Do not persist misses.
          return new Blob([JSON.stringify(value)], {
            type: value.length ? "application/json" : "text/plain",
          });
        },
        signal,
      ),
    signal,
  );
  const value = JSON.parse(await blob.text()) as Embed[];
  cards.delete(key);
  cards.set(key, { at: Date.now(), cards: value });
  while (cards.size > 256) cards.delete(cards.keys().next().value!);
  return value;
}
export async function previewImage(
  instance: InstanceClient,
  message: Message,
  index: number,
  signal: AbortSignal,
) {
  return retryMedia(
    () =>
      cachedMedia(
        mediaKey(
          instance,
          "embed-image",
          message.id,
          message.edited_at ?? message.created_at,
          index,
        ),
        async (requestSignal) => {
          const response = await instance.http.GET(
            "/api/v1/conversations/{id}/messages/{message}/embeds/image",
            {
              params: {
                path: { id: message.conversation_id, message: message.id },
                query: { index },
              },
              parseAs: "blob",
              signal: requestSignal,
            },
          );
          if (!response.response.ok || !response.data)
            throw Error("Preview image unavailable");
          return response.data as Blob;
        },
        signal,
      ),
    signal,
  );
}

export async function attachmentMetadata(
  instance: InstanceClient,
  id: string,
  signal: AbortSignal,
) {
  const secret = await instance.dmEncryption?.imageMetadata(id);
  if (secret)
    return {
      id,
      conversation_id: secret.conversation,
      user_id: secret.author,
      filename: secret.name,
      content_type: secret.type,
      bytes: secret.bytes,
      expires_at: null,
      is_dm: true,
      encrypted: true,
    } as Schemas["AttachmentsAttachment"];
  const blob = await retryMedia(
    () =>
      cachedMedia(
        mediaKey(instance, "attachment-metadata", id),
        async (requestSignal) => {
          const value = await unwrap(
            instance.http.GET("/api/v1/attachments/{id}/metadata", {
              params: { path: { id } },
              signal: requestSignal,
            }),
          );
          return new Blob([JSON.stringify(value)], {
            type: "application/json",
          });
        },
        signal,
      ),
    signal,
  );
  return JSON.parse(await blob.text()) as Schemas["AttachmentsAttachment"];
}
export function attachmentMedia(
  instance: InstanceClient,
  id: string,
  signal: AbortSignal,
) {
  return retryMedia(
    () =>
      cachedMedia(
        mediaKey(instance, "attachment-image", id),
        async (requestSignal) => {
          const result = await instance.http.GET("/api/v1/attachments/{id}", {
            params: { path: { id } },
            parseAs: "blob",
            signal: requestSignal,
          });
          if (!result.response.ok || !result.data)
            throw Error("Attachment unavailable");
          const blob = result.data as Blob;
          if (
            blob.type === "application/octet-stream" ||
            (await instance.dmEncryption?.imageMetadata(id))
          ) {
            if (!instance.dmEncryption)
              throw Error("Encrypted image support is unavailable");
            return instance.dmEncryption.image(id, blob);
          }
          return blob;
        },
        signal,
      ),
    signal,
  );
}
