import { lazy, Suspense, useEffect, useState } from "react";
import { fetchSurah, fetchTafsir, type Ayah, type TafsirEntry } from "../../lib/quran";
import { surahs } from "../../data/surahs";
import type { Settings } from "../../lib/appStore";
/* محرك التسميع ثقيل ويُفتح عند الحاجة فقط، فلا يبطئ بدء التطبيق ولا فتح المصحف. */
const TasmeeReader = lazy(() => import("./TasmeeReader"));
import MushafPages from "./MushafPages";
import QuranReadingEntry from "./QuranReadingEntry";
import TuhfaMushaf from "./TuhfaMushaf";
import MushafTasmeeArchive from "./MushafTasmeeArchive";
const TuhfaTasmeeReader = lazy(() => import("./TuhfaTasmeeReader"));
import HadithWidget from "./HadithWidget";
import HadithSearchPage from "./HadithSearchPage";
import QiblaWidget from "./QiblaWidget";
import { Icon, type IconName } from "./ui";
import { cachedFetch } from "../../lib/offlineCache";
import { useHistoryBack } from "../../lib/useHistoryBack";

function PageHead({ title, subtitle, onBack }: { title: string; subtitle: string; onBack: () => void }) {
  return (
    <div className="page-head standalone-head">
      <div>
        <button type="button" className="ghost-button back-button" onClick={onBack}>
          <Icon name="arrow-right" size={16} /> الرئيسية
        </button>
        <h2>{title}</h2>
        <p className="muted">{subtitle}</p>
      </div>
    </div>
  );
}

function CircularHub({
  items,
  onSelect,
  layout = "row",
}: {
  items: { id: string; label: string; icon: IconName }[];
  onSelect: (id: string) => void;
  layout?: "row" | "two";
}) {
  const two = layout === "two";
  return (
    <div
      className={`circular-hub ${two ? "hub-grid-two" : ""}`}
      role="toolbar"
      aria-label="أوامر المصحف"
      style={
        two
          ? { display: "grid", gridTemplateColumns: "repeat(2, auto)", justifyContent: "center", justifyItems: "center", gap: 18 }
          : undefined
      }
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className="hub-circle"
          title={item.label}
          aria-label={item.label}
          style={two && index === items.length - 1 && items.length === 3 ? { gridColumn: "1 / -1" } : undefined}
          onClick={() => onSelect(item.id)}
        >
          <span className="hub-icon" aria-hidden="true">
            <Icon name={item.icon} size={30} />
          </span>
          <span className="hub-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function QuranPage({ onBack, onOpenSettings }: { settings: Settings; onBack: () => void; onOpenSettings: () => void }) {
  const [mode, setMode] = useState<"tasmee" | "reading" | null>(null);
  const [tasmeeInitialPhase, setTasmeeInitialPhase] = useState<"config" | "result">("config");
  const [mushafOpen, setMushafOpen] = useState(false);
  const [mushafInitialPage, setMushafInitialPage] = useState<number | undefined>(undefined);
  const [archiveOpen, setArchiveOpen] = useState(false);

  /* زر الرجوع في الهاتف يخرج من القراءة/التسميع بدل زر ×. */
  const dismissMode = useHistoryBack(mode !== null, () => setMode(null));
  const openAyahInMushaf = async (globalAyah: number) => {
    try {
      const res = await cachedFetch(`https://api.alquran.cloud/v1/ayah/${globalAyah}`);
      const data = await res.json();
      const p = data?.data?.page;
      if (p) setMushafInitialPage(p);
    } catch { /* ignore */ }
    setArchiveOpen(false);
    setMushafOpen(true);
  };
  if (mushafOpen) return <MushafPages onClose={() => setMushafOpen(false)} initialPage={mushafInitialPage} />;

  if (mode) {
    return (
      <div className="page standalone-page mushaf-page mushaf-subpage" style={{ padding: 0 }}>
        {/* صفحة القرآن لها زر إغلاق واحد بجوار «القرآن الكريم»؛ لا نكرّره هنا. */}
        {mode === "tasmee" ? (
          <button type="button" className="standalone-close" onClick={dismissMode} aria-label="إغلاق" title="إغلاق">
            ×
          </button>
        ) : null}
        {mode === "tasmee" ? (
          <Suspense fallback={<p className="muted">جارٍ فتح محرك التسميع…</p>}>
            <TasmeeReader initialPhase={tasmeeInitialPhase} onOpenSettings={onOpenSettings} />
          </Suspense>
        ) : (
          <QuranReadingEntry onBack={dismissMode} />
        )}
      </div>
    );
  }

  return (
    <div className="page standalone-page mushaf-page quran-hub-standalone">
      <div className="quran-hub-back-row">
        <button type="button" className="quran-hub-close" onClick={onBack} aria-label="إغلاق" title="إغلاق">
          ×
        </button>
      </div>
      <CircularHub
        layout="two"
        items={[
          { id: "mushaf", label: "المصحف", icon: "book" },
          { id: "tasmee", label: "تسميع", icon: "mic" },
          { id: "archive", label: "الأرشيف", icon: "sparkles" },
        ]}
        onSelect={(id) => {
          if (id === "archive") setArchiveOpen(true);
          else if (id === "mushaf") setMushafOpen(true);
          else setMode("tasmee");
        }}
      />

      {archiveOpen ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setArchiveOpen(false)}>
          <div style={{ background: "var(--card)", padding: 20, borderRadius: 12, maxWidth: 460, width: "92%", maxHeight: "80vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>الأرشيف — تسميعات وملاحظات وعلامات</h3>
            <h4>علامات المراجعة</h4>
            {(() => {
              try {
                const marks = new Set<number>(JSON.parse(localStorage.getItem("thimar.reviewMarks") || "[]") as number[]);
                const notes = JSON.parse(localStorage.getItem("thimar.notes") || "{}");
                if (marks.size === 0 && Object.keys(notes).length === 0) return <p className="muted">لا توجد علامات/ملاحظات.</p>;
                return (
                  <ul style={{ paddingInlineStart: 18 }}>
                    {[...marks].map((n: number) => (
                      <li key={n}><button type="button" style={{ background: "none", border: "none", color: "#0f5f4e", cursor: "pointer", padding: 0 }} onClick={() => openAyahInMushaf(n)}>آية #{n}{notes[n] ? ` — ${notes[n]}` : ""}</button></li>
                    ))}
                    {Object.entries(notes).filter(([k]) => !marks.has(Number(k))).map(([k, v]) => (
                      <li key={k}><button type="button" style={{ background: "none", border: "none", color: "#0f5f4e", cursor: "pointer", padding: 0 }} onClick={() => openAyahInMushaf(Number(k))}>آية #{k}: {String(v)}</button></li>
                    ))}
                  </ul>
                );
              } catch {
                return <p className="muted">لا توجد بيانات.</p>;
              }
            })()}
            <h4>تسميع المصحف</h4>
            <MushafTasmeeArchive />
            <h4>تسميعات الحفظ ({(() => { try { return JSON.parse(localStorage.getItem("thimar.tasmeeSessions") || "[]").length; } catch { return 0; } })()})</h4>
            {(() => {
              try {
                const raw = localStorage.getItem("thimar.tasmeeSessions");
                const sessions = raw ? JSON.parse(raw) : [];
                if (!Array.isArray(sessions) || sessions.length === 0) return <p className="muted">لا توجد تسميعات.</p>;
                return (
                  <ul style={{ listStyle: "none", padding: 0 }}>
                    {sessions.map((s: { at: number; progress?: number; wrong?: number; errorLog?: { word?: string; spoken?: string }[] }, i: number) => (
                      <li key={i} style={{ margin: "6px 0", padding: 8, background: "rgba(0,0,0,0.05)", borderRadius: 6 }}>
                        <details>
                          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                            {new Date(s.at).toLocaleString("ar")} — تقدم {s.progress ?? 0}% • أخطاء {s.wrong ?? 0}
                          </summary>
                          {Array.isArray(s.errorLog) && s.errorLog.length > 0 ? (
                            <ul style={{ paddingInlineStart: 18, marginTop: 6 }}>
                              {s.errorLog.map((e, j) => (
                                <li key={j}>{e.word}{e.spoken ? ` (سمعت: ${e.spoken})` : ""}</li>
                              ))}
                            </ul>
                          ) : <p className="muted" style={{ marginTop: 6 }}>لا توجد أخطاء.</p>}
                        </details>
                      </li>
                    ))}
                  </ul>
                );
              } catch {
                return <p className="muted">لا توجد تسميعات.</p>;
              }
            })()}
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <button type="button" className="ghost-button" onClick={() => { setTasmeeInitialPhase("result"); setArchiveOpen(false); setMode("tasmee"); }}>عرض نتيجة التسميع (آخر جلسة)</button>
            </div>
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button type="button" className="primary-button" onClick={() => setArchiveOpen(false)}>إغلاق</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TuhfaPage({ onBack, onOpenSettings }: { onBack: () => void; onOpenSettings: () => void }) {
  const [mode, setMode] = useState<"tasmee" | "tuhfa" | "archive" | null>(null);
  const [tasmeeInitialPhase] = useState<"config" | "result">("config");

  if (mode === "tuhfa") {
    return <TuhfaMushaf initialScreen="setup" onClose={() => setMode(null)} />;
  }
  if (mode === "archive") {
    return <TuhfaMushaf initialScreen="archive" onClose={() => setMode(null)} />;
  }

  if (mode) {
    return (
      <div className="page standalone-page tuhfa-page-shell tuhfa-subpage" style={{ padding: 0 }}>
        <button type="button" className="standalone-close" onClick={() => setMode(null)} aria-label="إغلاق" title="إغلاق">
          ×
        </button>
        <Suspense fallback={<p className="muted">جارٍ فتح محرك التسميع…</p>}>
          <TuhfaTasmeeReader initialPhase={tasmeeInitialPhase} onOpenSettings={onOpenSettings} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="page standalone-page tuhfa-page-shell tuhfa-hub-shell">
      <button type="button" className="standalone-close" onClick={onBack} aria-label="إغلاق" title="إغلاق">
        ×
      </button>
      <CircularHub
        layout="two"
        items={[
          { id: "tasmee", label: "تسميع", icon: "mic" },
          { id: "tuhfa", label: "التحفة", icon: "book" },
          { id: "archive", label: "الأرشيف", icon: "sparkles" },
        ]}
        onSelect={(id) => setMode(id as "tasmee" | "tuhfa" | "archive")}
      />
    </div>
  );
}

export function HadithPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="page standalone-page hadith-page">
      <PageHead
        title="الأحاديث"
        subtitle="ابحث في مجموعة من الأحاديث الموثّقة، مع الشرح ومساعدة الذكاء الاصطناعي"
        onBack={onBack}
      />
      <HadithWidget />
      <HadithSearchPage />
    </div>
  );
}

export function QiblaPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="page standalone-page">
      <PageHead title="اتجاه القبلة" subtitle="اتّجاه الكعبة من موقعك" onBack={onBack} />
      <QiblaWidget />
    </div>
  );
}

export function TafsirPage({ onBack }: { onBack: () => void }) {
  const [surah, setSurah] = useState(1);
  const [ayahs, setAyahs] = useState<Ayah[]>([]);
  const [fromAyah, setFromAyah] = useState(1);
  const [toAyah, setToAyah] = useState(0); // 0 = حتى آخر السورة
  const [selected, setSelected] = useState<number | null>(null);
  const [tafsirs, setTafsirs] = useState<Record<number, TafsirEntry>>({});
  const [loading, setLoading] = useState(false);
  const [loadingAyah, setLoadingAyah] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [tafsirError, setTafsirError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSelected(null);
    setTafsirs({});
    setFromAyah(1);
    setToAyah(0);
    fetchSurah(surah, controller.signal)
      .then((data) => setAyahs(data))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "تعذّر تحميل السورة.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [surah]);

  const lastAyah = ayahs.length || 1;
  const rangeStart = Math.min(Math.max(1, fromAyah), lastAyah);
  const rangeEnd = toAyah === 0 ? lastAyah : Math.min(Math.max(rangeStart, toAyah), lastAyah);
  const visibleAyahs = ayahs.filter(
    (ayah) => ayah.numberInSurah >= rangeStart && ayah.numberInSurah <= rangeEnd,
  );

  const openTafsir = async (ayah: Ayah) => {
    setTafsirError("");
    if (selected === ayah.numberInSurah) {
      setSelected(null);
      return;
    }
    setSelected(ayah.numberInSurah);
    if (tafsirs[ayah.numberInSurah]) return;
    setLoadingAyah(ayah.numberInSurah);
    try {
      const entry = await fetchTafsir(surah, ayah.numberInSurah);
      setTafsirs((previous) => ({ ...previous, [ayah.numberInSurah]: entry }));
    } catch (err) {
      setTafsirError(err instanceof Error ? err.message : "تعذّر تحميل التفسير.");
    } finally {
      setLoadingAyah(null);
    }
  };

  return (
    <div className="page standalone-page tafsir-page">
      <PageHead
        title="تفسير القرآن"
        subtitle="اختر السورة ونطاق الآيات، واضغط على الآية ليظهر تفسيرها الميسر تحتها"
        onBack={onBack}
      />
      <div className="tafsir-toolbar">
        <label>
          <span>السورة</span>
          <select value={surah} onChange={(event) => setSurah(Number(event.target.value))}>
            {surahs.map((item) => (
              <option key={item.n} value={item.n}>{item.n}. {item.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>من الآية</span>
          <input
            type="number"
            min={1}
            max={lastAyah}
            value={rangeStart}
            onChange={(event) => {
              const value = Number(event.target.value);
              setFromAyah(Number.isFinite(value) ? value : 1);
            }}
          />
        </label>
        <label>
          <span>إلى الآية</span>
          <input
            type="number"
            min={1}
            max={lastAyah}
            value={rangeEnd}
            onChange={(event) => {
              const value = Number(event.target.value);
              setToAyah(Number.isFinite(value) ? value : lastAyah);
            }}
          />
        </label>
        <button
          type="button"
          className="chip-toggle"
          onClick={() => { setFromAyah(1); setToAyah(lastAyah); }}
        >
          السورة كاملة
        </button>
        <span className="badge badge-info">التفسير الميسر</span>
      </div>

      {loading ? <div className="skeleton-list">{Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton-line" />)}</div> : null}
      {error ? <p className="game-error">{error}</p> : null}

      {!loading ? (
        <div className="tafsir-ayahs">
          {visibleAyahs.map((ayah) => (
            <div key={ayah.number} className="tafsir-ayah-block">
              <button
                type="button"
                className={`tafsir-ayah ${selected === ayah.numberInSurah ? "active" : ""}`}
                onClick={() => openTafsir(ayah)}
              >
                <span className="tafsir-ayah-num">{ayah.numberInSurah}</span>
                <span>{ayah.text}</span>
              </button>
              {selected === ayah.numberInSurah ? (
                <div className="tafsir-inline">
                  <span className="tafsir-ref">
                    {tafsirs[ayah.numberInSurah]?.edition ?? "التفسير الميسر"} • {surahs[surah - 1]?.name} {ayah.numberInSurah}
                  </span>
                  {loadingAyah === ayah.numberInSurah ? <p className="muted">جارٍ تحميل التفسير…</p> : null}
                  {tafsirs[ayah.numberInSurah] ? <p>{tafsirs[ayah.numberInSurah].text}</p> : null}
                  {tafsirError ? <p className="game-error">{tafsirError}</p> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
