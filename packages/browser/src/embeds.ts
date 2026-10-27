import {
  type InstanceClient,
  type Message,
  type Schemas,
  unwrap,
  messageLinks,
} from "@haunt/core";
import {
  clientPost,
  providerAsset,
  publicBody,
  resolveClientPost,
  type Embed,
} from "./provider-posts";
export type { Embed } from "./provider-posts";
export { clientPost } from "./provider-posts";
import { cachedMedia, mediaKey, retryMedia } from "./media-cache";
export { mediaTask } from "./media-queue";
const cards = new Map<string, { at: number; cards: Embed[] }>();
const resolvedCards = new Map<string, { at: number; cards: Embed[] }>();
function messageEmbedKey(instance: InstanceClient, message: Message) {
  return mediaKey(
    instance,
    "resolved-embeds-v1",
    message.conversation_id,
    message.id,
    message.edited_at ?? message.created_at,
    message.security ?? "",
    message.body,
  );
}
export function cachedMessageEmbeds(
  instance: InstanceClient,
  message: Message,
) {
  return resolvedCards.get(messageEmbedKey(instance, message))?.cards;
}
export async function messageEmbeds(
  instance: InstanceClient,
  message: Message,
  signal: AbortSignal,
): Promise<Embed[]> {
  if (["encrypted", "unavailable", "pending"].includes(message.security ?? ""))
    return [];
  const key = messageEmbedKey(instance, message);
  const cached = resolvedCards.get(key);
  if (
    cached &&
    (instance.snapshot.status === "offline" ||
      Date.now() - cached.at <
        (cached.cards.some((card) => card.local) ? 60000 : 300000))
  )
    return cached.cards;
  const links = [
    ...new Set(
      messageLinks(message.body ?? "")
        .filter((link) => link.preview)
        .map((link) => link.url),
    ),
  ].slice(0, 3);
  const local = links.map((url, index) => ({ post: clientPost(url), index }));
  const serverPromise = (
    !links.length || local.some((item) => !item.post)
      ? serverMessageEmbeds(instance, message, signal)
      : Promise.resolve([] as Embed[])
  ).catch((error) => {
    if (signal.aborted || !local.some((item) => item.post)) throw error;
    return links.flatMap((url, index): Embed[] =>
      clientPost(url)
        ? []
        : [{ url, index, kind: "link", image: false, status: "unavailable" }],
    );
  });
  const postsPromise = Promise.all(
    local
      .filter((item) => item.post)
      .map(async ({ post, index }) => {
        try {
          const blob = await cachedMedia(
            mediaKey(instance, "client-post-v1", post!.url),
            async (request) =>
              new Blob(
                [JSON.stringify(await resolveClientPost(post!, request))],
                { type: "application/json" },
              ),
            signal,
            async (blob) => {
              const saved = JSON.parse(await blob.text()) as Embed;
              return (
                !!saved.local &&
                (instance.snapshot.status === "offline" ||
                  Date.now() - saved.local.at < 60000)
              );
            },
          );
          return { ...JSON.parse(await blob.text()), index } as Embed;
        } catch (error) {
          if (signal.aborted) throw error;
          return {
            index,
            url: post!.url,
            kind: "post",
            image: false,
            status: "unavailable",
          } as Embed;
        }
      }),
  );
  const [server, posts] = await Promise.all([serverPromise, postsPromise]);
  const value = [
    ...server
      .filter((card) => !clientPost(card.url))
      .map((card) => ({ ...card, local: undefined })),
    ...posts,
  ]
    .sort((a, b) => a.index - b.index)
    .slice(0, 3);
  signal.throwIfAborted();
  resolvedCards.delete(key);
  if (value.length && value.every((card) => card.status !== "unavailable"))
    resolvedCards.set(key, { at: Date.now(), cards: value });
  while (resolvedCards.size > 256)
    resolvedCards.delete(resolvedCards.keys().next().value!);
  return value;
}

async function serverMessageEmbeds(
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
    "embed-metadata-v4",
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
                  query: { client_posts: true },
                },
                signal: requestSignal,
              },
            ),
          );
          const value = result.embeds ?? [];
          // Empty previews can be a temporary upstream failure. Do not persist misses.
          return new Blob([JSON.stringify({ at: Date.now(), cards: value })], {
            type:
              value.length &&
              value.every((card) => card.status !== "unavailable")
                ? "application/json"
                : "text/plain",
          });
        },
        signal,
        async (blob) => {
          try {
            const saved = JSON.parse(await blob.text());
            return (
              Array.isArray(saved.cards) &&
              Number.isFinite(saved.at) &&
              (instance.snapshot.status === "offline" ||
                Date.now() - saved.at < 300000)
            );
          } catch {
            return false;
          }
        },
      ),
    signal,
  );
  const value = JSON.parse(await blob.text()).cards as Embed[];
  cards.delete(key);
  if (value.length && value.every((card) => card.status !== "unavailable"))
    cards.set(key, { at: Date.now(), cards: value });
  while (cards.size > 256) cards.delete(cards.keys().next().value!);
  return value;
}
export async function previewImage(
  instance: InstanceClient,
  message: Message,
  index: number,
  signal: AbortSignal,
  options: {
    asset?: number;
    avatar?: boolean;
    cacheKey?: string;
    embed?: Embed;
  } = {},
) {
  if (options.embed?.local) {
    const embed = options.embed;
    const post = clientPost(embed.url);
    const media =
      options.asset === undefined
        ? undefined
        : embed.local!.media[options.asset];
    const raw = options.avatar
      ? embed.local!.avatar
      : embed.media?.[options.asset ?? -1]?.kind === "image"
        ? media?.url
        : media?.poster;
    const url = post && providerAsset(post.provider, raw);
    if (!url) throw Error("Preview image unavailable");
    return cachedMedia(
      mediaKey(instance, "client-post-image-v1", url),
      async (request) => {
        const blob = await publicBody(url, request, 4 * 1024 * 1024);
        if (!/^image\/(jpeg|png|gif|webp|avif)$/.test(blob.type))
          throw Error("Preview image unavailable");
        return blob;
      },
      signal,
    );
  }
  return retryMedia(
    () =>
      cachedMedia(
        options.cacheKey && /^[a-f0-9]{64}$/.test(options.cacheKey)
          ? mediaKey(instance, "preview-asset-v1", options.cacheKey)
          : mediaKey(
              instance,
              "embed-image",
              message.id,
              message.edited_at ?? message.created_at,
              index,
              options.avatar ? "avatar" : String(options.asset ?? "default"),
            ),
        async (requestSignal) => {
          const response = await instance.http.GET(
            "/api/v1/conversations/{id}/messages/{message}/embeds/image",
            {
              params: {
                path: { id: message.conversation_id, message: message.id },
                query: { index, asset: options.asset, avatar: options.avatar },
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

export async function previewVideo(
  instance: InstanceClient,
  message: Message,
  index: number,
  asset: number,
  signal: AbortSignal,
  embed?: Embed,
  refresh = false,
) {
  if (embed?.local) {
    const post = clientPost(embed.url);
    if (!post) throw Error("Video source unavailable");
    const value =
      refresh || Date.now() - embed.local.at >= 60000
        ? await resolveClientPost(post, signal)
        : embed;
    const url = providerAsset(
      post.provider,
      value.local?.media[asset]?.url,
      true,
    );
    if (!url) throw Error("Video source unavailable");
    return url;
  }
  const ticket = await unwrap(
    instance.http.GET(
      "/api/v1/conversations/{id}/messages/{message}/embeds/video-ticket",
      {
        params: {
          path: { id: message.conversation_id, message: message.id },
          query: { index, asset },
        },
        signal,
      },
    ),
  );
  const url = new URL(
    `/api/v1/conversations/${encodeURIComponent(message.conversation_id)}/messages/${encodeURIComponent(message.id)}/embeds/video`,
    instance.origin,
  );
  url.searchParams.set("ticket", ticket.ticket);
  return url.href;
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
