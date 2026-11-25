import {
  createElement,
  lazy,
  Suspense,
  useEffect,
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

import { Check, Copy, CircleAlert } from "lucide-react";
import { copyText } from "./clipboard";

const HighlightedCode = lazy(() => import("./HighlightedCode"));

function CodeBlock({ text, language }: { text: string; language?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  const label =
    status === "copied"
      ? "Copied"
      : status === "failed"
        ? "Copy failed"
        : "Copy code";
  const Icon =
    status === "copied" ? Check : status === "failed" ? CircleAlert : Copy;
  return (
    <div className="message-code-block">
      <pre data-language={language || undefined}>
        <code>
          <Suspense fallback={text}>
            <HighlightedCode text={text} language={language} />
          </Suspense>
        </code>
      </pre>
      <button
        className="message-code-copy"
        type="button"
        title={label}
        aria-label={label}
        onClick={async (event) => {
          event.stopPropagation();
          try {
            await copyText(text);
            setStatus("copied");
          } catch {
            setStatus("failed");
          }
        }}
      >
        <Icon size={15} aria-hidden="true" />
        <span className="sr-only" role="status">
          {status === "idle" ? "" : label}
        </span>
      </button>
    </div>
  );
}

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
      return <CodeBlock key={key} text={node.text} language={node.language} />;
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
  variant = "message",
}: {
  text: string;
  instance: InstanceClient;
  variant?: "message" | "embed";
}) {
  const tree = useMemo(() => parseMessageMarkdown(text), [text]);
  const emojiNames = useSyncExternalStore(instance.subscribe, () =>
    instance.snapshot.emojis.map((emoji) => emoji.name).join("\0"),
  );
  const names = useMemo(
    () => new Set(emojiNames ? emojiNames.split("\0") : []),
    [emojiNames],
  );
  const large = useMemo(
    () => variant === "message" && emojiOnlyMessage(text, names),
    [variant, text, names],
  );
  return (
    <div
      className={
        variant === "embed"
          ? "markdown"
          : `message-body markdown ${large ? "emoji-only" : ""}`
      }
    >
      {renderNodes(tree, instance)}
    </div>
  );
});
export default MessageText;
