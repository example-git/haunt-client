import fs from "node:fs/promises";
const names = [
  "unicode-emoji-json",
  "emojilib",
  "markdown-it",
  "emoji-regex",
  "entities",
  "linkify-it",
  "mdurl",
  "punycode.js",
  "uc.micro",
  "react",
  "react-dom",
  "scheduler",
  "lucide-react",
  "idb",
  "fflate",
  "hls.js",
  "openapi-fetch",
  "@serenity-kit/opaque",
];
let notices = "Third-party notices for the bundled Haunt browser UI.\n\n";
for (const name of names) {
  const pkg = JSON.parse(
    await fs.readFile(`node_modules/${name}/package.json`, "utf8"),
  );
  const license = ["emoji-regex", "punycode.js"].includes(name)
    ? "LICENSE-MIT.txt"
    : name === "uc.micro"
      ? "LICENSE.txt"
      : "LICENSE";
  notices += `${name} ${pkg.version}\n${"=".repeat(72)}\n${await fs.readFile(`node_modules/${name}/${license}`, "utf8")}\n\n`;
}
notices += `Twemoji 17.0.3, Discord fork, commit 187e1b77ee80532eb584bcf62a2266942fa39cf9\nhttps://github.com/discord/twemoji\nCopyright Twitter, Inc. and other contributors. Graphics CC-BY-4.0. Original PNGs packed into lossless WebP sprite sheets.\n${await fs.readFile("vendor/twemoji/LICENSE-GRAPHICS", "utf8")}\n\n`;
notices += await fs.readFile(
  "native/dm-crypto/THIRD-PARTY-NOTICES.txt",
  "utf8",
);
await fs.mkdir(process.argv[2] ?? "dist", { recursive: true });
await fs.writeFile(
  `${process.argv[2] ?? "dist"}/THIRD-PARTY-NOTICES.txt`,
  notices,
);
