import { useEffect, useMemo, useState } from "react";
import { adhkar, type AdhkarCategory } from "../../data/adhkar";
import { Icon } from "./ui";

const STORAGE_KEY = "thimar.adhkar.counts.v1";

const DUA_CATEGORIES = new Set(["duas", "quranic", "distress", "healing", "knowledge", "parents", "children"]);

function normalize(text: string) {
  return text
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

type Kind = "adhkar" | "duas";

export default function AdhkarPage() {
  const [kind, setKind] = useState<Kind>("adhkar");
  const [active, setActive] = useState(adhkar[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { date: string; counts: Record<string, number> };
      if (parsed.date === todayKey()) setCounts(parsed.counts ?? {});
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayKey(), counts }));
    } catch { /* ignore */ }
  }, [counts]);

  const categoriesOfKind = useMemo(
    () => adhkar.filter((item) => (kind === "duas" ? DUA_CATEGORIES.has(item.id) : !DUA_CATEGORIES.has(item.id))),
    [kind],
  );

  useEffect(() => {
    if (!categoriesOfKind.some((item) => item.id === active)) {
      setActive(categoriesOfKind[0]?.id ?? "");
    }
  }, [kind, active, categoriesOfKind]);

  const category: AdhkarCategory | undefined = adhkar.find((item) => item.id === active);
  const q = normalize(query);
  const results = useMemo(() => {
    if (q) {
      return adhkar
        .filter((item) => (kind === "duas" ? DUA_CATEGORIES.has(item.id) : !DUA_CATEGORIES.has(item.id)))
        .flatMap((item) => item.items.map((entry) => ({ ...entry, categoryTitle: item.title })))
        .filter((entry) => normalize(`${entry.text} ${entry.source} ${entry.categoryTitle}`).includes(q));
    }
    return (category?.items ?? []).map((entry) => ({ ...entry, categoryTitle: category?.title ?? "" }));
  }, [q, kind, category]);

  const totalOfKind = useMemo(
    () => adhkar
      .filter((item) => (kind === "duas" ? DUA_CATEGORIES.has(item.id) : !DUA_CATEGORIES.has(item.id)))
      .reduce((sum, item) => sum + item.items.length, 0),
    [kind],
  );

  return (
    <div className="adhkar-page">
      <div className="adhkar-kind-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={kind === "adhkar"} className={kind === "adhkar" ? "active" : ""} onClick={() => setKind("adhkar")}>
          <Icon name="sun" size={16} /> الأذكار
        </button>
        <button type="button" role="tab" aria-selected={kind === "duas"} className={kind === "duas" ? "active" : ""} onClick={() => setKind("duas")}>
          <Icon name="sparkles" size={16} /> الأدعية
        </button>
      </div>

      <div className="adhkar-search">
        <Icon name="search" size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={kind === "duas" ? "ابحث في الأدعية…" : "ابحث في الأذكار…"}
          aria-label="بحث"
        />
        {query ? (
          <button type="button" className="icon-button" onClick={() => setQuery("")} aria-label="مسح">
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>

      <p className="adhkar-meta">
        {q ? `${results.length} نتيجة` : `${categoriesOfKind.length} قسمًا • ${totalOfKind} ${kind === "duas" ? "دعاءً" : "ذكرًا"}`}
      </p>

      {!q ? (
        <div className="tab-row adhkar-tabs">
          {categoriesOfKind.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`tab ${active === item.id ? "active" : ""}`}
              onClick={() => setActive(item.id)}
            >
              {item.title}
              <span className="tab-count">{item.items.length}</span>
            </button>
          ))}
        </div>
      ) : null}

      {!q && category ? <p className="tab-subtitle">{category.subtitle}</p> : null}

      <div className="adhkar-list adhkar-list--page">
        {results.length === 0 ? <p className="muted">لا توجد نتائج مطابقة.</p> : null}
        {results.map((item) => {
          const count = counts[item.id] ?? 0;
          const done = count >= item.repeat;
          return (
            <button
              key={`${item.id}-${item.categoryTitle}`}
              type="button"
              className={`adhkar-card ${done ? "done" : ""}`}
              onClick={() =>
                setCounts((previous) => ({
                  ...previous,
                  [item.id]: Math.min(item.repeat, (previous[item.id] ?? 0) + 1),
                }))
              }
            >
              <p>{item.text}</p>
              <div className="adhkar-foot">
                <span>{q ? item.categoryTitle : item.source}</span>
                <span className="counter">{done ? <Icon name="check" size={14} /> : `${count}/${item.repeat}`}</span>
              </div>
            </button>
          );
        })}
      </div>

      <p className="muted adhkar-hint">اضغط على الذكر أو الدعاء لعدّه. يُحفظ تقدّم اليوم تلقائيًا.</p>
    </div>
  );
}
