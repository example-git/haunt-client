const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("capturePicker", {
  ready: (listener) => {
    ipcRenderer.once("capture:sources", (_event, value) => listener(value));
    ipcRenderer.send("capture:ready");
  },
  choose: (index, audio, output) =>
    ipcRenderer.send("capture:choose", { index, audio, output }),
  cancel: () => ipcRenderer.send("capture:choose", null),
});
