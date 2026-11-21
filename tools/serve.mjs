// Jednoduchý lokální server pro dist/ (http://localhost:8080) – na localhost lze aplikaci i nainstalovat.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.argv[2] || "dist"), port = +(process.argv[3] || 8080);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".map": "application/json" };
http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p); if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
  try { const b = await fs.readFile(f); res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream", "cache-control": "no-cache" }); res.end(b); }
  catch { res.writeHead(404).end("not found"); }
}).listen(port, "127.0.0.1", () => console.log(`http://localhost:${port}/  (${root})`));
