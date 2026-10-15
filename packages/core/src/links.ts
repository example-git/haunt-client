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
