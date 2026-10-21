// Protocol fixture for native-client delivery checks. No renderer state or
// desktop badge API is injected: messages/read state travel over HTTP/WebSocket.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { wsServer: WebSocketServer } = require(
  path.join(
    path.dirname(require.resolve("playwright-core/package.json")),
    "lib/utilsBundle.js",
  ),
);

export async function badgeServerFixture() {
  const instance = randomUUID(),
    general = randomUUID(),
    other = randomUUID(),
    dm = randomUUID();
  const owner = { id: randomUUID(), username: "owner", display_name: "Owner" };
  const alice = { id: randomUUID(), username: "alice", display_name: "Alice" };
  const channels = [
    { id: general, name: "general", kind: "text", position: 0 },
    { id: other, name: "quiet", kind: "text", position: 1 },
  ];
  const conversations = [{ id: dm, kind: "dm", members: [owner.id, alice.id] }];
  let cursor = 1,
    origin;
  const messages = new Map([general, other, dm].map((id) => [id, []]));
  const states = new Map(
    [general, other, dm].map((id) => [
      id,
      {
        conversation_id: id,
        kind: id === dm ? "dm" : "text",
        read_seq: 0,
        last_seq: 0,
        unread_count: 0,
        mention_count: 0,
        event_cursor: cursor,
      },
    ]),
  );
  const unexpected = [],
    requests = [];
  const info = () => ({
    instance_id: instance,
    api_version: "v1",
    name: "Badge delivery",
    public_url: origin,
    capabilities: ["events.account_feed"],
    limits: {},
  });
  const broadcast = (value) => {
    for (const socket of sockets.clients)
      if (socket.watching) socket.send(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.setHeader("Content-Type", "application/json");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const pathname = new URL(req.url, origin).pathname;
    if (
      req.method === "GET" &&
      !pathname.startsWith("/api/") &&
      pathname !== "/readyz"
    ) {
      const root = path.resolve("dist");
      const filename = path.resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!filename.startsWith(root + path.sep)) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const bytes = await fs.readFile(filename);
        const type =
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".wasm": "application/wasm",
          }[path.extname(filename)] || "application/octet-stream";
        res.setHeader("Content-Type", type);
        res.end(bytes);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    const body = [];
    for await (const chunk of req) body.push(chunk);
    const input = body.length ? JSON.parse(Buffer.concat(body).toString()) : {};
    const respond = (value, status = 200) => {
      res.writeHead(status);
      res.end(JSON.stringify(value));
    };
    requests.push({ method: req.method, pathname });
    if (pathname === "/api/v1/instance") return respond(info());
    if (pathname === "/readyz") return respond({ status: "ok" });
    if (pathname === "/api/v1/auth/login")
      return respond({
        instance_id: instance,
        token: "native-badge-fixture",
        user: owner,
        session: { id: randomUUID(), expires_at: "2099-01-01T00:00:00Z" },
      });
    if (pathname === "/api/v1/me")
      return respond({ user: owner, permissions: 0, role_position: 0 });
    if (pathname === "/api/v1/channels") return respond({ channels });
    if (pathname === "/api/v1/categories") return respond({ categories: [] });
    if (pathname === "/api/v1/conversations") return respond({ conversations });
    if (pathname === "/api/v1/users") return respond({ users: [owner, alice] });
    if (pathname === "/api/v1/read-state")
      return respond({ states: [...states.values()] });
    const match = pathname.match(
      /^\/api\/v1\/conversations\/([^/]+)\/(messages|read)$/,
    );
    if (match && states.has(match[1])) {
      const id = match[1],
        state = states.get(id);
      if (match[2] === "messages")
        return respond({ messages: messages.get(id), event_cursor: cursor });
      if (req.method === "PUT") {
        state.read_seq = Math.max(state.read_seq, input.seq);
        const unread = messages
          .get(id)
          .filter((m) => m.seq > state.read_seq && m.author_id !== owner.id);
        state.unread_count = unread.length;
        state.mention_count = unread.filter(
          (m) => m.mention_user_ids.length,
        ).length;
        state.event_cursor = ++cursor;
        broadcast({ type: "read.state", states: [state] });
      }
      return respond(state);
    }
    if (pathname === "/api/v1/audio-plugins") return respond({ plugins: [] });
    if (pathname === "/api/v1/server-extensions")
      return respond({ extensions: [] });
    if (pathname === "/api/v1/auth/logout") return respond({}, 204);
    unexpected.push(`${req.method} ${pathname}`);
    respond({ error: "not_found" }, 404);
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket) =>
    socket.on("message", (data) => {
      const command = JSON.parse(String(data));
      if (command.type === "authenticate")
        socket.send(
          JSON.stringify({
            type: "ready",
            instance_id: instance,
            event_cursor: cursor,
          }),
        );
      else if (command.type === "events.watch") {
        socket.watching = true;
        socket.send(
          JSON.stringify({ type: "events.watching", event_cursor: cursor }),
        );
      } else unexpected.push(`socket ${command.type}`);
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    general,
    other,
    dm,
    requests,
    unexpected,
    send(id, mention = false, { body, own = false } = {}) {
      const rows = messages.get(id),
        state = states.get(id);
      const message = {
        id: randomUUID(),
        conversation_id: id,
        author_id: own ? owner.id : alice.id,
        request_id: randomUUID(),
        seq: rows.length + 1,
        body:
          body ?? (mention ? "@owner native badge check" : "Incoming message"),
        created_at: new Date().toISOString(),
        mention_user_ids: mention ? [owner.id] : [],
        attachment_ids: [],
        deleted: false,
      };
      rows.push(message);
      state.last_seq = message.seq;
      if (!own) state.unread_count++;
      if (mention && !own) state.mention_count++;
      state.event_cursor = ++cursor;
      broadcast({
        type: "message.created",
        id: cursor,
        conversation_id: id,
        data: message,
      });
      broadcast({ type: "read.state", states: [state] });
      return message;
    },
    async stop() {
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
