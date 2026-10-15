const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("capturePicker", {
  ready: (listener) => {
    ipcRenderer.once("capture:sources", (_event, value) => listener(value));
    ipcRenderer.send("capture:ready");
  },
  choose: (index, audio) =>
    ipcRenderer.send("capture:choose", { index, audio }),
  cancel: () => ipcRenderer.send("capture:choose", null),
});
