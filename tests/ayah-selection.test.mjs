import test from "node:test";
import assert from "node:assert/strict";
import { selectionAfterTap } from "../src/lib/ayahSelectionCore.mjs";

/* فهرس اصطناعي: سورة ١ بسبع آيات (١..٧)، وسورة ٢ بخمس آيات (٨..١٢). */
const surahs = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7],
  [2, 1], [2, 2], [2, 3], [2, 4], [2, 5],
];
const keysByGlobal = [""];
const globalOf = new Map();
surahs.forEach(([surah, ayah], index) => {
  const global = index + 1;
  const key = `${surah}:${ayah}`;
  keysByGlobal[global] = key;
  globalOf.set(key, global);
});

const tap = (current, tapped) =>
  selectionAfterTap({ keysByGlobal, globalOf, current, tapped });

test("اختيار آية واحدة ثم آية لاحقة يحدد النطاق كاملًا", () => {
  assert.deepEqual(tap(["1:1"], "2:3"), [
    "1:1", "1:2", "1:3", "1:4", "1:5", "1:6", "1:7", "2:1", "2:2", "2:3",
  ]);
});

test("الضغط داخل المجموعة يحتفظ بما قبل الآية المضغوطة فقط", () => {
  const group = keysByGlobal.slice(1, 11); // ١..١٠
  assert.deepEqual(tap(group, "1:7"), ["1:1", "1:2", "1:3", "1:4", "1:5", "1:6"]);
});

test("المثال الثاني: ١–٤ ثم الضغط على ٣ يعطي ١–٢", () => {
  const group = keysByGlobal.slice(1, 5);
  assert.deepEqual(tap(group, "1:3"), ["1:1", "1:2"]);
});

test("الضغط على أول آية في المجموعة يلغي التحديد كله", () => {
  const group = keysByGlobal.slice(1, 5);
  assert.deepEqual(tap(group, "1:1"), []);
});

test("الضغط على آية مفردة محددة يلغي تحديدها", () => {
  assert.deepEqual(tap(["2:2"], "2:2"), []);
});

test("امتداد التحديد لآية أبعد من نهاية المجموعة", () => {
  const group = ["1:3", "1:4", "1:5"];
  assert.deepEqual(tap(group, "2:2"), ["1:3", "1:4", "1:5", "1:6", "1:7", "2:1", "2:2"]);
});

test("التحديد لا يختلط بين أرقام الآيات المتشابهة في سور مختلفة", () => {
  const group = tap(["1:2"], "2:2");
  assert.deepEqual(group, ["1:2", "1:3", "1:4", "1:5", "1:6", "1:7", "2:1", "2:2"]);
  assert.deepEqual(tap(group, "2:1"), [
    "1:2", "1:3", "1:4", "1:5", "1:6", "1:7",
  ]);
});

test("الضغط على آية غير موجودة في الفهرس لا يغيّر التحديد", () => {
  assert.deepEqual(tap(["1:1", "1:2"], "9:9"), ["1:1", "1:2"]);
});
