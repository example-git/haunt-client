import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import {
  Client,
  type ClientBackup,
  type Runtime,
  type SavedAccount,
  type SocketLike,
} from "@haunt/core";
import {
  BrowserVault,
  IndexedDBKnownServers,
  IndexedDBStore,
} from "../packages/browser/src/storage";
import {
  proofKeys,
  random,
  type Ciphertext,
} from "../packages/browser/src/sync/crypto";
import {
  SyncService,
  type Session,
} from "../packages/browser/src/sync/service";
import {
  disableSync,
  enableSync,
  syncNow,
  syncStatus,
} from "../apps/web/src/sync-runtime";

const runtimeState = vi.hoisted(() => ({
  current: undefined as Device | undefined,
}));
vi.mock("../apps/web/src/runtime", () => ({
  get client() {
    return runtimeState.current!.client;
  },
  get knownServers() {
    return runtimeState.current!.servers;
  },
  get messageStore() {
    return runtimeState.current!.store;
  },
}));

class LocalStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

class Socket implements SocketLike {
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  onmessage: SocketLike["onmessage"] = null;
  constructor(
    readonly source: SavedAccount,
    readonly authenticated: (token: string) => void,
  ) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
    });
  }
  send(raw: string) {
    const command = JSON.parse(raw);
    if (command.type === "authenticate") this.authenticated(command.token);
    const reply =
      command.type === "authenticate"
        ? {
            type: "ready",
            instance_id: this.source.instance.instance_id,
            event_cursor: 1,
          }
        : { type: "subscribed", conversations: [] };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(reply) }));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }
}

interface Device {
  client: Client;
  store: IndexedDBStore;
  servers: IndexedDBKnownServers;
  storage: Storage;
  session: Session;
  requests: Request[];
  sockets: { instance: string; token: string }[];
}
const devices: Device[] = [];
afterEach(async () => {
  await disableSync();
  for (const device of devices.splice(0)) {
    device.client.stop();
    await device.store.close();
    await device.servers.close();
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([2, 3])(
  "keeps independent sessions for %i clients through sync, reconnect and restart",
  async (deviceCount) => {
    const sources: SavedAccount[] = ["one", "two"].map((name) => {
      const origin = `https://${name}.test`;
      return {
        origin,
        instance: {
          instance_id: name,
          name,
          api_version: "v1",
          public_url: origin,
          capabilities: ["sessions.persistent"],
        } as SavedAccount["instance"],
        login: {
          instance_id: name,
          token: random(),
          token_type: "Bearer",
          user: {
            id: crypto.randomUUID(),
            username: "alice",
            is_owner: false,
            created_at: "2026-10-21T00:00:00Z",
          },
          session: {
            id: crypto.randomUUID(),
            device_name: "original",
            created_at: "2026-10-21T00:00:00Z",
            expires_at: null,
          },
        },
        remember: true,
      };
    });
    const issued = new Map(
      sources.map((source) => [source.login.token, source.login]),
    );
    const issuer = "https://sync.test";
    let writes = 0;
    const vaults = new Map<
      string,
      { revision: number; ciphertext: Ciphertext | null }
    >();
    vi.stubEnv("MODE", "standalone");
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
      const url = new URL(input);
      expect(url.origin).toBe(issuer);
      if (url.pathname === "/v1/devices/current" && init.method === "DELETE")
        return new Response(null, { status: 204 });
      if (url.pathname === "/v1/vaults")
        return Response.json({
          origins: sources.map((source) => source.origin),
        });
      expect(url.pathname).toMatch(/^\/v1\/vault\//);
      const stored = vaults.get(url.pathname) ?? {
        revision: 0,
        ciphertext: null,
      };
      if (init.method === "GET") return Response.json(stored);
      expect(init.method).toBe("PUT");
      const body = JSON.parse(init.body as string);
      if (body.expected_revision !== stored.revision)
        return Response.json({ error: "revision_conflict" }, { status: 409 });
      const revision = stored.revision + 1;
      vaults.set(url.pathname, { revision, ciphertext: body.ciphertext });
      writes++;
      return Response.json({ revision });
    });
    const backupKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const rootMaterial = await crypto.subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(32)),
      "HKDF",
      false,
      ["deriveKey"],
    );
    const syncAccount = crypto.randomUUID();
    async function device(name: string, accounts: SavedAccount[] = []) {
      const storage = new LocalStorage();
      const vault = new BrowserVault(new LocalStorage(), storage);
      const store = new IndexedDBStore(
        "restore-history-" + deviceCount + "-" + name,
      );
      const servers = new IndexedDBKnownServers(
        "restore-servers-" + deviceCount + "-" + name,
      );
      for (const account of accounts) await vault.put(structuredClone(account));
      const requests: Request[] = [];
      const sockets: Device["sockets"] = [];
      const runtime: Runtime = {
        randomUUID: () => crypto.randomUUID(),
        socket: (url) => {
          const source = sources.find(
            (entry) => new URL(entry.origin).host === new URL(url).host,
          )!;
          return new Socket(source, (token) => {
            expect(issued.get(token)?.instance_id).toBe(
              source.instance.instance_id,
            );
            sockets.push({ instance: source.instance.instance_id, token });
          });
        },
        fetch: async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(input, init);
          requests.push(request);
          const url = new URL(request.url);
          const source = sources.find((entry) => entry.origin === url.origin)!;
          if (url.pathname === "/api/v1/instance")
            return Response.json(source.instance);
          if (url.pathname === "/readyz")
            return Response.json({ status: "ok" });
          const token = request.headers.get("Authorization")?.slice(7) ?? "";
          const login = issued.get(token);
          if (!login || login.instance_id !== source.instance.instance_id)
            return Response.json({ error: "unauthorized" }, { status: 401 });
          if (url.pathname === "/api/v1/sessions/restore") {
            const body = await request.json();
            const restored = {
              ...login,
              token: random(),
              session: {
                ...login.session,
                id: crypto.randomUUID(),
                device_name: body.device_name,
              },
            };
            issued.set(restored.token, restored);
            return Response.json(restored, { status: 201 });
          }
          if (url.pathname === "/api/v1/me")
            return Response.json({
              user: login.user,
              session_id: login.session.id,
              permissions: 0,
            });
          if (
            ["channels", "categories", "users", "conversations"].includes(
              url.pathname.split("/").at(-1)!,
            )
          )
            return Response.json({ [url.pathname.split("/").at(-1)!]: [] });
          throw Error("Unexpected community request: " + url.pathname);
        },
      };
      const client = new Client(runtime, store, vault, servers);
      const session: Session = {
        issuer,
        portal: issuer,
        account: syncAccount,
        username: "alice",
        token: random(),
        device: crypto.randomUUID(),
        scope: "full",
        keys: await proofKeys(),
        backupKey,
        rootMaterial,
      };
      const value: Device = {
        client,
        store,
        servers,
        storage,
        session,
        requests,
        sockets,
      };
      devices.push(value);
      return value;
    }
    async function synchronize(device: Device) {
      runtimeState.current = device;
      vi.stubGlobal("localStorage", device.storage);
      await enableSync(device.session);
      await syncNow();
      expect(syncStatus()).toMatchObject({
        error: "",
        conflict: false,
        notice: "",
      });
    }
    const original = await device("original", sources);
    await original.client.restore();
    await synchronize(original);
    for (let index = 1; index < deviceCount; index++)
      await synchronize(await device("restored-" + index));
    const credentials = await Promise.all(
      devices.map((entry) => entry.client.vault.list()),
    );
    for (const source of sources) {
      const logins = credentials.map(
        (accounts) =>
          accounts.find((entry) => entry.origin === source.origin)!.login,
      );
      expect(new Set(logins.map((login) => login.token)).size).toBe(
        deviceCount,
      );
      expect(new Set(logins.map((login) => login.session.id)).size).toBe(
        deviceCount,
      );
    }
    for (const entry of [...devices].reverse()) await synchronize(entry);
    for (const entry of devices) await synchronize(entry);
    const stableWrites = writes;
    for (const entry of devices) await synchronize(entry);
    expect(writes).toBe(stableWrites);
    for (const [index, entry] of devices.entries()) {
      expect(await entry.client.vault.list()).toEqual(credentials[index]);
      for (const instance of entry.client.instances.values())
        await instance.connect();
      entry.client.stop();
      entry.client = new Client(
        entry.client.runtime,
        entry.store,
        entry.client.vault,
        entry.servers,
      );
      await entry.client.restore();
      await vi.waitFor(() => {
        expect(
          [...entry.client.instances.values()].map(
            (instance) => instance.snapshot.status,
          ),
        ).toEqual(["online", "online"]);
      });
      await synchronize(entry);
      for (const account of credentials[index]) {
        const authenticated = entry.requests.filter(
          (request) =>
            request.url.startsWith(account.origin) &&
            request.headers.has("Authorization") &&
            !request.url.endsWith("/sessions/restore"),
        );
        expect(authenticated.length).toBeGreaterThan(0);
        expect(
          authenticated.every(
            (request) =>
              request.headers.get("Authorization") ===
              "Bearer " + account.login.token,
          ),
        ).toBe(true);
        const socketTokens = entry.sockets
          .filter((socket) => socket.instance === account.instance.instance_id)
          .map((socket) => socket.token);
        expect(socketTokens.length).toBeGreaterThanOrEqual(3);
        expect(new Set(socketTokens)).toEqual(new Set([account.login.token]));
      }
      expect(
        entry.requests.filter((request) =>
          request.url.endsWith("/sessions/restore"),
        ),
      ).toHaveLength(index === 0 ? 0 : 2);
    }
    const cloud = await new SyncService(issuer).read<ClientBackup>(
      devices.at(-1)!.session,
    );
    expect(cloud.value!.accounts.map((account) => account.login.token)).toEqual(
      credentials.at(-1)!.map((account) => account.login.token),
    );
  },
);
