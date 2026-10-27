import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BrowserMediaStore,
  MediaCache,
  mediaKey,
  type MediaStore,
} from "../packages/browser/src/media-cache";
import type { InstanceClient } from "@haunt/core";
import {
  previewImage,
  messageEmbeds,
  cachedMessageEmbeds,
} from "../packages/browser/src/embeds";
const { DiskMediaCache } = createRequire(import.meta.url)(
  "../apps/desktop/media-cache.cjs",
);
afterEach(() => vi.restoreAllMocks());
it("reuses server-identified preview images across messages while isolating accounts", async () => {
  vi.stubGlobal("window", {});
  try {
    const get = vi.fn(async () => ({
      data: image("preview"),
      response: new Response("", { status: 200 }),
    }));
    const instance = {
      origin: "https://cache-reuse.example",
      scope: crypto.randomUUID(),
      http: { GET: get },
    } as unknown as InstanceClient;
    const message = {
      id: "first",
      conversation_id: "room",
      created_at: "2026-10-26T00:00:00Z",
    } as any;
    await previewImage(instance, message, 0, signal(), {
      cacheKey: "a".repeat(64),
    });
    await previewImage(instance, { ...message, id: "second" }, 0, signal(), {
      cacheKey: "a".repeat(64),
    });
    expect(get).toHaveBeenCalledTimes(1);
    await previewImage(
      { ...instance, scope: "other-account" } as InstanceClient,
      message,
      0,
      signal(),
      { cacheKey: "a".repeat(64) },
    );
    expect(get).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("keeps resolved cards available during remount without crossing edits or accounts", async () => {
  vi.stubGlobal("window", {});
  try {
    const get = vi.fn(async () => ({
      data: {
        embeds: [
          {
            index: 0,
            url: "https://page.example",
            kind: "link",
            title: "Remounted card",
            image: true,
          },
        ],
      },
      response: new Response("", { status: 200 }),
    }));
    const instance = {
      origin: "https://cache-remount.example",
      scope: crypto.randomUUID(),
      snapshot: { status: "online" },
      http: { GET: get },
    } as unknown as InstanceClient;
    const message = {
      id: "message",
      conversation_id: "room",
      body: "https://page.example",
      created_at: "2026-10-26T00:00:00Z",
    } as any;
    expect(cachedMessageEmbeds(instance, message)).toBeUndefined();
    const cards = await messageEmbeds(instance, message, signal());
    expect(cachedMessageEmbeds(instance, { ...message })).toBe(cards);
    expect(await messageEmbeds(instance, message, signal())).toBe(cards);
    expect(get).toHaveBeenCalledTimes(1);
    expect(
      cachedMessageEmbeds(
        { ...instance, scope: "other-user" } as InstanceClient,
        message,
      ),
    ).toBeUndefined();
    expect(
      cachedMessageEmbeds(instance, {
        ...message,
        edited_at: "2026-10-27T00:00:00Z",
      }),
    ).toBeUndefined();
    expect(
      cachedMessageEmbeds(instance, { ...message, body: "changed" }),
    ).toBeUndefined();
    expect(
      cachedMessageEmbeds(instance, { ...message, security: "encrypted" }),
    ).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("refreshes expired metadata online and reuses saved cards offline", async () => {
  vi.stubGlobal("window", {});
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000000);
  try {
    const get = vi.fn(async () => ({
      data: {
        embeds: [
          {
            index: 0,
            url: "https://page.example",
            kind: "link",
            title: "Saved card",
            image: false,
          },
        ],
      },
      response: new Response("", { status: 200 }),
    }));
    const instance = {
      origin: "https://cache-metadata.example",
      scope: crypto.randomUUID(),
      snapshot: { status: "online" },
      http: { GET: get },
    } as unknown as InstanceClient;
    const message = {
      id: "message",
      conversation_id: "room",
      created_at: "2026-10-26T00:00:00Z",
    } as any;
    await messageEmbeds(instance, message, signal());
    clock.mockReturnValue(1400000);
    await messageEmbeds(instance, message, signal());
    expect(get).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(1800000);
    instance.snapshot.status = "offline";
    expect((await messageEmbeds(instance, message, signal()))[0].title).toBe(
      "Saved card",
    );
    expect(get).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
    clock.mockRestore();
  }
});
const image = (value: string) => new Blob([value], { type: "image/png" });
const signal = () => new AbortController().signal;

it("persists browser images and rolls out least recently read entries without erasing history", async () => {
  const name = "cache-" + crypto.randomUUID();
  const store = new BrowserMediaStore(name, 6, 2);
  const clock = vi.spyOn(Date, "now").mockReturnValue(1);
  await store.put("a", image("aaa"));
  clock.mockReturnValue(2);
  await store.put("b", image("bbb"));
  clock.mockReturnValue(3);
  expect(await (await store.get("a"))?.text()).toBe("aaa");
  clock.mockReturnValue(4);
  await store.put("c", image("ccc"));
  expect(await store.get("b")).toBeUndefined();
  await store.close();
  const reopened = new BrowserMediaStore(name, 6, 2);
  expect(await (await reopened.get("a"))?.text()).toBe("aaa");
  expect(await (await reopened.get("c"))?.text()).toBe("ccc");
  await reopened.put("a", image("xx"));
  await reopened.put("video", new Blob(["video"], { type: "video/mp4" }));
  await reopened.put("huge", image("toolarge"));
  expect(await reopened.get("video")).toBeUndefined();
  expect(await reopened.get("huge")).toBeUndefined();
  expect(await (await reopened.get("a"))?.text()).toBe("xx");
  await reopened.close();
});

it("deduplicates concurrent downloads, releases failed requests and tolerates unavailable storage", async () => {
  const store: MediaStore = {
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => {
      throw Error("Quota exceeded");
    }),
  };
  const cache = new MediaCache(store);
  const download = vi.fn(async () => {
    throw Error("startup unavailable");
  });
  await expect(cache.load("same", download, signal())).rejects.toThrow(
    "startup unavailable",
  );
  let finish!: (blob: Blob) => void;
  const recovered = vi.fn(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  const first = new AbortController();
  const one = cache.load("same", recovered, first.signal);
  const two = cache.load("same", recovered, signal());
  await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));
  const cancelled = expect(one).rejects.toMatchObject({ name: "AbortError" });
  first.abort();
  await cancelled;
  finish(image("recovered"));
  expect(await (await two).text()).toBe("recovered");
  expect(store.put).toHaveBeenCalledTimes(1);
  const saved = image("disk");
  store.get = vi.fn(async () => saved);
  expect(await cache.load("same", recovered, signal())).toBe(saved);
  expect(recovered).toHaveBeenCalledTimes(1);
});

it("cancels abandoned downloads and keeps server/account/version cache namespaces independent", async () => {
  const store: MediaStore = { get: async () => undefined, put: async () => {} };
  const cache = new MediaCache(store);
  let requestSignal: AbortSignal | undefined;
  const abort = new AbortController();
  const pending = cache.load(
    "a",
    async (request) => {
      requestSignal = request;
      return await new Promise<Blob>((_resolve, reject) =>
        request.addEventListener("abort", () => reject(request.reason)),
      );
    },
    abort.signal,
  );
  await vi.waitFor(() => expect(requestSignal).toBeDefined());
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  abort.abort();
  await rejected;
  expect(requestSignal!.aborted).toBe(true);
  expect(
    await (await cache.load("a", async () => image("new"), signal())).text(),
  ).toBe("new");
  const instance = (origin: string, scope: string) =>
    ({ origin, scope }) as InstanceClient;
  const keys = [
    mediaKey(instance("https://one.test", "alice"), "avatar", "v1"),
    mediaKey(instance("https://one.test", "bob"), "avatar", "v1"),
    mediaKey(instance("https://two.test", "alice"), "avatar", "v1"),
    mediaKey(instance("https://one.test", "alice"), "avatar", "v2"),
  ];
  expect(new Set(keys).size).toBe(4);
});

it("persists desktop files across cache instances with atomic replacements, LRU and corrupt-file recovery", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "haunt-cache-test-"),
  );
  try {
    const store = new DiskMediaCache(directory, 2000, 2);
    const value = (s: string) => ({
      type: "image/gif",
      data: new Uint8Array(Buffer.from(s)),
    });
    await store.put("a", value("a"));
    await store.put("b", value("b"));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
    await store.get("a");
    clock.mockReturnValue(Date.now() + 1000);
    await store.put("c", value("c"));
    expect(await store.get("b")).toBeNull();
    await Promise.all([
      store.put("a", value("latest-a")),
      store.put("a", value("final-a")),
    ]);
    const reopened = new DiskMediaCache(directory, 2000, 2);
    expect(Buffer.from((await reopened.get("a")).data).toString()).toBe(
      "final-a",
    );
    const entries = await fs.readdir(directory);
    expect(entries).toHaveLength(2);
    expect(entries.every((file) => /^[a-f0-9]{64}$/.test(file))).toBe(true);
    const stat = await fs.stat(path.join(directory, entries[0]));
    expect(stat.mode & 0o777).toBe(0o600);
    await fs.writeFile(path.join(directory, reopened.key("a")), "corrupt");
    expect(await reopened.get("a")).toBeNull();
    await reopened.put("a", value("repaired"));
    expect(Buffer.from((await reopened.get("a")).data).toString()).toBe(
      "repaired",
    );
    await expect(reopened.get("x".repeat(8193))).rejects.toThrow(
      "Invalid media cache key",
    );
    await expect(
      reopened.put("html", { type: "text/html", data: new Uint8Array([1]) }),
    ).rejects.toThrow("Invalid cached media");
    const small = new DiskMediaCache(path.join(directory, "small"), 1800, 10);
    await small.put("first", value("x".repeat(900)));
    await small.put("second", value("y".repeat(900)));
    expect(await small.get("first")).toBeNull();
    expect((await small.get("second")).data.byteLength).toBe(900);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
