import { describe, it, expect, vi, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { webcrypto, randomUUID } from "node:crypto";
import {
  rasterInfo,
  decryptImage,
} from "../packages/browser/src/dm-crypto/images";
import {
  cryptoDB,
  cryptoLock,
} from "../packages/browser/src/dm-crypto/storage";
import { validatePlain } from "../packages/browser/src/dm-crypto/validation";
import { csvCell, escapeHTML } from "../packages/browser/src/dm-export";
import type { InstanceClient } from "@haunt/core";
afterEach(() => vi.unstubAllGlobals());
describe("DM image and export boundaries", () => {
  it("rejects vector, executable, truncated and oversized raster input before decoding", () => {
    for (const text of [
      "<svg onload=alert(1)>",
      "MZexecutable",
      "GIF89a",
      "\x89PNG",
    ])
      expect(() => rasterInfo(new TextEncoder().encode(text))).toThrow();
    const png = new Uint8Array(24);
    png[0] = 137;
    png.set(new TextEncoder().encode("PNG"), 1);
    png.set(new TextEncoder().encode("IHDR"), 12);
    new DataView(png.buffer).setUint32(16, 8192);
    new DataView(png.buffer).setUint32(20, 8192);
    expect(() => rasterInfo(png)).toThrow(/16 megapixels/);
  });
  it("authenticates ciphertext and rejects nonimages even with a valid sender key", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const scope = JSON.stringify(["server", randomUUID()]),
      id = randomUUID(),
      conversation = randomUUID(),
      author = randomUUID(),
      token = randomUUID();
    const key = webcrypto.getRandomValues(new Uint8Array(32)),
      iv = webcrypto.getRandomValues(new Uint8Array(12));
    const clear = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    await (
      await cryptoDB()
    ).put(
      "images",
      {
        id,
        conversation,
        author,
        token,
        key: Buffer.from(key).toString("base64"),
        type: "image/webp",
        name: "safe.webp",
        bytes: clear.length,
      },
      [scope, id],
    );
    const instance = {
      scope,
      account: { instance: { instance_id: "server" } },
    } as InstanceClient;
    const imported = await crypto.subtle.importKey(
      "raw",
      key,
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const cipher = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(
          JSON.stringify([
            "haunt-dm-image-v1",
            "server",
            conversation,
            author,
            token,
          ]),
        ),
      },
      imported,
      clear,
    );
    const bytes = new Uint8Array(29 + clear.length);
    bytes[0] = 1;
    bytes.set(iv, 1);
    bytes.set(new Uint8Array(cipher), 13);
    const decoder = vi.fn();
    vi.stubGlobal("createImageBitmap", decoder);
    await expect(decryptImage(instance, id, new Blob([bytes]))).rejects.toThrow(
      /raster/,
    );
    expect(decoder).not.toHaveBeenCalled();
    bytes[bytes.length - 1] ^= 1;
    await expect(
      decryptImage(instance, id, new Blob([bytes])),
    ).rejects.toThrow();
    expect(decoder).not.toHaveBeenCalled();
    await expect(
      decryptImage(instance, id, new Blob([bytes.subarray(1)])),
    ).rejects.toThrow(/length/);
  });
  it("requires browser-wide serialization and rejects malformed encrypted payloads", async () => {
    vi.stubGlobal("navigator", {});
    await expect(cryptoLock("test", async () => {})).rejects.toThrow(
      /Web Locks/,
    );
    expect(() =>
      validatePlain({
        version: 1,
        instance: "server",
        author: randomUUID(),
        conversation: randomUUID(),
        device: randomUUID(),
        request: randomUUID(),
        body: "test",
        images: [{} as any],
      }),
    ).toThrow();
  });
  it("exports escaped HTML and inert CSV spreadsheet cells", () => {
    expect(escapeHTML("<script>\"&'</script>")).toBe(
      "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;",
    );
    for (const value of ["=CMD()", " +123", "@SUM(A1:A2)", "\tbad"])
      expect(csvCell(value)).toMatch(/^"'/);
    expect(csvCell('say "hello"')).toBe('"say ""hello"""');
  });
});
