import { surahs } from "../data/surahs";
import { cachedFetch } from "./offlineCache";

export type Ayah = {
  number: number;
  text: string;
  surah: number;
  surahName: string;
  numberInSurah: number;
  juz: number;
};

const CACHE_PREFIX = "thimar.quran.juz.v2.";
const MAX_AGE = 1000 * 60 * 60 * 24 * 45;

type ApiAyah = {
  number: number;
  text: string;
  numberInSurah: number;
  juz: number;
  surah: { number: number; name: string };
};

type CacheEntry = { at: number; ayahs: Ayah[] };

// تجريد التشكيل للمقارنة، حتى تُطابق البسملة المكتوبة بصور إملائية مختلفة
// مثل «بِّسْمِ» في سورتي التين والقدر.
function bareWord(word: string): string {
  return word
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u0654\u0655]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647");
}

const BASMALA_BARE = ["بسم", "الله", "الرحمن", "الرحيم"];

function stripBasmala(text: string, surah: number, numberInSurah: number): string {
  if (numberInSurah !== 1 || surah === 1 || surah === 9) return text;
  const words = text.split(/\s+/);
  if (words.length > 4 && BASMALA_BARE.every((word, index) => bareWord(words[index]) === word)) {
    return words.slice(4).join(" ");
  }
  return text;
}

function readCache(juz: number): Ayah[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + juz);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed.ayahs?.length) return null;
    if (Date.now() - parsed.at > MAX_AGE) return null;
    return parsed.ayahs;
  } catch {
    return null;
  }
}
function readCacheStale(juz: number): Ayah[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + juz);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed.ayahs?.length) return null;
    return parsed.ayahs;
  } catch {
    return null;
  }
}

export async function fetchJuz(juz: number, _signal?: AbortSignal): Promise<Ayah[]> {
  const cached = readCache(juz);
  if (cached) return cached;

  let response: Response | null = null;
  try {
    response = await cachedFetch(`https://api.alquran.cloud/v1/juz/${juz}/quran-uthmani`);
  } catch {
    response = null;
  }
  if (!response) {
    const stale = readCacheStale(juz);
    if (stale) return stale;
    throw new Error(`تعذّر تحميل الجزء ${juz} (لا يوجد اتصال).`);
  }
  if (!response.ok) {
    const stale = readCacheStale(juz);
    if (stale) return stale;
    throw new Error(`تعذّر تحميل الجزء ${juz} من مصدر القرآن.`);
  }
  const payload = (await response.json()) as { data?: { ayahs?: ApiAyah[] } };
  const rawAyahs = payload.data?.ayahs ?? [];
  if (rawAyahs.length === 0) {
    throw new Error(`لم تصل آيات الجزء ${juz}.`);
  }

  const ayahs: Ayah[] = rawAyahs.map((ayah) => ({
    number: ayah.number,
    text: stripBasmala(ayah.text, ayah.surah.number, ayah.numberInSurah),
    surah: ayah.surah.number,
    surahName: surahs[ayah.surah.number - 1]?.name ?? ayah.surah.name,
    numberInSurah: ayah.numberInSurah,
    juz: ayah.juz,
  }));

  try {
    localStorage.setItem(
      CACHE_PREFIX + juz,
      JSON.stringify({ at: Date.now(), ayahs } satisfies CacheEntry),
    );
  } catch {
    // التخزين ممتلئ — نكمل بدون تخزين مؤقت.
  }
  return ayahs;
}

export async function fetchJuzs(
  juzs: number[],
  signal?: AbortSignal,
): Promise<Ayah[]> {
  const unique = [...new Set(juzs)].filter((juz) => juz >= 1 && juz <= 30).slice(0, 4);
  const chunks = await Promise.all(unique.map((juz) => fetchJuz(juz, signal)));
  return chunks.flat();
}

export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

const SURAH_CACHE_PREFIX = "thimar.quran.surah.v2.";

export async function fetchSurah(
  surah: number,
  _signal?: AbortSignal,
): Promise<Ayah[]> {
  const cached = readCacheBySurah(surah);
  if (cached) return cached;
  let response: Response | null = null;
  try {
    response = await cachedFetch(`https://api.alquran.cloud/v1/surah/${surah}/quran-uthmani`);
  } catch {
    response = null;
  }
  if (!response) {
    const stale = readCacheBySurahStale(surah);
    if (stale) return stale;
    throw new Error(`تعذّر تحميل سورة ${surah} (لا يوجد اتصال).`);
  }
  if (!response.ok) {
    const stale = readCacheBySurahStale(surah);
    if (stale) return stale;
    throw new Error(`تعذّر تحميل سورة ${surah}.`);
  }
  const payload = (await response.json()) as {
    data?: {
      ayahs?: Array<{ number: number; text: string; numberInSurah: number; juz: number }>;
      name?: string;
    };
  };
  const rawAyahs = payload.data?.ayahs ?? [];
  if (rawAyahs.length === 0) throw new Error("لم تصل آيات السورة.");
  const ayahs: Ayah[] = rawAyahs.map((ayah) => ({
    number: ayah.number,
    text: stripBasmala(ayah.text, surah, ayah.numberInSurah),
    surah,
    surahName: surahs[surah - 1]?.name ?? payload.data?.name ?? "",
    numberInSurah: ayah.numberInSurah,
    juz: ayah.juz,
  }));
  try {
    localStorage.setItem(
      SURAH_CACHE_PREFIX + surah,
      JSON.stringify({ at: Date.now(), ayahs }),
    );
  } catch {
    // ignore
  }
  return ayahs;
}

function readCacheBySurah(surah: number): Ayah[] | null {
  try {
    const raw = localStorage.getItem(SURAH_CACHE_PREFIX + surah);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; ayahs: Ayah[] };
    if (!parsed.ayahs?.length) return null;
    if (Date.now() - parsed.at > MAX_AGE) return null;
    return parsed.ayahs;
  } catch {
    return null;
  }
}
function readCacheBySurahStale(surah: number): Ayah[] | null {
  try {
    const raw = localStorage.getItem(SURAH_CACHE_PREFIX + surah);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; ayahs: Ayah[] };
    if (!parsed.ayahs?.length) return null;
    return parsed.ayahs;
  } catch {
    return null;
  }
}

export function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0621-\u064A0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type TafsirEntry = {
  text: string;
  edition: string;
  surah: number;
  ayah: number;
};

const TAFSIR_KEY_PREFIX = "thimar.tafsir.muyassar.";

export async function fetchTafsir(
  surah: number,
  ayah: number,
  signal?: AbortSignal,
): Promise<TafsirEntry> {
  const key = `${TAFSIR_KEY_PREFIX}${surah}.${ayah}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached) return JSON.parse(cached) as TafsirEntry;
  } catch {
    // تجاهل التخزين غير المتاح.
  }
  const response = await fetch(
    `https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/ar.muyassar`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new Error("تعذّر تحميل التفسير. تحقق من الاتصال بالإنترنت.");
  const payload = (await response.json()) as {
    data?: { text?: string; edition?: { name?: string } };
  };
  const text = payload.data?.text?.trim();
  if (!text) throw new Error("لم يصل تفسير لهذه الآية.");
  const entry: TafsirEntry = {
    text,
    edition: payload.data?.edition?.name ?? "التفسير الميسر",
    surah,
    ayah,
  };
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // تجاهل امتلاء التخزين.
  }
  return entry;
}
