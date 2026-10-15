import type { ReactNode } from "react";
import { emojiTokens, type InstanceClient } from "@haunt/core";
import { EmojiImage } from "./Emojis";
import { StandardEmojiText } from "./StandardEmoji";
export function EmojiText({
  text,
  instance,
  sourceText = text,
  offset = 0,
}: {
  text: string;
  instance: InstanceClient;
  sourceText?: string;
  offset?: number;
}) {
  const output: ReactNode[] = [];
  let at = 0;
  for (const original of emojiTokens(sourceText)) {
    if (original.start < offset || original.end > offset + text.length)
      continue;
    const token = {
      ...original,
      start: original.start - offset,
      end: original.end - offset,
    };
    const emoji = instance.snapshot.emojis.find((e) => e.name === token.name);
    if (!emoji) continue;
    output.push(
      <StandardEmojiText
        key={`text-${token.start}`}
        text={text.slice(at, token.start)}
      />,
      <EmojiImage key={token.start} instance={instance} emoji={emoji} />,
    );
    at = token.end;
  }
  output.push(<StandardEmojiText key="tail" text={text.slice(at)} />);
  return <>{output}</>;
}
