/* حفظ ملفات المصحف كاملة محليًا: النص العثماني، التجويد، تخطيط الصفحات والخطوط. */
import { preloadHafsMushaf } from "./mushafText";

export const MUSHAF_PAGE_CACHE = "thimar-quran-v1";
export const MUSHAF_TOTAL_PAGES = 604;
export const MUSHAF_PAGE_BYTES = 2320;

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
const QURAN = `${BASE}quran/`;
const LINE_CHUNKS = Array.from({ length: 61 }, (_, index) => {
  const start = index * 10 + 1;
  const end = Math.min(604, start + 9);
  return `lines/${start}-${end}.json`;
});
const DATA_URLS = [
  `${QURAN}pages.json`,
  `${QURAN}hafs/text.json.gz`,
  `${QURAN}tajweed.json`,
  ...LINE_CHUNKS.map((path) => `${QURAN}${path}`),
  `${BASE}fonts/quran-uthmani.woff2`,
  `${BASE}fonts/quran-basmalah.woff2`,
];

export type MushafOfflineStatus = { cached: number; total: number; bytes: number; bundled: boolean };

let bundledPromise: Promise<boolean> | null = null;

/**
 * هل ملفات المصحف النصية مضمَّنة مع التطبيق نفسه؟
 * في هذه الحالة لا حاجة لأي تنزيل: الصفحات والنص والتجويد تُقرأ من ملفات التطبيق.
 */
export function mushafIsBundled(): Promise<boolean> {
  if (!bundledPromise) {
    bundledPromise = (async () => {
      try {
        const pages = await fetch(`${QURAN}pages.json`, { cache: "force-cache" });
        if (!pages.ok) return false;
        const payload = (await pages.json()) as { pages?: unknown[] };
        if (payload.pages?.length !== MUSHAF_TOTAL_PAGES) return false;
        const chunk = await fetch(`${QURAN}lines/1-10.json`, { cache: "force-cache" });
        return chunk.ok;
      } catch {
        return false;
      }
    })();
  }
  return bundledPromise;
}

async function cacheAsset(url: string, validate: (response: Response) => Promise<boolean>): Promise<number> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok || !(await validate(response.clone()))) {
    throw new Error(`Mushaf asset failed validation: ${url}`);
  }
  const cache = await caches.open(MUSHAF_PAGE_CACHE);
  await cache.put(url, response.clone());
  const length = Number(response.headers.get("content-length") || 0);
  return Number.isFinite(length) ? length : 0;
}

async function isStored(url: string): Promise<Response | undefined> {
  if (typeof caches === "undefined") return undefined;
  try {
    const cache = await caches.open(MUSHAF_PAGE_CACHE);
    return (await cache.match(url)) ?? undefined;
  } catch {
    return undefined;
  }
}

async function isValidStored(url: string): Promise<boolean> {
  const response = await isStored(url);
  if (!response) return false;
  try {
    if (url.endsWith("pages.json")) {
      const data = await response.clone().json() as { pages?: unknown[] };
      return data.pages?.length === MUSHAF_TOTAL_PAGES;
    }
    if (url.endsWith("tajweed.json")) {
      const data = await response.clone().json() as { verses?: Record<string, string> };
      return Boolean(data.verses && Object.keys(data.verses).length >= 6236);
    }
    if (url.includes("/lines/")) {
      const data = await response.clone().json() as Record<string, { lines?: unknown[] }>;
      return Object.keys(data).length > 0 && Object.values(data).every((page) => Array.isArray(page.lines));
    }
    if (url.endsWith(".woff2")) return (await response.clone().arrayBuffer()).byteLength > 0;
    return (await response.clone().arrayBuffer()).byteLength > 0;
  } catch {
    return false;
  }
}

/** لا يُعلن اكتمال المصحف إلا بعد وجود كل أصول الصفحات والتجويد والخطوط. */
export async function mushafOfflineStatus(): Promise<MushafOfflineStatus> {
  if (await mushafIsBundled()) {
    return { cached: MUSHAF_TOTAL_PAGES, total: MUSHAF_TOTAL_PAGES, bytes: 0, bundled: true };
  }
  const checks = await Promise.all(DATA_URLS.map(async (url) => {
    const response = await isStored(url);
    return response && await isValidStored(url) ? response : null;
  }));
  const ready = checks.every(Boolean);
  const bytes = ready
    ? checks.reduce((sum, response) => sum + Number(response?.headers.get("content-length") || 0), 0)
    : 0;
  return { cached: ready ? MUSHAF_TOTAL_PAGES : 0, total: MUSHAF_TOTAL_PAGES, bytes, bundled: false };
}

/**
 * ينزّل كل ما يلزم لعرض صفحات المصحف النصية الملوّنة دون اتصال.
 * يتأكد من بنية البيانات قبل حفظ كل ملف، ويمكن استئناف المحاولة بعد الانقطاع.
 */
export async function downloadMushafPages(
  onProgress: (done: number, total: number) => void,
  shouldStop: () => boolean,
): Promise<number> {
  onProgress(0, MUSHAF_TOTAL_PAGES);
  /* النسخة المضمَّنة جاهزة داخل التطبيق — لا نعيد تنزيل ما هو موجود أصلًا. */
  if (await mushafIsBundled()) {
    onProgress(MUSHAF_TOTAL_PAGES, MUSHAF_TOTAL_PAGES);
    return MUSHAF_TOTAL_PAGES;
  }
  if (shouldStop() || typeof caches === "undefined") return 0;

  const baseReady = await preloadHafsMushaf();
  if (!baseReady || shouldStop()) return 0;

  let completedPages = 0;

  const fixedAssets = [
    {
      url: `${QURAN}pages.json`,
      validate: async (response: Response) => {
        const data = await response.json() as { pages?: unknown[] };
        return data.pages?.length === MUSHAF_TOTAL_PAGES;
      },
    },
    {
      url: `${QURAN}tajweed.json`,
      validate: async (response: Response) => {
        const data = await response.json() as { verses?: Record<string, string> };
        return Boolean(data.verses && Object.keys(data.verses).length >= 6236);
      },
    },
    {
      url: `${BASE}fonts/quran-uthmani.woff2`,
      validate: async (response: Response) => (await response.arrayBuffer()).byteLength > 0,
    },
    {
      url: `${BASE}fonts/quran-basmalah.woff2`,
      validate: async (response: Response) => (await response.arrayBuffer()).byteLength > 0,
    },
  ];

  for (const asset of fixedAssets) {
    if (shouldStop()) return completedPages;
    await cacheAsset(asset.url, asset.validate);
  }

  for (let index = 0; index < LINE_CHUNKS.length; index += 1) {
    if (shouldStop()) return completedPages;
    const url = `${QURAN}${LINE_CHUNKS[index]}`;
    await cacheAsset(url, async (response) => {
      const data = await response.json() as Record<string, { lines?: unknown[] }>;
      const pages = Object.values(data);
      const expected = index === LINE_CHUNKS.length - 1 ? 4 : 10;
      return pages.length === expected && pages.every((page) => Array.isArray(page.lines));
    });
    completedPages = Math.min(MUSHAF_TOTAL_PAGES, (index + 1) * 10);
    onProgress(completedPages, MUSHAF_TOTAL_PAGES);
  }

  const ready = await mushafOfflineStatus();
  return ready.cached === MUSHAF_TOTAL_PAGES ? MUSHAF_TOTAL_PAGES : completedPages;
}

/** يحذف أصول المصحف المحفوظة محليًا فقط. */
export async function deleteMushafPages(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(MUSHAF_PAGE_CACHE);
    await Promise.all(DATA_URLS.map((url) => cache.delete(url)));
  } catch {
    /* تجاهل أخطاء التخزين */
  }
}
