// Static server for the offline recitation verification.
// Serves the APK's packaged web root plus the packaged offline bundle, so the
// test exercises exactly the bytes that ship inside the APK.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? ".");
const WWW = join(ROOT, "packaging/android/app/src/main/assets/www");
const OFFLINE = join(ROOT, "packaging/android/app/src/main/assets/offline");
const FIXTURES = resolve(process.argv[3] ?? "/tmp/fixtures");
const PORT = Number(process.argv[4] ?? 8788);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json",
};

const requested = [];

function resolvePath(urlPath) {
  const path = decodeURIComponent(urlPath.split("?")[0]);
  if (path.startsWith("/offline/")) return join(OFFLINE, normalize(path.slice("/offline".length)));
  if (path.startsWith("/fixtures/")) return join(FIXTURES, normalize(path.slice("/fixtures".length)));
  if (path.startsWith("/harness/")) return join(resolve("tests/offline"), normalize(path.slice("/harness".length)));
  return join(WWW, normalize(path));
}

const server = createServer(async (request, response) => {
  const entry = { method: request.method, url: request.url, host: request.headers.host ?? null };
  requested.push(entry);
  try {
    let target = resolvePath(request.url ?? "/");
    try {
      const info = await stat(target);
      if (info.isDirectory()) target = join(target, "index.html");
    } catch {
      target = join(WWW, "index.html");
    }
    const body = await readFile(target);
    response.writeHead(200, {
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end(`not found: ${error.message}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ listening: `http://127.0.0.1:${PORT}`, root: ROOT }));
});

process.on("SIGUSR2", () => {
  console.log(JSON.stringify({ requests: requested }));
});
