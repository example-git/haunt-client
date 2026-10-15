import fs from "node:fs/promises";

// Only compact display/search data reaches the lazy picker chunk.
const groups = JSON.parse(
  await fs.readFile(
    new URL(
      "../node_modules/unicode-emoji-json/data-by-group.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const keywords = JSON.parse(
  await fs.readFile(
    new URL("../node_modules/emojilib/dist/emoji-en-US.json", import.meta.url),
    "utf8",
  ),
);
const data = groups.map((group) => [
  group.name,
  group.emojis.map(({ emoji, slug }) => {
    const terms = new Set(
      `${slug} ${(keywords[emoji] ?? []).join(" ")}`
        .toLowerCase()
        .replaceAll("_", " ")
        .split(/\s+/),
    );
    return [emoji, slug, [...terms].join(" ")];
  }),
]);
const output = JSON.stringify(data) + "\n";
const path = new URL("../apps/web/src/emoji-data.json", import.meta.url);
if (process.argv.includes("--check")) {
  if ((await fs.readFile(path, "utf8")) !== output)
    throw Error("Emoji data is stale. Run npm run generate:emojis.");
} else await fs.writeFile(path, output);
