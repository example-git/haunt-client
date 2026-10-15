import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { serverOrigin, socketURL } from "@haunt/core";
import { randomUUID } from "../packages/browser/src/random";
const { localHTTPHost, allowInsecureRequest } = createRequire(import.meta.url)(
  "../apps/desktop/network.cjs",
);

describe("LAN HTTP", () => {
  it("accepts private IPs consistently in the SDK and desktop vault", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "127.0.0.2",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.117",
      "[::1]",
      "[fc00::1]",
      "[fdff::1]",
      "[::ffff:192.168.1.1]",
      "[::ffff:127.0.0.1]",
    ]) {
      const url = new URL(`http://${host}:8080`);
      expect(serverOrigin(url.href)).toBe(url.origin);
      expect(localHTTPHost(url.hostname)).toBe(true);
      expect(socketURL(url.origin, "/api/v1/events")).toBe(
        `ws://${url.host}/api/v1/events`,
      );
    }
  });
  it("rejects public, link-local, unspecified and deceptive HTTP hosts", () => {
    for (const host of [
      "8.8.8.8",
      "172.15.255.255",
      "172.32.0.1",
      "192.169.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "[::]",
      "[fe80::1]",
      "[2001:db8::1]",
      "[::ffff:8.8.8.8]",
      "192.168.1.1.example.test",
      "localhost.example.test",
    ]) {
      const url = new URL(`http://${host}`);
      expect(() => serverOrigin(url.href)).toThrow();
      expect(localHTTPHost(url.hostname)).toBe(false);
    }
    for (const origin of [
      "http://user:password@192.168.1.1",
      "http://192.168.1.1/path",
      "http://192.168.1.1?token=x",
    ])
      expect(() => serverOrigin(origin)).toThrow();
  });
  it("limits desktop mixed content to local API fetches and sockets in its own window", () => {
    const request = {
      url: "http://192.168.1.117:8080/api/v1/instance",
      resourceType: "xhr",
      webContentsId: 12,
    };
    expect(allowInsecureRequest(request, 12)).toBe(true);
    expect(
      allowInsecureRequest(
        {
          ...request,
          url: "ws://192.168.1.117:8080/api/v1/events",
          resourceType: "webSocket",
        },
        12,
      ),
    ).toBe(true);
    expect(allowInsecureRequest(request, 13)).toBe(false);
    for (const resourceType of [
      "script",
      "image",
      "mainFrame",
      "subFrame",
      "other",
    ])
      expect(allowInsecureRequest({ ...request, resourceType }, 12)).toBe(
        false,
      );
    for (const url of [
      "http://public.test/api/v1/instance",
      "http://192.168.1.117/elsewhere",
      "http://user:pass@192.168.1.117/api/v1/instance",
    ])
      expect(allowInsecureRequest({ ...request, url }, 12)).toBe(false);
  });
  it("generates valid unique message IDs without the secure-context randomUUID API", () => {
    const source = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    const ids = Array.from({ length: 100 }, () => randomUUID(source));
    expect(new Set(ids).size).toBe(100);
    for (const id of ids)
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
  });
});

describe("desktop server request forwarding", () => {
  const { forwardDesktopRequest, appAPIRequest } = createRequire(
    import.meta.url,
  )("../apps/desktop/network.cjs");
  const appOrigin = "https://app.chatxo.local";
  it("keeps each server's URL, credentials and binary body while adapting its origin", async () => {
    for (const host of ["one.test", "two.test"]) {
      const url = `https://${host}/api/v1/auth/login`;
      const body = new Uint8Array([0, 1, 128, 255, 13, 10]);
      const response = await forwardDesktopRequest(
        new Request(url, {
          method: "POST",
          headers: {
            Origin: appOrigin,
            Authorization: `Bearer ${host}`,
            "Content-Type": "application/octet-stream",
          },
          body,
        }),
        appOrigin,
        async (request: Request) => {
          expect(request.url).toBe(url);
          expect(request.headers.get("Origin")).toBe(`https://${host}`);
          expect(request.headers.get("Referer")).toBe(`https://${host}/`);
          expect(request.headers.get("Authorization")).toBe(`Bearer ${host}`);
          expect(request.credentials).toBe("omit");
          expect(request.redirect).toBe("error");
          expect(new Uint8Array(await request.arrayBuffer())).toEqual(body);
          return new Response("denied", {
            status: 401,
            headers: {
              "Access-Control-Allow-Origin": `https://${host}`,
              "Retry-After": "5",
            },
          });
        },
      );
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("denied");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        appOrigin,
      );
      expect(response.headers.get("Retry-After")).toBe("5");
    }
  });
  it("does not alter third-party frames, arbitrary resources or insecure public servers", async () => {
    for (const [url, origin] of [
      ["https://one.test/api/v1/auth/login", "https://embed.test"],
      ["https://one.test/elsewhere", appOrigin],
      ["http://public.test/api/v1/instance", appOrigin],
    ]) {
      const request = new Request(url, { headers: { Origin: origin } });
      const original = new Response("unmodified");
      expect(
        await forwardDesktopRequest(
          request,
          appOrigin,
          async (sent: Request) => {
            expect(sent).toBe(request);
            return original;
          },
        ),
      ).toBe(original);
    }
    const details = {
      url: "wss://one.test/api/v1/events",
      resourceType: "webSocket",
      webContentsId: 12,
      initiatorOrigin: appOrigin,
    };
    expect(appAPIRequest(details, appOrigin, [12])).toBe("https://one.test");
    expect(
      appAPIRequest(
        {
          ...details,
          initiatorOrigin: "https://embed.test",
          referrer: appOrigin,
        },
        appOrigin,
        [12],
      ),
    ).toBeNull();
    expect(appAPIRequest(details, appOrigin, [13])).toBeNull();
    expect(
      appAPIRequest({ ...details, resourceType: "script" }, appOrigin, [12]),
    ).toBeNull();
  });
});
