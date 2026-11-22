/**
 * تخطيط صفحات المصحف كما في مصحف المدينة (نسخة الملك فهد).
 *
 * واجهة quran.com ترجع رقم السطر المطبوع (line_number) لكل كلمة، فيمكن إعادة
 * بناء أسطر الصفحة الأصلية (15 سطرًا) بلا إعادة توزيع عشوائي للنص.
 */
import { cachedFetch } from "./offlineCache";
import { surahs } from "../data/surahs";

export type PageWord = {
  /** النص العثماني للكلمة كما هو دون تغيير. */
  text: string;
  /** رقم الآية داخل السورة. */
  ayahInSurah: number;
  /** رقم السورة. */
  surah: number;
  /** مفتاح الآية "سورة:آية". */
  key: string;
  /** هل هذه علامة نهاية الآية؟ */
  end: boolean;
};

export type PageLine = {
  line: number;
  words: PageWord[];
};

export type PageLayout = {
  page: number;
  lines: PageLine[];
  /** بدايات السور الظاهرة في هذه الصفحة. */
  surahStarts: { surah: number; name: string; line: number }[];
};

type ApiWord = {
  text_uthmani?: string;
  text?: string;
  char_type_name?: string;
  line_number?: number;
  position?: number;
};

type ApiVerse = {
  verse_key: string;
  verse_number: number;
  words?: ApiWord[];
};

function surahName(number: number): string {
  return surahs.find((s) => s.n === number)?.name ?? `سورة ${number}`;
}

type LocalLines = Record<string, { l: [number, [string, number, number, number][]][]; s: [number, number][] }>;

const chunkPromises = new Map<string, Promise<LocalLines | null>>();

/** بيانات الأسطر المطبوعة (نسخة المدينة): لكل صفحة قائمة أسطر، كل سطر قائمة [سورة، آية، فهرس الكلمة]. */
type PageLinesChunk = Record<string, { lines: number[][][]; lineNums: number[]; surahStarts: number[][] }>;
const linesChunkPromises = new Map<string, Promise<PageLinesChunk | null>>();

export async function loadPageLines(page: number): Promise<{ lines: number[][][]; lineNums: number[]; surahStarts: number[][] } | null> {
  const path = chunkPath(page);
  let promise = linesChunkPromises.get(path);
  if (!promise) {
    promise = fetch(path)
      .then((response) => (response.ok ? (response.json() as Promise<PageLinesChunk>) : null))
      .catch(() => null);
    linesChunkPromises.set(path, promise);
  }
  const chunk = await promise;
  return chunk?.[String(page)] ?? null;
}

/** ملف الأسطر المطبوع مقسّم إلى أجزاء (100 صفحة) ليعمل دون إنترنت بحجم صغير لكل تحميل. */
function chunkPath(page: number): string {
  const start = Math.floor((page - 1) / 10) * 10 + 1;
  const end = Math.min(604, start + 9);
  return `/quran/lines/${start}-${end}.json`;
}

async function loadLocalLayouts(page: number): Promise<LocalLines | null> {
  const path = chunkPath(page);
  const existing = chunkPromises.get(path);
  if (existing) return existing;
  const promise = fetch(path)
    .then((response) => (response.ok ? (response.json() as Promise<LocalLines>) : null))
    .catch(() => null);
  chunkPromises.set(path, promise);
  return promise;
}

export async function fetchPageLayout(page: number): Promise<PageLayout> {
  const local = await loadLocalLayouts(page);
  const entry = local?.[String(page)];
  if (entry && entry.l.length > 0) {
    return {
      page,
      lines: entry.l.map(([line, words]) => ({
        line,
        words: words.map(([text, surah, ayahInSurah, end]) => ({
          text,
          surah,
          ayahInSurah,
          key: `${surah}:${ayahInSurah}`,
          end: Boolean(end),
        })),
      })),
      surahStarts: entry.s.map(([line, surah]) => ({ line, surah, name: surahName(surah) })),
    };
  }

  const url =
    `https://api.quran.com/api/v4/verses/by_page/${page}` +
    `?words=true&word_fields=line_number,text_uthmani&fields=text_uthmani&per_page=60`;
  const response = await cachedFetch(url);
  const data = (await response.json()) as { verses?: ApiVerse[] };

  const byLine = new Map<number, PageWord[]>();
  const surahStarts: PageLayout["surahStarts"] = [];

  for (const verse of data.verses ?? []) {
    const [surahPart, ayahPart] = String(verse.verse_key ?? "").split(":");
    const surah = Number(surahPart);
    const ayahInSurah = Number(ayahPart) || verse.verse_number;
    if (!surah || !ayahInSurah) continue;
    let firstLine: number | null = null;

    for (const word of verse.words ?? []) {
      const line = Number(word.line_number) || 1;
      const isEnd = word.char_type_name === "end";
      const text = (word.text_uthmani ?? word.text ?? "").trim();
      if (!text) continue;
      if (firstLine === null) firstLine = line;
      const list = byLine.get(line) ?? [];
      list.push({ text, ayahInSurah, surah, key: `${surah}:${ayahInSurah}`, end: isEnd });
      byLine.set(line, list);
    }

    if (ayahInSurah === 1 && firstLine !== null && !surahStarts.some((s) => s.surah === surah)) {
      surahStarts.push({ surah, name: surahName(surah), line: firstLine });
    }
  }

  const lines: PageLine[] = [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, words]) => ({ line, words }));

  return { page, lines, surahStarts };
}

/** رقم الأية العام (1..6236) داخل المصحف. */
export function globalAyahNumber(surah: number, ayahInSurah: number, ayahs: { number: number; surah: { number: number }; numberInSurah: number }[]): number | null {
  const hit = ayahs.find((a) => a.surah.number === surah && a.numberInSurah === ayahInSurah);
  return hit ? hit.number : null;
}
