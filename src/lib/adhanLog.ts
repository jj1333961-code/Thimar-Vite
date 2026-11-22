/**
 * سجل الأذان: يُحفظ محليًا كل أذان يُشغّله التطبيق (الصلاة، المدينة، الوقت، ونغمة الأذان)
 * ليُعرض في صفحة «سجل الأذان» خلال العام كاملًا.
 */
export type AdhanLogEntry = {
  at: number;
  prayer: string;
  city: string;
  time: string;
  adhanId: string;
  adhanName: string;
};

const KEY = "thimar.adhanLog.v1";
const LIMIT = 3000;

export function loadAdhanLog(): AdhanLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as AdhanLogEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordAdhan(entry: Omit<AdhanLogEntry, "at"> & { at?: number }): void {
  try {
    const list = loadAdhanLog();
    const at = entry.at ?? Date.now();
    const duplicate = list.some(
      (item) =>
        Math.abs(item.at - at) < 120000 &&
        item.prayer === entry.prayer &&
        item.city === entry.city,
    );
    if (duplicate) return;
    list.push({ ...entry, at });
    localStorage.setItem(KEY, JSON.stringify(list.slice(-LIMIT)));
    window.dispatchEvent(new CustomEvent("thimar:adhan-log"));
  } catch {
    // التخزين غير متاح — لا نُفشل التطبيق.
  }
}

export function clearAdhanLog(): void {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent("thimar:adhan-log"));
  } catch {
    /* ignore */
  }
}

export function adhanLogForYear(year: number): AdhanLogEntry[] {
  return loadAdhanLog().filter((item) => new Date(item.at).getFullYear() === year);
}
