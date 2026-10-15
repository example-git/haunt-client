import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error Build-time generator intentionally uses JavaScript.
import generateApi from "../scripts/api-generator/index.mjs";

const fixture = () => ({
  openapi: "3.1.0",
  components: {
    schemas: {
      Credentials: {
        type: "object",
        properties: { password: { type: "string" } },
        required: ["password"],
        additionalProperties: false,
      },
      Item: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["pending", "done"] },
          tags: { type: ["array", "null"], items: { type: "string" } },
        },
        required: ["id", "status", "tags"],
        additionalProperties: false,
      },
    },
  },
  paths: {
    "/items/{id}": {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      get: {
        operationId: "getItem",
        parameters: [
          { name: "expand", in: "query", schema: { type: "boolean" } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Item" },
              },
            },
          },
          "204": { description: "No content" },
        },
      },
      post: {
        operationId: "register",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                allOf: [
                  { $ref: "#/components/schemas/Credentials" },
                  { properties: { password: { minLength: 8 } } },
                ],
              },
            },
          },
        },
        responses: { "204": { description: "Created" } },
      },
    },
  },
});

it("generates usable HTTP contracts with current TypeScript, required paths, nullable models and allOf constraints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "haunt-api-contract-"));
  try {
    const contract = await generateApi(fixture());
    await writeFile(join(directory, "contract.ts"), contract);
    await writeFile(
      join(directory, "check.ts"),
      `
import type { paths, components, operations } from './contract';
type Item = components['schemas']['Item'];
const item: Item = { id: 'one', status: 'done', tags: null };
const success: operations['getItem']['responses'][200]['content']['application/json'] = item;
const request: operations['register']['requestBody']['content']['application/json'] = { password: 'password' };
const id: paths['/items/{id}']['get']['parameters']['path'] = { id: 'one' };
// @ts-expect-error Required path parameters cannot be omitted.
const missing: paths['/items/{id}']['get']['parameters']['path'] = {};
// @ts-expect-error Enums remain closed.
const invalid: Item = { id: 'one', status: 'other', tags: [] };
// @ts-expect-error A no-content response has no JSON payload.
type Empty = operations['getItem']['responses'][204]['content']['application/json'];
declare module './contract' { interface paths { '/extension': { get: operations['getItem'] } } }
const extension: paths['/extension']['get']['parameters']['path'] = id;
void [success, request, extension];
`,
    );
    try {
      execFileSync(
        process.execPath,
        [
          join(process.cwd(), "node_modules/typescript/bin/tsc"),
          "--ignoreConfig",
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--target",
          "ES2022",
          join(directory, "check.ts"),
        ],
        { stdio: "pipe" },
      );
    } catch (error) {
      throw Error(String((error as { stdout?: Buffer }).stdout ?? error));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("fails visibly for missing operation IDs and unresolved references", async () => {
  const missing = fixture();
  // @ts-expect-error Deliberately invalid document.
  delete missing.paths["/items/{id}"].get.operationId;
  await expect(generateApi(missing)).rejects.toThrow("operationId");
  const unresolved = fixture();
  unresolved.paths["/items/{id}"].get.responses["200"].content[
    "application/json"
  ].schema.$ref = "#/components/schemas/Missing";
  await expect(generateApi(unresolved)).rejects.toThrow();
});
