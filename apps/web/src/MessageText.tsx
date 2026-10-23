import {
  createElement,
  memo,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { InstanceClient } from "@haunt/core";
import {
  emojiOnlyMessage,
  parseMessageMarkdown,
  type MarkdownNode,
} from "@haunt/browser/markdown";
import { MentionText } from "./Mentions";
import { ExternalLink } from "./RichContent";
import { StandardEmojiText } from "./StandardEmoji";

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className={`message-spoiler ${revealed ? "revealed" : ""}`}>
      <span aria-hidden={!revealed} inert={!revealed}>
        {children}
      </span>
      {!revealed && (
        <button
          type="button"
          aria-label="Reveal spoiler"
          onClick={() => setRevealed(true)}
        />
      )}
    </span>
  );
}
const tags = new Set([
  "p",
  "em",
  "strong",
  "u",
  "s",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
function renderNodes(
  nodes: MarkdownNode[],
  instance: InstanceClient,
  inLink = false,
): ReactNode {
  return nodes.map((node, key) => {
    if (node.type === "text" || node.type === "text_special")
      return (
        <span key={key}>
          {inLink ? (
            <StandardEmojiText text={node.text} />
          ) : (
            <MentionText text={node.text} instance={instance} />
          )}
        </span>
      );
    if (node.type === "code_inline") return <code key={key}>{node.text}</code>;
    if (node.type === "fence" || node.type === "code_block")
      return (
        <pre key={key} data-language={node.language || undefined}>
          <code>{node.text}</code>
        </pre>
      );
    if (node.type === "softbreak" || node.type === "hardbreak")
      return <br key={key} />;
    if (node.type === "hr") return <hr key={key} />;
    if (node.type === "link_open")
      return (
        <ExternalLink key={key} href={node.href ?? ""}>
          {renderNodes(node.children, instance, true)}
        </ExternalLink>
      );
    const children = renderNodes(node.children, instance, inLink);
    if (node.type === "spoiler_open")
      return <Spoiler key={key}>{children}</Spoiler>;
    if (tags.has(node.tag))
      return createElement(
        node.tag,
        { key, ...(node.tag === "ol" ? { start: node.start } : {}) },
        children,
      );
    return (
      <span key={key}>
        {node.text}
        {children}
      </span>
    );
  });
}
const MessageText = memo(function MessageText({
  text,
  instance,
}: {
  text: string;
  instance: InstanceClient;
}) {
  const tree = useMemo(() => parseMessageMarkdown(text), [text]);
  const emojiNames = useSyncExternalStore(instance.subscribe, () =>
    instance.snapshot.emojis.map((emoji) => emoji.name).join("\0"),
  );
  const names = useMemo(
    () => new Set(emojiNames ? emojiNames.split("\0") : []),
    [emojiNames],
  );
  const large = useMemo(() => emojiOnlyMessage(text, names), [text, names]);
  return (
    <div className={`message-body markdown ${large ? "emoji-only" : ""}`}>
      {renderNodes(tree, instance)}
    </div>
  );
});
export default MessageText;
