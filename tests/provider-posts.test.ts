import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InstanceClient, Message } from "@haunt/core";
import {
  messageEmbeds,
  previewImage,
  previewVideo,
} from "../packages/browser/src/embeds";
import {
  clientPost,
  providerAsset,
  publicBody,
  resolveClientPost,
} from "../packages/browser/src/provider-posts";

const did = "did:plc:z72i7hdynmk6r22z27h6tvur";
const bsky = "https://bsky.app/profile/bsky.app/post/3video";
const tiktok = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
const playlist = `https://video.bsky.app/watch/${encodeURIComponent(did)}/bafkreivideo/playlist.m3u8`;
const mp4 = "https://v19.tiktokcdn-us.com/video/post.mp4";
const signal = () => new AbortController().signal;
it("uses the official Bluesky segment CDN without following arbitrary redirects", () => {
  const base = `https://video.bsky.app/watch/${encodeURIComponent(did)}/bafkreivideo/`;
  expect(
    providerAsset(
      "bluesky",
      base + "360p/video0.ts?session_id=test&dur=6",
      true,
    ),
  ).toBe(`https://video.cdn.bsky.app/hls/${did}/bafkreivideo/360p/video0.ts`);
  expect(providerAsset("bluesky", base + "thumbnail.jpg")).toBe(
    `https://video.cdn.bsky.app/hls/${did}/bafkreivideo/thumbnail.jpg`,
  );
  expect(providerAsset("bluesky", base + "playlist.m3u8", true)).toBe(
    base + "playlist.m3u8",
  );
  expect(
    providerAsset(
      "bluesky",
      "https://video.cdn.bsky.app.evil.test/hls/video",
      true,
    ),
  ).toBeUndefined();
});
const instance = () =>
  ({
    origin: "https://community.example",
    scope: crypto.randomUUID(),
    snapshot: { status: "online" },
    http: {
      GET: vi.fn(async () => ({
        response: new Response(),
        data: {
          embeds: [
            {
              index: 1,
              url: "https://article.example/",
              kind: "link",
              image: false,
              title: "Article",
            },
          ],
        },
      })),
    },
  }) as unknown as InstanceClient;
const message = (body: string) =>
  ({
    id: crypto.randomUUID(),
    conversation_id: "room",
    body,
    created_at: "2026-10-26T00:00:00Z",
    attachment_ids: [],
    author_id: "author",
    deleted: false,
    request_id: "request",
    seq: 1,
  }) as Message;
const video = {
  $type: "app.bsky.embed.video#view",
  playlist,
  thumbnail: playlist.replace("playlist.m3u8", "thumbnail.jpg"),
  alt: "Video description",
  aspectRatio: { width: 720, height: 1280 },
};
let nested = false;
let tiktokPlay = mp4;
let requests: { url: string; init?: RequestInit }[];
beforeEach(() => {
  nested = false;
  tiktokPlay = mp4;
  requests = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (raw: string, init?: RequestInit) => {
      const url = new URL(raw);
      requests.push({ url: raw, init });
      if (url.hostname === "www.tikwm.com")
        return Response.json({
          code: 0,
          data: {
            id: "6718335390845095173",
            title: "TikTok video",
            play: tiktokPlay,
            cover: "https://p16.tiktokcdn-us.com/cover.jpg",
            author: { nickname: "Creator", unique_id: "scout2015" },
          },
        });
      if (url.pathname.endsWith("resolveHandle")) return Response.json({ did });
      if (url.pathname.endsWith("getPosts"))
        return Response.json({
          posts: [
            {
              uri: `at://${did}/app.bsky.feed.post/3video`,
              record: { text: "Video post" },
              author: { displayName: "Bluesky", handle: "bsky.app" },
              embed: nested
                ? { $type: "app.bsky.embed.recordWithMedia#view", media: video }
                : video,
            },
          ],
        });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/jpeg" },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([false, true])(
  "plays Bluesky video and record-with-media directly, nested=%s",
  async (value) => {
    nested = value;
    const client = instance(),
      item = message(bsky);
    const [card] = await messageEmbeds(client, item, signal());
    expect(card.media?.[0]).toMatchObject({
      kind: "video",
      alt: "Video description",
      width: 720,
      height: 1280,
    });
    expect(card.local?.media[0]).toMatchObject({ url: playlist, hls: true });
    expect(await previewVideo(client, item, 0, 0, signal(), card)).toBe(
      playlist,
    );
    expect(
      (await previewImage(client, item, 0, signal(), { embed: card, asset: 0 }))
        .type,
    ).toBe("image/jpeg");
    expect(client.http.GET).not.toHaveBeenCalled();
    for (const request of requests)
      expect(request.init).toMatchObject({
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
      });
  },
);

it("resolves TikTok share links with the account-free workaround and reuses per-client metadata", async () => {
  const client = instance(),
    item = message("https://vm.tiktok.com/ZShare123/");
  const [card] = await messageEmbeds(client, item, signal());
  expect(await previewVideo(client, item, 0, 0, signal(), card)).toBe(mp4);
  await messageEmbeds(client, { ...item, id: "second-message" }, signal());
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain("www.tikwm.com/api/?url=");
  expect(client.http.GET).not.toHaveBeenCalled();
  await messageEmbeds(instance(), item, signal());
  expect(requests).toHaveLength(2);
});

it("refreshes expired or failed TikTok sources instead of replaying a stale URL", async () => {
  const client = instance(),
    item = message(tiktok);
  const [card] = await messageEmbeds(client, item, signal());
  tiktokPlay = "https://v19.tiktokcdn-us.com/video/new.mp4";
  expect(await previewVideo(client, item, 0, 0, signal(), card, true)).toBe(
    tiktokPlay,
  );
  card.local!.at = Date.now() - 60001;
  expect(await previewVideo(client, item, 0, 0, signal(), card)).toBe(
    tiktokPlay,
  );
  expect(client.http.GET).not.toHaveBeenCalled();
});

it("keeps mixed article previews on the server while excluding client posts", async () => {
  const client = instance();
  const cards = await messageEmbeds(
    client,
    message(`${bsky} https://article.example/`),
    signal(),
  );
  expect(cards.map((card) => card.index)).toEqual([0, 1]);
  expect(cards[0].local).toBeDefined();
  expect(cards[1].local).toBeUndefined();
  expect(client.http.GET).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      params: expect.objectContaining({ query: { client_posts: true } }),
    }),
  );
});

it("rejects arbitrary destinations, spoofed hosts and credentials in provider URLs", () => {
  for (const raw of [
    "https://bsky.app.evil.test/profile/me/post/id",
    "https://evil@bsky.app/profile/me/post/id",
    "https://tiktok.com.evil.test/@x/video/123",
    "https://www.tiktok.com:8443/@x/video/123",
    "https://tiktok.com/profile",
    "https://bsky.app/profile/did%3Aweb%3Aevil%2Fpath/post/id",
  ])
    expect(clientPost(raw)).toBeUndefined();
  for (const raw of [
    "https://127.0.0.1/video",
    "https://v19.tiktokcdn-us.com.evil.test/video",
    "https://evil.test/video.mp4",
    "https://user:pass@video.bsky.app/watch/file",
    "http://video.bsky.app/watch/file",
    "https://video.bsky.app:8080/watch/file",
    "javascript:alert(1)",
  ]) {
    expect(providerAsset("bluesky", raw, true)).toBeUndefined();
    expect(providerAsset("tiktok", raw, true)).toBeUndefined();
  }
  expect(
    providerAsset("bluesky", "https://cdn.bsky.app/img/image", true),
  ).toBeUndefined();
});

it("does not turn malicious provider output into a direct browser request", async () => {
  tiktokPlay = "https://ip-grabber.example/video.mp4";
  const client = instance(),
    item = message(tiktok);
  const [card] = await messageEmbeds(client, item, signal());
  expect(card.status).toBe("unavailable");
  expect(card.local).toBeUndefined();
  expect(requests).toHaveLength(1);
  tiktokPlay = mp4;
  expect((await messageEmbeds(client, item, signal()))[0].media?.[0].kind).toBe(
    "video",
  );
  expect(requests).toHaveLength(2);
});

it("keeps a local post visible when the other preview fails", async () => {
  const client = instance();
  vi.mocked(client.http.GET).mockRejectedValue(
    Error("Generic preview unavailable"),
  );
  const cards = await messageEmbeds(
    client,
    message(`${bsky} https://article.example/`),
    signal(),
  );
  expect(cards[0].local?.media[0].url).toBe(playlist);
  expect(cards[1].status).toBe("unavailable");
});

it("aborts abandoned client metadata work", async () => {
  const abort = new AbortController();
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      requestSignal = init.signal!;
      return new Promise((_resolve, reject) =>
        requestSignal!.addEventListener(
          "abort",
          () => reject(requestSignal!.reason),
          { once: true },
        ),
      );
    }),
  );
  const pending = messageEmbeds(instance(), message(tiktok), abort.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(requestSignal).toBeDefined());
  abort.abort();
  await rejected;
  expect(requestSignal!.aborted).toBe(true);
});

it("does not disclose encrypted messages or suppressed links to providers", async () => {
  const client = instance();
  expect(
    await messageEmbeds(
      client,
      { ...message(bsky), security: "encrypted" },
      signal(),
    ),
  ).toEqual([]);
  await messageEmbeds(client, message(`<${tiktok}> \`${bsky}\``), signal());
  expect(requests).toHaveLength(0);
});

it("bounds provider response reads and rejects a mismatched TikTok post", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("12345")),
  );
  await expect(
    publicBody("https://www.tikwm.com/api/", signal(), 4),
  ).rejects.toThrow("download limit");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ code: 0, data: { id: "999", play: mp4 } }),
    ),
  );
  await expect(
    resolveClientPost(clientPost(tiktok)!, signal()),
  ).rejects.toThrow("TikTok post unavailable");
});
