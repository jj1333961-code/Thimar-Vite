import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getUpdatePlan,
  compareManifests,
} from "../src/lib/differentialUpdate.ts";

function manifest(versionName, versionCode, files, deleted = [], notes = null) {
  return {
    schema: 1,
    versionName,
    versionCode,
    baseUrl: "/assets",
    files,
    deletedFiles: deleted,
    releaseNotes: notes,
  };
}

const fA1 = { path: "A.js", bytes: 3, sha256: "a1" };
const fA2 = { path: "A.js", bytes: 4, sha256: "a2" };
const fA3 = { path: "A.js", bytes: 5, sha256: "a3" };
const fB = { path: "B.js", bytes: 2, sha256: "b" };
const fC1 = { path: "C.js", bytes: 1, sha256: "c1" };
const fC0 = { path: "C.js", bytes: 1, sha256: "c0" };

const releases = [
  manifest("1.8.1", 10, [fC0], [], null),
  manifest("1.9.1", 11, [fA1, fB, fC1], [], { ar: { features: ["A added", "B added", "C modified"] }, en: { features: ["A added", "B added", "C modified"] } }),
  manifest("1.10.1", 12, [fA2, fC1], ["B.js"], { ar: { features: ["A modified", "B deleted"] }, en: { features: ["A modified", "B deleted"] } }),
  manifest("1.11.1", 13, [fA2, fC1], [], { ar: { features: ["C modified"] }, en: { features: ["C modified"] } }),
  manifest("1.11.3", 14, [fA3, fC0], ["B.js"], { ar: { features: ["A final", "C restored"] }, en: { features: ["A final", "C restored"] } }),
];

test("cumulative 1.8.1 -> 1.11.3 downloads only final A, not B, not restored C", () => {
  const installedManifest = { versionName: "1.8.1", versionCode: 10, files: { "C.js": fC0 } };
  const latest = releases[releases.length - 1];
  const plan = getUpdatePlan("1.8.1", latest, installedManifest, { releases });
  assert.deepEqual(plan.filesToDownload.map((f) => f.path), ["A.js"]);
  const a = plan.filesToDownload.find((f) => f.path === "A.js");
  assert.equal(a.sha256, "a3");
  assert.equal(plan.deleted.includes("B.js"), false);
});

test("1.9.1 -> 1.11.3 downloads final A and excludes B deletion if installed had B", () => {
  const installedManifest = {
    versionName: "1.9.1",
    versionCode: 11,
    files: { "A.js": fA1, "B.js": fB, "C.js": fC1 },
  };
  const latest = releases[releases.length - 1];
  const plan = getUpdatePlan(11, latest, installedManifest, { releases });
  assert.deepEqual(plan.filesToDownload.map((f) => f.path).sort(), ["A.js", "C.js"]);
  assert.deepEqual(plan.deleted, ["B.js"]);
});

test("1.11.1 -> 1.11.3 downloads only A final; C already matches final hash", () => {
  const installedManifest = {
    versionName: "1.11.1",
    versionCode: 13,
    files: { "A.js": fA2, "C.js": fC0 }, // C restored already locally
  };
  const latest = releases[releases.length - 1];
  const plan = getUpdatePlan("1.11.1", latest, installedManifest, { releases });
  assert.deepEqual(plan.filesToDownload.map((f) => f.path), ["A.js"]);
  assert.deepEqual(plan.unchanged, ["C.js"]);
});

test("1.11.3 -> 1.11.3 downloads nothing", () => {
  const installedManifest = {
    versionName: "1.11.3",
    versionCode: 14,
    files: { "A.js": fA3, "C.js": fC0 },
  };
  const latest = releases[releases.length - 1];
  const plan = getUpdatePlan("1.11.3", latest, installedManifest, { releases });
  assert.equal(plan.filesToDownload.length, 0);
});

test("missing and corrupted local files are included", () => {
  const installedManifest = {
    versionName: "1.8.1",
    versionCode: 10,
    files: { "A.js": { path: "A.js", bytes: 5, sha256: "a3" }, "C.js": fC0 },
    actualHashes: { "A.js": { bytes: 1, sha256: "corrupt" } },
  };
  const latest = releases[releases.length - 1];
  const plan = getUpdatePlan(10, latest, installedManifest, { releases });
  assert.deepEqual(plan.corrupted, ["A.js"]);
  assert.equal(plan.filesToDownload.some((f) => f.path === "A.js"), true);
});

test("cumulative release notes grouped by version and accumulated", () => {
  const installedManifest = { versionName: "1.8.1", versionCode: 10, files: {} };
  const latest = releases[releases.length - 1];
  const plan = getUpdatePlan("1.8.1", latest, installedManifest, { releases });
  assert.equal(plan.releaseNotesByVersion.length, 4);
  assert.deepEqual(plan.releaseNotesByVersion.map((r) => r.versionName), ["1.9.1", "1.10.1", "1.11.1", "1.11.3"]);
  assert.ok(plan.cumulativeReleaseNotes.en.features.includes("A added"));
  assert.ok(plan.cumulativeReleaseNotes.en.features.includes("A final"));
  assert.ok(plan.cumulativeReleaseNotes.en.features.includes("C restored"));
});

test("release history can be provided as versions", () => {
  const installedManifest = { versionName: "1.8.1", versionCode: 10, files: {} };
  const latest = releases[releases.length - 1];
  const plan = getUpdatePlan("1.8.1", latest, installedManifest, { versions: releases });
  assert.equal(plan.filesToDownload.length, 2);
});

test("loads installed manifest from history when missing", () => {
  const latest = releases[releases.length - 1];
  const plan = getUpdatePlan("1.9.1", latest, null, { releases });
  // installed 1.9.1 loaded from history: A1,B,C1; final A/C change, B deleted
  assert.deepEqual(plan.filesToDownload.map((f) => f.path).sort(), ["A.js", "C.js"]);
  assert.deepEqual(plan.deleted, ["B.js"]);
});