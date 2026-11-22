#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return { hash: hash.digest("hex"), size: data.length };
}

function walk(dir, base) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, base));
    } else if (entry.isFile()) {
      const rel = path.relative(base, full).replace(/\\/g, "/");
      out.push({ path: rel, full });
    }
  }
  return out;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      args[key] = val;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = args.root || ".";
const baseUrl = args["base-url"] || "/assets";
const versionName = args["version-name"] || "0.0.0";
const versionCode = Number(args["version-code"] || 0);
const previousPath = args.previous || null;
const outPath = args.out || "release-manifest.json";

const files = walk(path.resolve(root), path.resolve(root)).map(({ path: rel, full }) => {
  const { hash, size } = sha256File(full);
  return { path: rel, bytes: size, sha256: hash };
});

let previous = null;
if (previousPath && fs.existsSync(previousPath)) {
  try { previous = JSON.parse(fs.readFileSync(previousPath, "utf8")); } catch { previous = null; }
}

const prevMap = new Map((previous?.files || []).map((f) => [f.path, f]));
const added = [];
const modified = [];
const unchanged = [];
const deleted = [];
for (const f of files) {
  const p = prevMap.get(f.path);
  if (!p) added.push(f.path);
  else if (p.sha256 !== f.sha256 || p.bytes !== f.bytes) modified.push(f.path);
  else unchanged.push(f.path);
}
for (const p of previous?.files || []) {
  if (!files.find((f) => f.path === p.path)) deleted.push(p.path);
}

const manifest = {
  schema: 1,
  versionName,
  versionCode,
  releaseDate: new Date().toISOString().slice(0, 10),
  baseUrl,
  files,
  deletedFiles: deleted,
  addedFiles: added,
  modifiedFiles: modified,
  unchangedFiles: unchanged,
  deletedReport: deleted,
};

fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Generated manifest: ${files.length} files -> ${outPath}`);
console.log(`added=${added.length} modified=${modified.length} unchanged=${unchanged.length} deleted=${deleted.length}`);
