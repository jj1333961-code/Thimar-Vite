import { localQuranResponse } from "./quranLocal";
import { fetchWithOfflineFallback } from "./offlineCacheCore";

/** يفضّل أحدث بيانات المصحف من الشبكة، ويستخدم الكاش فقط عند انقطاعها. */
export async function cachedFetch(url: string): Promise<Response> {
  return fetchWithOfflineFallback(
    url,
    () => localQuranResponse(url),
    async () => {
      if (typeof caches === "undefined") return null;
      return caches.open("thimar-quran-v1");
    },
    (requestUrl, options) => fetch(requestUrl, options),
  );
}
