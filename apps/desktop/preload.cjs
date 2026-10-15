const { contextBridge, ipcRenderer } = require("electron");
const nativeListeners = new Set();
ipcRenderer.on("native:event", (_event, value) => {
  try {
    for (const listener of nativeListeners) listener(value);
  } finally {
    if (value.kind === "video" || value.kind === "audio")
      ipcRenderer.send("native:ack", value.id, value.kind);
  }
});
contextBridge.exposeInMainWorld("hauntDesktop", {
  platform: process.platform,
  appearance: { set: (value) => ipcRenderer.invoke("appearance:set", value) },
  updates: {
    source: (value) => ipcRenderer.invoke("updates:source", value),
    state: () => ipcRenderer.invoke("updates:state"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    apply: () => ipcRenderer.invoke("updates:apply"),
    healthy: () => ipcRenderer.invoke("updates:healthy"),
    subscribe: (callback) => {
      const receive = (_event, value) => callback(value);
      ipcRenderer.on("updates:state", receive);
      return () => ipcRenderer.removeListener("updates:state", receive);
    },
  },
  mediaCacheRead: (key) => ipcRenderer.invoke("media-cache:read", key),
  mediaCacheWrite: (key, value) =>
    ipcRenderer.invoke("media-cache:write", key, value),
  mediaDiagnostics: () => ipcRenderer.invoke("media:diagnostics"),
  nativeCaptureAvailable: ipcRenderer.sendSync("native:available") === true,
  nativeDevices: (requestPermission) =>
    ipcRenderer.invoke("native:devices", requestPermission),
  nativeStart: (request) => ipcRenderer.invoke("native:start", request),
  nativeStop: (id) => ipcRenderer.invoke("native:stop", id),
  onNativeEvent: (callback) => {
    nativeListeners.add(callback);
    return () => nativeListeners.delete(callback);
  },
  nativeOffer: (request) => ipcRenderer.invoke("native:offer", request),
  nativeAnswer: (id, sdp) => ipcRenderer.invoke("native:answer", id, sdp),
  nativeAudio: (id, purpose, data, timestamp) =>
    ipcRenderer.send("native:audio", id, purpose, data, timestamp),
  nativeClosePublisher: (id) =>
    ipcRenderer.invoke("native:close-publisher", id),
  onCallWindowClosed: (callback) => {
    const receive = () => callback();
    ipcRenderer.on("call:closed", receive);
    return () => ipcRenderer.removeListener("call:closed", receive);
  },
  windowState: (target) => ipcRenderer.invoke("window:state", target),
  windowControl: (action, target) =>
    ipcRenderer.invoke("window:control", action, target),
  onWindowState: (callback) => {
    const receive = (_event, value) => callback(value);
    ipcRenderer.on("window:state", receive);
    return () => ipcRenderer.removeListener("window:state", receive);
  },
  openExternal: (url) => ipcRenderer.invoke("link:open", url),
  setBadge: (value) => ipcRenderer.invoke("badge:set", value),
  notificationAvailable: () => ipcRenderer.invoke("notification:available"),
  showNotification: (value) => ipcRenderer.invoke("notification:show", value),
  onNotificationClick: (callback) => {
    const receive = (_event, value) => callback(value);
    ipcRenderer.on("notification:click", receive);
    return () => ipcRenderer.removeListener("notification:click", receive);
  },
  serversRead: () => ipcRenderer.invoke("servers:read"),
  serversWrite: (servers) => ipcRenderer.invoke("servers:write", servers),
  backupSave: (data) => ipcRenderer.invoke("backup:save", data),
  vaultRead: () => ipcRenderer.invoke("vault:read"),
  vaultWrite: (accounts) => ipcRenderer.invoke("vault:write", accounts),
});
