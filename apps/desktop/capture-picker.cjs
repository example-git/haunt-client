const { BrowserWindow, desktopCapturer, ipcMain } = require("electron");
const path = require("node:path");

// A short-lived sandboxed window gets only the current source catalog. No
// credentials, app preload, arbitrary IPC, or renderer-supplied capture IDs.
async function chooseCapture(parent, audioRequested, options = {}) {
  const sources = (
    options.sources ??
    (await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 256, height: 144 },
      fetchWindowIcons: true,
    }))
  ).slice(0, 200);
  if (!sources.length || parent.isDestroyed()) return {};
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent,
      modal: true,
      title: "Share a screen or window",
      width: 780,
      height: 580,
      minWidth: 480,
      minHeight: 360,
      backgroundColor: "#202124",
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "capture-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    const allowAudio =
      audioRequested &&
      (process.platform === "win32" || options.native === true);
    let finished = false;
    const finish = (selection = {}) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      ipcMain.removeListener("capture:ready", ready);
      ipcMain.removeListener("capture:choose", choose);
      parent.webContents.removeListener("did-start-navigation", navigated);
      if (!picker.isDestroyed()) picker.destroy();
      resolve(selection);
    };
    const ready = (event) => {
      if (
        event.sender !== picker.webContents ||
        event.senderFrame !== picker.webContents.mainFrame
      )
        return;
      event.sender.send("capture:sources", {
        allowAudio,
        audioLabel: options.native
          ? "Share audio"
          : "Share system audio (all apps)",
        sources: sources.map((s, index) => ({
          index,
          name: s.name,
          kind: s.id.startsWith("screen:") ? "screen" : "window",
          thumbnail: s.thumbnail?.toDataURL(),
          icon: s.appIcon?.toDataURL(),
        })),
      });
    };
    const choose = (event, value) => {
      if (
        event.sender !== picker.webContents ||
        event.senderFrame !== picker.webContents.mainFrame
      )
        return;
      if (value === null) {
        finish();
        return;
      }
      if (!Number.isInteger(value?.index) || !sources[value.index]) return;
      finish({
        video: sources[value.index],
        ...(allowAudio && value.audio === true ? { audio: "loopback" } : {}),
      });
    };
    const navigated = (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) finish();
    };
    const timeout = setTimeout(() => finish(), 120000);
    parent.webContents.on("did-start-navigation", navigated);
    ipcMain.on("capture:ready", ready);
    ipcMain.on("capture:choose", choose);
    picker.once("closed", () => finish());
    picker.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    picker.webContents.on("will-navigate", (event) => event.preventDefault());
    picker.once("ready-to-show", () => picker.show());
    void picker
      .loadFile(path.join(__dirname, "capture-picker.html"))
      .catch(() => finish());
  });
}
module.exports = { chooseCapture };
