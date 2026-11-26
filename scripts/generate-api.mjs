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
const document = JSON.parse(await fs.readFile(source, "utf8"));
const schema = await generateApi(document);
const definitions = document["x-haunt-role-permissions"];
const permissions =
  "// Generated from the server role permission catalog. Do not edit.\n" +
  `export const legacyChannelMask = ${document["x-haunt-legacy-override-mask"]};\n` +
  "export const Permission = " +
  JSON.stringify(
    Object.fromEntries(definitions.map((p) => [p.key, p.bit])),
    null,
    2,
  ) +
  " as const;\n" +
  "export const rolePermissions: ReadonlyArray<{ bit: number; label: string; kinds: readonly string[] }> = " +
  JSON.stringify(
    definitions.map(({ bit, label, kinds = [] }) => ({ bit, label, kinds })),
    null,
    2,
  ) +
  ";\n";
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
  [
    new URL("../packages/core/src/generated/permissions.ts", import.meta.url),
    permissions,
  ],
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
