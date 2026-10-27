import { describe, expect, it } from "vitest";
import {
  emojiOnlyMessage,
  parseMessageMarkdown,
  type MarkdownNode,
} from "../packages/browser/src/markdown";
import spriteIndex from "../apps/web/src/emoji-sprites/index.json";
import catalog from "../apps/web/src/emoji-data.json";

const flatten = (nodes: MarkdownNode[]): MarkdownNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
describe("chat markdown and emoji sizing", () => {
  it("renders Haunt links while rejecting other native protocols", () => {
    const url = "haunt://open?server=https%3A%2F%2Fcommunity.example";
    const links = flatten(
      parseMessageMarkdown(
        `[message](${url}) [file](file:///etc/passwd) [wrong](haunt://settings?server=x)`,
      ),
    ).filter((node) => node.type === "link_open");
    expect(links.map((node) => node.href)).toEqual([url]);
  });
  const names = new Set(["party_wave"]);
  it("enlarges only whole messages made of recognized emoji and whitespace", () => {
    for (const text of [
      "😀",
      "👩🏽‍💻 🇨🇦 1️⃣",
      ":party_wave:",
      " :PARTY_WAVE: \n ❤️ 👨‍👩‍👧‍👦 ",
    ])
      expect(emojiOnlyMessage(text, names), text).toBe(true);
    for (const text of [
      "",
      " \n ",
      "123",
      ":missing:",
      ":party_wave: hello",
      "😀!",
      "**😀**",
      "`:party_wave:`",
      "😀\u200b",
    ])
      expect(emojiOnlyMessage(text, names), text).toBe(false);
  });
  it("formats nested emphasis, Discord underline, strike, lists, quotes and literal code", () => {
    const nodes = flatten(
      parseMessageMarkdown(
        "**bold *italic*** __underline__ ~~gone~~\n\n> quote\n\n- one\n- two\n\n`@owner :party_wave:`\n\n```js\n<script>alert(1)</script>\n```",
      ),
    );
    for (const tag of ["strong", "em", "u", "s", "blockquote", "ul", "li"])
      expect(
        nodes.some((node) => node.tag === tag),
        tag,
      ).toBe(true);
    expect(nodes.find((node) => node.type === "code_inline")?.text).toBe(
      "@owner :party_wave:",
    );
    expect(nodes.find((node) => node.type === "fence")).toMatchObject({
      text: "<script>alert(1)</script>\n",
      language: "js",
    });
    const spoiler = flatten(
      parseMessageMarkdown("Before ||**hidden** @owner|| after"),
    );
    expect(
      spoiler
        .find((node) => node.type === "spoiler_open")
        ?.children.some((node) => node.tag === "strong"),
    ).toBe(true);
  });
  it("treats HTML and image syntax as text and rejects executable/credentialed links", () => {
    const nodes = flatten(
      parseMessageMarkdown(
        '<img src=x onerror="alert(1)"> [bad](javascript:alert(1)) [bad](data:text/html,test) [bad](https://user:pass@example.com) [safe](https://example.com) ![remote](https://example.com/tracker.png)',
      ),
    );
    expect(
      nodes.some(
        (node) => node.type.startsWith("html") || node.type === "image",
      ),
    ).toBe(false);
    expect(
      nodes
        .filter((node) => node.type === "link_open")
        .map((node) => node.href),
    ).toEqual(["https://example.com", "https://example.com/tracker.png"]);
    expect(
      flatten(parseMessageMarkdown("[".repeat(16000))).length,
    ).toBeLessThan(5);
  });
  it("has bundled artwork for every picker emoji and complex pasted sequences", () => {
    const keys = new Set(Object.keys(spriteIndex));
    const supported = (text: string) => {
      const key = [...text]
        .map((char) => char.codePointAt(0)!.toString(16))
        .join("-");
      return keys.has(key) || keys.has(key.replaceAll("-fe0f", ""));
    };
    for (const [, entries] of catalog as [string, string[][]][])
      for (const [text] of entries) expect(supported(text), text).toBe(true);
    for (const text of ["👩🏽‍💻", "👨‍👩‍👧‍👦", "🇨🇦", "1️⃣", "❤️"])
      expect(supported(text), text).toBe(true);
  });
});
