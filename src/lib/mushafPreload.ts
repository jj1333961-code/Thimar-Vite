/**
 * تحميل مسبق لبيانات المصحف في وقت الخمول.
 *
 * الهدف: أن يُفتح المصحف جاهزًا بلا شاشة انتظار. لا يعطّل إقلاع التطبيق ولا
 * يستهلك شبكة المستخدم على اتصال بطيء أو موفّر للبيانات.
 */
import { prefetchPageLines } from "./quranPageLayout";
import { loadPageMap, loadTajweed } from "./tajweed";

const LAST_PAGE_KEY = "thimar.lastMushaf";

function lastPage(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_PAGE_KEY) || "null") as { page?: unknown } | null;
    const page = Number(raw?.page);
    return Number.isFinite(page) ? Math.min(604, Math.max(1, Math.round(page))) : 1;
  } catch {
    return 1;
  }
}

function allowHeavyPrefetch(): boolean {
  try {
    const connection = (navigator as any).connection as
      | { saveData?: boolean; effectiveType?: string }
      | undefined;
    if (connection?.saveData) return false;
    const type = String(connection?.effectiveType ?? "");
    if (type === "slow-2g" || type === "2g") return false;
  } catch { /* المتصفح لا يفصح عن الاتصال */ }
  return true;
}

export function preloadMushaf(): void {
  const run = () => {
    const page = lastPage();
    /* صفحات المصحف والأسطر المحيطة: صغيرة وسريعة، تُطلب أولًا. */
    void loadPageMap().catch(() => undefined);
    prefetchPageLines(page);
    prefetchPageLines(page + 1);
    /* نص القرآن كامل (أكبر ملف) بعد أن يهدأ التطبيق. */
    if (allowHeavyPrefetch()) void loadTajweed().catch(() => undefined);
  };
  const idle = (window as any).requestIdleCallback as
    | undefined
    | ((callback: () => void, options?: { timeout: number }) => number);
  if (typeof idle === "function") idle(run, { timeout: 5000 });
  else window.setTimeout(run, 1500);
}
