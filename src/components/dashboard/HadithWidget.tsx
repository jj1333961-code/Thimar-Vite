import { useEffect, useState } from "react";
import { fetchRandomHadith, type Hadith } from "../../lib/islamic";
import { Icon } from "./ui";

export default function HadithWidget() {
  const [hadith, setHadith] = useState<Hadith | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(true);

  const load = (avoidId?: string) => {
    setLoading(true);
    setError("");
    fetchRandomHadith(undefined, avoidId)
      .then(setHadith)
      .catch((err) => setError(err instanceof Error ? err.message : "تعذّر تحميل الحديث."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="hadith-widget">
      <div className="widget-head">
        <h4>حديث اليوم</h4>
        <button type="button" className="icon-button" onClick={() => load(hadith?.id)} aria-label="حديث آخر">
          <Icon name="refresh" size={18} />
        </button>
      </div>
      {loading ? (
        <div className="skeleton-list">
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </div>
      ) : error ? (
        <div className="error-box compact">
          <p>{error}</p>
          <button type="button" onClick={() => load(hadith?.id)}>إعادة</button>
        </div>
      ) : hadith ? (
        <>
          <div className="hadith-meta">
            <span className="hadith-title">{hadith.title}</span>
            <span className={`grade grade-${hadith.grade.includes("صحيح") ? "saheeh" : "hasan"}`}>
              {hadith.grade}
            </span>
          </div>
          <p className="hadith-text">«{hadith.text}»</p>
          <p className="hadith-attr">{hadith.attribution}</p>
          <button type="button" className="link-button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "إخفاء الشرح" : "عرض الشرح"}
          </button>
          {expanded ? (
            <div className="hadith-expl">
              <p>{hadith.explanation}</p>
              {hadith.reference ? <small>{hadith.reference}</small> : null}
              {hadith.hints.length ? (
                <ul>
                  {hadith.hints.map((hint, index) => (
                    <li key={index}>{hint}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
