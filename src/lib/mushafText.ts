/*
 * «مصحف حفص نسخة نصية» — النسخة المعتمدة في التطبيق.
 *
 * المصدر: quranpedia.net/mushaf/2 (رواية حفص عن عاصم، الخط العثماني KFGQPC).
 * البيانات محلية داخل التطبيق:
 *   /quran/pages.json        فهرس ٦٠٤ صفحات: [السورة، الآية، الرقم العام، الجزء]
 *   /quran/hafs/text.json.gz نص كل آية مضغوطًا بمفتاح "سورة:آية"
 *
 * التحديد يعتمد على النص نفسه: كل آية عنصر مستقل، فالنقر على أي كلمة يعطي
 * الآية التي تحتويها بدقة، بلا مستطيلات تقريبية ولا آيات مجاورة.
 */

import { cachedFetch } from "./offlineCache";
import { loadTajweed, tajweedText, TOTAL_PAGES } from "./tajweed";

export type HafsAyah = {
  surah: number;
  ayah: number;
  /** الرقم العام في ترتيب المصحف ١..٦٢٣٦ (يُستخدم للصوت والعلامات). */
  global: number;
  juz: number;
  page: number;
  text: string;
};

/** [رقم السورة، رقم الآية، الرقم العام، رقم الجزء] */
type Row = [number, number, number, number];

const BASE = (import.meta.env.BASE_URL || "/") + "quran/";

let rowsPromise: Promise<Row[][]> | null = null;
let textPromise: Promise<Record<string, string>> | null = null;
let indexPromise: Promise<Map<string, Row>> | null = null;

export function ayahKey(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

/** فهرس الصفحات كاملًا (٦٠٤ صفحة). */
export function loadHafsPages(): Promise<Row[][]> {
  if (!rowsPromise) {
    rowsPromise = cachedFetch(`${BASE}pages.json`)
      .then((response) => {
        if (!response.ok) throw new Error("pages unavailable");
        return response.json() as Promise<{ pages?: Row[][] }>;
      })
      .then((payload) => {
        const pages = payload.pages ?? [];
        if (pages.length !== TOTAL_PAGES) throw new Error("incomplete pages");
        return pages;
      })
      .catch((error) => {
        rowsPromise = null;
        throw error;
      });
  }
  return rowsPromise;
}

/** فهرس بحث سريع: "سورة:آية" ← [السورة، الآية، الرقم العام، الجزء]. */
export function loadHafsIndex(): Promise<Map<string, Row>> {
  if (!indexPromise) {
    indexPromise = loadHafsPages()
      .then((pages) => {
        const map = new Map<string, Row>();
        for (const rows of pages) {
          for (const row of rows) map.set(ayahKey(row[0], row[1]), row);
        }
        return map;
      })
      .catch((error) => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

async function gunzipText(response: Response): Promise<string> {
  const Stream = (window as unknown as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (!Stream) throw new Error("gzip unsupported");
  const buffer = await response.arrayBuffer();
  const stream = new Blob([buffer]).stream().pipeThrough(new Stream("gzip"));
  return new Response(stream).text();
}

/**
 * يقرأ نص المصحف: الملف غير المضغوط أولًا ثم المضغوط.
 *
 * داخل حزمة أندرويد يفكّ aapt2 أي أصل ينتهي بـ.gz ويُخزّنه باسمه بلا .gz،
 * لذلك يصل النص داخل التطبيق كـ quran/hafs/text.json. المحاولة غير المضغوطة
 * تنجح محليًا بلا أي طلب شبكة؛ وعلى الويب تفشل ويردّ .gz المضغوط.
 */
async function readHafsText(): Promise<string> {
  const plain = await fetch(`${BASE}hafs/text.json`, { cache: "no-store" }).catch(() => null);
  if (plain && plain.ok) {
    const body = await plain.text();
    if (body.trimStart().startsWith("{")) return body;
  }
  const response = await cachedFetch(`${BASE}hafs/text.json.gz`);
  if (!response.ok) throw new Error("text unavailable");
  return gunzipText(response);
}

/** نصوص الآيات كلها، أو نص النسخة التجويدية المحلية إن تعذّر فكّ الضغط. */
export function loadHafsText(): Promise<Record<string, string>> {
  if (!textPromise) {
    textPromise = readHafsText()
      .then((raw) => JSON.parse(raw) as Record<string, string>)
      .catch(async () => {
        // احتياط: نص المصحف المحمّل أصلًا مع التطبيق (مصحف التجويد) بلا تلوين.
        const fallback = await loadTajweed();
        const map: Record<string, string> = {};
        for (const [key, encoded] of Object.entries(fallback.verses)) {
          map[key] = tajweedText(encoded);
        }
        return map;
      });
  }
  return textPromise;
}

function normalizePage(page: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(TOTAL_PAGES, Math.max(1, Math.round(page)));
}

/** آيات صفحة كاملة بالترتيب، مع نصها. */
export async function loadHafsPage(page: number): Promise<HafsAyah[]> {
  const normalized = normalizePage(page);
  const [pages, texts] = await Promise.all([loadHafsPages(), loadHafsText()]);
  const rows = pages[normalized - 1] ?? [];
  return rows.map(([surah, ayah, global, juz]) => ({
    surah,
    ayah,
    global,
    juz,
    page: normalized,
    text: texts[ayahKey(surah, ayah)] ?? "",
  }));
}

/** آيات محددة (قد تكون من صفحات مختلفة) مرتبة بترتيب المصحف. */
export async function loadHafsAyahs(keys: string[]): Promise<HafsAyah[]> {
  const [pages, index, texts] = await Promise.all([
    loadHafsPages(),
    loadHafsIndex(),
    loadHafsText(),
  ]);
  const pageOf = new Map<number, number>();
  pages.forEach((rows, pageIndex) => {
    for (const row of rows) pageOf.set(row[2], pageIndex + 1);
  });
  const seen = new Set<string>();
  const result: HafsAyah[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const row = index.get(key);
    if (!row) continue;
    result.push({
      surah: row[0],
      ayah: row[1],
      global: row[2],
      juz: row[3],
      page: pageOf.get(row[2]) ?? 0,
      text: texts[key] ?? "",
    });
  }
  result.sort((first, second) => first.global - second.global);
  return result;
}

/** صفحة آية واحدة بالرقم العام (للانتقال من العلامات والملاحظات). */
export async function pageOfGlobalAyah(global: number): Promise<number | null> {
  const pages = await loadHafsPages();
  for (let index = 0; index < pages.length; index += 1) {
    if (pages[index].some((row) => row[2] === global)) return index + 1;
  }
  return null;
}

/** مفتاح الآية من الرقم العام. */
export async function keyOfGlobalAyah(global: number): Promise<string | null> {
  const pages = await loadHafsPages();
  for (const rows of pages) {
    const row = rows.find((item) => item[2] === global);
    if (row) return ayahKey(row[0], row[1]);
  }
  return null;
}

/** تحميل نص المصحف كاملًا في الكاش (يعمل ورقم الصفحات ثابت ٦٠٤). */
export async function preloadHafsMushaf(): Promise<boolean> {
  try {
    await Promise.all([loadHafsPages(), loadHafsText()]);
    return true;
  } catch {
    return false;
  }
}
