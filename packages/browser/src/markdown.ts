import MarkdownIt from "markdown-it";
import emojiRegex from "emoji-regex";
import { safeExternalURL } from "@haunt/core";

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: false,
  maxNesting: 20,
}).disable(["image", "table"]);
markdown.validateLink = (url) => !!safeExternalURL(url);

// Stop plain-text runs at our added delimiter, leaving escaped pipes and code
// to the parser's existing rules. Bare URLs use the client's strict linkifier.
const textRule = markdown.inline.ruler.getRules("")[0];
markdown.inline.ruler.at("text", (state, silent) => {
  const max = state.posMax,
    next = state.src.indexOf("||", state.pos);
  if (next >= state.pos && next < max) state.posMax = next;
  const matched = textRule(state, silent);
  state.posMax = max;
  return matched;
});

// Use the parser's nested delimiter rules for ||spoilers|| as well as emphasis.
markdown.inline.ruler.before("emphasis", "spoiler", (state, silent) => {
  if (state.src.slice(state.pos, state.pos + 2) !== "||") return false;
  const start = state.pos,
    oldMax = state.posMax;
  let end = state.src.indexOf("||", start + 2);
  while (end >= 0 && state.src[end - 1] === "\\")
    end = state.src.indexOf("||", end + 2);
  if (
    end <= start + 2 ||
    end >= oldMax ||
    state.level >= state.md.options.maxNesting
  )
    return false;
  if (silent) return false;
  state.push("spoiler_open", "span", 1);
  state.pos = start + 2;
  state.posMax = end;
  state.md.inline.tokenize(state);
  state.push("spoiler_close", "span", -1);
  state.pos = end + 2;
  state.posMax = oldMax;
  return true;
});

export interface MarkdownNode {
  type: string;
  tag: string;
  text: string;
  href?: string;
  start?: number;
  language?: string;
  children: MarkdownNode[];
}

/** Build a small allowlisted React-friendly tree; never render parser HTML. */
export function parseMessageMarkdown(text: string): MarkdownNode[] {
  const root: MarkdownNode[] = [],
    stack = [root];
  const visit = (tokens: ReturnType<typeof markdown.parse>) => {
    for (const token of tokens) {
      if (token.nesting === -1) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (token.type === "inline") {
        visit(token.children ?? []);
        continue;
      }
      const node: MarkdownNode = {
        type: token.type,
        tag: token.tag,
        text: token.content,
        children: [],
        href:
          token.attrGet("href") === null
            ? undefined
            : String(token.attrGet("href")),
        start:
          token.tag === "ol" ? Number(token.attrGet("start") ?? 1) : undefined,
        language:
          token.type === "fence"
            ? token.info.trim().split(/\s+/)[0].slice(0, 32)
            : undefined,
      };
      if (token.type === "strong_open" && token.markup === "__") node.tag = "u";
      stack[stack.length - 1].push(node);
      if (token.nesting === 1) stack.push(node.children);
    }
  };
  visit(markdown.parse(text, {}));
  return root;
}

export function emojiOnlyMessage(
  text: string,
  names: ReadonlySet<string>,
): boolean {
  if (!text.trim()) return false;
  const remainder = text.replace(
    /:([a-zA-Z0-9_]{2,32}):/g,
    (token, name: string) => (names.has(name.toLowerCase()) ? "" : token),
  );
  return !remainder.replace(emojiRegex(), "").trim();
}
