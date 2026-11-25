import { memo, useMemo, type ReactNode } from "react";
import { common, createLowlight } from "lowlight";
import type { RootContent } from "hast";

const syntax = createLowlight(common);
const subset = ["javascript", "python", "json", "bash", "xml", "css", "sql"];

function renderTokens(nodes: RootContent[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.value;
    if (node.type !== "element") return null;
    const classes = node.properties.className;
    return (
      <span
        key={index}
        className={Array.isArray(classes) ? classes.join(" ") : undefined}
      >
        {renderTokens(node.children)}
      </span>
    );
  });
}

export default memo(function HighlightedCode({
  text,
  language,
}: {
  text: string;
  language?: string;
}) {
  return useMemo(() => {
    if (text.length > 32768) return text;
    const name = language?.toLowerCase();
    if (name && !syntax.registered(name)) return text;
    if (!name && text.length > 4096) return text;
    const tree = name
      ? syntax.highlight(name, text)
      : syntax.highlightAuto(text, { subset });
    return renderTokens(tree.children);
  }, [text, language]);
});
