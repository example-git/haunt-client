import { MLSClient } from "@haunt/browser/dm-crypto/client";
import { archiveSearch } from "@haunt/browser/archive-jobs";
import { restoreAudioPlugins } from "@haunt/browser/audio-plugins/cache";
import { ArchiveBudget, Client, type Runtime } from "@haunt/core";
import {
  getPreferences,
  subscribePreferences,
} from "@haunt/browser/preferences";
import { randomUUID } from "@haunt/browser/random";
import {
  desktopClient,
  multiServerClient,
} from "@haunt/browser/client-context";
import {
  BrowserVault,
  IndexedDBKnownServers,
  DesktopKnownServers,
  DesktopVault,
  IndexedDBStore,
} from "@haunt/browser/storage";
const runtime: Runtime = {
  archiveBudget: new ArchiveBudget(() => getPreferences().archive),
  archiveAvailable: () =>
    document.visibilityState === "visible" &&
    navigator.onLine &&
    !(navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData,
  prepareConnection: restoreAudioPlugins,
  dmEncryption: (instance) => new MLSClient(instance),
  fetch: globalThis.fetch.bind(globalThis),
  socket: (url) => new WebSocket(url),
  randomUUID: () => randomUUID(),
};
const servers = desktopClient()
  ? new DesktopKnownServers(window.hauntDesktop!)
  : new IndexedDBKnownServers();
export const knownServers = multiServerClient()
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
const scopedVault = multiServerClient()
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
messageStore.search = (scope, conversation, query, options = {}) =>
  archiveSearch("chatxo-history-v1", scope, conversation, query, options);
export const client = new Client(
  runtime,
  messageStore,
  scopedVault,
  knownServers,
);
window.addEventListener("pagehide", () => client.stop());
let archivePolicy = getPreferences().archive;
subscribePreferences(() => {
  const next = getPreferences().archive;
  if (JSON.stringify(next) === JSON.stringify(archivePolicy)) return;
  archivePolicy = next;
  for (const instance of client.instances.values())
    void instance.updateArchivePolicy();
});
