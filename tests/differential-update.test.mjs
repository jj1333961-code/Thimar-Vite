import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareManifests,
  requiredBytes,
  isProtectedPath,
} from "../src/lib/differentialUpdate.ts";

function makeRemote(files, deleted = []) {
  return { schema: 1, versionName: "2.0.0", versionCode: 5, baseUrl: "/assets", files, deletedFiles: deleted };
}

test("unchanged files are not downloaded", () => {
  const f = { path: "a.js", bytes: 10, sha256: "h" };
  const local = { versionName: "1", versionCode: 4, files: { "a.js": { path: "a.js", bytes: 10, sha256: "h" } } };
  const remote = makeRemote([f]);
  const diff = compareManifests(local, remote);
  assert.deepEqual(diff.unchanged, ["a.js"]);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.modified.length, 0);
});

test("newly added files are detected", () => {
  const f = { path: "b.js", bytes: 5, sha256: "x" };
  const local = { versionName: "1", versionCode: 4, files: {} };
  const remote = makeRemote([f]);
  const diff = compareManifests(local, remote);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].path, "b.js");
});

test("modified files detected by hash/size", () => {
  const f = { path: "a.js", bytes: 12, sha256: "new" };
  const local = { versionName: "1", versionCode: 4, files: { "a.js": { path: "a.js", bytes: 10, sha256: "old" } } };
  const remote = makeRemote([f]);
  const diff = compareManifests(local, remote);
  assert.equal(diff.modified.length, 1);
  assert.equal(diff.modified[0].path, "a.js");
});

test("deleted only when listed and not protected", () => {
  const local = { versionName: "1", versionCode: 4, files: { "old.js": { path: "old.js", bytes: 1, sha256: "h" }, "user-data/x": { path: "user-data/x", bytes: 1, sha256: "h" } } };
  const remote = makeRemote([], ["old.js", "user-data/x"]);
  const diff = compareManifests(local, remote);
  assert.deepEqual(diff.deleted, ["old.js"]);
});

test("protected path detection", () => {
  assert.equal(isProtectedPath("user-data/foo"), true);
  assert.equal(isProtectedPath("assets/app.js"), false);
});

test("corruption detected via actualHashes", () => {
  const f = { path: "a.js", bytes: 10, sha256: "h" };
  const local = { versionName: "1", versionCode: 4, files: { "a.js": { path: "a.js", bytes: 10, sha256: "h" } } };
  const remote = makeRemote([f]);
  const diff = compareManifests(local, remote, { "a.js": { bytes: 9, sha256: "corrupt" } });
  assert.deepEqual(diff.corrupted, ["a.js"]);
});

test("requiredBytes sums added+modified+corrupted", () => {
  const f1 = { path: "a.js", bytes: 10, sha256: "h" };
  const f2 = { path: "b.js", bytes: 5, sha256: "x" };
  const local = { versionName: "1", versionCode: 4, files: { "a.js": { path: "a.js", bytes: 10, sha256: "old" } } };
  const remote = makeRemote([f1, f2], []);
  const diff = compareManifests(local, remote);
  assert.equal(requiredBytes(diff, remote), 15);
});
