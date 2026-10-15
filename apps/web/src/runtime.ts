import { MLSClient } from "@haunt/browser/dm-crypto/client";
import { restoreAudioPlugins } from "@haunt/browser/audio-plugins/cache";
import { Client, type Runtime } from "@haunt/core";
import { randomUUID } from "@haunt/browser/random";
import { desktopClient } from "@haunt/browser/client-context";
import {
  BrowserVault,
  IndexedDBKnownServers,
  DesktopKnownServers,
  DesktopVault,
  IndexedDBStore,
} from "@haunt/browser/storage";
const runtime: Runtime = {
  prepareConnection: restoreAudioPlugins,
  dmEncryption: (instance) => new MLSClient(instance),
  fetch: globalThis.fetch.bind(globalThis),
  socket: (url) => new WebSocket(url),
  randomUUID: () => randomUUID(),
};
const servers = desktopClient()
  ? new DesktopKnownServers(window.hauntDesktop!)
  : new IndexedDBKnownServers();
export const knownServers = desktopClient()
  ? servers
  : {
      list: async () =>
        (await servers.list()).filter((s) => s.origin === location.origin),
      put: async (server: import("@haunt/core").KnownServer) => {
        if (server.origin !== location.origin)
          throw Error("Use Haunt desktop for other servers.");
        await servers.put(server);
      },
      remove: (origin: string, username: string) =>
        servers.remove(origin, username),
    };
const vault = desktopClient()
  ? new DesktopVault(window.hauntDesktop!)
  : new BrowserVault();
const scopedVault = desktopClient()
  ? vault
  : {
      list: async () =>
        (await vault.list()).filter((a) => a.origin === location.origin),
      put: async (account: import("@haunt/core").SavedAccount) => {
        if (account.origin !== location.origin)
          throw Error(
            "Use Haunt desktop to restore accounts from other servers.",
          );
        await vault.put(account);
      },
      remove: (instance: string) => vault.remove(instance),
    };
export const messageStore = new IndexedDBStore();
export const client = new Client(
  runtime,
  messageStore,
  scopedVault,
  knownServers,
);
window.addEventListener("pagehide", () => client.stop());
