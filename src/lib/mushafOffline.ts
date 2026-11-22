/* حفظ المصحف النصي كاملًا (٦٠٤ صفحات) على الجهاز لتعمل القراءة دون إنترنت. */

import { preloadHafsMushaf } from "./mushafText";

export const MUSHAF_PAGE_CACHE = "thimar-quran-v1";
export const MUSHAF_TOTAL_PAGES = 604;
/** حجم نص القرآن الكامل تقريبًا (١٫٤ م.ب) بعد فكّ الضغط. */
export const MUSHAF_PAGE_BYTES = 2320;

const BASE = import.meta.env.BASE_URL || "/";
const DATA_URLS = [`${BASE}quran/pages.json`, `${BASE}quran/hafs/text.json.gz`];

export type MushafOfflineStatus = { cached: number; total: number; bytes: number };

async function isStored(url: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(MUSHAF_PAGE_CACHE);
    const match = await cache.match(url);
    if (match) return true;
  } catch {
    /* تجاهل. */
  }
  try {
    const found = await caches.match(url);
    return Boolean(found);
  } catch {
    return false;
  }
}

/** كم صفحة متاحة دون إنترنت الآن. */
export async function mushafOfflineStatus(): Promise<MushafOfflineStatus> {
  const checks = await Promise.all(DATA_URLS.map(isStored));
  const ready = checks.every(Boolean);
  return {
    cached: ready ? MUSHAF_TOTAL_PAGES : 0,
    total: MUSHAF_TOTAL_PAGES,
    bytes: ready ? MUSHAF_TOTAL_PAGES * MUSHAF_PAGE_BYTES : 0,
  };
}

/** يحمّل نص المصحف كاملًا إلى ذاكرة الجهاز. يعيد عدد الصفحات المتاحة. */
export async function downloadMushafPages(
  onProgress: (done: number, total: number) => void,
  shouldStop: () => boolean,
): Promise<number> {
  onProgress(0, MUSHAF_TOTAL_PAGES);
  if (shouldStop()) return 0;
  const ok = await preloadHafsMushaf();
  if (!ok) return 0;
  onProgress(MUSHAF_TOTAL_PAGES, MUSHAF_TOTAL_PAGES);
  return MUSHAF_TOTAL_PAGES;
}

/** يحذف نسخة المصحف المحفوظة على الجهاز (يُعاد تحميلها عند الحاجة). */
export async function deleteMushafPages(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(MUSHAF_PAGE_CACHE);
    for (const url of DATA_URLS) await cache.delete(url);
  } catch {
    /* تجاهل. */
  }
  for (const url of DATA_URLS) {
    try {
      await caches.delete(url);
    } catch {
      /* تجاهل. */
    }
  }
}
