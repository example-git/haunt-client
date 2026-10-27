const { localHTTPHost } = require("./network.cjs");
function parseDeepLink(raw) {
  if (typeof raw !== "string" || raw.length > 4096)
    throw Error("Invalid Haunt link.");
  const url = new URL(raw);
  if (
    url.protocol !== "haunt:" ||
    url.hostname !== "open" ||
    !["", "/"].includes(url.pathname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    throw Error("Invalid Haunt link.");
  const server = new URL(url.searchParams.get("server"));
  if (
    server.origin !== url.searchParams.get("server") ||
    server.username ||
    server.password ||
    (server.protocol !== "https:" &&
      !(server.protocol === "http:" && localHTTPHost(server.hostname)))
  )
    throw Error("Invalid server in Haunt link.");
  const channel = url.searchParams.get("channel") || undefined,
    message = url.searchParams.get("message") || undefined;
  for (const value of [channel, message])
    if (
      value &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        value,
      )
    )
      throw Error("Invalid channel or message in Haunt link.");
  if (message && !channel) throw Error("A message link needs a channel.");
  return { server: server.origin, channel, message };
}
function installDeepLinks(app, ipcMain, validateSender) {
  let parent,
    ready = false;
  const queued = [];
  const receive = (raw) => {
    let value;
    try {
      value = parseDeepLink(raw);
    } catch (error) {
      value = { error: error.message };
    }
    if (ready && parent && !parent.isDestroyed())
      parent.webContents.send("links:open", value);
    else {
      queued.push(value);
      if (queued.length > 10) queued.shift();
    }
    if (parent && !parent.isDestroyed()) {
      if (parent.isMinimized()) parent.restore();
      parent.show();
      parent.focus();
    }
  };
  app.on("open-url", (event, url) => {
    event.preventDefault();
    receive(url);
  });
  app.on("second-instance", (_event, argv) => {
    for (const arg of argv) if (arg.startsWith("haunt:")) receive(arg);
  });
  for (const arg of process.argv) if (arg.startsWith("haunt:")) receive(arg);
  ipcMain.handle("links:ready", (event) => {
    validateSender(event);
    ready = true;
    return queued.splice(0);
  });
  ipcMain.handle("links:open", (event, raw) => {
    validateSender(event);
    parseDeepLink(raw);
    receive(raw);
  });
  return (window) => {
    parent = window;
    parent.webContents.on(
      "did-start-navigation",
      (_event, _url, inPlace, mainFrame) => {
        if (!inPlace && mainFrame) ready = false;
      },
    );
    if (app.isPackaged && process.env.HAUNT_DESKTOP_TEST !== "1")
      app.setAsDefaultProtocolClient("haunt");
  };
}
module.exports = { parseDeepLink, installDeepLinks };
