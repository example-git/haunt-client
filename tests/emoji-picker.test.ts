import { describe, expect, it, vi } from "vitest";
import { EmojiArtPool } from "../packages/browser/src/emoji-art";
import {
  customEmojiGroup,
  layoutEmojiGroups,
  loadEmojiRecents,
  rememberEmoji,
  searchEmojiGroups,
} from "../packages/browser/src/emoji-picker";

describe("emoji picker", () => {
  const group = customEmojiGroup(
    Array.from({ length: 100 }, (_, i) => ({
      id: `id-${i}`,
      name: `party_wave_${i}`,
      version: "v1",
      animated: true,
    })),
    "My server",
  );
  it("searches colon names and keywords and lays out a bounded viewport", () => {
    expect(searchEmojiGroups([group], ":party_wave_99:")[0].items[0].name).toBe(
      "party_wave_99",
    );
    expect(searchEmojiGroups([group], "WAVE party")[0].items).toHaveLength(100);
    expect(searchEmojiGroups([group], "missing")).toEqual([]);
    const layout = layoutEmojiGroups([group]);
    expect(layout.items).toHaveLength(100);
    expect(layout.positions[8]).toBe(72);
    expect(
      layout.rows.filter((row) => row.top < 280).flatMap((row) => row.items)
        .length,
    ).toBeLessThanOrEqual(56);
    expect(layout.height).toBe(30 + 13 * 42);
  });
  it("bounds, deduplicates and tolerates corrupt or unavailable recent storage", () => {
    let saved = "[]";
    const storage = {
      getItem: () => saved,
      setItem: (_: string, value: string) => {
        saved = value;
      },
    };
    let recent: string[] = [];
    for (let i = 0; i < 100; i++)
      recent = rememberEmoji(storage, "scope", recent, `server:${i}`);
    expect(loadEmojiRecents(storage, "scope")).toHaveLength(24);
    recent = rememberEmoji(storage, "scope", recent, "server:98");
    expect(recent[0]).toBe("server:98");
    expect(new Set(recent).size).toBe(24);
    saved = "{invalid";
    expect(loadEmojiRecents(storage, "scope")).toEqual([]);
    saved = '[1, null, "ok", "ok"]';
    expect(loadEmojiRecents(storage, "scope")).toEqual(["ok"]);
    expect(
      rememberEmoji(
        {
          setItem() {
            throw Error("denied");
          },
        },
        "scope",
        [],
        "unicode:😀",
      ),
    ).toEqual(["unicode:😀"]);
  });
  it("limits downloads, skips scrolled-away work, shares cached URLs and revokes on eviction/close", async () => {
    let serial = 0;
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:${++serial}`);
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const pool = new EmojiArtPool(3);
    const pending: (() => void)[] = [];
    const fetch = vi.fn(
      () =>
        new Promise<Blob>((resolve) =>
          pending.push(() => resolve(new Blob(["xx"]))),
        ),
    );
    const listener = vi.fn();
    const release = Array.from({ length: 10 }, (_, i) =>
      pool.acquire(`${i}`, fetch, listener),
    );
    const flush = async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    };
    await flush();
    expect(fetch).toHaveBeenCalledTimes(4);
    for (let i = 4; i < 10; i++) release[i]();
    pending.splice(0).forEach((finish) => finish());
    await flush();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenCalledTimes(4);
    release[0]();
    const cached = vi.fn();
    const releaseCached = pool.acquire("0", fetch, cached);
    expect(cached).toHaveBeenCalledWith("blob:1");
    expect(fetch).toHaveBeenCalledTimes(4);
    releaseCached();
    release[1]();
    expect(revoke).toHaveBeenCalledWith("blob:1");
    const late = pool.acquire("late", fetch, listener);
    await flush();
    pool.dispose();
    pending.splice(0).forEach((finish) => finish());
    await flush();
    expect(create).toHaveBeenCalledTimes(4);
    expect(revoke).toHaveBeenCalledTimes(4);
    late();
    release[2]();
    release[3]();
    vi.restoreAllMocks();
  });
});
