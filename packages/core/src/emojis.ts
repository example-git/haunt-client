import { messageLinks } from "./links.js";
/** Server-scoped colon tokens, excluding links and backtick-delimited code. */
export function emojiTokens(text: string) {
  const links = messageLinks(text);
  const tokens: { name: string; start: number; end: number }[] = [];
  const pattern = /(`+)[\s\S]*?\1|:([a-zA-Z0-9_]{2,32}):/g;
  for (const match of text.matchAll(pattern)) {
    if (!match[2]) continue;
    const start = match.index,
      end = start + match[0].length;
    if (!links.some((link) => start < link.end && end > link.start))
      tokens.push({ name: match[2].toLowerCase(), start, end });
  }
  return tokens;
}
