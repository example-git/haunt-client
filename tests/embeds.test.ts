import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { messageLinks, safeExternalURL, youtubePlayer, providerPlayer } from "@haunt/core";
import { mediaTask } from "../packages/browser/src/embeds";
const { externalURL } = createRequire(import.meta.url)(
  "../apps/desktop/network.cjs",
);

describe("rich message links", () => {
  it("constructs official players without allowing user-controlled iframe destinations", () => {
    expect(providerPlayer({ url: "https://vimeo.com/123456/abc123def0", player: "vimeo", player_id: "123456", player_token: "abc123def0" }, "chat.example.com")).toBe("https://player.vimeo.com/video/123456?h=abc123def0&autoplay=1&dnt=1");
    expect(providerPlayer({ url: "https://streamable.com/abc123", player: "streamable", player_id: "abc123" }, "chat.example.com")).toBe("https://streamable.com/e/abc123?autoplay=1");
    const twitch = providerPlayer({ url: "https://twitch.tv/videos/1234", player: "twitch-video", player_id: "1234" }, "chat.example.com");
    expect(new URL(twitch!).searchParams.get("parent")).toBe("chat.example.com");
    expect(new URL(twitch!).searchParams.get("video")).toBe("v1234");
    for (const url of ["https://vimeo.com.attacker.com/123456", "https://attacker.com/video", "https://attacker.com@vimeo.com/123456", "javascript:alert(1)"]) expect(providerPlayer({ url, player: "vimeo", player_id: "123456" }, "chat.example.com")).toBeUndefined();
    for (const id of ["https://attacker.com", "123/evil", "123?src=evil", '123"']) expect(providerPlayer({ url: "https://vimeo.com/123", player: "vimeo", player_id: id }, "chat.example.com")).toBeUndefined();
    expect(providerPlayer({ url: "https://vimeo.com/123", player: "vimeo", player_id: "123", player_token: "a&src=evil" }, "chat.example.com")).toBeUndefined();
  });
  it("keeps punctuation outside links, preserves balanced paths, suppresses code and angle-wrapped previews", () => {
    const text =
      "See https://example.com/article_(test). `https://code.example.com` <https://quiet.example.com>";
    const links = messageLinks(text);
    expect(links).toHaveLength(2);
    expect(text.slice(links[0].start, links[0].end)).toBe(
      "https://example.com/article_(test)",
    );
    expect(links[0].preview).toBe(true);
    expect(links[1].preview).toBe(false);
  });
  it("rejects unsafe browser and desktop links consistently", () => {
    for (const value of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,hello",
      "https://user:secret@example.com",
      "https://example.com\\@localhost",
      "https://example.com\n",
      "https://" + "a".repeat(2048),
    ]) {
      expect(safeExternalURL(value)).toBeUndefined();
      expect(() => externalURL(value)).toThrow();
    }
    for (const value of [
      "https://example.com",
      "http://192.168.1.1:8080/local",
      "https://example.com/?x=%22",
    ]) {
      expect(externalURL(value)).toBe(safeExternalURL(value));
    }
  });
  it("builds a player only from an exact YouTube ID", () => {
    expect(youtubePlayer("abcdefghijk")).toBe(
      "https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&rel=0",
    );
    for (const id of [
      "",
      "../evil.com",
      "https://example.com",
      'abcdefghij"',
      "abcdefghijk/extra",
    ])
      expect(youtubePlayer(id)).toBeUndefined();
  });
});

describe("bounded visible-media queue", () => {
  it("runs at most four jobs, cancels queued work and recovers from failures", async () => {
    let running = 0,
      peak = 0;
    const release: Array<() => void> = [];
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const jobs = controllers.map((c) =>
      mediaTask(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => release.push(resolve));
        running--;
        return true;
      }, c.signal),
    );
    await Promise.resolve();
    expect(running).toBe(4);
    const cancelled = expect(jobs[5]).rejects.toMatchObject({
      name: "AbortError",
    });
    controllers[5].abort();
    await cancelled;
    for (let i = 0; i < 8; i++) {
      release.splice(0).forEach((fn) => fn());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(jobs.filter((_, i) => i !== 5));
    expect(peak).toBe(4);
    await expect(
      mediaTask(() => {
        throw Error("failed");
      }, new AbortController().signal),
    ).rejects.toThrow("failed");
    await expect(
      mediaTask(async () => 42, new AbortController().signal),
    ).resolves.toBe(42);
  });
  it("rejects overflow and clears cancelled waiting work", async () => {
    const controller = new AbortController();
    const release: Array<() => void> = [];
    const jobs = Array.from({ length: 100 }, () =>
      mediaTask(
        () => new Promise<void>((resolve) => release.push(resolve)),
        controller.signal,
      ),
    );
    const settled = Promise.allSettled(jobs);
    await expect(
      mediaTask(async () => 0, new AbortController().signal),
    ).rejects.toThrow("queue full");
    controller.abort();
    release.forEach((fn) => fn());
    expect((await settled).filter((r) => r.status === "rejected")).toHaveLength(
      96,
    );
    await expect(
      mediaTask(async () => true, new AbortController().signal),
    ).resolves.toBe(true);
  });
});
