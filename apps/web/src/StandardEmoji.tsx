import type { CSSProperties, ReactNode } from "react";
import emojiRegex from "emoji-regex";
import index from "./emoji-sprites/index.json";

const sheets = import.meta.glob<string>("./emoji-sprites/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});
const sprites: Record<string, number[]> = index;
export function StandardEmoji({ text }: { text: string }) {
  const key = [...text]
    .map((char) => char.codePointAt(0)!.toString(16))
    .join("-");
  const sprite = sprites[key] ?? sprites[key.replaceAll("-fe0f", "")];
  if (!sprite) return <>{text}</>;
  const [sheet, slot] = sprite;
  const style: CSSProperties = {
    backgroundImage: `url("${sheets[`./emoji-sprites/${sheet}.webp`]}")`,
    backgroundPosition: `${((slot % 16) * 100) / 15}% ${(Math.floor(slot / 16) * 100) / 15}%`,
  };
  return (
    <span className="standard-emoji" role="img" aria-label={text} style={style}>
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
export function StandardEmojiText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(emojiRegex())) {
    parts.push(
      text.slice(at, match.index),
      <StandardEmoji key={match.index} text={match[0]} />,
    );
    at = match.index + match[0].length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
