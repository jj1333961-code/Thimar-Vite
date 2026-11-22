import { useEffect, useMemo, useRef, useState } from "react";
import { fatwas, fatwaCategories } from "../../data/fatwas";
import {
  offlineFatwaCount,
  recentOfflineFatwas,
  saveFatwas,
  searchOfflineFatwas,
} from "../../lib/fatwaOffline";
import { Icon } from "./ui";

/*
 * صفحة الإفتاء: بحث فوري في آلاف الفتاوى الموثّقة عبر بوابتنا (المصدر:
 * موسوعة Quranpedia — فتاوى إسلام ويب وغيرها)، مع فتاوى محفوظة تعمل دون إنترنت.
 */

type FatwaItem = {
  id: number | null;
  title: string;
  question: string;
  answer?: string;
  mufti?: string;
  category?: string;
  source?: string;
};

const PAGE_SIZE_NOTE = "المصدر: فتاوى إسلام ويب وآخرون عبر Quranpedia";

function normalize(text: string) {
  return text
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

export default function FatwaPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("الكل");
  const [items, setItems] = useState<FatwaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [offlineMode, setOfflineMode] = useState(false);
  const [open, setOpen] = useState<FatwaItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [offlineResults, setOfflineResults] = useState<FatwaItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void offlineFatwaCount().then(setSavedCount);
  }, []);

  /* عرض الفتاوى المحفوظة على الجهاز عند بحث دون إنترنت. */
  useEffect(() => {
    if (!offlineMode) {
      setOfflineResults([]);
      return;
    }
    let cancelled = false;
    const run = query.trim() ? searchOfflineFatwas(query, category) : recentOfflineFatwas();
    run.then((rows) => {
      if (cancelled) return;
      setOfflineResults(
        rows.map((row) => ({
          id: null,
          title: row.title || row.question,
          question: row.question,
          answer: row.answer,
          mufti: row.mufti,
          category: row.category,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [category, offlineMode, query]);

  const localList = useMemo(() => {
    const list = category === "الكل" ? fatwas : fatwas.filter((item) => item.category === category);
    const q = normalize(query);
    if (!q) return list;
    return list.filter((item) => normalize(`${item.question} ${item.answer}`).includes(q));
  }, [category, query]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setItems([]);
      setTotal(0);
      setError("");
      setOfflineMode(false);
      return;
    }
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      fetch(`/api/fatwa?q=${encodeURIComponent(q)}&page=${page}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json() as Promise<{ items: FatwaItem[]; total: number; lastPage: number }>;
        })
        .then((data) => {
          setItems(data.items ?? []);
          setTotal(data.total ?? 0);
          setLastPage(data.lastPage ?? 1);
          setOfflineMode(false);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError("تعذّر الاتصال بمصدر الفتاوى؛ نعرض الفتاوى المحفوظة في التطبيق.");
          setOfflineMode(true);
          void err;
        })
        .finally(() => setLoading(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query, page]);

  useEffect(() => { setPage(1); }, [query]);

  const openFatwa = async (item: FatwaItem) => {
    if (item.id === null) {
      setOpen(item);
      return;
    }
    /* كل فتوى تُفتح تُحفظ على الجهاز لتعمل لاحقًا دون إنترنت. */
    if (item.answer) void saveFatwas([item]).then(() => void offlineFatwaCount().then(setSavedCount));
    setOpen(item);
    if (item.answer) return;
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/fatwa?id=${item.id}`);
      if (!response.ok) throw new Error("failed");
      const data = (await response.json()) as { fatwa: FatwaItem };
      setOpen((current) => (current && current.id === item.id ? { ...current, ...data.fatwa } : current));
      setItems((previous) => previous.map((entry) => (entry.id === item.id ? { ...entry, ...data.fatwa } : entry)));
      void saveFatwas([data.fatwa]).then(() => void offlineFatwaCount().then(setSavedCount));
    } catch {
      setOpen((current) => (current && current.id === item.id
        ? { ...current, answer: "تعذّر تحميل نص الفتوى الآن. تحقّق من الاتصال بالإنترنت ثم أعد المحاولة." }
        : current));
    } finally {
      setDetailLoading(false);
    }
  };

  const showingLive = query.trim().length >= 2;

  return (
    <div className="fatwa-page">
      <div className="fatwa-search">
        <Icon name="search" size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث في آلاف الفتاوى: الصلاة، الزكاة، البيوع، الأسرة…"
          aria-label="بحث في الفتاوى"
        />
        {query ? (
          <button type="button" className="icon-button" onClick={() => setQuery("")} aria-label="مسح">
            <Icon name="x" size={15} />
          </button>
        ) : null}
      </div>

      <div className="fatwa-meta">
        <span>{showingLive ? (loading ? "جارٍ البحث في الشبكة…" : `${total} نتيجة من الفتاوى الموثّقة`) : `${fatwas.length} فتوى مضمّنة + ${savedCount.toLocaleString("ar")} محفوظة على الجهاز`}</span>
        <small>{PAGE_SIZE_NOTE}</small>
      </div>

      {!showingLive ? (
        <div className="fatwa-chips">
          {["الكل", ...fatwaCategories].map((item) => (
            <button
              key={item}
              type="button"
              className={`chip ${category === item ? "active" : ""}`}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="fatwa-error">{error}</p> : null}

      {loading && showingLive ? <div className="skeleton-list">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton-line" />)}</div> : null}

      <ul className="fatwa-results">
        {(showingLive && !offlineMode
          ? items
          : offlineMode && offlineResults.length
            ? offlineResults
            : localList.map((item) => ({
                id: null,
                title: item.question,
                question: item.question,
                answer: item.answer,
                mufti: item.evidence ?? "",
                category: item.category,
              }))
        ).map((item, index) => (
          <li key={`${item.id ?? "local"}-${index}`}>
            <button type="button" className="fatwa-card" onClick={() => void openFatwa(item)}>
              <span className="fatwa-card-cat">{item.category || "فتوى"}</span>
              <strong>{item.title || item.question}</strong>
              {item.question && item.title !== item.question ? <p>{item.question}</p> : null}
              <span className="fatwa-card-src">{item.mufti || PAGE_SIZE_NOTE}</span>
            </button>
          </li>
        ))}
      </ul>

      {showingLive && !offlineMode && !loading && items.length === 0 && !error ? (
        <p className="muted">لا توجد نتائج مطابقة. جرّب كلمة أخرى.</p>
      ) : null}

      {showingLive && !offlineMode && lastPage > 1 ? (
        <div className="fatwa-pager">
          <button type="button" className="ghost-button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>السابقة</button>
          <span>صفحة {page} من {lastPage}</span>
          <button type="button" className="ghost-button" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>التالية</button>
        </div>
      ) : null}

      <p className="muted fatwa-note">
        الفتاوى تُعرض كما وردت من مصادرها الموثّقة. وفي المسائل الخلافية يُرجَع إلى أهل العلم في بلدك.
      </p>

      {open ? (
        <div className="fatwa-sheet-backdrop" onClick={() => setOpen(null)}>
          <div className="fatwa-sheet" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="tajweed-sheet-close" onClick={() => setOpen(null)} aria-label="إغلاق">×</button>
            <span className="fatwa-card-cat">{open.category || "فتوى"}</span>
            <h3>{open.title}</h3>
            {open.question ? <p className="fatwa-sheet-q">{open.question}</p> : null}
            {detailLoading ? <p className="muted">جارٍ تحميل نص الفتوى…</p> : null}
            {open.answer ? <div className="fatwa-sheet-a">{open.answer}</div> : null}
            <small className="muted">{open.mufti || PAGE_SIZE_NOTE}</small>
          </div>
        </div>
      ) : null}
    </div>
  );
}
