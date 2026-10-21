const {
  app,
  BrowserWindow,
  session,
  net,
  ipcMain,
  safeStorage,
  dialog,
  Notification,
  nativeImage,
  shell,
  Menu,
  Tray,
  nativeTheme,
} = require("electron");
const fs = require("node:fs/promises");
const {
  validAppearance,
  supportedMode,
  windowOptions,
  applyWindow,
} = require("./appearance.cjs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  localHTTPHost,
  allowInsecureRequest,
  externalURL,
  forwardDesktopRequest,
  installDesktopCors,
} = require("./network.cjs");
const { installTray, updateAppBadge } = require("./tray.cjs");
const { installLinuxDesktop } = require("./linux-desktop.cjs");
const { linuxInstallerFormat } = require("./updates.cjs");
const {
  validateNotification,
  validateBadge,
  createNotificationService,
} = require("./notifications.cjs");
const { chooseCapture } = require("./capture-picker.cjs");
const { installNativeMedia } = require("./native-media.cjs");
const { DiskMediaCache } = require("./media-cache.cjs");
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
if (process.platform === "win32") {
  const appId = app.isPackaged
    ? require("../../package.json").desktopAppId
    : require("../../electron-builder.config.json").appId;
  app.setAppUserModelId(appId);
}
if (process.platform === "linux" && !app.isReady())
  app.setDesktopName(require("../../package.json").desktopName);
const APP_ORIGIN = "https://app.chatxo.local";
const testMode = !app.isPackaged && process.env.HAUNT_DESKTOP_TEST === "1";
if (!global[Symbol.for("haunt.updater")] && !app.requestSingleInstanceLock())
  app.quit();
let window;
let callWindow;
let statusTray;
const CALL_URL = APP_ORIGIN + "/call-window.html";
let volatileAccounts = [];
const trusted = (raw) => {
  try {
    return new URL(raw).origin === APP_ORIGIN;
  } catch {
    return false;
  }
};
const encryptedStorage = () =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== "linux" ||
    !["basic_text", "unknown"].includes(
      safeStorage.getSelectedStorageBackend(),
    ));
const credentialsPath = () =>
  path.join(app.getPath("userData"), "sessions.encrypted");
function validateSender(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !trusted(event.senderFrame.url)
  )
    throw Error("Untrusted credential request");
}
function validateAccounts(accounts) {
  if (
    !Array.isArray(accounts) ||
    accounts.length > 32 ||
    JSON.stringify(accounts).length > 1_048_576
  )
    throw Error("Invalid accounts");
  for (const account of accounts) {
    const url = new URL(account.origin);
    const local = localHTTPHost(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.origin !== account.origin ||
      !account.instance?.instance_id ||
      account.login?.instance_id !== account.instance.instance_id ||
      typeof account.login?.token !== "string" ||
      account.login.token.length > 1024
    )
      throw Error("Invalid saved account");
  }
}
async function startMain() {
  await profile.migrateCredentials(safeStorage);
  let linuxDesktopError;
  if (process.platform === "linux" && app.isPackaged) {
    try {
      await installLinuxDesktop({
        packageFormat: linuxInstallerFormat(process.resourcesPath),
        nativeExecutable: app.getPath("exe"),
        iconPath: path.join(__dirname, "../../resources/icon.png"),
      });
    } catch (error) {
      linuxDesktopError = `Haunt could not install its launcher entry: ${error.message}`;
      console.error(linuxDesktopError);
    }
  }
  app.setAboutPanelOptions({
    applicationName: "Haunt",
    applicationVersion:
      global[Symbol.for("haunt.updater")]?.updater.snapshot().current ??
      app.getVersion(),
  });
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Haunt",
          submenu: [
            { role: "about", label: "About Haunt" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide", label: "Hide Haunt" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit", label: "Quit Haunt" },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
  }
  const ses = session.fromPartition("persist:chatxo");
  const windowState = (target, win) => ({
    target,
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen(),
    focused: win.isVisible() && !win.isMinimized() && win.isFocused(),
  });
  const trackWindow = (win, target) => {
    const changed = () => {
      if (window && !window.isDestroyed() && !win.isDestroyed())
        window.webContents.send("window:state", windowState(target, win));
    };
    for (const event of [
      "maximize",
      "unmaximize",
      "enter-full-screen",
      "leave-full-screen",
      "restore",
      "minimize",
      "show",
      "hide",
      "focus",
      "blur",
    ])
      win.on(event, changed);
  };
  const controlledWindow = (event, target) => {
    validateSender(event);
    if (target !== "main" && target !== "call")
      throw Error("Invalid window target");
    const win = target === "main" ? window : callWindow;
    if (!win || win.isDestroyed()) throw Error("Window is closed");
    return win;
  };
  ipcMain.handle("window:state", (event, target) =>
    windowState(target, controlledWindow(event, target)),
  );
  ipcMain.handle("media:diagnostics", (event) => {
    validateSender(event);
    return {
      hardwareAcceleration: app.isHardwareAccelerationEnabled(),
      gpu: app.getGPUFeatureStatus(),
    };
  });
  ipcMain.handle("window:control", (event, action, target) => {
    const win = controlledWindow(event, target);
    switch (action) {
      case "minimize":
        win.minimize();
        break;
      case "maximize":
        if (win.isFullScreen()) win.setFullScreen(false);
        else if (win.isMaximized()) win.unmaximize();
        else win.maximize();
        break;
      case "close":
        win.close();
        break;
      case "focus":
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        break;
      default:
        throw Error("Invalid window action");
    }
  });
  // The bundled HTTPS UI can connect to LAN HTTP APIs. Restrict this exception
  // to private-IP/loopback API fetches and sockets from this window; it cannot
  // load scripts, frames, images, or public HTTP resources.
  ses.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "ws://*/*"] },
    (details, callback) =>
      callback({
        cancel: !allowInsecureRequest(details, window?.webContents.id),
      }),
  );
  const root = path.resolve(__dirname, "../../dist");
  installDesktopCors(ses, APP_ORIGIN, () =>
    [window?.webContents.id, callWindow?.webContents.id].filter(
      Number.isInteger,
    ),
  );
  await ses.protocol.handle("https", async (request) => {
    if (!trusted(request.url))
      return forwardDesktopRequest(request, APP_ORIGIN, (upstream) =>
        net.fetch(upstream, { bypassCustomProtocolHandlers: true }),
      );
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405 });
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response(null, { status: 400 });
    }
    const target = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!target.startsWith(root + path.sep))
      return new Response(null, { status: 403 });
    try {
      const response = await net.fetch(pathToFileURL(target).href);
      const headers = new Headers(response.headers);
      if (path.extname(target) === ".webmanifest")
        headers.set("Content-Type", "application/manifest+json");
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src https: wss: http: ws:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src https://www.youtube-nocookie.com; form-action 'none'",
      );
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(request.method === "HEAD" ? null : response.body, {
        status: response.status,
        headers,
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  ses.setPermissionCheckHandler(
    (contents, permission, origin) =>
      contents === window?.webContents &&
      trusted(origin) &&
      [
        "media",
        "display-capture",
        "speaker-selection",
        "clipboard-sanitized-write",
        "local-network-access",
        "local-network",
        "loopback-network",
      ].includes(permission),
  );
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (contents !== window?.webContents || !trusted(details.requestingUrl)) {
      callback(false);
      return;
    }
    if (
      [
        "clipboard-sanitized-write",
        "speaker-selection",
        "local-network-access",
        "local-network",
        "loopback-network",
      ].includes(permission)
    ) {
      callback(true);
      return;
    }
    if (permission !== "media") {
      callback(false);
      return;
    }
    // Only our trusted renderer reaches here. OS camera/microphone consent
    // still applies; an additional per-capture app dialog repeats that grant.
    callback(true);
  });
  let capturePending = false;
  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (
        !trusted(request.securityOrigin) ||
        request.frame !== window?.webContents.mainFrame ||
        capturePending
      ) {
        callback({});
        return;
      }
      capturePending = true;
      try {
        callback(await chooseCapture(window, request.audioRequested));
      } catch {
        callback({});
      } finally {
        capturePending = false;
      }
    },
    { useSystemPicker: true },
  );
  ipcMain.handle("link:open", (event, raw) => {
    validateSender(event);
    return shell.openExternal(externalURL(raw));
  });
  let badgeKey = "";
  let latestBadge;
  const badgeBase = nativeImage.createFromPath(
    path.join(
      __dirname,
      app.isPackaged ? "../../resources/icon.png" : "../../static/icon.png",
    ),
  );
  ipcMain.handle("badge:set", (event, raw) => {
    validateSender(event);
    const value = validateBadge(raw);
    const key = `${value.count}:${value.unread}:${value.icon}:${value.overlay}`;
    if (key === badgeKey && latestBadge)
      return updateAppBadge({ app, window, base: badgeBase }, latestBadge);
    const artwork = (data) => {
      if (!data) return;
      const image = nativeImage.createFromDataURL(data);
      const size = image.getSize();
      if (size.width !== 64 || size.height !== 64)
        throw Error("Invalid badge image");
      return image;
    };
    const icon = artwork(value.icon) || badgeBase;
    const overlay = artwork(value.overlay);
    if (linuxDesktopError && (value.count || value.unread)) {
      window.webContents.send("notification:error", linuxDesktopError);
      linuxDesktopError = undefined;
    }
    latestBadge = { ...value, icon, overlay };
    statusTray?.update(latestBadge);
    const result = updateAppBadge(
      { app, window, base: badgeBase },
      latestBadge,
    );
    badgeKey = key;
    return result;
  });
  const notificationReplacement = () =>
    require(
      app.isPackaged
        ? path.join(
            process.resourcesPath,
            "native/mac/notification-replacement.node",
          )
        : path.resolve(
            __dirname,
            "../../release/native/mac/notification-replacement.node",
          ),
    );
  const nativeNotifications = createNotificationService({
    Notification,
    getWindow: () => window,
    replaceNotification:
      process.platform === "darwin"
        ? (popup, value) =>
            notificationReplacement().replace(popup.id, value.title, value.body)
        : undefined,
    cancelReplacement:
      process.platform === "darwin"
        ? (popup) => notificationReplacement().cancel(popup.id)
        : undefined,
    // macOS supplies the signed bundle's app icon. An explicit icon becomes
    // a duplicate image attachment rather than changing that app identity.
    icon:
      process.platform === "darwin"
        ? undefined
        : path.join(app.getAppPath(), "dist/brand/logo-128.png"),
    onError: (message) => {
      if (!window.isDestroyed())
        window.webContents.send("notification:error", message);
    },
  });
  ipcMain.handle("notification:available", (event) => {
    validateSender(event);
    return Notification.isSupported();
  });
  app.on("browser-window-focus", () => {
    // Permission may have been granted in the system prompt or Settings since
    // the last unread event. Reapply the retained native badge on return.
    if (latestBadge) {
      try {
        updateAppBadge({ app, window, base: badgeBase }, latestBadge);
      } catch (error) {
        window.webContents.send("notification:error", error.message);
      }
    }
  });
  ipcMain.handle("notification:show", (event, raw) => {
    validateSender(event);
    return nativeNotifications.show(validateNotification(raw));
  });
  app.on("before-quit", nativeNotifications.dispose);
  const serversPath = path.join(app.getPath("userData"), "known-servers.json");
  const mediaCache = new DiskMediaCache(
    path.join(app.getPath("userData"), "media-cache-v1"),
  );
  ipcMain.handle("media-cache:read", (event, key) => {
    validateSender(event);
    return mediaCache.get(key);
  });
  ipcMain.handle("media-cache:write", (event, key, value) => {
    validateSender(event);
    return mediaCache.put(key, value);
  });
  const validateServers = (rows) => {
    if (
      !Array.isArray(rows) ||
      rows.length > 100 ||
      JSON.stringify(rows).length > 100000
    )
      throw Error("Invalid saved servers");
    return rows.map((row) => {
      const url = new URL(row.origin);
      if (
        url.origin !== row.origin ||
        (url.protocol !== "https:" &&
          !(url.protocol === "http:" && localHTTPHost(url.hostname))) ||
        typeof row.instanceId !== "string" ||
        !row.instanceId ||
        row.instanceId.length > 128 ||
        typeof row.name !== "string" ||
        row.name.length > 256 ||
        typeof row.username !== "string" ||
        !/^[a-zA-Z0-9_]{3,32}$/.test(row.username) ||
        !Number.isFinite(row.lastUsed)
      )
        throw Error("Invalid saved server");
      return {
        origin: row.origin,
        instanceId: row.instanceId,
        name: row.name,
        username: row.username,
        lastUsed: row.lastUsed,
      };
    });
  };
  ipcMain.handle("servers:read", async (event) => {
    validateSender(event);
    try {
      return validateServers(
        JSON.parse(await fs.readFile(serversPath, "utf8")),
      );
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  });
  let serversWrite = Promise.resolve();
  ipcMain.handle("servers:write", (event, rows) => {
    validateSender(event);
    const clean = validateServers(rows);
    const task = serversWrite.then(async () => {
      await fs.mkdir(path.dirname(serversPath), {
        recursive: true,
        mode: 0o700,
      });
      await fs.writeFile(serversPath + ".tmp", JSON.stringify(clean), {
        mode: 0o600,
      });
      await fs.rename(serversPath + ".tmp", serversPath);
    });
    serversWrite = task.catch(() => {});
    return task;
  });
  let savingBackup = false;
  ipcMain.handle("backup:save", async (event, data) => {
    validateSender(event);
    if (savingBackup) throw Error("A backup export is already open");
    if (typeof data !== "string" || data.length > 32 * 1024 * 1024)
      throw Error("Invalid backup file");
    const envelope = JSON.parse(data);
    if (
      envelope?.format !== "chatxo-encrypted-backup" ||
      envelope.version !== 1 ||
      typeof envelope.data !== "string"
    )
      throw Error("Expected an encrypted client backup");
    savingBackup = true;
    try {
      const result = await dialog.showSaveDialog(window, {
        title: "Export encrypted client backup",
        defaultPath: `Haunt-backup-${new Date().toISOString().slice(0, 10)}.chatxo`,
        filters: [{ name: "Haunt encrypted backup", extensions: ["chatxo"] }],
      });
      if (result.canceled || !result.filePath) return false;
      await fs.writeFile(result.filePath, data, { mode: 0o600 });
      return true;
    } finally {
      savingBackup = false;
    }
  });
  ipcMain.handle("vault:read", async (event) => {
    validateSender(event);
    if (!encryptedStorage()) return volatileAccounts;
    try {
      const accounts = JSON.parse(
        safeStorage.decryptString(await fs.readFile(credentialsPath())),
      );
      validateAccounts(accounts);
      // Legacy desktop credentials were always saved; retain that preference.
      const saved = accounts.map((account) => ({
        ...account,
        remember: account.remember ?? true,
      }));
      return [
        ...saved.filter(
          (a) =>
            !volatileAccounts.some(
              (v) => v.instance.instance_id === a.instance.instance_id,
            ),
        ),
        ...volatileAccounts,
      ];
    } catch (error) {
      if (error.code === "ENOENT") return volatileAccounts;
      throw Error(
        "Could not unlock saved sessions. Check your desktop keyring.",
      );
    }
  });
  ipcMain.handle("vault:write", async (event, accounts) => {
    validateSender(event);
    validateAccounts(accounts);
    if (!encryptedStorage()) {
      volatileAccounts = structuredClone(accounts);
      return;
    }
    const filename = credentialsPath();
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await fs.writeFile(
      filename + ".tmp",
      safeStorage.encryptString(
        JSON.stringify(accounts.filter((a) => a.remember !== false)),
      ),
      { mode: 0o600 },
    );
    await fs.rename(filename + ".tmp", filename);
    volatileAccounts = structuredClone(
      accounts.filter((a) => a.remember === false),
    );
  });
  const appearancePath = path.join(
    app.getPath("userData"),
    "window-appearance.json",
  );
  let appearance = { mode: "solid", background: "#161616", dark: true };
  try {
    appearance = validAppearance(
      JSON.parse(await fs.readFile(appearancePath, "utf8")),
    );
  } catch {}
  let effectiveAppearance = {
    ...appearance,
    mode: supportedMode(appearance.mode),
  };
  const createdTransparent = windowOptions(appearance).transparent;
  nativeTheme.themeSource = appearance.dark ? "dark" : "light";
  let appearanceWrite = Promise.resolve();
  ipcMain.handle("appearance:set", (event, value) => {
    validateSender(event);
    const next = validAppearance(value);
    const update = async () => {
      await fs.mkdir(path.dirname(appearancePath), { recursive: true });
      await fs.writeFile(appearancePath + ".tmp", JSON.stringify(next), {
        mode: 0o600,
      });
      await fs.rename(appearancePath + ".tmp", appearancePath);
      appearance = next;
      nativeTheme.themeSource = next.dark ? "dark" : "light";
      const result = applyWindow(window, next, createdTransparent);
      if (!result.restart)
        effectiveAppearance = { ...next, mode: result.effect };
      else {
        effectiveAppearance.background = next.background;
        applyWindow(window, effectiveAppearance, createdTransparent);
      }
      if (callWindow && !callWindow.isDestroyed())
        callWindow.setBackgroundColor(next.background);
      return { ...result, effect: effectiveAppearance.mode };
    };
    const pending = appearanceWrite.then(update);
    appearanceWrite = pending.catch(() => {});
    return pending;
  });
  window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 600,
    minHeight: 500,
    title: "Haunt",
    frame: false,
    icon: path.resolve(
      __dirname,
      app.isPackaged ? "../../resources/icon.png" : "../../static/icon.png",
    ),
    ...windowOptions(appearance),
    autoHideMenuBar: true,
    webPreferences: {
      partition: "persist:chatxo",
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: true,
      backgroundThrottling: false,
    },
  });
  try {
    statusTray = installTray({
      app,
      Tray,
      Menu,
      nativeImage,
      window,
      iconPath: path.resolve(
        __dirname,
        app.isPackaged ? "../../resources/icon.png" : "../../static/icon.png",
      ),
      templatePath: path.resolve(
        __dirname,
        "../../dist/brand/trayTemplate.png",
      ),
    });
  } catch (error) {
    console.error(
      "Haunt tray is unavailable; closing the window will quit the app.",
      error,
    );
  }
  trackWindow(window, "main");
  window.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (
      url !== CALL_URL ||
      frameName !== "haunt-call" ||
      (callWindow && !callWindow.isDestroyed())
    )
      return { action: "deny" };
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 960,
        height: 640,
        minWidth: 360,
        minHeight: 280,
        frame: false,
        title: "Haunt · Voice",
        backgroundColor: appearance.background,
        autoHideMenuBar: true,
        webPreferences: {
          partition: "persist:chatxo",
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
        },
      },
    };
  });
  window.webContents.on("did-create-window", (child) => {
    callWindow = child;
    child.setMenu(null);
    trackWindow(child, "call");
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    child.webContents.on("will-navigate", (event, url) => {
      if (url !== CALL_URL) event.preventDefault();
    });
    let loaded = false;
    child.webContents.on("did-finish-load", () => {
      loaded = true;
    });
    child.webContents.on(
      "did-start-navigation",
      (_event, _url, inPlace, mainFrame) => {
        // Reloading a view-only window returns it to the owning app renderer.
        if (loaded && mainFrame && !inPlace) child.close();
      },
    );
    child.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    child.on("closed", () => {
      if (callWindow === child) callWindow = undefined;
      if (window && !window.isDestroyed())
        window.webContents.send("call:closed");
    });
  });
  // A call view cannot outlive the renderer that owns its media and credentials.
  window.webContents.on(
    "did-start-navigation",
    (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace && callWindow && !callWindow.isDestroyed())
        callWindow.close();
    },
  );
  window.webContents.on("will-navigate", (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  installNativeMedia(window, validateSender);
  global[Symbol.for("haunt.updater")]?.attach(window, validateSender);
  await window.loadURL(APP_ORIGIN);
}
app
  .whenReady()
  .then(startMain)
  .catch((error) => {
    console.error("Haunt startup:", error.message);
    dialog.showErrorBox("Haunt startup", error.message);
    app.exit(1);
  });
app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});
app.on("window-all-closed", () => app.quit());
