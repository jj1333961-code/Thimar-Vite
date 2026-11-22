import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFLINE_PACKAGES, packageById, isVersionCompatible } from "../src/lib/offlinePackage.ts";

test("three packages defined", () => {
  assert.equal(OFFLINE_PACKAGES.length, 3);
  const ids = OFFLINE_PACKAGES.map((p) => p.id);
  assert.deepEqual(ids, ["recitation-lite", "quran-reading", "recitation-advanced"]);
});

test("recitation-lite includes lite model and wasm", () => {
  const p = packageById("recitation-lite");
  assert.ok(p);
  const paths = p.files.map((f) => f.path);
  assert.ok(paths.includes("v1/models/spliced-clean-lite/1-int8/model.onnx"));
  assert.ok(paths.includes("v1/runtime/ort/ort-wasm-simd-threaded.jsep.wasm"));
  assert.ok(p.totalBytes > 0);
});

test("quran-reading total > 0 and advanced has full model", () => {
  assert.ok(packageById("quran-reading").totalBytes > 0);
  const adv = packageById("recitation-advanced");
  assert.ok(adv.files.some((f) => f.path.includes("spliced-clean/1-int8/model.onnx")));
});

test("version compatibility", () => {
  const p = packageById("recitation-lite");
  assert.equal(isVersionCompatible(p, 24), true);
  assert.equal(isVersionCompatible(p, 23), false);
  assert.equal(isVersionCompatible(p, null), true);
});

test("recitation-lite total matches sum of files", () => {
  const p = packageById("recitation-lite");
  const sum = p.files.reduce((a, f) => a + f.bytes, 0);
  assert.equal(p.totalBytes, sum);
});
