import { cachedFetch } from "./offlineCache";

let started = false;

export function preloadQuranOffline(): void {
  if (started || typeof window === "undefined") return;
  if (!navigator.onLine) return;
  started = true;
  const run = async () => {
    // preload juzs
    for (let j = 1; j <= 30; j++) {
      try {
        await cachedFetch(`https://api.alquran.cloud/v1/juz/${j}/quran-uthmani`);
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 120));
    }
    // preload pages
    for (let p = 1; p <= 604; p++) {
      if (!navigator.onLine) break;
      try {
        await cachedFetch(`https://api.alquran.cloud/v1/page/${p}/quran-uthmani`);
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 80));
    }
  };
  // delay start
  setTimeout(() => { void run(); }, 4000);
}
