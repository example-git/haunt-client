import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
export const contentSecurityPolicy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src https: wss: http: ws:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src https://www.youtube-nocookie.com; form-action 'none'";
export async function serveBuild(port = 5173, host = "127.0.0.1") {
  const root = path.resolve("dist");
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const filename = path.resolve(
        root,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (
        !filename.startsWith(root + path.sep) ||
        !["GET", "HEAD"].includes(req.method)
      ) {
        res.writeHead(403).end();
        return;
      }
      const data = await fs.readFile(filename);
      const type =
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".json": "application/json",
          ".wasm": "application/wasm",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".webmanifest": "application/manifest+json",
          ".ico": "image/x-icon",
        }[path.extname(filename)] ?? "application/octet-stream";
      res
        .writeHead(200, {
          "Content-Type": type,
          "Content-Security-Policy": contentSecurityPolicy,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        })
        .end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return server;
}
