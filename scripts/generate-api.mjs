import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import generateApi from "./api-generator/index.mjs";
const source = new URL("../static/api/openapi.json", import.meta.url);
const target = new URL(
  "../packages/core/src/generated/api.ts",
  import.meta.url,
);
const protocolTarget = new URL(
  "../packages/core/src/generated/protocol.ts",
  import.meta.url,
);
const protocol = JSON.parse(
  await fs.readFile(
    new URL("../static/api/websocket.json", import.meta.url),
    "utf8",
  ),
);
const schema = await generateApi(source);
const wire =
  "// Generated from static/api/websocket.json. Do not edit.\nexport const protocol = " +
  JSON.stringify(
    { format: protocol.format, events: protocol.events, media: protocol.media },
    null,
    2,
  ) +
  " as const;\n";
for (const [url, content] of [
  [target, schema],
  [protocolTarget, wire],
]) {
  if (process.argv.includes("--check")) {
    if ((await fs.readFile(url, "utf8").catch(() => "")) !== content)
      throw Error(
        `Stale generated client contract: ${fileURLToPath(url)}. Run npm run generate.`,
      );
  } else {
    await fs.mkdir(new URL(".", url), { recursive: true });
    await fs.writeFile(url, content);
  }
}
