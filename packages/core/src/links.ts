export interface MessageLink {
  start: number;
  end: number;
  url: string;
  preview: boolean;
}
/** Safe clickable HTTP(S) links. Code and angle-wrapped URLs do not unfurl. */
export function messageLinks(text: string): MessageLink[] {
  const code = [...text.matchAll(/(`+)([\s\S]*?)\1/g)].map((m) => [
    m.index!,
    m.index! + m[0].length,
  ]);
  const result: MessageLink[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"`]+/gi)) {
    const start = match.index!;
    if (code.some(([a, b]) => start >= a && start < b)) continue;
    let raw = match[0].replace(/[.,!?:;']+$/, "");
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ])
      while (
        raw.endsWith(close) &&
        raw.split(close).length > raw.split(open).length
      )
        raw = raw.slice(0, -1);
    const url = safeExternalURL(raw);
    if (!url) continue;
    result.push({
      start,
      end: start + raw.length,
      url,
      preview: !(text[start - 1] === "<" && text[start + raw.length] === ">"),
    });
  }
  return result;
}
export function safeExternalURL(value: string): string | undefined {
  if (value.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(value)) return;
  try {
    const u = new URL(value);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      !u.hostname
    )
      return;
    return u.href;
  } catch {
    return;
  }
}
export function youtubePlayer(id: string): string | undefined {
  return /^[A-Za-z0-9_-]{11}$/.test(id)
    ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`
    : undefined;
}

export function providerPlayer(
  embed: {
    url: string;
    youtube_id?: string;
    player?: string;
    player_id?: string;
    player_token?: string;
  },
  parent: string,
): string | undefined {
  const safe = safeExternalURL(embed.url);
  if (!safe) return;
  const original = new URL(safe);
  if (original.port) return;
  const host = original.hostname.replace(/^www\./, "");
  if (
    [
      "youtube.com",
      "m.youtube.com",
      "youtube-nocookie.com",
      "youtu.be",
    ].includes(host)
  )
    return youtubePlayer(embed.youtube_id ?? "");
  const id = embed.player_id ?? "";
  if (
    embed.player === "vimeo" &&
    ["vimeo.com", "player.vimeo.com"].includes(host) &&
    /^\d{1,15}$/.test(id)
  ) {
    const hash = embed.player_token ?? "";
    if (hash && !/^[a-zA-Z0-9]{6,64}$/.test(hash)) return;
    const url = new URL(`https://player.vimeo.com/video/${id}`);
    if (hash) url.searchParams.set("h", hash);
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("dnt", "1");
    return url.href;
  }
  if (
    embed.player === "streamable" &&
    host === "streamable.com" &&
    /^[a-z0-9]{1,64}$/.test(id)
  )
    return `https://streamable.com/e/${id}?autoplay=1`;
  if (
    !["twitch.tv", "m.twitch.tv", "clips.twitch.tv"].includes(host) ||
    !/^[a-zA-Z0-9.-]+$/.test(parent)
  )
    return;
  const url = new URL(
    embed.player === "twitch-clip"
      ? "https://clips.twitch.tv/embed"
      : "https://player.twitch.tv/",
  );
  if (embed.player === "twitch-clip" && /^[a-zA-Z0-9_-]{1,100}$/.test(id))
    url.searchParams.set("clip", id);
  else if (embed.player === "twitch-video" && /^\d{1,20}$/.test(id))
    url.searchParams.set("video", `v${id}`);
  else if (embed.player === "twitch-channel" && /^[a-zA-Z0-9_]{1,25}$/.test(id))
    url.searchParams.set("channel", id);
  else return;
  url.searchParams.set("parent", parent);
  url.searchParams.set("autoplay", "true");
  return url.href;
}
