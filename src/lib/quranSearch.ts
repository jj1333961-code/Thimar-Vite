/*
 * بحث القرآن: فهرس مطبَّع مسبقًا ومضمَّن مع التطبيق (public/quran/search-index.json).
 * يفتح البحث فورًا بلا تجهيز ثقيل على الواجهة، ويمكن الاقتصار على أول صفحة من
 * النتائج بدل بناء آلاف العناصر في كل حرف.
 */
import { loadHafsPages, loadHafsText } from "./mushafText";
import { surahNameOf } from "./quranIndex";

export type QuranSearchHit = {
  /** الرقم العام للآية ١..٦٢٣٦ */
  number: number;
  text: string;
  norm: string;
  numberInSurah: number;
  surah: { number: number; name: string };
  page: number;
  juz: number;
};

type PackedAyah = [number, number, number, number, number, string, string];

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
const INDEX_URL = `${BASE}quran/search-index.json`;
const EXPECTED_AYAHS = 6236;

const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/;
const LETTER = /[\u0621-\u064Aa-z0-9]/;
const SEPARATOR = /[\s،؛.,:!?؟\-–—_"'«»()[\]{}]+/;

/** يزيل التشكيل ويوحّد الحروف، مع خريطة مواضع لربط نتيجة البحث بالنص الأصلي. */
export function buildNormalized(text: string): { n: string; map: number[] } {
  let n = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const raw = text[i];
    if (DIACRITICS.test(raw)) continue;
    let ch = raw;
    if (ch === "أ" || ch === "إ" || ch === "آ" || ch === "ٱ") ch = "ا";
    else if (ch === "ؤ") ch = "و";
    else if (ch === "ئ" || ch === "ى") ch = "ي";
    else if (ch === "ة") ch = "ه";
    if (SEPARATOR.test(raw) || !LETTER.test(ch)) {
      if (n && !n.endsWith(" ")) {
        n += " ";
        map.push(i);
      }
      continue;
    }
    n += ch.toLowerCase();
    map.push(i);
  }
  if (n.endsWith(" ")) {
    n = n.slice(0, -1);
    map.pop();
  }
  return { n, map };
}

/** تطبيع نص البحث دون بناء خريطة المواضع (أسرع للاستعلامات والفلترة). */
export function normalizeQuery(input: string): string {
  let n = "";
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i];
    if (DIACRITICS.test(raw)) continue;
    let ch = raw;
    if (ch === "أ" || ch === "إ" || ch === "آ" || ch === "ٱ") ch = "ا";
    else if (ch === "ؤ") ch = "و";
    else if (ch === "ئ" || ch === "ى") ch = "ي";
    else if (ch === "ة") ch = "ه";
    if (SEPARATOR.test(raw) || !LETTER.test(ch)) {
      if (n && !n.endsWith(" ")) n += " ";
      continue;
    }
    n += ch.toLowerCase();
  }
  return n.trim();
}

/** نطاق أول تطابق للكلمة/العبارة داخل النص المطبَّع. */
export function matchRange(hay: string, needle: string): { start: number; end: number } | null {
  if (!needle) return null;
  const at = hay.indexOf(needle);
  if (at < 0) return null;
  return { start: at, end: at + needle.length };
}

function packedToHit(row: PackedAyah): QuranSearchHit {
  const [surah, ayah, number, juz, page, norm, text] = row;
  return {
    number,
    text,
    norm,
    numberInSurah: ayah,
    surah: { number: surah, name: surahNameOf(surah) },
    page,
    juz,
  };
}

/** يبني الفهرس من بيانات المصحف المحلية إن تعذّر تحميل الملف المسبق. */
async function buildFromBundledData(
  onProgress?: (done: number, total: number) => void,
): Promise<QuranSearchHit[]> {
  const [pages, texts] = await Promise.all([loadHafsPages(), loadHafsText()]);
  const total = pages.reduce((sum, rows) => sum + rows.length, 0) || EXPECTED_AYAHS;
  const hits: QuranSearchHit[] = [];
  let done = 0;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    for (const [surah, ayah, number, juz] of pages[pageIndex]) {
      const text = texts[`${surah}:${ayah}`] ?? "";
      hits.push({
        number,
        text,
        norm: normalizeQuery(text),
        numberInSurah: ayah,
        surah: { number: surah, name: surahNameOf(surah) },
        page: pageIndex + 1,
        juz,
      });
      done += 1;
    }
    // نترك إطارًا للواجهة بين كل صفحة وأخرى حتى لا تتجمد أثناء التجهيز.
    if (pageIndex % 40 === 39) {
      onProgress?.(done, total);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
  hits.sort((first, second) => first.number - second.number);
  onProgress?.(total, total);
  return hits;
}

let indexPromise: Promise<QuranSearchHit[]> | null = null;

/**
 * يحمّل فهرس البحث مرة واحدة في الجلسة. الملف المسبق صغير ويُقرأ من ملفات
 * التطبيق نفسها (مضمَّن) فلا حاجة لشبكة ولا لإعادة تجهيز عند كل فتح.
 */
export function loadQuranSearchIndex(
  onProgress?: (done: number, total: number) => void,
): Promise<QuranSearchHit[]> {
  if (!indexPromise) {
    indexPromise = (async () => {
      try {
        const response = await fetch(INDEX_URL, { cache: "force-cache" });
        if (response.ok) {
          const payload = (await response.json()) as { ayahs?: PackedAyah[] };
          if (Array.isArray(payload.ayahs) && payload.ayahs.length >= EXPECTED_AYAHS) {
            return payload.ayahs.map(packedToHit);
          }
        }
      } catch {
        /* نكمل بالبناء المحلي */
      }
      return buildFromBundledData(onProgress);
    })().catch((error) => {
      indexPromise = null;
      throw error;
    });
  }
  return indexPromise;
}

/** بحث فوري في الفهرس (فلترة خطية خفيفة على نصوص مطبَّعة مسبقًا). */
export function searchQuran(
  index: QuranSearchHit[],
  query: string,
  surahFilter = 0,
  juzFilter = 0,
): QuranSearchHit[] {
  const needle = normalizeQuery(query);
  if (!needle) return [];
  const out: QuranSearchHit[] = [];
  for (const item of index) {
    if (surahFilter && item.surah.number !== surahFilter) continue;
    if (juzFilter && item.juz !== juzFilter) continue;
    if (item.norm.includes(needle)) out.push(item);
  }
  return out;
}
