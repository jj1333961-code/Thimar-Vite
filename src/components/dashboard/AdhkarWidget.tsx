import { useEffect, useMemo, useState } from "react";
import { adhkar, type AdhkarCategory } from "../../data/adhkar";
import { Icon } from "./ui";

const STORAGE_KEY = "thimar.adhkar.counts.v1";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalize(text: string) {
  return text.replace(/[\u064B-\u0652\u0670\u0640]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
}

export default function AdhkarWidget() {
  const [active, setActive] = useState(adhkar[0]?.id ?? "");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { date: string; counts: Record<string, number> };
      if (parsed.date === todayKey()) setCounts(parsed.counts ?? {});
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayKey(), counts }));
  }, [counts]);

  const category: AdhkarCategory | undefined = adhkar.find((item) => item.id === active);
  const filtered = useMemo(() => {
    if (!category) return [];
    const q = normalize(query.trim());
    if (!q) return category.items;
    return category.items.filter((item) => normalize(`${item.text} ${item.source}`).includes(q));
  }, [category, query]);

  const totalItems = adhkar.reduce((sum, item) => sum + item.items.length, 0);

  return (
    <div className="adhkar-widget">
      <div className="widget-head">
        <div>
          <h4>أذكار وأدعية</h4>
          <p className="muted">{adhkar.length} قسمًا • {totalItems} ذكرًا ودعاءً</p>
        </div>
        <span className="badge badge-info">يومي</span>
      </div>

      <div className="adhkar-search">
        <Icon name="search" size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث في الأذكار والأدعية…"
        />
        {query ? (
          <button type="button" className="icon-button" onClick={() => setQuery("")} aria-label="مسح البحث">
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>

      <div className="tab-row adhkar-tabs">
        {adhkar.map((item) => (
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

      {category ? (
        <>
          <p className="tab-subtitle">{category.subtitle}</p>
          <div className="adhkar-list">
            {filtered.length === 0 ? (
              <p className="muted">لا توجد نتائج مطابقة في هذا القسم.</p>
            ) : (
              filtered.map((item) => {
                const count = counts[item.id] ?? 0;
                const done = count >= item.repeat;
                return (
                  <button
                    key={item.id}
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
                      <span>{item.source}</span>
                      <span className="counter">
                        {done ? <Icon name="check" size={14} /> : `${count}/${item.repeat}`}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <p className="muted adhkar-hint">اضغط على الذكر لعدّه. يُحفظ تقدم اليوم تلقائيًا.</p>
        </>
      ) : null}
    </div>
  );
}
