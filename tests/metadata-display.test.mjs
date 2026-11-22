import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function extractShortDescription(meta) {
  const sd = meta?.shortDescription ?? meta?.releaseNotes?.ar?.shortDescription ?? meta?.releaseNotes?.en?.shortDescription;
  return typeof sd === "string" ? sd : (sd?.ar || sd?.en || "");
}

test("android metadata short description is extractable", () => {
  const meta = JSON.parse(fs.readFileSync(path.join(root, "public/updates/android.json"), "utf8"));
  const note = extractShortDescription(meta);
  assert.ok(note.length > 0);
});

test("release-notes file has at least one release", () => {
  const notes = JSON.parse(fs.readFileSync(path.join(root, "public/updates/release-notes.json"), "utf8"));
  assert.equal(notes.schemaVersion, 1);
  assert.ok(Array.isArray(notes.releases) && notes.releases.length > 0);
});
