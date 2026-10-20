import { afterEach, expect, it, vi } from "vitest";
import {
  parseServerExtensions,
  requestExtensionSpeech,
} from "../packages/core/src/server-extensions";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("uses only the selected Haunt server and its login, not provider credentials", async () => {
  const fetcher = vi.fn(
    async (_request: Request) =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "audio/mpeg" },
      }),
  );
  const bytes = await requestExtensionSpeech(
    fetcher,
    "https://haunt.example.test",
    "haunt-token",
    "tiktok-tts",
    { text: "hello", voice: "en_us_001", room_id: "room" },
  );
  expect([...bytes]).toEqual([1, 2, 3]);
  const request = fetcher.mock.calls[0][0] as Request;
  expect(request.url).toBe(
    "https://haunt.example.test/api/v1/server-extensions/tiktok-tts/speech",
  );
  expect(request.headers.get("Authorization")).toBe("Bearer haunt-token");
  expect(request.headers.has("Cookie")).toBe(false);
  expect(request.redirect).toBe("error");
  expect(await request.json()).toEqual({
    text: "hello",
    voice: "en_us_001",
    room_id: "room",
  });
});

it("uses the separate owner-only live test route and rejects injected provider paths", async () => {
  const fetcher = vi.fn(
    async (_request: Request) =>
      new Response("audio", { headers: { "Content-Type": "audio/mpeg" } }),
  );
  await requestExtensionSpeech(
    fetcher,
    "https://haunt.example.test",
    "owner-token",
    "tiktok-tts",
    { text: "test", voice: "en_us_001" },
    undefined,
    true,
  );
  expect((fetcher.mock.calls[0][0] as Request).url).toBe(
    "https://haunt.example.test/api/v1/admin/server-extensions/tiktok-tts/test",
  );
  await expect(
    requestExtensionSpeech(
      fetcher,
      "https://haunt.example.test",
      "owner-token",
      "../another-server",
      { text: "test", voice: "en_us_001" },
    ),
  ).rejects.toThrow(/Invalid/);
  expect(fetcher).toHaveBeenCalledOnce();
});

it("does not accept JSON as audio and exposes bounded provider failure codes", async () => {
  const failed = async () =>
    Response.json({ error: "server_extension_unavailable" }, { status: 503 });
  await expect(
    requestExtensionSpeech(
      failed,
      "https://haunt.example.test",
      "token",
      "tiktok-tts",
      { text: "test", voice: "en_us_001" },
    ),
  ).rejects.toMatchObject({
    status: 503,
    code: "server_extension_unavailable",
  });
  await expect(
    requestExtensionSpeech(
      async () => Response.json({ data: "not audio" }),
      "https://haunt.example.test",
      "token",
      "tiktok-tts",
      { text: "test", voice: "en_us_001" },
    ),
  ).rejects.toThrow(/invalid audio/);
});

it("validates extension metadata without retaining arbitrary credentials or duplicate IDs", () => {
  const extension = {
    id: "tiktok-tts",
    name: "TikTok TTS",
    category: "tts",
    enabled: true,
    configured: true,
  };
  expect(
    parseServerExtensions({
      extensions: [{ ...extension, session_token: "never retain" }],
    }),
  ).toEqual([extension]);
  expect(() =>
    parseServerExtensions({ extensions: [extension, extension] }),
  ).toThrow();
});

it("persists provider, fallback and user overrides independently for each server", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const { getNarratorSettings, setNarratorSettings } =
    await import("../packages/browser/src/narrator/preferences");
  setNarratorSettings("one", {
    enabled: true,
    provider: "tiktok-tts",
    fallback: false,
    users: { alice: { voice: "en_us_006", ignored: true } },
  });
  setNarratorSettings("two", {
    enabled: false,
    provider: "device",
    fallback: true,
  });
  expect(getNarratorSettings("one")).toMatchObject({
    enabled: true,
    provider: "tiktok-tts",
    fallback: false,
    users: { alice: { ignored: true } },
  });
  expect(getNarratorSettings("two").users).toEqual({});
  expect(getNarratorSettings("unconfigured")).toMatchObject({
    enabled: false,
    provider: "device",
  });
  vi.resetModules();
  const reloaded = await import("../packages/browser/src/narrator/preferences");
  expect(reloaded.getNarratorSettings("one").fallback).toBe(false);
});
