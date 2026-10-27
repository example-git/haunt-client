import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { messageLink } from "../packages/browser/src/deep-links";
const require = createRequire(import.meta.url);
const {
  parseDeepLink,
  installDeepLinks,
} = require("../apps/desktop/deep-links.cjs");
const { DiskMediaCache } = require("../apps/desktop/media-cache.cjs");
const { installDesktopTools } = require("../apps/desktop/desktop-tools.cjs");
const { writeRanges } = require("../apps/desktop/range-download.cjs");

it("saves every range of a video larger than the proxy chunk and removes incomplete files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-ranges-"));
  const bytes = Buffer.alloc(9 * 1024 * 1024 + 7, 0x61),
    ranges: string[] = [];
  bytes[bytes.length - 1] = 0x7a;
  const fetch = async (_url: string, options: RequestInit) => {
    const header = new Headers(options.headers).get("Range")!;
    ranges.push(header);
    const [start, requested] = header.slice(6).split("-").map(Number);
    const end = Math.min(bytes.length - 1, requested);
    return new Response(bytes.subarray(start, end + 1), {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
      },
    });
  };
  try {
    const file = path.join(directory, "video.mp4"),
      abort = new AbortController();
    const progress = vi.fn();
    await writeRanges(
      "https://example.com/video",
      file,
      fetch,
      abort.signal,
      progress,
    );
    expect((await fs.readFile(file)).equals(bytes)).toBe(true);
    expect(ranges).toHaveLength(2);
    expect(progress).toHaveBeenLastCalledWith(bytes.length, bytes.length);
    await expect(
      writeRanges("https://example.com/video", file, fetch, abort.signal, () =>
        abort.abort(),
      ),
    ).rejects.toThrow();
    expect((await fs.readFile(file)).equals(bytes)).toBe(true);
    expect(await fs.readdir(directory)).toEqual(["video.mp4"]);
    await expect(
      writeRanges(
        "https://example.com/video",
        file,
        async () =>
          new Response("short", {
            status: 206,
            headers: {
              "Content-Type": "video/mp4",
              "Content-Range": "bytes 0-99/100",
            },
          }),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("before all bytes");
    expect((await fs.readFile(file)).equals(bytes)).toBe(true);
    expect(await fs.readdir(directory)).toEqual(["video.mp4"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

it("routes server-local links and queues startup links until the renderer is ready", () => {
  const channel = crypto.randomUUID(),
    message = crypto.randomUUID();
  const url = messageLink("https://community.example", channel, message);
  expect(parseDeepLink(url)).toEqual({
    server: "https://community.example",
    channel,
    message,
  });
  const app = Object.assign(new EventEmitter(), { isPackaged: false }),
    ipc = new Map();
  const validate = vi.fn((event) => {
    if (event !== "trusted") throw Error("Untrusted");
  });
  const attach = installDeepLinks(
    app,
    { handle: (name: string, fn: unknown) => ipc.set(name, fn) },
    validate,
  );
  app.emit("open-url", { preventDefault() {} }, url);
  const parent = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: Object.assign(new EventEmitter(), { send: vi.fn() }),
  });
  attach(parent);
  expect(() => ipc.get("links:ready")("foreign")).toThrow("Untrusted");
  expect(ipc.get("links:ready")("trusted")).toEqual([parseDeepLink(url)]);
  app.emit("second-instance", {}, [
    "haunt",
    messageLink("http://127.0.0.1:8080", channel),
  ]);
  expect(parent.webContents.send).toHaveBeenCalledWith("links:open", {
    server: "http://127.0.0.1:8080",
    channel,
    message: undefined,
  });
  expect(parent.restore).toHaveBeenCalled();
  expect(() => ipc.get("links:open")("foreign", url)).toThrow("Untrusted");
  expect(() =>
    ipc.get("links:open")("trusted", "haunt://open?server=file:///etc/passwd"),
  ).toThrow("Invalid server");
  ipc.get("links:open")("trusted", url);
  expect(parent.webContents.send).toHaveBeenLastCalledWith(
    "links:open",
    parseDeepLink(url),
  );
});

it.each([
  "https://open?server=https%3A%2F%2Fcommunity.example",
  "haunt://user:pass@open?server=https%3A%2F%2Fcommunity.example",
  "haunt://open?server=http%3A%2F%2Fcommunity.example",
  "haunt://open?server=https%3A%2F%2Fcommunity.example%2Fpath",
  "haunt://open?server=https%3A%2F%2Fuser%3Apass%40community.example",
  "haunt://open?server=https%3A%2F%2Fcommunity.example&channel=other",
  `haunt://open?server=https%3A%2F%2Fcommunity.example&message=${crypto.randomUUID()}`,
])("rejects malformed or credential-bearing deep links: %s", (url) =>
  expect(() => parseDeepLink(url)).toThrow(),
);

it("clears queued media cache writes without touching independent message archives", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "haunt-cache-controls-"),
  );
  try {
    const archive = path.join(directory, "messages.jsonl.gz");
    await fs.writeFile(archive, "private archive");
    const cache = new DiskMediaCache(path.join(directory, "media"));
    const pending = cache.put("image", {
      type: "image/png",
      data: new Uint8Array([1, 2, 3]),
    });
    await cache.configure(16 * 1024 * 1024, true);
    await pending;
    expect(await cache.stats()).toEqual({
      budget: 16 * 1024 * 1024,
      bytes: 0,
      entries: 0,
    });
    expect(await cache.get("image")).toBeNull();
    expect(await fs.readFile(archive, "utf8")).toBe("private archive");
    await expect(cache.configure(0)).rejects.toThrow("16 to 8192");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

it("tracks native download progress, cancellation, retry and completed-file reveal through trusted IPC", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "haunt-download-controls-"),
  );
  const app = Object.assign(new EventEmitter(), { getPath: () => directory });
  const parent = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: { send: vi.fn(), downloadURL: vi.fn() },
  });
  const session = new EventEmitter(),
    handlers = new Map();
  const shell = { showItemInFolder: vi.fn(), openPath: vi.fn(async () => "") };
  try {
    await installDesktopTools({
      app,
      parent,
      session,
      ipcMain: {
        handle: (name: string, fn: unknown) => handlers.set(name, fn),
      },
      dialog: {},
      shell,
      clipboard: {},
      nativeImage: {},
      validateSender: (event: string) => {
        if (event !== "trusted") throw Error("Untrusted");
      },
      mediaCache: new DiskMediaCache(path.join(directory, "media")),
    });
    let received = 0;
    const output = path.join(directory, "saved.txt");
    const item = Object.assign(new EventEmitter(), {
      getURL: () => "blob:https://app.chatxo.local/download",
      getFilename: () => "saved.txt",
      getTotalBytes: () => 40,
      getReceivedBytes: () => received,
      getSavePath: () => output,
      setSaveDialogOptions: vi.fn(),
      cancel: vi.fn(),
      canResume: () => false,
    });
    session.emit("will-download", {}, item, parent.webContents);
    const list = () => handlers.get("downloads:list")("trusted");
    const id = list()[0].id;
    received = 12;
    item.emit("updated", {}, "progressing");
    expect(list()[0]).toMatchObject({
      name: "saved.txt",
      state: "progressing",
      received: 12,
      total: 40,
    });
    await handlers.get("downloads:action")("trusted", id, "cancel");
    expect(item.cancel).toHaveBeenCalledOnce();
    item.emit("done", {}, "cancelled");
    const retry = handlers.get("downloads:action")("trusted", id, "retry");
    expect(parent.webContents.downloadURL).toHaveBeenCalledWith(item.getURL());
    session.emit("will-download", {}, item, parent.webContents);
    await retry;
    const completed = list()[0].id;
    await fs.writeFile(output, "downloaded");
    received = 40;
    item.emit("done", {}, "completed");
    await handlers.get("downloads:action")("trusted", completed, "reveal");
    expect(shell.showItemInFolder).toHaveBeenCalledWith(output);
    await expect(
      handlers.get("downloads:action")("foreign", completed, "reveal"),
    ).rejects.toThrow("Untrusted");
    await handlers.get("downloads:action")("trusted", completed, "remove");
    expect(await fs.readFile(output, "utf8")).toBe("downloaded");
  } finally {
    app.emit("before-quit");
    await fs.rm(directory, { recursive: true, force: true });
  }
});
