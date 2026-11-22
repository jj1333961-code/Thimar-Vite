import { useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { tuhfaSections } from "../../data/tuhfa";
import { tuhfaVerseReciters, tuhfaVerseWindow } from "../../data/tuhfaVerseAudio";
import { normalizeArabic } from "../../lib/quran";

// كل وجه يبقى داخل باب واحد، ويُعرض كاملًا في الشاشة دون تمرير.
const PAGE_SIZE = 6;
const MARKS_KEY = "thimar.tuhfa.marks";
const NOTES_KEY = "thimar.tuhfa.notes";
const SESSIONS_KEY = "thimar.tuhfaLogs";

type Screen = "setup" | "read" | "archive" | "session";

type FlatVerse = {
  n: number;
  first: string;
  second: string;
  sectionId: string;
  sectionTitle: string;
};

const VERSES: FlatVerse[] = tuhfaSections.flatMap((section) =>
  section.verses.map((verse) => ({
    n: verse.n,
    first: verse.first,
    second: verse.second,
    sectionId: section.id,
    sectionTitle: section.title,
  })),
);

const PAGES: FlatVerse[][] = [];
for (const section of tuhfaSections) {
  const sectionVerses: FlatVerse[] = section.verses.map((verse) => ({
    n: verse.n,
    first: verse.first,
    second: verse.second,
    sectionId: section.id,
    sectionTitle: section.title,
  }));
  for (let i = 0; i < sectionVerses.length; i += PAGE_SIZE) {
    PAGES.push(sectionVerses.slice(i, i + PAGE_SIZE));
  }
}

function verseText(verse: FlatVerse): string {
  return `${verse.first} ${verse.second}`;
}

function bare(text: string): string {
  return normalizeArabic(text);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

type Session = {
  at: number;
  progress?: number;
  revealed?: number;
  wrong?: number;
  cancelled?: boolean;
  errorLog?: { word?: string; spoken?: string }[];
};

/** كلمة مميّزة بخلفية صفراء عند مطابقة البحث. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  return (
    <>
      {text.split(/\s+/).map((word, index) => {
        const plain = bare(word);
        const hit = plain.length > 0 && terms.some((term) => plain.includes(term));
        return (
          <span key={`${word}-${index}`}>
            {hit ? (
              <mark style={{ background: "#fde047", color: "#1f2937", padding: "0 2px", borderRadius: 3 }}>{word}</mark>
            ) : (
              word
            )}{" "}
          </span>
        );
      })}
    </>
  );
}

export default function TuhfaMushaf({
  initialScreen = "setup",
  onClose,
}: {
  initialScreen?: "setup" | "archive";
  onClose: () => void;
}) {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [query, setQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [jumpVerse, setJumpVerse] = useState("1");
  const [selectedVerses, setSelectedVerses] = useState<number[]>([]);
  const selectionAnchor = useRef<number | null>(null);
  const [focusedVerse, setFocusedVerse] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [marks, setMarks] = useState<Set<number>>(() => new Set(readJson<number[]>(MARKS_KEY, [])));
  const [notes, setNotes] = useState<Record<number, string>>(() => readJson<Record<number, string>>(NOTES_KEY, {}));
  const [sessions] = useState<Session[]>(() => readJson<Session[]>(SESSIONS_KEY, []));
  const [reciterId, setReciterId] = useState(tuhfaVerseReciters[0]?.id ?? "");
  const [verseRepeat, setVerseRepeat] = useState(2);
  const [paraRepeat, setParaRepeat] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tokenRef = useRef(0);
  const tapRef = useRef<{ n: number; at: number } | null>(null);
  const touchStart = useRef<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(MARKS_KEY, JSON.stringify([...marks]));
    } catch {
      /* ignore */
    }
  }, [marks]);
  useEffect(() => {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch {
      /* ignore */
    }
  }, [notes]);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    return () => {
      tokenRef.current += 1;
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  const reciter = tuhfaVerseReciters.find((item) => item.id === reciterId) ?? tuhfaVerseReciters[0];
  const page = PAGES[Math.max(0, Math.min(PAGES.length - 1, pageIndex))];

  const terms = useMemo(
    () => bare(query).split(/\s+/).map((term) => term.trim()).filter(Boolean),
    [query],
  );

  const results = useMemo(() => {
    if (terms.length === 0) return [];
    return VERSES.filter((verse) => {
      const plain = bare(verseText(verse));
      return terms.every((term) => plain.includes(term));
    });
  }, [terms]);

  function stopAudio() {
    tokenRef.current += 1;
    audioRef.current?.pause();
    setPlaying(false);
  }

  function playWindow(reciterUrl: string, verseNumber: number, rate: number): Promise<void> {
    return new Promise((resolve) => {
      const audio = audioRef.current;
      if (!audio || !reciter) {
        resolve();
        return;
      }
      const [start, end] = tuhfaVerseWindow(reciter, verseNumber);
      if (audio.src !== reciterUrl) audio.src = reciterUrl;
      audio.playbackRate = rate;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        audio.ontimeupdate = null;
        audio.onerror = null;
        audio.pause();
        resolve();
      };
      const begin = () => {
        try {
          audio.currentTime = start;
        } catch {
          /* ignore */
        }
        audio.play().catch(finish);
      };
      audio.ontimeupdate = () => {
        if (audio.currentTime >= end - 0.03) finish();
      };
      audio.onerror = finish;
      if (audio.readyState >= 1) begin();
      else {
        audio.onloadedmetadata = begin;
        audio.load();
      }
    });
  }

  const playVerse = async (verseNumber: number, times = verseRepeat) => {
    if (!reciter) return;
    stopAudio();
    const token = ++tokenRef.current;
    setPlaying(true);
    for (let i = 0; i < Math.max(1, times); i += 1) {
      if (token !== tokenRef.current) return;
      setStatus(`تشغيل البيت ${verseNumber} — تكرار ${i + 1}/${times}`);
      await playWindow(reciter.url, verseNumber, speed);
    }
    if (token === tokenRef.current) {
      setPlaying(false);
      setStatus("");
    }
  };

  const playPage = async () => {
    if (!reciter) return;
    stopAudio();
    const token = ++tokenRef.current;
    setPlaying(true);
    for (let round = 0; round < Math.max(1, paraRepeat); round += 1) {
      for (const verse of page) {
        if (token !== tokenRef.current) return;
        for (let repeat = 0; repeat < Math.max(1, verseRepeat); repeat += 1) {
          if (token !== tokenRef.current) return;
          setStatus(`الفقرة ${round + 1}/${paraRepeat} • البيت ${verse.n}`);
          await playWindow(reciter.url, verse.n, speed);
        }
      }
    }
    if (token === tokenRef.current) {
      setPlaying(false);
      setStatus("");
    }
  };

  function goToVerse(verseNumber: number) {
    const index = PAGES.findIndex((list) => list.some((verse) => verse.n === verseNumber));
    if (index >= 0) setPageIndex(index);
    selectionAnchor.current = verseNumber;
    setSelectedVerses([verseNumber]);
    setJumpVerse(String(verseNumber));
    setScreen("read");
  }

  function changePage(next: number) {
    const clamped = Math.max(0, Math.min(PAGES.length - 1, next));
    if (clamped === pageIndex) return;
    setPageIndex(clamped);
    setSelectedVerses([]);
    selectionAnchor.current = null;
    const first = PAGES[clamped]?.[0]?.n;
    if (first) setJumpVerse(String(first));
  }

  /** ضغطة: تحديد، وضغطة ثانية: تحديد ما بين البيتين، وضغطتان سريعتان: نافذة البيت. */
  function handleTap(verseNumber: number) {
    const now = Date.now();
    if (tapRef.current && tapRef.current.n === verseNumber && now - tapRef.current.at < 350) {
      tapRef.current = null;
      setFocusedVerse(verseNumber);
      return;
    }
    tapRef.current = { n: verseNumber, at: now };

    const anchor = selectionAnchor.current;
    if (anchor === null) {
      selectionAnchor.current = verseNumber;
      setSelectedVerses([verseNumber]);
      return;
    }
    if (anchor === verseNumber && selectedVerses.length === 1) {
      selectionAnchor.current = null;
      setSelectedVerses([]);
      return;
    }
    const from = Math.min(anchor, verseNumber);
    const to = Math.max(anchor, verseNumber);
    setSelectedVerses(VERSES.filter((verse) => verse.n >= from && verse.n <= to).map((verse) => verse.n));
  }

  function onTouchStart(event: ReactTouchEvent) {
    touchStart.current = event.touches[0].clientX;
  }
  function onTouchEnd(event: ReactTouchEvent) {
    if (touchStart.current === null) return;
    const dx = event.changedTouches[0].clientX - touchStart.current;
    // السحب لليسار → الوجه التالي، ولليمين → الوجه السابق.
    // السحب لليسار يعرض الوجه السابق، ولليمين يعرض الوجه التالي.
    if (dx < -50) changePage(pageIndex - 1);
    if (dx > 50) changePage(pageIndex + 1);
    touchStart.current = null;
  }

  const focused = focusedVerse !== null ? VERSES.find((verse) => verse.n === focusedVerse) : null;

  /* ---------- إعداد / بحث ---------- */
  if (screen === "setup") {
    return (
      <div className="page standalone-page tuhfa-mushaf" style={{ paddingBottom: 90 }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "6px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" className="ghost-button" onClick={onClose}>→ رجوع</button>
            <strong>التحفة — القراءة والبحث</strong>
          </div>

          <div className="tuhfa-search-bar" style={{ marginTop: 12 }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث في التحفة بحرف أو أكثر من كلمة…"
              aria-label="البحث في التحفة"
              style={{ flex: 1 }}
            />
          </div>

          {query.trim() ? (
            <div style={{ marginTop: 10 }}>
              <p className="muted">{results.length} نتيجة</p>
              {results.length === 0 ? <p className="muted">لا توجد أبيات تحتوي على «{query.trim()}».</p> : null}
              {results.map((verse) => (
                <button
                  key={verse.n}
                  type="button"
                  onClick={() => goToVerse(verse.n)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "right",
                    padding: "10px 12px",
                    marginBottom: 8,
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    cursor: "pointer",
                    lineHeight: 1.9,
                  }}
                >
                  <span className="muted" style={{ fontSize: 12 }}>
                    {verse.sectionTitle} • البيت {verse.n}
                  </span>
                  <span style={{ display: "block", fontFamily: "Amiri, serif", fontSize: 18 }}>
                    <Highlighted text={verseText(verse)} terms={terms} />
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 10, marginTop: 16, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 14 }}>
            <label style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <span>الوجه</span>
              <select
                value={pageIndex}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setPageIndex(next);
                  const first = PAGES[next]?.[0]?.n;
                  if (first) setJumpVerse(String(first));
                }}
                style={{ flex: 1, padding: "8px 10px", borderRadius: 10 }}
              >
                {PAGES.map((list, index) => (
                  <option key={index} value={index}>
                    الوجه {index + 1} — الأبيات {list[0]?.n}–{list[list.length - 1]?.n}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <span>رقم البيت</span>
              {/* أرقام الأبيات هنا هي أبيات الوجه المختار فقط. */}
              <select
                value={jumpVerse}
                onChange={(event) => setJumpVerse(event.target.value)}
                style={{ flex: 1, padding: "8px 10px", borderRadius: 10 }}
              >
                {(PAGES[Math.max(0, Math.min(PAGES.length - 1, pageIndex))] ?? []).map((verse) => (
                  <option key={verse.n} value={verse.n}>
                    البيت {verse.n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const target = Number(jumpVerse);
                if (Number.isFinite(target) && target >= 1 && target <= VERSES.length) goToVerse(target);
                else setScreen("read");
              }}
            >
              قراءة
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- الأرشيف ---------- */
  if (screen === "archive") {
    return (
      <div className="page standalone-page" style={{ paddingBottom: 90 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "6px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" className="ghost-button" onClick={onClose}>→ رجوع</button>
            <strong>أرشيف التحفة</strong>
          </div>

          <h3 style={{ marginTop: 16 }}>سجلات التسميع ({sessions.length})</h3>
          {sessions.length === 0 ? (
            <p className="muted">لا توجد تسميعات بعد.</p>
          ) : (
            sessions.map((session, index) => (
              <button
                key={`${session.at}-${index}`}
                type="button"
                onClick={() => {
                  setActiveSession(session);
                  setScreen("session");
                }}
                style={{ display: "block", width: "100%", textAlign: "right", padding: 12, marginBottom: 8, borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer" }}
              >
                <strong>{new Date(session.at).toLocaleString("ar")}</strong>
                <span className="muted" style={{ display: "block", fontSize: 13 }}>
                  تقدم {session.progress ?? 0}% • صحيح {session.revealed ?? 0} • أخطاء {session.wrong ?? 0}
                  {session.cancelled ? " • ملغاة" : ""}
                </span>
              </button>
            ))
          )}

          <h3 style={{ marginTop: 16 }}>علامات المراجعة ({marks.size})</h3>
          {marks.size === 0 ? (
            <p className="muted">لا توجد علامات.</p>
          ) : (
            <ul style={{ paddingInlineStart: 18 }}>
              {[...marks].sort((a, b) => a - b).map((n) => (
                <li key={n} style={{ marginBottom: 4 }}>
                  <button type="button" style={{ background: "none", border: "none", color: "#0f5f4e", cursor: "pointer", padding: 0 }} onClick={() => goToVerse(n)}>
                    البيت #{n}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3 style={{ marginTop: 16 }}>الملاحظات ({Object.keys(notes).filter((key) => notes[Number(key)]?.trim()).length})</h3>
          {Object.keys(notes).filter((key) => notes[Number(key)]?.trim()).length === 0 ? (
            <p className="muted">لا توجد ملاحظات.</p>
          ) : (
            <ul style={{ paddingInlineStart: 18 }}>
              {Object.entries(notes)
                .filter(([, value]) => value.trim())
                .map(([key, value]) => (
                  <li key={key} style={{ marginBottom: 4 }}>
                    <button type="button" style={{ background: "none", border: "none", color: "#0f5f4e", cursor: "pointer", padding: 0, textAlign: "right" }} onClick={() => goToVerse(Number(key))}>
                      البيت #{key}: {value}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  /* ---------- نتيجة تسميع ---------- */
  if (screen === "session" && activeSession) {
    return (
      <div className="page standalone-page" style={{ paddingBottom: 90 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "6px 12px" }}>
          <button type="button" className="ghost-button" onClick={() => setScreen("archive")}>→ رجوع للأرشيف</button>
          <h2 className="page-title">نتيجة التسميع</h2>
          <p className="muted">{new Date(activeSession.at).toLocaleString("ar")}</p>
          <div style={{ display: "flex", gap: 18, justifyContent: "center", margin: "16px 0", fontWeight: 700 }}>
            <span>التقدم {activeSession.progress ?? 0}%</span>
            <span>كلمات صحيحة {activeSession.revealed ?? 0}</span>
            <span>أخطاء {activeSession.wrong ?? 0}</span>
          </div>
          {activeSession.errorLog && activeSession.errorLog.length > 0 ? (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {activeSession.errorLog.map((entry, index) => (
                <li key={index} style={{ margin: "6px 0", padding: 10, background: "rgba(239,68,68,0.12)", borderRadius: 8 }}>
                  {entry.word}
                  {entry.spoken ? ` (سمعت: ${entry.spoken})` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">لا توجد أخطاء.</p>
          )}
        </div>
      </div>
    );
  }

  /* ---------- القراءة ---------- */
  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="tuhfa-read"
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "var(--bg)", color: "var(--text)", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", fontSize: 14, background: "color-mix(in srgb, var(--card) 82%, transparent)", borderBottom: "1px solid var(--border)" }}>
        <button type="button" onClick={() => { stopAudio(); setScreen("setup"); }} style={{ background: "transparent", border: "none", color: "var(--text)", fontSize: 20, cursor: "pointer" }} aria-label="رجوع">×</button>
        <span style={{ fontWeight: 700, color: "var(--primary)" }}>تحفة الأطفال</span>
        <span className="muted">الوجه {pageIndex + 1} من {PAGES.length}</span>
      </div>

      {/* كل أبيات الوجه في الشاشة بخط كبير متصل بلا صناديق ولا فراغات. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-evenly",
          gap: 2,
          padding: "2px 8px 4px",
          direction: "rtl",
        }}
      >
        {page.map((verse) => {
          const selected = selectedVerses.includes(verse.n);
          const firstInPage = verse.n === page[0]?.n;
          return (
            <div
              key={verse.n}
              onClick={() => handleTap(verse.n)}
              role="button"
              aria-label={`البيت ${verse.n}`}
              style={{
                flex: "0 0 auto",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 0,
                padding: "0 2px",
                margin: 0,
                borderRadius: selected ? 8 : 0,
                cursor: "pointer",
                background: selected ? "rgba(250,204,21,0.28)" : "transparent",
                transition: "background 120ms ease",
              }}
            >
              {firstInPage ? (
                <div className="tuhfa-section-band" style={{ fontSize: "clamp(15px, 3.4vw, 20px)", fontWeight: 700 }}>
                  {verse.sectionTitle}
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 6, width: "100%" }}>
                <span style={{ fontFamily: "Amiri, serif", fontSize: "clamp(24px, 5.4vw, 36px)", lineHeight: 1.6, fontWeight: 700 }}>
                  {verse.first}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 6, paddingInlineStart: "0.8em", width: "100%" }}>
                <span style={{ fontFamily: "Amiri, serif", fontSize: "clamp(24px, 5.4vw, 36px)", lineHeight: 1.6, fontWeight: 700 }}>
                  {verse.second}
                </span>
                <span style={{ color: "#b08a3e", fontSize: "clamp(13px, 2.4vw, 16px)", flexShrink: 0 }}>﴿{verse.n}﴾</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 14px 10px", gap: 8, minHeight: 26 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {status || (selectedVerses.length > 0 ? `محدد: ${selectedVerses.length} بيت — اضغط البيت مرة أخرى لإلغاء التحديد` : "اسحب: الوجه السابق أو التالي")}
        </span>
      </div>

      {focused ? (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}
          onClick={() => setFocusedVerse(null)}
        >
          <div
            style={{ background: "var(--card)", color: "var(--text)", border: "1px solid var(--border)", padding: 18, borderRadius: 16, maxWidth: 420, width: "92%", maxHeight: "86vh", overflow: "auto", position: "relative" }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setFocusedVerse(null)}
              aria-label="إلغاء"
              style={{ position: "absolute", top: 6, insetInlineEnd: 8, background: "transparent", border: "none", fontSize: 24, lineHeight: 1, cursor: "pointer" }}
            >
              ×
            </button>
            <h3 style={{ margin: "0 0 6px", color: "var(--primary)" }}>البيت {focused.n}</h3>
            <p style={{ fontFamily: "Amiri, serif", fontSize: 18, lineHeight: 1.9, margin: "6px 0 12px" }}>
              {verseText(focused)}
            </p>

            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <span>القارئ</span>
              <select value={reciterId} onChange={(event) => setReciterId(event.target.value)} style={{ flex: 1, padding: "6px 8px", borderRadius: 8 }}>
                {tuhfaVerseReciters.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <span>تكرار البيت</span>
              <select value={verseRepeat} onChange={(event) => setVerseRepeat(Number(event.target.value))} style={{ flex: 1, padding: "6px 8px", borderRadius: 8 }}>
                {[1, 2, 3, 5, 7, 10].map((value) => <option key={value} value={value}>{value}×</option>)}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <span>تكرار الفقرة</span>
              <select value={paraRepeat} onChange={(event) => setParaRepeat(Number(event.target.value))} style={{ flex: 1, padding: "6px 8px", borderRadius: 8 }}>
                {[1, 2, 3, 5].map((value) => <option key={value} value={value}>{value}×</option>)}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <span>سرعة القارئ</span>
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} style={{ flex: 1, padding: "6px 8px", borderRadius: 8 }}>
                {[0.5, 0.75, 1, 1.25, 1.5].map((value) => <option key={value} value={value}>{value}×</option>)}
              </select>
            </label>

            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 10 }}>
              <button type="button" className="primary-button" onClick={() => playVerse(focused.n)} disabled={playing}>
                ▶ تشغيل البيت
              </button>
              <button type="button" className="ghost-button" onClick={playPage} disabled={playing}>
                تشغيل الفقرة
              </button>
              <button type="button" className="ghost-button" onClick={stopAudio}>إيقاف</button>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
              <button
                type="button"
                className={`chip-toggle ${marks.has(focused.n) ? "active" : ""}`}
                onClick={() =>
                  setMarks((previous) => {
                    const next = new Set(previous);
                    if (next.has(focused.n)) next.delete(focused.n);
                    else next.add(focused.n);
                    return next;
                  })
                }
              >
                ✓ علامة
              </button>
            </div>

            <textarea
              placeholder="اكتب ملاحظتك لهذا البيت…"
              value={notes[focused.n] ?? ""}
              onChange={(event) => setNotes((previous) => ({ ...previous, [focused.n]: event.target.value }))}
              style={{ width: "100%", minHeight: 64, marginTop: 10, padding: 8, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-2)", color: "var(--text)", fontSize: 14 }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
