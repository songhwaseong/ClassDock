/* Minimal static server for browser regression tests. It intentionally exposes
 * only the application HTML and its bundled source/vendor assets. */
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.MN_E2E_PORT || 4173);
const mime = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".ttf": "font/ttf", ".wasm": "application/wasm", ".whl": "application/octet-stream"
};

function targetFor(urlText) {
  const pathname = decodeURIComponent(new URL(urlText, "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "manneung-classroom.html" : pathname.replace(/^\/+/, "");
  if (!/^(?:manneung-classroom\.html|src\/(?:js\/|)|vendor\/)/.test(relative)) return null;
  const target = path.resolve(root, relative);
  return target.startsWith(root + path.sep) || target === root ? target : null;
}

http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  const target = targetFor(req.url || "/");
  if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); return res.end("Not found"); }
  const type = mime[path.extname(target).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(target).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`E2E static server: http://127.0.0.1:${port}`));
