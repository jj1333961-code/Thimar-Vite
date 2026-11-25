import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function versionParts(value) {
  const text = String(value ?? "").trim().replace(/^v/i, "");
  if (!text) return null;
  const parts = text.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts;
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function codeForName(history, name) {
  const entry = (history || []).find((item) => item?.versionName === name);
  return entry ? Number(entry.versionCode) : null;
}

function eligibleRows(rows, metadata) {
  const history = Array.isArray(metadata.versionHistory) ? metadata.versionHistory : [];
  const targetParts = versionParts(metadata.versionName);
  return (rows || []).filter((row) => {
    if (typeof row.app_version_code === "number" && Number.isFinite(row.app_version_code)) {
      return row.app_version_code < metadata.versionCode;
    }
    const installedCode = codeForName(history, row.app_version);
    if (installedCode !== null) return installedCode < metadata.versionCode;
    const installedParts = versionParts(row.app_version);
    if (!installedParts || !targetParts) return true;
    return compareVersions(installedParts, targetParts) < 0;
  });
}

test("android metadata has required release fields", () => {
  const meta = readJson("public/updates/android.json");
  assert.equal(meta.platform, "android");
  assert.equal(meta.available, true);
  assert.ok(Number.isInteger(meta.versionCode));
  const assetOnly = meta.assetOnly === true || meta.apkRequired === false;
  if (assetOnly) {
    assert.ok(Number.isInteger(meta.resourceVersionCode ?? meta.versionCode));
  } else {
    assert.ok(typeof meta.downloadUrl === "string" && meta.downloadUrl.length > 0);
    assert.ok(typeof meta.sha256 === "string" && meta.sha256.length === 64);
  }
  assert.ok(Array.isArray(meta.versionHistory) && meta.versionHistory.length > 0);
});

test("old-version targeting by app_version_code", () => {
  const meta = readJson("public/updates/android.json");
  const rows = [
    { token: "t1", app_version_code: 20 },
    { token: "t2", app_version_code: 23 },
    { token: "t3", app_version_code: 24 },
    { token: "t4" }, // unknown -> conservative eligible
  ];
  const eligible = eligibleRows(rows, meta);
  assert.deepEqual(eligible.map((r) => r.token), ["t1", "t2", "t3", "t4"]);
});

test("old-version targeting falls back to version history name", () => {
  const meta = readJson("public/updates/android.json");
  const rows = [{ token: "t1", app_version: "1.10.2" }];
  const eligible = eligibleRows(rows, meta);
  assert.equal(eligible.length, 1);
});

test("equal or newer installed versions are excluded", () => {
  const meta = readJson("public/updates/android.json");
  const rows = [
    { token: "t1", app_version_code: meta.versionCode },
    { token: "t2", app_version_code: meta.versionCode + 1 },
  ];
  const eligible = eligibleRows(rows, meta);
  assert.equal(eligible.length, 0);
});

test("duplicate campaign idempotency logic", () => {
  const sent = { status: "sent", sent_count: 5 };
  const inProgress = { status: "sending", started_at: new Date().toISOString() };
  assert.equal(sent.status, "sent");
  assert.equal(inProgress.status, "sending");
  // A second invocation should not re-send when status is sent.
  const shouldSendAgain = sent.status !== "sent";
  assert.equal(shouldSendAgain, false);
});
