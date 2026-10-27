import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import {
  desktopDownloadFixture,
  checkDesktopTools,
} from "./check-desktop-tools.mjs";

async function providerFixtures(page, desktop) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "haunt-post-video-"),
  );
  try {
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=12",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "5",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-g",
      "12",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      path.join(directory, "video.mp4"),
    ]);
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-i",
      path.join(directory, "video.mp4"),
      "-c",
      "copy",
      "-hls_time",
      "1",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_type",
      "fmp4",
      "-hls_segment_filename",
      path.join(directory, "segment%d.m4s"),
      path.join(directory, "playlist.m3u8"),
    ]);
    const assets = new Map();
    for (const name of await fs.readdir(directory))
      assets.set(name, await fs.readFile(path.join(directory, name)));
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/mXPo5QAAAABJRU5ErkJggg==",
      "base64",
    );
    const did = "did:plc:z72i7hdynmk6r22z27h6tvur";
    const base = `https://video.bsky.app/watch/${encodeURIComponent(did)}/bafkreifixture/`;
    const calls = [];
    const handle = async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      calls.push({ url: url.href, headers: request.headers() });
      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": "bytes",
      };
      if (url.hostname === "public.api.bsky.app") {
        if (url.pathname.endsWith("resolveHandle"))
          return route.fulfill({ headers, json: { did } });
        const uri = url.searchParams.get("uris");
        const video = {
          $type: "app.bsky.embed.video#view",
          playlist: base + "playlist.m3u8",
          thumbnail: base + "poster.png",
          alt: "Bluesky video fixture",
        };
        const embed = uri.endsWith("3key")
          ? {
              $type: "app.bsky.embed.images#view",
              images: [
                { fullsize: "https://cdn.bsky.app/img/one.png" },
                { fullsize: "https://cdn.bsky.app/img/two.png" },
              ],
            }
          : uri.endsWith("3nested")
            ? { $type: "app.bsky.embed.recordWithMedia#view", media: video }
            : video;
        return route.fulfill({
          headers,
          json: {
            posts: [
              {
                uri,
                author: {
                  displayName: "Post author",
                  handle: "author",
                  avatar: "https://cdn.bsky.app/img/avatar.png",
                },
                record: { text: "First paragraph.\n\nSecond paragraph." },
                embed,
              },
            ],
          },
        });
      }
      if (url.hostname === "www.tikwm.com")
        return route.fulfill({
          headers,
          json: {
            code: 0,
            data: {
              id: "123",
              title: "TikTok video fixture",
              play: "https://v19.tiktokcdn-us.com/video/video.mp4",
              cover: "https://p16.tiktokcdn-us.com/poster.png",
              author: { nickname: "Post author", unique_id: "author" },
            },
          },
        });
      const name = url.pathname.split("/").pop();
      if (name.endsWith(".png"))
        return route.fulfill({
          headers,
          contentType: "image/png",
          body: image,
        });
      const body = assets.get(name);
      assert(body, `Unexpected provider media ${url}`);
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range ?? "");
      const contentType = name.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : "video/mp4";
      if (!range) return route.fulfill({ headers, contentType, body });
      const start = Number(range[1]),
        end = Math.min(
          body.length - 1,
          range[2] ? Number(range[2]) : body.length - 1,
        );
      return route.fulfill({
        status: 206,
        contentType,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${body.length}`,
        },
        body: body.subarray(start, end + 1),
      });
    };
    const hosts = [
      "public.api.bsky.app",
      "video.bsky.app",
      "video.cdn.bsky.app",
      "cdn.bsky.app",
      "www.tikwm.com",
      "v19.tiktokcdn-us.com",
      "p16.tiktokcdn-us.com",
    ];
    for (const host of hosts) await page.route(`https://${host}/**`, handle);
    let server;
    if (desktop) {
      server = createServer((request, response) => {
        const url = new URL(request.url, "http://fixture").searchParams.get(
          "url",
        );
        if (!url || !hosts.includes(new URL(url).hostname)) {
          response.writeHead(400).end();
          return;
        }
        void handle({
          request: () => ({ url: () => url, headers: () => request.headers }),
          fulfill: async (value) => {
            const body =
              value.json === undefined
                ? value.body
                : JSON.stringify(value.json);
            response.writeHead(value.status || 200, {
              ...value.headers,
              "Content-Type":
                value.json === undefined
                  ? value.contentType || "application/octet-stream"
                  : "application/json",
            });
            response.end(body);
          },
        }).catch((error) => {
          response.writeHead(500).end(error.message);
        });
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      await desktop.evaluate(
        ({ net }, { hosts, port }) => {
          const original = net.fetch.bind(net);
          globalThis.restoreEmbedFetch = () => {
            net.fetch = original;
          };
          net.fetch = (request, options) => {
            const url = typeof request === "string" ? request : request.url;
            if (!hosts.includes(new URL(url).hostname))
              return original(request, options);
            return original(
              `http://127.0.0.1:${port}/?url=${encodeURIComponent(url)}`,
              {
                headers:
                  typeof request === "string" ? undefined : request.headers,
                credentials: "omit",
                bypassCustomProtocolHandlers: true,
              },
            );
          };
        },
        { hosts, port: server.address().port },
      );
    }
    return {
      calls,
      close: async () => {
        if (desktop)
          await desktop.evaluate(() => {
            globalThis.restoreEmbedFetch?.();
            delete globalThis.restoreEmbedFetch;
          });
        if (server) {
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }
      },
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function checkEmbeds(browser, fixtures, providedPage, desktop) {
  const context =
    providedPage?.context() ??
    (await browser.newContext({
      viewport: { width: 1280, height: 850 },
    }));
  const errors = [],
    external = [],
    previews = [];
  let conversation = fixtures.rtc.general;
  let providerCleanup;
  let downloadFixture;
  try {
    const page = providedPage ?? (await context.newPage());
    if (desktop) downloadFixture = await desktopDownloadFixture(desktop);
    const provider = await providerFixtures(page, desktop);
    const providerRequests = provider.calls;
    providerCleanup = provider.close;
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const target = new URL(request.url()).pathname.match(
        /^\/api\/v1\/conversations\/([^/]+)\/messages$/,
      );
      if (request.method() === "POST" && target) conversation = target[1];
      if (request.url().startsWith("https://preview.example.com"))
        external.push(request.url());
      if (request.url().includes("/embeds")) previews.push(request);
    });
    let previewsAvailable = false;
    await page.route(`${fixtures.rtc.url}/api/v1/instance`, async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      if (!previewsAvailable)
        json.capabilities = json.capabilities.filter(
          (value) => value !== "messages.embeds",
        );
      await route.fulfill({ response, json });
    });
    if (!providedPage) await page.goto(fixtures.rtc.url);
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixtures.rtc.url, "owner");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("dialog"))
      .toHaveCount(0, { timeout: 20000 })
      .catch(async (error) => {
        console.error(
          "Embed login dialog:",
          await page.getByRole("dialog").innerText(),
        );
        throw error;
      });
    await expect(page.locator(".connection")).toHaveText("Connected");
    const send = async (body, rendered = body) => {
      await page.getByLabel("Message", { exact: true }).fill(body);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      const row = page
        .locator(".message")
        .filter({ has: page.locator(".message-body", { hasText: rendered }) });
      await expect(row).toHaveCount(1);
      return row;
    };
    const row = await send("Rich article https://preview.example.com/article.");
    await expect(row.locator(".message-embeds")).toHaveCount(0);
    previewsAvailable = true;
    await page
      .getByRole("button", { name: "Refresh conversations", exact: true })
      .click();
    const card = row.locator(".embed-card");
    await expect(card).toContainText("Example journal · preview.example.com");
    await expect(card).toContainText(
      "A rich preview <script>plain text</script>",
    );
    await expect(card.locator("script")).toHaveCount(0);
    await expect(row.locator(".message-body a")).toHaveAttribute(
      "href",
      "https://preview.example.com/article",
    );
    await expect(card.locator("img")).toBeVisible();
    await expect
      .poll(() => card.locator("img").evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
    assert(
      previews.every((r) => !!r.headers().authorization),
      "preview requests require session authentication",
    );
    assert.deepEqual(
      external,
      [],
      "no direct browser thumbnail or metadata fetches",
    );
    await card.getByRole("button", { name: "Enlarge preview image" }).click();
    await expect(
      page.getByRole("dialog", { name: "Image preview" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .locator(".messages")
          .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
      )
      .toBeLessThan(120);

    const quiet = await send(
      "Quiet <https://preview.example.com/quiet> `https://preview.example.com/code`",
      "Quiet https://preview.example.com/quiet https://preview.example.com/code",
    );
    await expect(quiet.locator(".message-embeds")).toHaveCount(0);
    const unavailable = await send("Local http://127.0.0.1/private");
    await expect(unavailable.locator(".message-body a")).toHaveCount(1);
    await expect(unavailable.locator(".embed-card")).toHaveCount(0);
    const missing = await send(
      "Missing https://preview.example.com/missing-image",
    );
    await expect(missing.locator(".embed-title")).toBeVisible();

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/mXPo5QAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.locator("input[type=file]").setInputFiles({
      name: "inline.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.locator(".attachment-chips")).toContainText("inline.png");
    const attachment = await send("An automatic inline attachment");
    await expect(attachment.locator("img.attachment-image")).toBeVisible();
    await expect
      .poll(() => attachment.locator("img").evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
    await attachment
      .getByRole("button", { name: "Enlarge inline.png" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    if (desktop) {
      await page
        .getByRole("button", { name: "Copy image", exact: true })
        .click();
      await expect(
        page.getByText("Image copied.", { exact: true }),
      ).toBeVisible();
      assert.deepEqual(
        await desktop.evaluate(async ({ clipboard, nativeImage }) => {
          const item = (await clipboard.read()).find((item) =>
            item.types.includes("image/png"),
          );
          const blob = await item.getType("image/png");
          return nativeImage
            .createFromBuffer(Buffer.from(await blob.arrayBuffer()))
            .getSize();
        }),
        { width: 1, height: 1 },
      );
      await page
        .getByRole("link", { name: "Download image", exact: true })
        .click();
      await expect
        .poll(async () =>
          (
            await page.evaluate(() => window.hauntDesktop.downloads.list())
          ).some((item) => item.state === "completed"),
        )
        .toBe(true);
      const image = (
        await page.evaluate(() => window.hauntDesktop.downloads.list())
      ).find((item) => item.state === "completed");
      assert((await fs.readFile(image.filePath)).equals(png));
    }
    await page.getByRole("button", { name: "Close image preview" }).click();

    // A local document stands in for the external player; this checks gating,
    // CSP and sandbox integration, not live YouTube availability or playback.
    if (!providedPage) {
      let playerRequests = 0;
      await page.route("https://www.youtube-nocookie.com/**", async (route) => {
        playerRequests++;
        await route.fulfill({
          contentType: "text/html",
          body: "<p>Test player frame</p>",
        });
      });
      const video = await send("Watch https://youtu.be/abcdefghijk");
      await expect(
        video.getByRole("button", {
          name: "Play YouTube video: Fixture video",
        }),
      ).toBeVisible();
      assert.equal(playerRequests, 0);
      await expect(video.locator("iframe")).toHaveCount(0);
      await video
        .getByRole("button", { name: "Play YouTube video: Fixture video" })
        .click();
      await expect(video.locator("iframe")).toHaveAttribute(
        "src",
        "https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&rel=0",
      );
      await expect(
        video.frameLocator("iframe").getByText("Test player frame"),
      ).toBeVisible();
      await video.getByRole("button", { name: "Close embedded video" }).click();
      await expect(video.locator("iframe")).toHaveCount(0);
    }
    for (const link of [
      "https://x.com/author/status/123",
      "https://bsky.app/profile/author.bsky.social/post/3key",
    ]) {
      const post = await send("Social post " + link);
      await expect(post.locator(".embed-post-author")).toContainText(
        "Post author",
      );
      await expect(post.locator(".embed-description")).toHaveText(
        "First paragraph.\n\nSecond paragraph.",
      );
      await expect(
        post.locator(".embed-gallery .embed-picture img"),
      ).toHaveCount(2);
      for (const picture of await post
        .locator(".embed-gallery .embed-picture img")
        .all())
        await expect
          .poll(() => picture.evaluate((image) => image.naturalWidth))
          .toBeGreaterThan(0);
      await expect(post.locator(".embed-open")).toHaveAttribute("href", link);
      if (link.includes("x.com")) {
        await expect(post.locator("video")).toHaveCount(0);
        await post
          .getByRole("button", { name: "Play video", exact: true })
          .click();
        await expect
          .poll(() =>
            post.locator("video").evaluate((video) => video.currentTime),
          )
          .toBeGreaterThan(0.1);
        await post.locator("video").evaluate((video) => {
          video.currentTime = 2;
        });
        await expect
          .poll(() =>
            post.locator("video").evaluate((video) => video.currentTime),
          )
          .toBeGreaterThan(2);
        await post.locator("video").evaluate((video) => video.pause());
      }
    }

    for (const link of [
      "https://www.tiktok.com/@author/video/123",
      "https://vm.tiktok.com/ZShare123/",
      "https://bsky.app/profile/author.bsky.social/post/3video",
      "https://bsky.app/profile/author.bsky.social/post/3nested",
    ]) {
      const before = providerRequests.length;
      const post = await send("Client video " + link);
      const play = post.getByRole("button", {
        name: "Play video",
        exact: true,
      });
      await expect(play).toBeVisible();
      await expect(post.locator("iframe, video")).toHaveCount(0);
      assert(
        !providerRequests
          .slice(before)
          .some((request) => /\.(mp4|m4s|m3u8)(?:$|\?)/.test(request.url)),
        "video downloaded before play",
      );
      const serverRequests = previews.length;
      await play.click();
      const video = post.locator("video");
      await expect
        .poll(() =>
          video.evaluate(
            (element) => element.getVideoPlaybackQuality().totalVideoFrames,
          ),
        )
        .toBeGreaterThan(2);
      await video.evaluate((element) => {
        element.currentTime = 3;
      });
      await expect
        .poll(() => video.evaluate((element) => element.currentTime))
        .toBeGreaterThan(3);
      assert(
        !previews
          .slice(serverRequests)
          .some(
            (request) =>
              request.url().includes("video-ticket") ||
              request.url().includes("/embeds/video"),
          ),
        "client video used community media relay",
      );
      await video.evaluate((element) => element.pause());
      if (desktop) {
        await post
          .getByLabel("Playback speed", { exact: true })
          .selectOption("1.5");
        assert.equal(
          await video.evaluate((element) => element.playbackRate),
          1.5,
        );
        await post
          .getByRole("button", { name: "Picture in picture", exact: true })
          .click();
        await expect
          .poll(() => page.evaluate(() => !!document.pictureInPictureElement))
          .toBe(true);
        await post
          .getByRole("button", { name: "Picture in picture", exact: true })
          .click();
        await expect
          .poll(() => page.evaluate(() => !!document.pictureInPictureElement))
          .toBe(false);
        assert.equal(
          await page.evaluate(() => localStorage.getItem("haunt-media-speed")),
          "1.5",
        );
      }
      await post
        .getByRole("button", { name: "Hide previews", exact: true })
        .click();
      await expect(video).toHaveCount(0);
      const stopped = providerRequests.length;
      await page.waitForTimeout(250);
      assert.equal(
        providerRequests.length,
        stopped,
        "hidden video continued downloading",
      );
    }
    for (const request of providerRequests) {
      assert(
        !request.headers.authorization && !request.headers.cookie,
        "provider request forwarded account credentials",
      );
    }

    for (const [extension, kind] of [
      ["mp4", "video"],
      ["wav", "audio"],
    ]) {
      const direct = await send(
        `Direct file https://preview.example.com/direct.${extension}`,
      );
      await direct
        .getByRole("button", { name: `Play ${kind}`, exact: true })
        .click();
      await expect
        .poll(() => direct.locator(kind).evaluate((media) => media.currentTime))
        .toBeGreaterThan(0.1);
      await expect(direct.locator(kind)).toHaveAttribute(
        "src",
        /\/api\/v1\/conversations\/.*\/embeds\/video\?ticket=/,
      );
      await direct.locator(kind).evaluate((media) => media.pause());
    }
    if (!providedPage) {
      for (const [link, name, target] of [
        [
          "https://vimeo.com/76979871",
          "Vimeo",
          "https://player.vimeo.com/video/76979871?autoplay=1&dnt=1",
        ],
        [
          "https://streamable.com/abc123",
          "Streamable",
          "https://streamable.com/e/abc123?autoplay=1",
        ],
        [
          "https://twitch.tv/videos/123456",
          "Twitch",
          `https://player.twitch.tv/?video=v123456&parent=${new URL(fixtures.rtc.url).hostname}&autoplay=true`,
        ],
        [
          "https://twitch.tv/hauntfixture",
          "Twitch",
          `https://player.twitch.tv/?channel=hauntfixture&parent=${new URL(fixtures.rtc.url).hostname}&autoplay=true`,
        ],
        [
          "https://clips.twitch.tv/FixtureClip",
          "Twitch",
          `https://clips.twitch.tv/embed?clip=FixtureClip&parent=${new URL(fixtures.rtc.url).hostname}&autoplay=true`,
        ],
      ]) {
        let requests = 0;
        await page.route(target, (route) => {
          requests++;
          return route.fulfill({
            contentType: "text/html",
            body: `<p>${name} fixture player</p>`,
          });
        });
        const provider = await send(`Official provider ${link}`);
        await expect(provider.locator(".embed-title")).toHaveText(
          `${name} fixture`,
        );
        assert.equal(requests, 0, "external player contacted before playback");
        await provider
          .getByRole("button", { name: `Play ${name} video: ${name} fixture` })
          .click();
        await expect(provider.locator("iframe")).toHaveAttribute("src", target);
        await expect(
          provider.frameLocator("iframe").getByText(`${name} fixture player`),
        ).toBeVisible();
        await provider
          .getByRole("button", { name: "Close embedded video" })
          .click();
      }
    }
    assert.deepEqual(
      external,
      [],
      "user-submitted media hosts must only be contacted by the server",
    );

    // Incoming messages must not pull a reader away from older history or
    // start preview requests for content outside the visible scroll area.
    await page.locator(".messages").evaluate((el) => {
      el.scrollTop = 0;
    });
    const loginResponse = await fetch(`${fixtures.rtc.url}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "owner",
        password: fixtures.password,
        device_name: "embed scroll test",
      }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();
    const incomingResponse = await fetch(
      `${fixtures.rtc.url}/api/v1/conversations/${conversation}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${login.token}`,
        },
        body: JSON.stringify({
          body: "While reading history https://preview.example.com/background",
          request_id: randomUUID(),
        }),
      },
    );
    assert.equal(incomingResponse.status, 201);
    const incoming = await incomingResponse.json();
    const background = page
      .locator(".message")
      .filter({ hasText: "While reading history" });
    await expect(background).toHaveCount(0);
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator(".messages").evaluate((el) => el.scrollTop),
      0,
    );
    assert.equal(
      previews.filter((request) => request.url().includes(incoming.id)).length,
      0,
    );
    await page.locator(".messages").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(background.locator(".embed-title")).toBeVisible();

    await background.hover();
    await background
      .getByRole("button", { name: "Message options", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Edit message", exact: true })
      .click();
    await page
      .locator(".message textarea")
      .fill("Edited article without a link");
    await page
      .locator(".message")
      .filter({ has: page.locator("textarea") })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    const edited = page
      .locator(".message")
      .filter({ hasText: "Edited article without a link" });
    await expect(edited.locator(".embed-card")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    assert.deepEqual(errors, []);
    if (desktop)
      await checkDesktopTools(page, desktop, downloadFixture, fixtures);
    assert.deepEqual(errors, []);
    console.log(
      `PASS rich embeds: authenticated cards/images, escaped metadata, suppression, unavailable links, inline attachments/lightbox, native video playback/seeking${providedPage ? "" : ", sandboxed YouTube player"}, edits, capability upgrade, scroll preservation/lazy fetching and mobile width`,
    );
  } finally {
    await providerCleanup?.();
    await downloadFixture?.close();
    if (!providedPage) await context.close();
  }
}

export async function checkDesktopLinks(desktop, page) {
  await desktop.evaluate(({ shell }) => {
    globalThis.hauntLinks = [];
    shell.openExternal = async (url) => {
      globalThis.hauntLinks.push(url);
    };
  });
  await page.evaluate(() =>
    window.hauntDesktop.openExternal("https://example.com/article"),
  );
  assert.deepEqual(await desktop.evaluate(() => globalThis.hauntLinks), [
    "https://example.com/article",
  ]);
  assert.equal(
    await page.evaluate(() =>
      window.hauntDesktop.openExternal("file:///etc/passwd").then(
        () => false,
        () => true,
      ),
    ),
    true,
  );
  assert.equal(
    await desktop.evaluate(async ({ BrowserWindow, app }) => {
      const untrusted = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: `${app.getAppPath()}/apps/desktop/preload.cjs`,
          partition: "persist:chatxo",
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      try {
        await untrusted.loadURL("https://app.chatxo.local");
        return await untrusted.webContents.executeJavaScript(
          'window.hauntDesktop.openExternal("https://example.com/forbidden").then(()=>false,()=>true)',
        );
      } finally {
        untrusted.destroy();
      }
    }),
    true,
  );
  assert.deepEqual(await desktop.evaluate(() => globalThis.hauntLinks), [
    "https://example.com/article",
  ]);
  console.log(
    "PASS desktop external links: validated HTTP(S), trusted renderer only, OS browser call intercepted",
  );
}

export async function checkLiveEmbeds(browser, fixtures, providedPage) {
  const links = JSON.parse(process.env.HAUNT_LIVE_EMBED_POSTS || "[]");
  assert(
    links.length > 0 && links.length <= 4,
    "Provide 1-4 public sample URLs in HAUNT_LIVE_EMBED_POSTS",
  );
  const context =
    providedPage?.context() ??
    (await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }));
  try {
    const page = providedPage ?? (await context.newPage());
    page.on("requestfailed", (request) =>
      console.error(
        "Live provider request failed",
        new URL(request.url()).host + new URL(request.url()).pathname,
        request.failure()?.errorText,
      ),
    );
    page.on("response", (response) => {
      if (response.status() >= 400)
        console.error(
          "Live provider response",
          new URL(response.url()).hostname,
          response.status(),
        );
    });
    page.on("pageerror", (error) =>
      console.error("Live player error", error.message),
    );
    if (!providedPage) await page.goto(fixtures.rtc.url);
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixtures.rtc.url, "owner");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    const report = [];
    for (const link of links) {
      await page.getByLabel("Message", { exact: true }).fill(link);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      const row = page
        .locator(".message")
        .filter({ has: page.locator(".message-body a", { hasText: link }) });
      await expect(row.locator(".embed-post-author")).toBeVisible({
        timeout: 20000,
      });
      console.log(
        "Live post card",
        link,
        await row.locator(".embed-card").innerText(),
      );
      const pictures = row.locator(".embed-gallery .embed-picture img");
      const avatars = row.locator(".embed-avatar");
      if (new URL(link).hostname === "bsky.app") {
        await expect(avatars).toHaveCount(1, { timeout: 15000 });
        await expect
          .poll(() => avatars.evaluate((image) => image.naturalWidth), {
            timeout: 15000,
          })
          .toBeGreaterThan(0);
      }
      if (
        !(await row
          .getByRole("button", { name: "Play video", exact: true })
          .count())
      )
        await expect
          .poll(() => pictures.count(), { timeout: 15000 })
          .toBeGreaterThan(0);
      for (const image of await pictures.all())
        await expect
          .poll(() => image.evaluate((image) => image.naturalWidth), {
            timeout: 15000,
          })
          .toBeGreaterThan(0);
      let decodedFrames = 0;
      if (
        await row
          .getByRole("button", { name: "Play video", exact: true })
          .count()
      ) {
        await row
          .getByRole("button", { name: "Play video", exact: true })
          .click();
        await expect
          .poll(
            () => row.locator("video").evaluate((video) => video.currentTime),
            { timeout: 20000 },
          )
          .toBeGreaterThan(0.2);
        await row.locator("video").evaluate((video) => {
          video.currentTime = Math.min(5, video.duration / 2);
        });
        await expect
          .poll(
            () =>
              row
                .locator("video")
                .evaluate(
                  (video) => video.getVideoPlaybackQuality().totalVideoFrames,
                ),
            { timeout: 15000 },
          )
          .toBeGreaterThan(1);
        decodedFrames = await row.locator("video").evaluate((video) => {
          video.pause();
          return video.getVideoPlaybackQuality().totalVideoFrames;
        });
      }
      report.push({
        url: link,
        images: await pictures.count(),
        avatars: await avatars.count(),
        decodedFrames,
      });
      await row.screenshot({
        path: `test-results/live-post-${report.length}.png`,
      });
    }
    console.log(
      JSON.stringify({
        client: providedPage ? "desktop" : "browser",
        live_embeds: report,
      }),
    );
  } finally {
    if (!providedPage) await context.close();
  }
}
