const {
  app,
  ipcMain,
  shell,
  dialog,
  powerMonitor,
  safeStorage,
} = require("electron");
const path = require("node:path");
const {
  Updater,
  linuxInstallerFormat,
  startUpdatePolling,
  createUpdateInstaller,
  updateActivityScript,
} = require("./updates.cjs");
const config = require("../../update-runtime.json");
const { initializeProfile, runKeyMigrationHelper } = require("./profile.cjs");
if (runKeyMigrationHelper(app, safeStorage)) return;
let profile;
try {
  profile = initializeProfile(app);
} catch (error) {
  console.error("Haunt profile migration:", error.message);
  dialog.showErrorBox("Haunt profile migration", error.message);
  app.exit(1);
  return;
}
if (process.platform === "linux")
  app.setDesktopName(require("../../package.json").desktopName);
if (!app.requestSingleInstanceLock()) app.exit(0);
else
  void start().catch((error) => {
    console.error("Haunt startup:", error.message);
    dialog.showErrorBox("Haunt startup", error.message);
    app.exit(1);
  });

async function start() {
  await app.whenReady();
  await profile.migrateCredentials(safeStorage);
  const updater = new Updater({
    directory: path.join(app.getPath("userData"), "client-updates"),
    config: {
      ...config,
      ...(process.platform === "linux"
        ? { installerFormat: linuxInstallerFormat(process.resourcesPath) }
        : {}),
    },
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
      const polling = startUpdatePolling(updater);
      ipcMain.handle("updates:source", (event, value) => {
        validateSender(event);
        updater.source(value);
        if (!value.remove) polling.sourceChanged();
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
      const install = createUpdateInstaller({
        updater,
        app,
        shell,
        readActivity: () =>
          window.webContents.executeJavaScript(updateActivityScript),
        confirm: async (detail) =>
          (
            await dialog.showMessageBox(window, {
              type: "question",
              title: "Install update",
              message: "Restart Haunt to install the update?",
              detail,
              buttons: ["Cancel", "Restart and update"],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            })
          ).response === 1,
      });
      ipcMain.handle("updates:apply", (event) => {
        validateSender(event);
        return install();
      });
      window.on("focus", polling.wake);
      powerMonitor.on("resume", polling.wake);
      app.once("will-quit", () => {
        polling.stop();
        window.removeListener("focus", polling.wake);
        powerMonitor.removeListener("resume", polling.wake);
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
