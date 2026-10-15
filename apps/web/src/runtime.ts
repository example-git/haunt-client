import { MLSClient } from "@haunt/browser/dm-crypto/client";
import { restoreAudioPlugins } from "@haunt/browser/audio-plugins/cache";
import { Client, type Runtime } from "@haunt/core";
import { randomUUID } from "@haunt/browser/random";
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
export const knownServers = window.hauntDesktop
  ? new DesktopKnownServers(window.hauntDesktop)
  : new IndexedDBKnownServers();
export const messageStore = new IndexedDBStore();
export const client = new Client(
  runtime,
  messageStore,
  window.hauntDesktop
    ? new DesktopVault(window.hauntDesktop)
    : new BrowserVault(),
  knownServers,
);
window.addEventListener("pagehide", () => client.stop());
