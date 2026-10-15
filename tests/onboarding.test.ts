import { describe, it, expect, vi } from "vitest";
import "fake-indexeddb/auto";
import {
  Client,
  MemoryStore,
  MemoryVault,
  PasswordChangeRequired,
  inviteLink,
  parseInviteLink,
  encryptBackup,
  decryptBackup,
  validateBackup,
  type ClientBackup,
  type SavedAccount,
  type Runtime,
  type KnownServerStore,
} from "@haunt/core";
import {
  IndexedDBKnownServers,
  DesktopKnownServers,
  type DesktopBridge,
} from "../packages/browser/src/storage";
const token = "A".repeat(43),
  origin = "https://community.test";
const account: SavedAccount = {
  origin,
  instance: {
    instance_id: "instance",
    name: "Community",
    api_version: "v1",
    public_url: origin,
    capabilities: ["sessions.persistent"],
  } as SavedAccount["instance"],
  login: {
    instance_id: "instance",
    token,
    token_type: "Bearer",
    user: {
      id: "12345678-1234-4234-8234-123456789abc",
      username: "alice",
      is_owner: false,
      created_at: "2026-10-10T00:00:00Z",
    },
    session: {
      id: "12345678-1234-4234-8234-123456789def",
      device_name: "test",
      created_at: "2026-10-10T00:00:00Z",
      expires_at: null,
    },
  },
  remember: true,
};
const server = {
  origin,
  instanceId: "instance",
  name: "Community",
  username: "alice",
  lastUsed: 1,
};
const backup = (): ClientBackup => ({
  version: 1,
  createdAt: new Date().toISOString(),
  accounts: [structuredClone(account)],
  servers: [server],
  preferences: {
    "chatxo-voice-sounds": "off",
    "chatxo-client-preferences-v1": JSON.stringify({
      audioPlugins: {
        instance: {
          selected: "example-filter",
          plugins: {
            "example-filter": {
              id: "example-filter",
              variant: "default",
              values: { strength: 76 },
            },
          },
        },
      },
    }),
  },
});
describe("portable invitations", () => {
  it("keeps the code out of requests and preserves private origins", () => {
    for (const address of [
      origin,
      "http://192.168.1.2:8080",
      "http://[::1]:8080",
    ]) {
      const link = inviteLink(address, token),
        url = new URL(link);
      expect(url.pathname + url.search).toBe("/");
      expect(parseInviteLink(link)).toEqual({ origin: address, token });
    }
    expect(parseInviteLink(origin)).toBeUndefined();
  });
  it("rejects malformed or unsafe destinations before credentials are sent", () => {
    for (const link of [
      `http://public.test/#invite=${token}`,
      `https://user:pass@community.test/#invite=${token}`,
      `${origin}/api/#invite=${token}`,
      `${origin}/?redirect=x#invite=${token}`,
      `${origin}/#invite=short`,
      `${origin}/#invite=${token}&other=x`,
      `${origin}/#invite=${"B".repeat(43)}`,
    ])
      expect(() => parseInviteLink(link)).toThrow();
  });
});
describe("encrypted client backups", () => {
  it("round-trips sessions and rejects wrong passwords and tampering", async () => {
    const value = backup(),
      file = await encryptBackup(value, "backup123");
    expect(file).not.toContain(token);
    expect(file).not.toContain("alice");
    expect(await decryptBackup(file, "backup123")).toEqual(value);
    await expect(decryptBackup(file, "incorrect")).rejects.toThrow(
      "incorrect or the file is damaged",
    );
    const damaged = JSON.parse(file);
    damaged.data =
      (damaged.data[0] === "A" ? "B" : "A") + damaged.data.slice(1);
    await expect(
      decryptBackup(JSON.stringify(damaged), "backup123"),
    ).rejects.toThrow("incorrect or the file is damaged");
  });
  it("rejects unsafe accounts, restricted tokens, and arbitrary storage keys", () => {
    let value = backup();
    value.accounts[0].origin = "http://public.test";
    expect(() => validateBackup(value)).toThrow();
    value = backup();
    value.accounts[0].login.password_change_required = true;
    expect(() => validateBackup(value)).toThrow();
    value = backup();
    value.accounts.push(value.accounts[0]);
    expect(() => validateBackup(value)).toThrow();
    value = backup();
    value.preferences["chatxo-remembered-v1:evil"] = "{}";
    expect(() => validateBackup(value)).toThrow();
  });
  it("does not accept attacker-selected KDF work factors", async () => {
    await expect(
      decryptBackup(
        JSON.stringify({
          format: "chatxo-encrypted-backup",
          version: 1,
          kdf: "PBKDF2-SHA256",
          iterations: 2 ** 32,
        }),
        "backup123",
      ),
    ).rejects.toThrow("Unsupported");
  });
});
it("keeps server history separately from revoked tokens across storage reopen", async () => {
  const name = `known-${crypto.randomUUID()}`,
    first = new IndexedDBKnownServers(name);
  await first.put({ ...server, token: "must not persist" } as typeof server);
  await first.close();
  const second = new IndexedDBKnownServers(name);
  expect(await second.list()).toEqual([server]);
  await second.remove(origin, "alice");
  expect(await second.list()).toEqual([]);
  await second.close();
});
it("serializes desktop server-list updates and strips unknown fields", async () => {
  let rows: (typeof server)[] = [];
  const bridge = {
    serversRead: async () => structuredClone(rows),
    serversWrite: async (next: typeof rows) => {
      rows = next;
    },
  } as DesktopBridge;
  const store = new DesktopKnownServers(bridge);
  await Promise.all([
    store.put(server),
    store.put({ ...server, username: "bob" }),
  ]);
  expect(await store.list()).toHaveLength(2);
});
it("never persists restricted temporary sessions or opens their gateway", async () => {
  const vault = new MemoryVault(),
    known = new IndexedDBKnownServers(`reset-${crypto.randomUUID()}`),
    requests: Request[] = [];
  const runtime: Runtime = {
    randomUUID: () => crypto.randomUUID(),
    socket: vi.fn(() => {
      throw Error("Must not open a gateway");
    }),
    fetch: vi.fn(async (input) => {
      const req = input as Request;
      requests.push(req);
      if (req.url.endsWith("/instance")) return Response.json(account.instance);
      if (req.url.endsWith("/auth/login"))
        return Response.json({
          ...account.login,
          password_change_required: true,
        });
      return new Response(null, { status: 204 });
    }),
  };
  const client = new Client(runtime, new MemoryStore(), vault, known);
  let challenge: PasswordChangeRequired | undefined;
  try {
    await client.login(origin, {
      username: "alice",
      password: "temporary",
      device_name: "test",
      remember: true,
    });
  } catch (e) {
    expect(e).toBeInstanceOf(PasswordChangeRequired);
    challenge = e as PasswordChangeRequired;
  }
  expect(await vault.list()).toEqual([]);
  expect(client.instances.size).toBe(0);
  expect(runtime.socket).not.toHaveBeenCalled();
  expect((await known.list())[0].username).toBe("alice");
  await challenge!.cancel();
  expect(requests.at(-1)?.url).toBe(`${origin}/api/v1/auth/logout`);
  await known.close();
});
it("migrates saved servers before an expired session is removed", async () => {
  const vault = new MemoryVault();
  await vault.put(account);
  const known = new IndexedDBKnownServers(`expired-${crypto.randomUUID()}`);
  const client = new Client(
    {
      randomUUID: () => crypto.randomUUID(),
      socket: () => {
        throw Error("No socket");
      },
      fetch: async () =>
        Response.json({ error: "unauthorized" }, { status: 401 }),
    },
    new MemoryStore(),
    vault,
    known,
  );
  await client.restore();
  await vi.waitFor(async () => expect(await vault.list()).toEqual([]));
  expect((await known.list())[0].origin).toBe(origin);
  client.stop();
  await known.close();
});
it("does not delete saved credentials if the non-secret directory is unavailable", async () => {
  const vault = new MemoryVault();
  await vault.put(account);
  const remove = vi.spyOn(vault, "remove");
  const store: KnownServerStore = {
    list: async () => [],
    put: async () => {
      throw Error("Quota exceeded");
    },
    remove: async () => {},
  };
  const client = new Client(
    {
      randomUUID: () => crypto.randomUUID(),
      socket: () => {
        throw Error("No socket");
      },
      fetch: async () => {
        throw Error("Offline");
      },
    },
    new MemoryStore(),
    vault,
    store,
  );
  await client.restore();
  expect(remove).not.toHaveBeenCalled();
  expect(await vault.list()).toHaveLength(1);
  client.stop();
});

describe("restoring independent device sessions", () => {
  it("stores only the fresh credential and leaves existing sign-ins alone", async () => {
    const source = structuredClone(account);
    const restored = {
      ...source.login,
      token: "B".repeat(43),
      session: {
        ...source.login.session,
        id: "12345678-1234-4234-8234-123456789aaa",
      },
    };
    const fetcher = vi.fn(async (request: Request) => {
      if (request.url.endsWith("/api/v1/instance"))
        return Response.json(source.instance);
      expect(request.url).toBe(origin + "/api/v1/sessions/restore");
      expect(request.headers.get("Authorization")).toBe(
        `Bearer ${source.login.token}`,
      );
      expect(await request.json()).toEqual({
        device_name: "Browser · backup restore",
      });
      return Response.json(restored, { status: 201 });
    });
    const vault = new MemoryVault();
    const client = new Client(
      { fetch: fetcher } as unknown as Runtime,
      new MemoryStore(),
      vault,
    );
    await client.restoreAccount(source, "Browser · backup restore");
    expect((await vault.list())[0].login).toEqual(restored);
    await client.restoreAccount(source, "another import");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(source.login.token).toBe(token);
  });
  it("does not send backup credentials to a changed server identity", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ ...account.instance, instance_id: "changed" }),
    );
    const vault = new MemoryVault();
    const client = new Client(
      { fetch: fetcher } as unknown as Runtime,
      new MemoryStore(),
      vault,
    );
    await expect(client.restoreAccount(account, "restored")).rejects.toThrow(
      "identity has changed",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      (fetcher.mock.calls[0] as unknown as [Request])[0].headers.has(
        "Authorization",
      ),
    ).toBe(false);
    expect(await vault.list()).toEqual([]);
  });
  it.each([401, 503])(
    "never saves the shared token when restore fails with %s",
    async (status) => {
      const fetcher = vi.fn(async (request: Request) =>
        request.url.endsWith("/instance")
          ? Response.json(account.instance)
          : Response.json({ error: "unavailable" }, { status }),
      );
      const vault = new MemoryVault();
      const client = new Client(
        { fetch: fetcher } as unknown as Runtime,
        new MemoryStore(),
        vault,
      );
      await expect(
        client.restoreAccount(account, "restored"),
      ).rejects.toThrow();
      expect(await vault.list()).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("revokes only the new session if local persistence fails", async () => {
    const fresh = {
      ...account.login,
      token: "C".repeat(43),
      session: {
        ...account.login.session,
        id: "12345678-1234-4234-8234-123456789bbb",
      },
    };
    const fetcher = vi.fn(async (request: Request) => {
      if (request.url.endsWith("/instance"))
        return Response.json(account.instance);
      if (request.url.endsWith("/restore"))
        return Response.json(fresh, { status: 201 });
      expect(request.url).toBe(origin + "/api/v1/auth/logout");
      expect(request.headers.get("Authorization")).toBe(
        `Bearer ${fresh.token}`,
      );
      return new Response(null, { status: 204 });
    });
    const vault = new MemoryVault();
    vault.put = async () => {
      throw Error("full");
    };
    const client = new Client(
      { fetch: fetcher } as unknown as Runtime,
      new MemoryStore(),
      vault,
    );
    await expect(client.restoreAccount(account, "restored")).rejects.toThrow(
      "full",
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
