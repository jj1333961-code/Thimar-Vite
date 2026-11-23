import { localQuranResponse } from "./quranLocal";

/**
 * يقدّم بيانات المصحف المحلية أولًا، ثم يفضّل أحدث نسخة من الشبكة عند الاتصال.
 * لا يُستخدم Cache Storage إلا كخطة احتياطية عند انقطاع الشبكة، حتى لا تُعاد
 * ملفات قديمة عند وجود إصدار أحدث على الخادم.
 */
export async function cachedFetch(url: string): Promise<Response> {
  try {
    const local = await localQuranResponse(url);
    if (local) return local;
  } catch {
    // لا تتوفر بيانات محلية — نتابع إلى الشبكة.
  }

  let cache: Cache | null = null;
  try {
    cache = await caches.open("thimar-quran-v1");
  } catch {
    cache = null;
  }

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok && cache) {
      try {
        await cache.put(url, response.clone());
      } catch {
        // تعذّر التخزين لا يمنع استخدام الاستجابة السليمة الحالية.
      }
    }
    return response;
  } catch {
    const cached = cache ? await cache.match(url) : undefined;
    if (cached) return cached;
    throw new Error("offline");
  }
}
