/* Development-only static file server with HTTP Range (byte-range) support.
   Used for local testing of the flipbook (video seeking needs 206 responses).
   NOT part of the deployed site — the project remains a pure static site. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[3] || 8137);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    let st;
    try {
      st = fs.statSync(file);
      if (st.isDirectory()) {
        st = fs.statSync(path.join(file, "index.html"));
      }
    } catch {
      res.writeHead(404).end("not found");
      return;
    }
    const target = st.isDirectory() ? path.join(file, "index.html") : file;
    const size = st.size;
    const type = MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range;
    const lastMod = st.mtime.toUTCString();
    const common = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      // Validate-on-reuse: lets the two-stage preloader's warm HTTP cache behave
      // like production (Vercel serves ETags) instead of refetching everything.
      "Cache-Control": "no-cache",
      "Last-Modified": lastMod,
      "Access-Control-Allow-Origin": "*",
    };
    const ims = req.headers["if-modified-since"];
    if (ims && new Date(ims).getTime() >= Math.floor(st.mtime.getTime() / 1000) * 1000) {
      res.writeHead(304, common).end();
      return;
    }
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m && (m[1] !== "" || m[2] !== "")) {
        let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
        let end = m[1] === "" ? size - 1 : m[2] === "" ? size - 1 : Number(m[2]);
        if (start <= end && start < size) {
          end = Math.min(end, size - 1);
          res.writeHead(206, {
            ...common,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": end - start + 1,
          });
          if (req.method === "HEAD") return void res.end();
          fs.createReadStream(target, { start, end }).pipe(res);
          return;
        }
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
    }
    res.writeHead(200, { ...common, "Content-Length": size });
    if (req.method === "HEAD") return void res.end();
    fs.createReadStream(target).pipe(res);
  } catch (err) {
    res.writeHead(500).end(String(err && err.message));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dev-server] serving ${ROOT} at http://127.0.0.1:${PORT}/ (Range enabled)`);
});
