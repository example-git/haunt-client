import { validatePlain, validateImage, uuid } from "./validation";
import type { Message } from "@haunt/core";
import type { IndexedDBStore } from "../storage";
import {
  cryptoDB,
  cryptoLock,
  type CryptoAccount,
  type PlainPayload,
  type SecretImage,
} from "./storage";
import { engine } from "./engine";
interface Recovery {
  version: 1;
  accounts: { scope: string; state: CryptoAccount }[];
  decoded: { key: [string, string]; value: PlainPayload }[];
  images: { key: [string, string]; value: SecretImage }[];
  delivered: { key: [string, string]; value: string }[];
  messages: { scope: string; items: Message[] }[];
}
const maximum = 16 * 1024 * 1024;
const validScope = (scope: unknown): scope is string => {
  if (typeof scope !== "string" || scope.length > 512) return false;
  try {
    const v = JSON.parse(scope);
    return (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === "string" &&
      v[0].length <= 128 &&
      typeof v[1] === "string" &&
      /^[a-f0-9-]{36}$/i.test(v[1])
    );
  } catch {
    return false;
  }
};
export async function exportDMRecovery(
  store: IndexedDBStore,
  allowedScopes?: ReadonlySet<string>,
): Promise<string | undefined> {
  const db = await cryptoDB(),
    scopes = await db.getAllKeys("accounts"),
    out: Recovery = {
      version: 1,
      accounts: [],
      decoded: [],
      images: [],
      delivered: [],
      messages: [],
    };
  let measured = 0;
  const accountSize = (v: unknown) => {
    measured += JSON.stringify(v).length;
    if (measured > maximum)
      throw Error(
        "DM recovery data exceeds 16 MiB. Export large conversations separately.",
      );
  };
  for (const scope of scopes)
    if (!allowedScopes || allowedScopes.has(scope))
      await cryptoLock(scope, async () => {
        const a = await db.get("accounts", scope);
        if (!a) return;
        accountSize(a);
        out.accounts.push({
          scope,
          state: { ...a, pending: undefined, published: [] },
        });
        for (const state of await db.getAll(
          "archives",
          IDBKeyRange.bound([scope, ""], [scope, "\uffff"]),
        )) {
          accountSize(state);
          out.accounts.push({ scope, state });
        }
        for (const name of ["decoded", "images", "delivered"] as const) {
          let cursor = await db
            .transaction(name)
            .store.openCursor(
              IDBKeyRange.bound([scope, ""], [scope, "\uffff"]),
            );
          while (cursor) {
            accountSize(cursor.value);
            (out[name] as { key: [string, string]; value: unknown }[]).push({
              key: cursor.key,
              value: cursor.value,
            });
            cursor = await cursor.continue();
          }
        }
        const all: Message[] = [];
        const conversations = new Set([
          ...Object.keys(a.groups),
          ...out.accounts
            .filter((v) => v.scope === scope)
            .flatMap((v) => Object.keys(v.state.groups)),
        ]);
        for (const conversation of conversations) {
          let before: number | undefined;
          for (;;) {
            const page = await store.messages(scope, conversation, {
              before,
              limit: 1000,
            });
            for (const item of page) accountSize(item);
            all.push(...page);
            if (page.length < 1000) break;
            before = page[0].seq;
          }
        }
        out.messages.push({ scope, items: all });
      });
  if (!out.accounts.length) return undefined;
  const encoded = JSON.stringify(out);
  if (encoded.length > maximum)
    throw Error(
      "DM recovery data exceeds 16 MiB. Export large conversations separately before creating this client backup.",
    );
  return encoded;
}
export async function validateDMRecovery(raw: string): Promise<Recovery> {
  if (raw.length > maximum) throw Error("DM recovery data is too large");
  const value = JSON.parse(raw) as Recovery;
  if (
    value?.version !== 1 ||
    ![
      value.accounts,
      value.decoded,
      value.images,
      value.delivered,
      value.messages,
    ].every(Array.isArray) ||
    value.accounts.length > 128 ||
    value.decoded.length > 100000 ||
    value.images.length > 100000 ||
    value.delivered.length > 100000 ||
    value.messages.length > 32
  )
    throw Error("Invalid DM recovery data");
  for (const { scope, state } of value.accounts) {
    if (
      !validScope(scope) ||
      !state ||
      state.version !== 1 ||
      !/^[-a-f0-9]{36}$/i.test(state.device) ||
      state.engine?.identity !==
        JSON.stringify([...JSON.parse(scope), state.device]) ||
      !state.groups ||
      typeof state.groups !== "object" ||
      !state.pins ||
      typeof state.pins !== "object" ||
      Object.keys(state.groups).length > 4096
    )
      throw Error("Invalid DM recovery identity");
    for (const [id, g] of Object.entries(state.groups)) {
      if (
        !/^[-a-f0-9]{36}$/i.test(id) ||
        !Number.isSafeInteger(g.revision) ||
        g.revision < 1 ||
        !Array.isArray(g.members) ||
        g.members.length > 256 ||
        g.members.length < 2 ||
        !g.members.every(uuid) ||
        new Set(g.members).size !== g.members.length ||
        g.revision > 4096
      )
        throw Error("Invalid DM recovery group");
    }
    for (const [id, key] of Object.entries(state.pins)) {
      if (
        !uuid(id) ||
        typeof key !== "string" ||
        !/^[A-Za-z0-9+/]{43}=$/.test(key)
      )
        throw Error("Invalid pinned DM identity");
    }
    await engine({ op: "sign", state: state.engine, bytes: [1, 2, 3] });
  }
  for (const item of [...value.decoded, ...value.images, ...value.delivered]) {
    if (
      !item ||
      !Array.isArray(item.key) ||
      item.key.length !== 2 ||
      !validScope(item.key[0]) ||
      typeof item.key[1] !== "string" ||
      item.key[1].length > 128
    )
      throw Error("Invalid DM recovery entry");
  }
  const scopes = new Set(value.accounts.map((a) => a.scope));
  for (const item of value.decoded) {
    validatePlain(item.value);
    if (
      !scopes.has(item.key[0]) ||
      !/^[a-f0-9]{64}$/.test(item.key[1]) ||
      item.value.instance !== JSON.parse(item.key[0])[0]
    )
      throw Error("Invalid recovered ciphertext binding");
  }
  for (const item of value.images) {
    validateImage(item.value);
    if (!scopes.has(item.key[0]) || item.value.id !== item.key[1])
      throw Error("Invalid recovered image binding");
  }
  for (const item of value.delivered) {
    if (
      !scopes.has(item.key[0]) ||
      !uuid(item.value) ||
      item.key[1].split(":").length !== 2 ||
      !item.key[1].split(":").every(uuid)
    )
      throw Error("Invalid recovered message binding");
  }
  for (const batch of value.messages) {
    if (
      !validScope(batch.scope) ||
      !Array.isArray(batch.items) ||
      batch.items.length > 100000
    )
      throw Error("Invalid recovered messages");
    for (const m of batch.items) {
      if (
        !m ||
        !uuid(m.author_id) ||
        !uuid(m.request_id) ||
        typeof m.deleted !== "boolean" ||
        ![undefined, "legacy", "encrypted", "unavailable"].includes(
          m.security,
        ) ||
        (m.edited_at !== undefined &&
          m.edited_at !== null &&
          !Number.isFinite(Date.parse(m.edited_at))) ||
        !/^[-a-f0-9]{36}$/i.test(m.id) ||
        !/^[-a-f0-9]{36}$/i.test(m.conversation_id) ||
        typeof m.body !== "string" ||
        m.body.length > 65536 ||
        !Number.isSafeInteger(m.seq) ||
        m.seq < 1 ||
        typeof m.created_at !== "string" ||
        !Number.isFinite(Date.parse(m.created_at)) ||
        !Array.isArray(m.attachment_ids) ||
        m.attachment_ids.length > 8 ||
        !m.attachment_ids.every(uuid)
      )
        throw Error("Invalid recovered message");
    }
  }
  return value;
}
export async function importDMRecovery(raw: string, store: IndexedDBStore) {
  const value = await validateDMRecovery(raw),
    db = await cryptoDB();
  for (const { scope, state } of value.accounts)
    await cryptoLock(scope, async () => {
      // Recovery state is read-only: never duplicate an active sending ratchet.
      const archived: CryptoAccount = {
        ...state,
        archive: state.device,
        pending: undefined,
        published: [],
      };
      await db.put("archives", archived, [scope, state.device]);
    });
  const tx = db.transaction(["decoded", "images", "delivered"], "readwrite", {
    durability: "strict",
  });
  for (const item of value.decoded)
    if (!(await tx.objectStore("decoded").get(item.key)))
      await tx.objectStore("decoded").put(item.value, item.key);
  for (const item of value.images)
    if (!(await tx.objectStore("images").get(item.key)))
      await tx.objectStore("images").put(item.value, item.key);
  for (const item of value.delivered)
    if (!(await tx.objectStore("delivered").get(item.key)))
      await tx.objectStore("delivered").put(item.value, item.key);
  await tx.done;
  for (const batch of value.messages)
    await store.merge(batch.scope, batch.items);
}
