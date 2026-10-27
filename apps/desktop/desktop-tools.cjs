const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { externalURL, localHTTPHost } = require("./network.cjs");
const { isVideoTicket, writeRanges } = require("./range-download.cjs");

async function installDesktopTools({
  app,
  ipcMain,
  parent,
  session,
  dialog,
  shell,
  clipboard,
  ClipboardItem,
  nativeImage,
  validateSender,
  mediaCache,
  fetch,
}) {
  const file = path.join(app.getPath("userData"), "desktop-settings.json");
  let preferences = {
    cacheBudget: mediaCache.budget,
    downloadDirectory: app.getPath("downloads"),
  };
  try {
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    if (
      Number.isInteger(saved.cacheBudget) &&
      saved.cacheBudget >= 16 * 1024 * 1024 &&
      saved.cacheBudget <= 8 * 1024 * 1024 * 1024
    )
      preferences.cacheBudget = saved.cacheBudget;
    if (
      typeof saved.downloadDirectory === "string" &&
      path.isAbsolute(saved.downloadDirectory)
    )
      preferences.downloadDirectory = saved.downloadDirectory;
  } catch (error) {
    if (error.code !== "ENOENT")
      console.error("Desktop settings could not be read:", error.message);
  }
  await mediaCache.configure(preferences.cacheBudget);
  let writes = Promise.resolve();
  const save = () => {
    const data = JSON.stringify(preferences);
    const task = writes.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.writeFile(file + ".tmp", data, { mode: 0o600 });
      await fs.rename(file + ".tmp", file);
    });
    writes = task.catch(() => {});
    return task;
  };
  const downloads = new Map();
  const pending = new Map();
  const start = (raw, name) => {
    const url = new URL(raw);
    if (url.protocol === "blob:") {
      if (url.origin !== "https://app.chatxo.local")
        throw Error("Invalid download source.");
    } else {
      externalURL(raw);
      if (url.protocol === "http:" && !localHTTPHost(url.hostname))
        throw Error("Downloads require HTTPS.");
    }
    if (
      typeof name !== "string" ||
      !name.length ||
      name.length > 255 ||
      /[\u0000-\u001f]/.test(name)
    )
      throw Error("Invalid download filename.");
    if (pending.has(raw)) throw Error("This download is already starting.");
    if (isVideoTicket(url)) return startRanges(raw, path.basename(name));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(raw);
        reject(
          Error(
            "Download source is unavailable. Open the media and save it again.",
          ),
        );
      }, 10000);
      pending.set(raw, {
        name: path.basename(name),
        resolve: (id) => {
          clearTimeout(timeout);
          pending.delete(raw);
          resolve(id);
        },
      });
      try {
        parent.webContents.downloadURL(raw);
      } catch (error) {
        clearTimeout(timeout);
        pending.delete(raw);
        reject(error);
      }
    });
  };
  const snapshot = () =>
    [...downloads.values()]
      .reverse()
      .map(
        ({
          id,
          name,
          received,
          total,
          state,
          filePath,
          item,
          sourceKey,
          error,
        }) => ({
          id,
          name,
          received,
          total,
          state,
          filePath,
          active: !!item,
          sourceKey,
          error,
        }),
      );
  let timer;
  const publish = (immediate = false) => {
    if (immediate) {
      clearTimeout(timer);
      timer = undefined;
    } else if (timer) return;
    const send = () => {
      timer = undefined;
      if (!parent.isDestroyed())
        parent.webContents.send("downloads:state", snapshot());
    };
    if (immediate) send();
    else timer = setTimeout(send, 100);
  };
  const startRanges = async (url, name) => {
    const result = await dialog.showSaveDialog(parent, {
      title: "Save video",
      defaultPath: path.join(preferences.downloadDirectory, name),
    });
    if (result.canceled || !result.filePath) return "";
    const id = randomUUID(),
      abort = new AbortController();
    const entry = {
      id,
      url,
      name,
      sourceKey: createHash("sha256").update(url).digest("hex"),
      received: 0,
      total: 0,
      state: "progressing",
      filePath: result.filePath,
      item: { cancel: () => abort.abort(), canResume: () => false },
    };
    downloads.set(id, entry);
    publish(true);
    void writeRanges(
      url,
      result.filePath,
      fetch,
      abort.signal,
      (received, total) => {
        Object.assign(entry, { received, total });
        publish();
      },
    )
      .then(
        () => {
          entry.state = "completed";
        },
        (error) => {
          entry.state = abort.signal.aborted ? "cancelled" : "interrupted";
          entry.error = abort.signal.aborted ? "" : error.message;
        },
      )
      .finally(() => {
        entry.item = undefined;
        publish(true);
      });
    return id;
  };
  session.on("will-download", (event, item, contents) => {
    if (contents !== parent.webContents) return;
    const id = randomUUID();
    const requested = pending.get(item.getURL());
    const entry = {
      id,
      item,
      url: item.getURL(),
      sourceKey: createHash("sha256").update(item.getURL()).digest("hex"),
      name: requested?.name || item.getFilename(),
      received: 0,
      total: item.getTotalBytes(),
      state: "progressing",
      filePath: "",
    };
    downloads.set(id, entry);
    item.setSaveDialogOptions({
      defaultPath: path.join(
        preferences.downloadDirectory,
        path.basename(entry.name),
      ),
      title: "Save download",
    });
    item.on("updated", (_event, state) => {
      Object.assign(entry, {
        state,
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
        filePath: item.getSavePath(),
      });
      publish();
    });
    item.once("done", (_event, state) => {
      Object.assign(entry, {
        state,
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
        filePath: item.getSavePath(),
        item: undefined,
      });
      publish(true);
    });
    for (const [key, value] of downloads) {
      if (downloads.size <= 50) break;
      if (!value.item) downloads.delete(key);
    }
    publish(true);
    requested?.resolve(id);
  });
  ipcMain.handle("downloads:start", (event, url, name) => {
    validateSender(event);
    return start(url, name);
  });
  ipcMain.handle("downloads:list", (event) => {
    validateSender(event);
    return snapshot();
  });
  ipcMain.handle("downloads:action", async (event, id, action) => {
    validateSender(event);
    const entry = downloads.get(id);
    if (!entry) throw Error("Download is no longer in the list.");
    if (action === "cancel" && entry.item) entry.item.cancel();
    else if (action === "retry" && entry.state !== "completed") {
      if (entry.item?.canResume()) entry.item.resume();
      else {
        entry.item?.cancel();
        return start(entry.url, entry.name);
      }
    } else if (
      action === "reveal" &&
      entry.state === "completed" &&
      entry.filePath
    ) {
      await fs.access(entry.filePath);
      shell.showItemInFolder(entry.filePath);
    } else if (action === "remove" && !entry.item) {
      downloads.delete(id);
      publish(true);
    } else throw Error("This download action is unavailable.");
  });
  ipcMain.handle("desktop:storage", async (event) => {
    validateSender(event);
    return {
      ...(await mediaCache.stats()),
      downloadDirectory: preferences.downloadDirectory,
    };
  });
  ipcMain.handle("desktop:cache-budget", async (event, budget) => {
    validateSender(event);
    await mediaCache.configure(budget);
    preferences.cacheBudget = budget;
    await save();
    return mediaCache.stats();
  });
  ipcMain.handle("desktop:clear-cache", async (event) => {
    validateSender(event);
    await mediaCache.configure(preferences.cacheBudget, true);
    return mediaCache.stats();
  });
  let choosing = false;
  ipcMain.handle("desktop:download-directory", async (event) => {
    validateSender(event);
    if (choosing) throw Error("A folder chooser is already open.");
    choosing = true;
    try {
      const result = await dialog.showOpenDialog(parent, {
        title: "Download folder",
        defaultPath: preferences.downloadDirectory,
        properties: ["openDirectory", "createDirectory"],
      });
      if (!result.canceled && result.filePaths[0]) {
        preferences.downloadDirectory = result.filePaths[0];
        await save();
      }
      return preferences.downloadDirectory;
    } finally {
      choosing = false;
    }
  });
  ipcMain.handle("desktop:reveal-storage", async (event, kind) => {
    validateSender(event);
    const directory =
      kind === "media"
        ? mediaCache.directory
        : kind === "application"
          ? app.getPath("userData")
          : kind === "downloads"
            ? preferences.downloadDirectory
            : undefined;
    if (!directory) throw Error("Unknown storage location.");
    const error = await shell.openPath(directory);
    if (error) throw Error(error);
  });
  ipcMain.handle("media:copy-image", (event, bytes) => {
    validateSender(event);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 20 * 1024 * 1024)
      throw Error("Choose an image up to 20 MiB.");
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image.isEmpty()) throw Error("This image cannot be copied.");
    return clipboard.write([
      new ClipboardItem({
        "image/png": new Blob([new Uint8Array(image.toPNG())], {
          type: "image/png",
        }),
      }),
    ]);
  });
  app.on("before-quit", () => {
    clearTimeout(timer);
    for (const entry of downloads.values()) entry.item?.cancel();
  });
}
module.exports = { installDesktopTools };
