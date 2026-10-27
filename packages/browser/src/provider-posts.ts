import { safeExternalURL, type Schemas } from "@haunt/core";

type Provider = "tiktok" | "bluesky";
export type ClientPost = {
  provider: Provider;
  url: string;
  handle?: string;
  key?: string;
  id?: string;
};
export type Embed = Schemas["EmbedsPreview"] & {
  local?: {
    at: number;
    avatar?: string;
    media: { url: string; poster?: string; hls?: boolean }[];
  };
};

export function clientPost(raw: string): ClientPost | undefined {
  const safe = safeExternalURL(raw);
  if (!safe) return;
  const u = new URL(safe);
  if (u.port) return;
  const host = u.hostname.replace(/^www\./, "");
  if (host === "bsky.app") {
    const match =
      /^\/profile\/([a-zA-Z0-9.:%_-]+)\/post\/([a-zA-Z0-9]+)\/?$/.exec(
        u.pathname,
      );
    if (!match) return;
    let handle: string;
    try {
      handle = decodeURIComponent(match[1]);
    } catch {
      return;
    }
    if (
      !/^(?:did:plc:[a-z2-7]{24}|did:web:[a-zA-Z0-9.-]+|[a-zA-Z0-9.-]+)$/.test(
        handle,
      )
    )
      return;
    return {
      provider: "bluesky",
      url: `https://bsky.app/profile/${handle}/post/${match[2]}`,
      handle,
      key: match[2],
    };
  }
  if (
    ["tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(
      host,
    )
  ) {
    const video = /^\/@[a-zA-Z0-9_.]+\/video\/(\d{1,25})\/?$/.exec(u.pathname);
    const short = ["vm.tiktok.com", "vt.tiktok.com"].includes(host)
      ? /^\/[a-zA-Z0-9]+\/?$/.test(u.pathname)
      : /^\/t\/[a-zA-Z0-9]+\/?$/.test(u.pathname);
    if (!video && !short) return;
    return {
      provider: "tiktok",
      url: `https://${host === "tiktok.com" || host === "m.tiktok.com" ? "www.tiktok.com" : host}${u.pathname}`,
      id: video?.[1],
    };
  }
}

export function providerAsset(
  provider: Provider,
  raw: unknown,
  video = false,
): string | undefined {
  if (
    typeof raw !== "string" ||
    raw.length > 8192 ||
    /[\\\u0000-\u0020\u007f]/.test(raw)
  )
    return;
  try {
    const u = new URL(
      raw,
      provider === "tiktok"
        ? "https://www.tikwm.com"
        : "https://video.bsky.app",
    );
    if (u.protocol !== "https:" || u.username || u.password || u.port) return;
    if (provider === "bluesky") {
      if (u.hostname === "video.bsky.app" && u.pathname.startsWith("/watch/")) {
        if (!u.pathname.endsWith(".m3u8")) {
          const parts = u.pathname.slice(7).split("/").map(decodeURIComponent);
          if (
            parts.length < 3 ||
            parts.some((part) => !/^[a-zA-Z0-9:._-]+$/.test(part))
          )
            return;
          u.hostname = "video.cdn.bsky.app";
          u.pathname = "/hls/" + parts.join("/");
          u.search = "";
        }
        return u.href;
      }
      if (u.hostname === "video.cdn.bsky.app" && u.pathname.startsWith("/hls/"))
        return u.href;
      if (
        !video &&
        u.hostname === "cdn.bsky.app" &&
        u.pathname.startsWith("/img/")
      )
        return u.href;
    } else if (
      [
        "tiktokcdn.com",
        "tiktokcdn-us.com",
        "tiktokcdn-eu.com",
        "tiktokv.com",
        "ibytedtos.com",
        "ibyteimg.com",
        "byteoversea.com",
        "muscdn.com",
      ].some(
        (host) => u.hostname === host || u.hostname.endsWith(`.${host}`),
      ) ||
      (["www.tikwm.com", "tikwm.com"].includes(u.hostname) &&
        /^\/(?:video|picture|avatar)\//.test(u.pathname))
    ) {
      return u.href;
    }
  } catch {
    return;
  }
}

export async function publicBody(
  url: string,
  signal: AbortSignal,
  limit: number,
): Promise<Blob> {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok || !response.body) throw Error("Post source unavailable");
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error("Post source exceeds download limit");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Blob(parts, {
    type:
      response.headers.get("content-type")?.split(";")[0] ??
      "application/octet-stream",
  });
}

export function directPostImage(embed: Embed, asset?: number, avatar = false) {
  if (window.hauntDesktop || embed.provider !== "bluesky" || !embed.local)
    return;
  const media = asset === undefined ? undefined : embed.local.media[asset];
  const raw = avatar
    ? embed.local.avatar
    : embed.media?.[asset ?? -1]?.kind === "image"
      ? media?.url
      : media?.poster;
  const url = providerAsset("bluesky", raw);
  if (url && new URL(url).hostname === "cdn.bsky.app") return url;
}

const text = (value: unknown, max = 32000) =>
  typeof value === "string" ? value.slice(0, max) : "";
const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
async function json(url: string, signal: AbortSignal) {
  return object(
    JSON.parse(await (await publicBody(url, signal, 1024 * 1024)).text()),
  );
}

export async function resolveClientPost(
  post: ClientPost,
  signal: AbortSignal,
): Promise<Embed> {
  const card: Embed = {
    index: 0,
    url: post.url,
    kind: "post",
    image: false,
    provider: post.provider,
    site_name: post.provider === "tiktok" ? "TikTok" : "Bluesky",
    status: "ready",
    media: [],
    local: { at: Date.now(), media: [] },
  };
  const add = (
    kind: string,
    raw: unknown,
    poster: unknown,
    alt: unknown,
    aspect: unknown,
    hls = false,
  ) => {
    const url = providerAsset(post.provider, raw, kind === "video");
    if (!url || card.media!.length >= 4) return;
    const thumbnail = providerAsset(post.provider, poster);
    const ratio = object(aspect);
    card.media!.push({
      kind,
      poster: !!thumbnail,
      alt: text(alt, 1000),
      width: Math.max(0, Math.min(8192, Number(ratio.width) || 0)),
      height: Math.max(0, Math.min(8192, Number(ratio.height) || 0)),
    });
    card.local!.media.push({ url, poster: thumbnail, hls });
  };
  if (post.provider === "bluesky") {
    let did = post.handle!;
    if (!did.startsWith("did:"))
      did = text(
        (
          await json(
            `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(did)}`,
            signal,
          )
        ).did,
      );
    if (!/^did:(?:plc:[a-z2-7]{24}|web:[a-zA-Z0-9.-]+)$/.test(did))
      throw Error("Bluesky author unavailable");
    const uri = `at://${did}/app.bsky.feed.post/${post.key}`;
    const data = await json(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`,
      signal,
    );
    const item = object(
      Array.isArray(data.posts)
        ? data.posts.find((entry: any) => entry?.uri === uri)
        : undefined,
    );
    if (!item.uri) throw Error("Bluesky post unavailable");
    const author = object(item.author),
      record = object(item.record);
    card.author_name = text(author.displayName || author.handle, 120);
    card.author_handle = `@${text(author.handle, 253)}`;
    card.description = text(record.text);
    card.published_at = text(record.createdAt, 50);
    card.local!.avatar = providerAsset(post.provider, author.avatar);
    const outer = object(item.embed);
    const media =
      outer.$type === "app.bsky.embed.recordWithMedia#view"
        ? object(outer.media)
        : outer;
    if (media.$type === "app.bsky.embed.video#view") {
      add(
        "video",
        media.playlist,
        media.thumbnail,
        media.alt,
        media.aspectRatio,
        true,
      );
      if (!card.media!.length) throw Error("Bluesky video source unavailable");
    } else if (Array.isArray(media.images)) {
      for (const image of media.images)
        add(
          "image",
          image.fullsize || image.thumb,
          undefined,
          image.alt,
          image.aspectRatio,
        );
    }
  } else {
    const response = await json(
      `https://www.tikwm.com/api/?url=${encodeURIComponent(post.url)}`,
      signal,
    );
    const data = object(response.data),
      author = object(data.author);
    if (
      response.code !== 0 ||
      !/^\d{1,25}$/.test(text(data.id)) ||
      (post.id && data.id !== post.id)
    )
      throw Error("TikTok post unavailable");
    card.author_name = text(author.nickname || author.unique_id, 120);
    card.author_handle = `@${text(author.unique_id, 100)}`;
    card.description = text(data.title);
    card.local!.avatar = providerAsset(post.provider, author.avatar);
    if (
      Number.isFinite(data.create_time) &&
      data.create_time > 0 &&
      data.create_time < 1e11
    )
      card.published_at = new Date(data.create_time * 1000).toISOString();
    add(
      "video",
      data.play || data.wmplay,
      data.cover || data.origin_cover,
      data.title,
      data,
    );
    if (!card.media!.length) throw Error("TikTok video source unavailable");
  }
  card.avatar = !!card.local!.avatar;
  return card;
}
