const { app, ipcMain, shell } = require("electron");
const path = require("node:path");
const { Updater, replaceAppImage } = require("./updates.cjs");
const config = require("../../update-runtime.json");
// These identities intentionally remain stable across releases and repository moves.
if (!app.commandLine.hasSwitch("user-data-dir"))
  app.setPath("userData", path.join(app.getPath("appData"), "chat.xo.vg"));
app.setName("chat.xo.vg");
if (!app.requestSingleInstanceLock()) app.exit(0);
else void start();

async function start() {
  const updater = new Updater({
    directory: path.join(app.getPath("userData"), "client-updates"),
    config,
    runtime: config.runtime,
    version: config.version,
  });
  let archive;
  try {
    archive = await updater.boot();
  } catch (error) {
    updater.set({
      phase: "disabled",
      message: `Updates are unavailable: ${error.message}`,
    });
  }
  let watchdog;
  // Only a newly activated payload has to acknowledge startup. Offline use and
  // sign-in are unrelated to this acknowledgement.
  if (updater.state.trial)
    watchdog = setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 60_000);
  global[Symbol.for("haunt.updater")] = {
    updater,
    attach(window, validateSender) {
      const publish = (state) => {
        if (!window.isDestroyed())
          window.webContents.send("updates:state", state);
      };
      updater.on("status", publish);
      let sourceCheck;
      ipcMain.handle("updates:source", (event, value) => {
        validateSender(event);
        updater.source(value);
        clearTimeout(sourceCheck);
        if (!value.remove)
          sourceCheck = setTimeout(() => void updater.check(), 2000);
      });
      ipcMain.handle("updates:state", (event) => {
        validateSender(event);
        return updater.snapshot();
      });
      ipcMain.handle("updates:check", (event) => {
        validateSender(event);
        return updater.check();
      });
      ipcMain.handle("updates:download", (event) => {
        validateSender(event);
        return updater.download();
      });
      ipcMain.handle("updates:healthy", async (event) => {
        validateSender(event);
        await updater.healthy();
        clearTimeout(watchdog);
      });
      let applying = false;
      ipcMain.handle("updates:apply", async (event) => {
        validateSender(event);
        if (applying) return;
        applying = true;
        try {
          const busy = await window.webContents.executeJavaScript(
            'Boolean(document.querySelector(\'[data-update-busy="true"], [data-active-call="true"]\'))',
          );
          if (busy)
            throw Error(
              "Finish the call or upload before installing this update.",
            );
          const release = await updater.verifyReady();
          if (release.kind === "asar") {
            app.relaunch();
            app.quit();
          } else if (process.platform === "linux" && process.env.APPIMAGE) {
            await replaceAppImage(
              process.env.APPIMAGE,
              release.filename,
              release.info.installer,
            );
            app.relaunch({ execPath: process.env.APPIMAGE, args: [] });
            app.quit();
          } else {
            // NSIS upgrades the existing Windows installation and handles locked
            // executables. macOS users install/sign their new baseline themselves.
            const error = await shell.openPath(release.filename);
            if (error) throw Error(error);
            if (process.platform === "win32") app.quit();
          }
        } catch (error) {
          updater.set({ message: error.message });
          throw error;
        } finally {
          applying = false;
        }
      });
      const first = setTimeout(() => void updater.check(), 60_000);
      const interval = setInterval(() => void updater.check(), 6 * 60 * 60_000);
      first.unref();
      interval.unref();
      app.once("will-quit", () => {
        clearTimeout(first);
        clearInterval(interval);
        clearTimeout(sourceCheck);
        clearTimeout(watchdog);
      });
    },
  };
  if (archive) app.setAppPath(archive);
  try {
    require(
      archive ? path.join(archive, "apps/desktop/main.cjs") : "./main.cjs",
    );
  } catch (error) {
    if (updater.state.trial) {
      app.relaunch();
      app.exit(1);
    } else throw error;
  }
}
