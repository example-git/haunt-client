const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

function installDesktopCalls({
  app,
  ipcMain,
  globalShortcut,
  parent,
  validateSender,
  tray,
}) {
  const file = path.join(app.getPath("userData"), "call-shortcuts.json");
  const keys = ["CommandOrControl+Shift+M", "CommandOrControl+Shift+D"];
  let state = {
    shortcuts: false,
    ptt: false,
    pressed: false,
    native: process.platform === "linux",
    trigger: process.platform === "linux" ? "F9" : "F9 (Haunt focused)",
    error: "",
  };
  let helper,
    configuring = false,
    active = false;
  const send = (value) => {
    if (!parent.isDestroyed()) parent.webContents.send("calls:event", value);
  };
  const publish = () => send({ state });
  const command = (action) => {
    if (active) send({ action });
  };
  const clear = () => {
    for (const key of keys) globalShortcut.unregister(key);
    globalShortcut.unregister("F9");
    const child = helper;
    helper = undefined;
    child?.kill("SIGTERM");
    state = { ...state, pressed: false };
    publish();
  };
  const startPTT = () =>
    new Promise((resolve, reject) => {
      const binary = app.isPackaged
        ? path.join(process.resourcesPath, "native/linux/HauntShortcutWorker")
        : path.join(
            __dirname,
            "../../release/native/linux/HauntShortcutWorker",
          );
      const wayland =
        process.env.XDG_SESSION_TYPE === "wayland" ||
        !!process.env.WAYLAND_DISPLAY;
      if (!wayland && !globalShortcut.register("F9", () => {})) {
        reject(Error("F9 is already reserved by another application."));
        return;
      }
      const child = (helper = spawn(binary, [], {
        stdio: ["ignore", "pipe", "pipe"],
      }));
      let pending = "",
        error = "",
        ready = false;
      const timeout = setTimeout(() => {
        failed("The desktop did not finish binding push to talk.");
      }, 120000);
      const failed = (message) => {
        clearTimeout(timeout);
        if (helper !== child) {
          if (!ready) reject(Error("Shortcut setup cancelled."));
          return;
        }
        helper = undefined;
        child.kill("SIGTERM");
        globalShortcut.unregister("F9");
        state = { ...state, pressed: false, error: message };
        publish();
        if (!ready) reject(Error(message));
      };
      child.once("error", (failure) => failed(failure.message));
      child.once("exit", () =>
        failed(
          error ||
            "Push-to-talk shortcut stopped. Re-enable it in Devices settings.",
        ),
      );
      child.stderr.on("data", (data) => {
        error = (error + data).slice(-2000).trim();
      });
      child.stdout.on("data", (data) => {
        pending += data;
        if (pending.length > 8192) {
          failed("Invalid shortcut response.");
          return;
        }
        let end;
        while ((end = pending.indexOf("\n")) >= 0) {
          let value;
          try {
            value = JSON.parse(pending.slice(0, end));
          } catch {
            failed("Invalid shortcut response.");
            return;
          }
          pending = pending.slice(end + 1);
          if (helper !== child) return;
          if (value.ready === true && typeof value.trigger === "string") {
            ready = true;
            clearTimeout(timeout);
            state = {
              ...state,
              trigger: value.trigger.slice(0, 160),
              error: "",
            };
            resolve();
          } else if (ready && typeof value.pressed === "boolean") {
            state = { ...state, pressed: value.pressed };
            publish();
          }
        }
      });
    });
  const configure = async (value, persist) => {
    if (configuring) throw Error("Finish the current shortcut setup first.");
    if (
      !value ||
      typeof value.shortcuts !== "boolean" ||
      typeof value.ptt !== "boolean"
    )
      throw Error("Invalid call shortcut settings.");
    configuring = true;
    clear();
    state = { ...state, shortcuts: value.shortcuts, ptt: value.ptt, error: "" };
    publish();
    try {
      if (value.shortcuts) {
        for (const [index, key] of keys.entries())
          if (
            !globalShortcut.register(key, () =>
              command(index ? "deafen" : "mute"),
            )
          )
            throw Error(
              `Cannot register ${key}. Another app or the desktop may own it.`,
            );
      }
      if (value.ptt && process.platform === "linux") await startPTT();
      if (persist) {
        await fs.writeFile(
          file + ".tmp",
          JSON.stringify({ shortcuts: value.shortcuts, ptt: value.ptt }),
          { mode: 0o600 },
        );
        await fs.rename(file + ".tmp", file);
      }
      return state;
    } catch (error) {
      clear();
      state = { ...state, shortcuts: false, error: error.message };
      throw error;
    } finally {
      configuring = false;
      publish();
    }
  };
  const ready = fs
    .readFile(file, "utf8")
    .then((raw) => {
      const value = JSON.parse(raw);
      void configure(value, false).catch((error) => {
        state = { ...state, error: error.message };
        publish();
      });
    })
    .catch((error) => {
      if (error.code !== "ENOENT") {
        state = { ...state, error: error.message };
        publish();
      }
    });
  ipcMain.handle("calls:settings", async (event, value) => {
    validateSender(event);
    await ready;
    return value === undefined ? state : configure(value, true);
  });
  ipcMain.handle("calls:state", (event, value) => {
    validateSender(event);
    if (
      !value ||
      ["active", "muted", "deafened", "sharing"].some(
        (key) => typeof value[key] !== "boolean",
      )
    )
      throw Error("Invalid call state.");
    active = value.active;
    tray?.setCall(value, command);
  });
  const reset = () => {
    active = false;
    state = { ...state, pressed: false };
    publish();
    tray?.setCall(undefined, command);
  };
  parent.webContents.on(
    "did-start-navigation",
    (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) reset();
    },
  );
  parent.webContents.on("render-process-gone", reset);
  parent.on("closed", clear);
  app.on("will-quit", clear);
}
module.exports = { installDesktopCalls };
