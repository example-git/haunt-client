import fs from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const methods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const pointer = (value) => value.replaceAll("~", "~0").replaceAll("/", "~1");

/** Emit the existing openapi-fetch contract without legacy compiler APIs. */
export default async function generateApi(source) {
  const document =
    source instanceof URL
      ? JSON.parse(await fs.readFile(source, "utf8"))
      : source;
  if (!/^3\.1\./.test(document?.openapi ?? ""))
    throw Error("API generation requires an OpenAPI 3.1 document.");
  const resolve = (value) => {
    const seen = new Set();
    while (value?.$ref) {
      const ref = value.$ref;
      if (!ref.startsWith("#/") || seen.has(ref))
        throw Error(`Unsupported or circular OpenAPI reference: ${ref}`);
      seen.add(ref);
      value = ref
        .slice(2)
        .split("/")
        .reduce(
          (part, key) =>
            part?.[key.replaceAll("~1", "/").replaceAll("~0", "~")],
          document,
        );
      if (value === undefined) throw Error(`Missing OpenAPI reference: ${ref}`);
    }
    return value;
  };
  const schema = (value) => {
    if (Array.isArray(value)) return value.map(schema);
    if (!value || typeof value !== "object") return value;
    if (value.allOf) {
      // A constraint-only property inherits its type from the other conjunct.
      // For example credentials.password:string intersected with minLength:8
      // remains a string, rather than becoming an object/string intersection.
      const types = {};
      for (const raw of value.allOf) {
        const member = resolve(raw);
        for (const [name, property] of Object.entries(
          member.properties ?? {},
        )) {
          const type = resolve(property).type;
          if (type !== undefined) {
            if (
              types[name] !== undefined &&
              JSON.stringify(types[name]) !== JSON.stringify(type)
            )
              throw Error(`Conflicting allOf property types: ${name}`);
            types[name] = type;
          }
        }
      }
      value = {
        ...value,
        allOf: value.allOf.map((member) =>
          member.properties
            ? {
                ...member,
                properties: Object.fromEntries(
                  Object.entries(member.properties).map(([name, property]) => [
                    name,
                    property &&
                    typeof property === "object" &&
                    property.type === undefined &&
                    !property.$ref &&
                    types[name] !== undefined
                      ? { ...property, type: types[name] }
                      : property,
                  ]),
                ),
              }
            : member,
        ),
      };
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (key === "$ref") {
          if (!item.startsWith("#/components/schemas/"))
            throw Error(`Unsupported schema reference: ${item}`);
          return [key, item.replace("#/components/schemas/", "#/definitions/")];
        }
        return [key, schema(item)];
      }),
    );
  };
  const media = (content) =>
    object(
      Object.fromEntries(
        Object.entries(content ?? {}).map(([type, value]) => {
          if (value.schema === undefined)
            throw Error(`Missing schema for content type ${type}`);
          return [type, schema(value.schema)];
        }),
      ),
    );
  const parameters = (rows) => {
    const groups = {};
    const required = [];
    for (const location of ["query", "header", "path", "cookie"]) {
      const matching = rows.map(resolve).filter((p) => p.in === location);
      if (!matching.length) {
        groups[location] = false;
        continue;
      }
      const properties = {};
      const names = [];
      for (const p of matching) {
        if (!p.name || p.schema === undefined)
          throw Error("Parameters need a name and schema.");
        properties[p.name] = schema(p.schema);
        if (p.required) names.push(p.name);
      }
      groups[location] = object(properties, names);
      if (names.length) required.push(location);
    }
    for (const row of rows.map(resolve))
      if (!["query", "header", "path", "cookie"].includes(row.in))
        throw Error(`Unsupported parameter location: ${row.in}`);
    return object(groups, required);
  };
  const definitions = Object.fromEntries(
    Object.entries(document.components?.schemas ?? {}).map(([name, value]) => [
      name,
      schema(value),
    ]),
  );
  const operations = {};
  const paths = {};
  for (const [path, raw] of Object.entries(document.paths ?? {})) {
    const item = resolve(raw);
    const shared = item.parameters ?? [];
    const pathProperties = { parameters: parameters(shared) };
    const requiredMethods = ["parameters"];
    for (const method of methods) {
      if (!item[method]) {
        pathProperties[method] = false;
        continue;
      }
      const operation = resolve(item[method]);
      const id = operation.operationId;
      if (!id || Object.hasOwn(operations, id))
        throw Error(
          `Missing or duplicate operationId at ${method.toUpperCase()} ${path}`,
        );
      const params = new Map(
        [...shared, ...(operation.parameters ?? [])]
          .map(resolve)
          .map((p) => [`${p.in}:${p.name}`, p]),
      );
      const properties = { parameters: parameters([...params.values()]) };
      const required = ["parameters", "responses"];
      if (operation.requestBody) {
        const body = resolve(operation.requestBody);
        properties.requestBody = object({ content: media(body.content) });
        if (body.required) required.push("requestBody");
      } else properties.requestBody = false;
      const responses = {};
      for (const [status, rawResponse] of Object.entries(
        operation.responses ?? {},
      )) {
        if (!/^(?:[1-5][0-9]{2}|[1-5]XX|default)$/.test(status))
          throw Error(`Invalid response status: ${status}`);
        const response = resolve(rawResponse);
        const headers = {};
        const requiredHeaders = [];
        for (const [name, rawHeader] of Object.entries(
          response.headers ?? {},
        )) {
          const header = resolve(rawHeader);
          if (header.schema === undefined)
            throw Error(`Missing response header schema: ${name}`);
          headers[name] = schema(header.schema);
          if (header.required) requiredHeaders.push(name);
        }
        const headerSchema = object(headers, requiredHeaders);
        headerSchema.additionalProperties = {};
        responses[status] = object(
          {
            headers: headerSchema,
            content: response.content ? media(response.content) : false,
          },
          response.content ? ["headers", "content"] : ["headers"],
        );
      }
      if (!Object.keys(responses).length)
        throw Error(`Operation ${id} needs responses.`);
      properties.responses = object(responses);
      const name = `Operation_${id}`;
      if (Object.hasOwn(definitions, name))
        throw Error(`Operation schema name collision: ${name}`);
      definitions[name] = object(properties, required);
      const ref = { $ref: `#/definitions/${pointer(name)}` };
      operations[id] = ref;
      pathProperties[method] = ref;
      requiredMethods.push(method);
    }
    paths[path] = object(pathProperties, requiredMethods);
  }
  const components = {};
  for (const [name] of Object.entries(document.components?.schemas ?? {}))
    components[name] = { $ref: `#/definitions/${pointer(name)}` };
  const contract = object({
    paths: object(paths),
    components: object({ schemas: object(components) }),
    operations: object(operations),
  });
  contract.definitions = definitions;
  const text = await compile(contract, "APIContract", {
    additionalProperties: false,
    bannerComment: "// Generated from static/api/openapi.json. Do not edit.",
    enableConstEnums: false,
    maxItems: -1,
    style: { tabWidth: 2 },
  });
  // JSON Schema property keys are strings; OpenAPI response codes are numeric.
  return (
    text +
    `
type HTTPMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";
type HTTPOperation<T> = T extends { responses: infer R }
  ? Omit<T, "responses"> & { responses: { [K in keyof R as K extends \`\${infer Status extends number}\` ? Status : K]: R[K] } }
  : T;
type GeneratedComponents = APIContract["components"];
export interface components extends GeneratedComponents { responses: never; parameters: never; requestBodies: never; headers: never; pathItems: never }
export type webhooks = Record<string, never>;
export type $defs = Record<string, never>;
type GeneratedOperations = { [ID in keyof APIContract["operations"]]: HTTPOperation<APIContract["operations"][ID]> };
export interface operations extends GeneratedOperations {}
type GeneratedPaths = { [Path in keyof APIContract["paths"]]: { [Method in keyof APIContract["paths"][Path]]: Method extends HTTPMethod ? HTTPOperation<APIContract["paths"][Path][Method]> : APIContract["paths"][Path][Method] } };
export interface paths extends GeneratedPaths {}
`
  );
}
