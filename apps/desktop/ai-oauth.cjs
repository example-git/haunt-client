const http = require("node:http");
const { randomUUID } = require("node:crypto");
const providers = {
  claude: { origin: "https://claude.com", path: "/cai/oauth/authorize" },
  codex: { origin: "https://auth.openai.com", path: "/oauth/authorize" },
  antigravity: {
    origin: "https://accounts.google.com",
    path: "/o/oauth2/auth",
  },
};
class AIOAuth {
  constructor(openExternal) {
    this.openExternal = openExternal;
    this.sessions = new Map();
  }
  async reserve(provider, owner) {
    if (!Object.hasOwn(providers, provider))
      throw Error("Unknown AI integration.");
    for (const [id, session] of this.sessions)
      if (session.owner === owner) this.cancel(id, owner);
    const id = randomUUID();
    const session = { provider, owner, opened: false };
    session.result = new Promise((resolve, reject) => {
      session.resolve = resolve;
      session.reject = reject;
    });
    session.result.catch(() => {});
    this.sessions.set(id, session);
    try {
      if (provider === "antigravity") {
        session.redirect_uri = "https://antigravity.google/oauth-callback";
      } else {
        const path = provider === "codex" ? "/auth/callback" : "/callback";
        session.server = http.createServer((request, response) => {
          const url = new URL(request.url, session.redirect_uri);
          if (request.method !== "GET" || url.pathname !== path) {
            response.writeHead(404).end();
            return;
          }
          if (
            !session.opened ||
            !session.state ||
            url.searchParams.get("state") !== session.state
          ) {
            response
              .writeHead(400, { "Content-Type": "text/plain" })
              .end("Invalid OAuth state.");
            return;
          }
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");
          if (!code && !error) {
            response.writeHead(400).end("Missing authorization code.");
            return;
          }
          response.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          });
          response.end(
            error
              ? "Connection was not completed. Return to Haunt."
              : "Authorization received. Return to Haunt to finish connecting.",
          );
          if (error)
            session.reject(Error("Provider authorization was declined."));
          else session.resolve({ code, state: session.state });
          this.close(id);
        });
        await new Promise((resolve, reject) => {
          session.server.once("error", reject);
          session.server.listen(
            provider === "codex" ? 1455 : 0,
            "127.0.0.1",
            resolve,
          );
        });
        session.redirect_uri = `http://localhost:${session.server.address().port}${path}`;
      }
      session.timer = setTimeout(() => {
        session.reject(Error("AI connection expired. Start connecting again."));
        this.close(id);
      }, 10 * 60_000);
      session.timer.unref?.();
      return { id, redirect_uri: session.redirect_uri };
    } catch (error) {
      this.close(id);
      if (provider === "codex" && error.code === "EADDRINUSE")
        throw Error(
          "Codex connection requires localhost port 1455. Another application is using that port; close its login flow and reconnect.",
        );
      throw error;
    }
  }
  get(id, owner) {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner)
      throw Error("AI connection session is unavailable.");
    return session;
  }
  async launch(id, raw, owner) {
    const session = this.get(id, owner);
    if (session.opened) throw Error("AI connection is already open.");
    const url = new URL(raw);
    const provider = providers[session.provider];
    if (
      url.origin !== provider.origin ||
      url.pathname !== provider.path ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.get("redirect_uri") !== session.redirect_uri ||
      !url.searchParams.get("state")
    )
      throw Error("Invalid provider authorization address.");
    session.state = url.searchParams.get("state");
    session.opened = true;
    try {
      await this.openExternal(url.href);
      if (session.provider === "antigravity") return { paste: true };
      return await session.result;
    } catch (error) {
      this.close(id);
      throw error;
    }
  }
  cancel(id, owner) {
    const session = this.get(id, owner);
    session.reject(Error("AI connection cancelled."));
    this.close(id);
  }
  close(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    clearTimeout(session.timer);
    session.server?.close();
    this.sessions.delete(id);
  }
  shutdown() {
    for (const [id, session] of this.sessions) this.cancel(id, session.owner);
  }
}
function installAIOAuth(app, ipcMain, shell, validateSender) {
  const oauth = new AIOAuth((url) => shell.openExternal(url));
  ipcMain.handle("ai-oauth:reserve", (event, provider) => {
    validateSender(event);
    return oauth.reserve(provider, event.sender.id);
  });
  ipcMain.handle("ai-oauth:launch", (event, id, url) => {
    validateSender(event);
    return oauth.launch(id, url, event.sender.id);
  });
  ipcMain.handle("ai-oauth:cancel", (event, id) => {
    validateSender(event);
    return oauth.cancel(id, event.sender.id);
  });
  app.on("before-quit", () => oauth.shutdown());
  return oauth;
}
module.exports = { AIOAuth, installAIOAuth };
