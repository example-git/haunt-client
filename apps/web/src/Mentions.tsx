import { openProfile } from "./Profile";
import { EmojiText } from "./EmojiText";
import { ExternalLink } from "./RichContent";
import { messageLinks, mentions, type InstanceClient } from "@haunt/core";
import type { ReactNode } from "react";
export function MentionText({
  text,
  instance,
}: {
  text: string;
  instance: InstanceClient;
}) {
  const output: ReactNode[] = [];
  let offset = 0;
  const links = messageLinks(text);
  const plain = (value: string, start: number) => {
    const pieces: ReactNode[] = [];
    let at = 0;
    for (const link of links.filter(
      (link) => link.start >= start && link.end <= start + value.length,
    )) {
      const a = link.start - start,
        b = link.end - start;
      pieces.push(
        <EmojiText
          key={`text-${at}`}
          text={value.slice(at, a)}
          sourceText={text}
          offset={start + at}
          instance={instance}
        />,
        <ExternalLink key={link.start} href={link.url}>
          {value.slice(a, b)}
        </ExternalLink>,
      );
      at = b;
    }
    pieces.push(
      <EmojiText
        key={`text-${at}`}
        text={value.slice(at)}
        sourceText={text}
        offset={start + at}
        instance={instance}
      />,
    );
    return pieces;
  };
  for (const mention of mentions(text)) {
    if (
      links.some(
        (link) => mention.start >= link.start && mention.start < link.end,
      )
    )
      continue;
    const user = instance.snapshot.users.find(
      (u) => u.username.toLowerCase() === mention.username,
    );
    if (!user) continue;
    output.push(...plain(text.slice(offset, mention.start), offset));
    output.push(
      <button
        type="button"
        onClick={() => openProfile(instance, user.id)}
        key={mention.start}
        className={`mention ${user.id === instance.account.login.user.id ? "mention-self" : ""}`}
        title={user.display_name || user.username}
      >
        {text.slice(mention.start, mention.end)}
      </button>,
    );
    offset = mention.end;
  }
  output.push(...plain(text.slice(offset), offset));
  return <>{output}</>;
}
