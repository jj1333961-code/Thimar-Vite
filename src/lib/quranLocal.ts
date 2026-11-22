/**
 * مصحف محلي داخل التطبيق: ملف واحد يحوي 6236 آية في 604 صفحات.
 * يسمح بعرض المصحف والبحث والقراءة دون إنترنت بعد أول تحميل.
 */
import { surahs } from "../data/surahs";
import { loadTajweed, tajweedText } from "./tajweed";

export type LocalAyahRow = [number, number, number, number, string];

const DATA_URL = "/quran/pages.json";
const DATA_CACHE = "thimar-data-v1";
const SURAH_NAMES = surahs.map((surah) => surah.name);

let pagesPromise: Promise<LocalAyahRow[][]> | null = null;

async function readData(): Promise<LocalAyahRow[][]> {
  let response: Response | undefined;
  try {
    const cache = await caches.open(DATA_CACHE);
    response = await cache.match(DATA_URL);
    if (!response) {
      response = await fetch(DATA_URL);
      if (response.ok) void cache.put(DATA_URL, response.clone());
    }
  } catch {
    response = undefined;
  }
  if (!response || !response.ok) {
    response = await fetch(DATA_URL);
  }
  if (!response.ok) throw new Error("تعذّر تحميل بيانات المصحف.");
  const payload = (await response.json()) as { pages?: Array<Array<[number, number, number, number]>> };
  if (!payload.pages?.length) throw new Error("بيانات المصحف غير مكتملة.");
  /* ملف الصفحات يحمل أرقام الآيات فقط؛ النص يأتي من ملف المصحف الملوّن
     نفسه فلا تُخزَّن نسختان من نص القرآن. */
  const tajweed = await loadTajweed().catch(() => null);
  return payload.pages.map((rows) =>
    rows.map(([surah, ayahInSurah, number, juz]) => [
      surah,
      ayahInSurah,
      number,
      juz,
      tajweed ? tajweedText(tajweed.verses[`${surah}:${ayahInSurah}`] ?? "") : "",
    ] as LocalAyahRow),
  );
}

function pages(): Promise<LocalAyahRow[][]> {
  if (!pagesPromise) {
    pagesPromise = readData().catch((error) => {
      pagesPromise = null;
      throw error;
    });
  }
  return pagesPromise;
}

function surahName(number: number): string {
  return SURAH_NAMES[number - 1] ?? `سورة ${number}`;
}

function ayahPayload(row: LocalAyahRow, page?: number) {
  const [surah, numberInSurah, number, juz, text] = row;
  return {
    number,
    text,
    numberInSurah,
    juz,
    page,
    surah: { number: surah, name: surahName(surah) },
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, status: "OK", data }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalize(text: string): string {
  return text
    .replace(/[\u064B-\u0652\u0670\u0640\u0610-\u061A\u06D6-\u06ED]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0621-\u064A0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const AYAH_RE = /\/ayah\/(\d+)(?::(\d+))?(?:\/|$)/;
const PAGE_RE = /\/page\/(\d+)/;
const JUZ_RE = /\/juz\/(\d+)/;
const SURAH_RE = /\/surah\/(\d+)/;
const SEARCH_RE = /\/search\/([^/]+)\/all\//;

/**
 * يعيد استجابة محلية لأي طلب من واجهة القرآن، أو null إذا لم يكن الطلب منها.
 * بهذا تعمل كل الشاشات دون إنترنت دون تغيير بقية الكود.
 */
export async function localQuranResponse(url: string): Promise<Response | null> {
  if (!url.includes("api.alquran.cloud")) return null;
  if (url.includes("/ar.") || url.includes("tafsir")) return null;

  const search = url.match(SEARCH_RE);
  const ayahMatch = url.match(AYAH_RE);
  const pageMatch = url.match(PAGE_RE);
  const juzMatch = url.match(JUZ_RE);
  const surahMatch = url.match(SURAH_RE);
  const all = url.includes("/quran/quran-uthmani");

  if (!search && !ayahMatch && !pageMatch && !juzMatch && !surahMatch && !all) return null;

  const data = await pages();

  /* خريطة رقم الآية العام → رقم الصفحة، ليعمل الانتقال إلى السورة/الآية دون إنترنت. */
  const pageIndex = new Map<number, number>();
  data.forEach((rows, index) => {
    rows.forEach((row) => pageIndex.set(row[2], index + 1));
  });

  if (search) {
    const query = decodeURIComponent(search[1]).trim();
    const needle = normalize(query);
    if (!needle) return jsonResponse({ count: 0, matches: [] });
    const matches: unknown[] = [];
    for (const page of data) {
      for (const row of page) {
        if (normalize(row[4]).includes(needle)) matches.push(ayahPayload(row, pageIndex.get(row[2])));
        if (matches.length >= 200) break;
      }
      if (matches.length >= 200) break;
    }
    return jsonResponse({ count: matches.length, matches });
  }

  if (ayahMatch) {
    const first = Number(ayahMatch[1]);
    const second = ayahMatch[2] ? Number(ayahMatch[2]) : null;
    for (const page of data) {
      for (const row of page) {
        const [, numberInSurah, number] = row;
        const hit = second === null ? number === first : row[0] === first && numberInSurah === second;
        if (hit) return jsonResponse(ayahPayload(row, pageIndex.get(number)));
      }
    }
    return new Response(JSON.stringify({ code: 404, status: "NOT_FOUND" }), { status: 404 });
  }

  if (pageMatch) {
    const pageNumber = Number(pageMatch[1]);
    const rows = data[pageNumber - 1];
    if (!rows) return new Response(JSON.stringify({ code: 404, status: "NOT_FOUND" }), { status: 404 });
    return jsonResponse({
      number: pageNumber,
      ayahs: rows.map((row) => ayahPayload(row, pageIndex.get(row[2]))),
      surahs: Object.fromEntries(
        [...new Set(rows.map((row) => row[0]))].map((number) => [number, surahName(number)]),
      ),
      edition: { identifier: "quran-uthmani", language: "ar" },
    });
  }

  if (juzMatch) {
    const juz = Number(juzMatch[1]);
    const rows = data.flat().filter((row) => row[3] === juz);
    if (!rows.length) return new Response(JSON.stringify({ code: 404, status: "NOT_FOUND" }), { status: 404 });
    return jsonResponse({
      number: juz,
      ayahs: rows.map((row) => ayahPayload(row, pageIndex.get(row[2]))),
      edition: { identifier: "quran-uthmani", language: "ar" },
    });
  }

  if (surahMatch) {
    const surah = Number(surahMatch[1]);
    const rows = data.flat().filter((row) => row[0] === surah);
    if (!rows.length) return new Response(JSON.stringify({ code: 404, status: "NOT_FOUND" }), { status: 404 });
    return jsonResponse({
      number: surah,
      name: surahName(surah),
      englishName: "",
      ayahs: rows.map((row) => ayahPayload(row, pageIndex.get(row[2]))),
      edition: { identifier: "quran-uthmani", language: "ar" },
    });
  }

  if (all) {
    const grouped = new Map<number, LocalAyahRow[]>();
    for (const row of data.flat()) {
      const list = grouped.get(row[0]) ?? [];
      list.push(row);
      grouped.set(row[0], list);
    }
    const surahList = [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([number, rows]) => ({
        number,
        name: surahName(number),
        ayahs: rows.map(ayahPayload),
      }));
    return jsonResponse({ surahs: surahList });
  }

  return null;
}
