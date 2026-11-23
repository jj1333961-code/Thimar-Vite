/**
 * Pure cache policy used by Quran resources and its regression tests.
 * Network is authoritative while online; Cache Storage is an offline fallback.
 */
export async function fetchWithOfflineFallback(
  url: string,
  localFirst: () => Promise<Response | null>,
  openCache: () => Promise<Cache | null>,
  networkFetch: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Response> {
  try {
    const local = await localFirst();
    if (local) return local;
  } catch {
    // Continue to the network when local Quran data is unavailable.
  }

  let cache: Cache | null = null;
  try {
    cache = await openCache();
  } catch {
    cache = null;
  }

  try {
    const response = await networkFetch(url, { cache: "no-store" });
    if (response.ok && cache) {
      try {
        await cache.put(url, response.clone());
      } catch {
        // A storage quota error must not discard a valid network response.
      }
    }
    return response;
  } catch {
    const cached = cache ? await cache.match(url) : undefined;
    if (cached) return cached;
    throw new Error("offline");
  }
}
