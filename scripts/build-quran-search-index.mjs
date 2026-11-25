#!/usr/bin/env node
/**
 * يبني فهرس بحث القرآن المضمَّن مع التطبيق: النص العثماني + نص مطبَّع للبحث.
 * يُشغَّل مرة عند تحديث نص المصحف: node scripts/build-quran-search-index.mjs
 *
 * الصيغة: [[السورة، الآية، الرقم العام، الجزء، الصفحة، النص المطبَّع، النص العثماني], ...]
 * التطبيع مطابق تمامًا لـ buildNormalized في الواجهة، حتى تُظلَّل نتائج البحث بدقة.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pagesPath = resolve(root, "public/quran/pages.json");
const textPath = resolve(root, "public/quran/hafs/text.json.gz");
const outPath = resolve(root, "public/quran/search-index.json");

if (!existsSync(pagesPath) || !existsSync(textPath)) {
  console.error("بيانات المصحف غير موجودة: pages.json أو hafs/text.json.gz");
  process.exit(1);
}

const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/;
const LETTER = /[\u0621-\u064Aa-z0-9]/;
const SEPARATOR = /[\s،؛.,:!?؟\-–—_"'«»()[\]{}]+/;

function normalize(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const raw = text[i];
    if (DIACRITICS.test(raw)) continue;
    let ch = raw;
    if (ch === "أ" || ch === "إ" || ch === "آ" || ch === "ٱ") ch = "ا";
    else if (ch === "ؤ") ch = "و";
    else if (ch === "ئ" || ch === "ى") ch = "ي";
    else if (ch === "ة") ch = "ه";
    if (SEPARATOR.test(raw) || !LETTER.test(ch)) {
      if (out && !out.endsWith(" ")) out += " ";
      continue;
    }
    out += ch.toLowerCase();
  }
  return out.trim();
}

const { pages } = JSON.parse(readFileSync(pagesPath, "utf8"));
const texts = JSON.parse(gunzipSync(readFileSync(textPath)));
const ayahs = [];

for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
  for (const [surah, ayah, global, juz] of pages[pageIndex]) {
    const text = texts[`${surah}:${ayah}`] ?? "";
    ayahs.push([surah, ayah, global, juz, pageIndex + 1, normalize(text), text]);
  }
}

ayahs.sort((first, second) => first[2] - second[2]);
const payload = { v: 1, ayahs };
writeFileSync(outPath, JSON.stringify(payload));
console.log(
  `فهرس البحث: ${ayahs.length} آية، ${(Buffer.byteLength(JSON.stringify(payload)) / 1024 / 1024).toFixed(2)} م.ب → ${outPath}`,
);
