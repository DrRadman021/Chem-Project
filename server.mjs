import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { exec } from "node:child_process";

const root = import.meta.dirname;
const port = 8123;
const types = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json"
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (p === "/") p = "/index (12).html";
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}/`;
  console.log("Rachem is running at " + url);
  console.log("Keep this window open while you use the site.");
  console.log("Close this window to stop the server.");
  exec(`start "" "${url}"`);
});
