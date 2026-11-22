import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyTilawaCache } from "../src/lib/tilawaRecitation.ts";

function memoryStorage() {
  const m = new Map();
  return {
    async get(k) { return m.get(k) ?? null; },
    async put(k, b) { m.set(k, b); },
    async delete(k) { m.delete(k); },
    async keys() { return [...m.keys()]; },
  };
}

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

test("correct file and correct hash -> checked, not removed", async () => {
  const storage = memoryStorage();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const hash = await sha256(bytes);
  await storage.put("k", bytes);
  const expected = [{ key: "k", bytes: bytes.length, sha256: hash, label: "x" }];
  const report = await verifyTilawaCache(storage, crypto.subtle, expected);
  assert.deepEqual(report.checked, ["k"]);
  assert.deepEqual(report.removed, []);
  assert.equal(report.cryptoAvailable, true);
});

test("correct size but incorrect hash -> removed, not checked", async () => {
  const storage = memoryStorage();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await storage.put("k", bytes);
  const expected = [{ key: "k", bytes: bytes.length, sha256: "0".repeat(64), label: "x" }];
  const report = await verifyTilawaCache(storage, crypto.subtle, expected);
  assert.deepEqual(report.checked, []);
  assert.deepEqual(report.removed, ["k"]);
  assert.equal(await storage.get("k"), null);
});

test("missing crypto.subtle -> throws (no length-only fallback)", async () => {
  const storage = memoryStorage();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await storage.put("k", bytes);
  const expected = [{ key: "k", bytes: bytes.length, sha256: "0".repeat(64), label: "x" }];
  await assert.rejects(() => verifyTilawaCache(storage, null, expected));
});

test("SHA-256 computation failure -> throws", async () => {
  const storage = memoryStorage();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await storage.put("k", bytes);
  const badSubtle = { digest: async () => { throw new Error("boom"); } };
  const expected = [{ key: "k", bytes: bytes.length, sha256: "0".repeat(64), label: "x" }];
  await assert.rejects(() => verifyTilawaCache(storage, badSubtle, expected));
});

test("missing file -> skipped, not removed", async () => {
  const storage = memoryStorage();
  const expected = [{ key: "k", bytes: 4, sha256: "0".repeat(64), label: "x" }];
  const report = await verifyTilawaCache(storage, crypto.subtle, expected);
  assert.deepEqual(report.checked, []);
  assert.deepEqual(report.removed, []);
});

test("interrupted download (size mismatch) -> removed", async () => {
  const storage = memoryStorage();
  const bytes = new Uint8Array([1, 2]); // truncated
  await storage.put("k", bytes);
  const expected = [{ key: "k", bytes: 4, sha256: "0".repeat(64), label: "x" }];
  const report = await verifyTilawaCache(storage, crypto.subtle, expected);
  assert.deepEqual(report.removed, ["k"]);
  assert.equal(await storage.get("k"), null);
});

test("corrupted Quran reference -> removed", async () => {
  const storage = memoryStorage();
  const bytes = new Uint8Array([9, 9, 9]);
  await storage.put("ref", bytes);
  const hash = await sha256(new Uint8Array([1, 2, 3]));
  const expected = [{ key: "ref", bytes: 3, sha256: hash, label: "reference" }];
  const report = await verifyTilawaCache(storage, crypto.subtle, expected);
  assert.deepEqual(report.removed, ["ref"]);
});

test("failed replacement while verified model exists -> bad file removed, good file preserved", async () => {
  const storage = memoryStorage();
  const good = new Uint8Array([1, 2, 3, 4]);
  const goodHash = await sha256(good);
  const bad = new Uint8Array([5, 6, 7, 8]);
  await storage.put("good", good);
  await storage.put("bad", bad);
  const expected = [
    { key: "good", bytes: good.length, sha256: goodHash, label: "good" },
    { key: "bad", bytes: bad.length, sha256: "0".repeat(64), label: "bad" },
  ];
  const report = await verifyTilawaCache(storage, crypto.subtle, expected);
  assert.deepEqual(report.checked, ["good"]);
  assert.deepEqual(report.removed, ["bad"]);
  assert.notEqual(await storage.get("good"), null);
  assert.equal(await storage.get("bad"), null);
});