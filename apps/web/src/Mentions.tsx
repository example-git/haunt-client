import { openProfile } from "./Profile";
import { UserName } from "./UserName";
import { EmojiText } from "./EmojiText";
import { ExternalLink } from "./RichContent";
import { hauntLink } from "@haunt/browser/deep-links";
import { messageLinks, mentions, type InstanceClient } from "@haunt/core";
import { useSyncExternalStore, type ReactNode } from "react";
export function MentionText({
  text,
  instance,
}: {
  text: string;
  instance: InstanceClient;
}) {
  useSyncExternalStore(instance.subscribe, () =>
    JSON.stringify(
      instance.snapshot.users.map((user) => [
        user.id,
        user.username,
        user.display_name,
      ]),
    ),
  );
  const output: ReactNode[] = [];
  let offset = 0;
  const links = messageLinks(text);
  for (const match of text.matchAll(/\bhaunt:\/\/open\/?\?[^\s<>]+/gi)) {
    const raw = match[0].replace(/[),.;]+$/, "");
    const url = hauntLink(raw);
    if (
      url &&
      !links.some((link) => match.index >= link.start && match.index < link.end)
    )
      links.push({
        url,
        preview: false,
        start: match.index,
        end: match.index + raw.length,
      });
  }
  links.sort((a, b) => a.start - b.start);
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
        <UserName user={user} instance={instance}>
          {text.slice(mention.start, mention.end)}
        </UserName>
      </button>,
    );
    offset = mention.end;
  }
  output.push(...plain(text.slice(offset), offset));
  return <>{output}</>;
}
