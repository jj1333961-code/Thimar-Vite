import { localQuranResponse } from "./quranLocal";

/** يجرّب بيانات المصحف المحلية أولًا، ثم الشبكة، ويخزّن النتائج في Cache Storage. */
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
  const cached = cache ? await cache.match(url) : undefined;
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (res.ok && cache) {
      void cache.put(url, res.clone());
    }
    return res;
  } catch {
    if (cached) return cached;
    throw new Error("offline");
  }
}
