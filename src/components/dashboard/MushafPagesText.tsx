import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPageMap, loadTajweed, tajweedText, type PageMap, type TajweedData } from "../../lib/tajweed";
import { surahs } from "../../data/surahs";
import { useHistoryBack } from "../../lib/useHistoryBack";
import { ayahKey, loadHafsAyahs, type HafsAyah } from "../../lib/mushafText";
import { loadPageLines } from "../../lib/quranPageLayout";
import type { TasmeeWord, WordStatus } from "../../lib/mushafTasmee";
import MushafAyahMenu from "./MushafAyahMenu";
import MushafTasmeeSheet from "./MushafTasmeeSheet";

/*
 * مصحف التجويد الملوّن برواية حفص — نفس نسخة الموسوعة القرآنية (quranpedia.net)
 * الموجودة في الصورة المرجعية: صفحة بيضاء، إطار رفيع، خط عثماني (Uthmanic Hafs)،
 * أرقام الآيات في زخارف خضراء، وفاصل ذهبي في أسفله زخرفة رقم الصفحة.
 *
 * القراءة هنا بلا تمرير: يُضبط حجم خط الصفحة آليًا حتى تدخل آياتها كلها في الشاشة.
 * النقر يحدّد الآية فقط (ونقرة أبعد تحدّد المدى بينهما)، والضغط المطوّل يفتح
 * الأزرار الدائرية، والسحب يمينًا أو يسارًا يقلّب الصفحات.
 * البسملة واسم السورة يُعرضان منفصلين فوق الآيات ولا يدخلان في التحديد.
 */

const TOTAL_PAGES = 604;
const BASE = import.meta.env.BASE_URL || "/";
const HIDDEN_KEY = "thimar.mushaf.hidden.v1";
const BASMALA = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";
const LONG_PRESS_MS = 480;

function arabicNumber(value: number): string {
  return String(value).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

function readHidden(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeHidden(keys: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...keys]));
  } catch {
    /* التخزين غير متاح */
  }
}

export default function MushafPagesText({
  onClose,
  initialPage,
  initialHighlight,
}: {
  onClose: () => void;
  initialPage?: number;
  initialHighlight?: number | null;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pressRef = useRef<{
    key: string | null;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    long: boolean;
    timer: number | null;
  } | null>(null);

  const [page, setPage] = useState(() => {
    const p = Number(initialPage ?? 1);
    return Number.isFinite(p) ? Math.min(TOTAL_PAGES, Math.max(1, Math.round(p))) : 1;
  });
  const [map, setMap] = useState<PageMap | null>(null);
  const [data, setData] = useState<TajweedData | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [selected, setSelected] = useState<HafsAyah[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden());
  const [fontPx, setFontPx] = useState(0);
  const [linesData, setLinesData] = useState<{ lines: number[][][]; lineNums: number[]; surahStarts: number[][] } | null>(null);
  const [tasmeeOpen, setTasmeeOpen] = useState(false);
  const [tasmeeRevealVerses, setTasmeeRevealVerses] = useState(false);
  const [tasmeeWordsList, setTasmeeWordsList] = useState<TasmeeWord[]>([]);
  const [tasmeeStatuses, setTasmeeStatuses] = useState<WordStatus[]>([]);
  const [tasmeeCursor, setTasmeeCursor] = useState(0);
  const [tasmeeRevealAll, setTasmeeRevealAll] = useState(false);
  const [tasmeeActive, setTasmeeActive] = useState(false);
  const [tasmeeAyahs, setTasmeeAyahs] = useState<HafsAyah[]>([]);
  const [toast, setToast] = useState("");
  const closeMushaf = useHistoryBack(true, onClose, "thimarMushaf");

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadPageMap(), loadTajweed()])
      .then(([pages, tajweed]) => {
        if (cancelled) return;
        setMap(pages);
        setData(tajweed);
      })
      .catch(() => {
        /* تبقى رسالة التعذّر ظاهرة */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLinesData(null);
    loadPageLines(page)
      .then((value) => {
        if (cancelled) return;
        setLinesData(value);
      })
      .catch(() => {
        /* بقاء null */
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setSelection([]);
    setSelected([]);
    setMenu(null);
  }, [page]);

  /*
   * أثناء التسميع: إن اختار القارئ «عرض الآيات» تظل الآيات ظاهرة كما هي،
   * وإن اختار «إخفاء الآيات» تُخفى وتُكشف كلمةً كلمة. بعد الانتهاء تُعاد دائمًا.
   */
  useEffect(() => {
    if (!tasmeeOpen) return;
    if (!tasmeeAyahs.length) return;
    setHidden((current) => {
      const next = new Set(current);
      tasmeeAyahs.forEach((ayah) => {
        const key = ayahKey(ayah.surah, ayah.ayah);
        if (tasmeeActive && !tasmeeRevealVerses) next.add(key);
        else next.delete(key);
      });
      writeHidden(next);
      return next;
    });
  }, [tasmeeActive, tasmeeAyahs, tasmeeOpen, tasmeeRevealVerses]);

  /* بعد انتهاء التسميع: إعادة إظهار الآيات (إلغاء الإخفاء). */
  useEffect(() => {
    if (tasmeeActive) return;
    if (!tasmeeAyahs.length) return;
    setHidden((current) => {
      const next = new Set(current);
      tasmeeAyahs.forEach((ayah) => next.delete(ayahKey(ayah.surah, ayah.ayah)));
      writeHidden(next);
      return next;
    });
  }, [tasmeeActive, tasmeeAyahs]);

  useEffect(() => {
    try {
      localStorage.setItem("thimar.lastMushaf", JSON.stringify({ page, at: Date.now() }));
    } catch {
      /* التخزين غير متاح */
    }
  }, [page]);

  const rows = useMemo(() => {
    if (!map || page < 1 || page > map.length) return [] as [number, number][];
    return map[page - 1] ?? [];
  }, [map, page]);

  /* رقم الجزء من أول آية في الصفحة. */
  const juz = useMemo(() => {
    const first = rows[0];
    if (!first) return 1;
    let value = 1;
    const starts: Array<[number, number]> = [
      [1, 1], [2, 142], [2, 253], [3, 93], [4, 24], [4, 148], [5, 82], [6, 111],
      [7, 88], [8, 41], [9, 93], [11, 6], [12, 53], [15, 1], [16, 1], [17, 1],
      [18, 1], [21, 1], [23, 1], [25, 1], [27, 1], [29, 1], [31, 22], [33, 31],
      [36, 28], [39, 32], [41, 47], [46, 1], [51, 31], [58, 1],
    ];
    starts.forEach(([s, a], index) => {
      if (first[0] > s || (first[0] === s && first[1] >= a)) value = index + 1;
    });
    return value;
  }, [rows]);

  const surahNames = useMemo(() => {
    const seen: number[] = [];
    rows.forEach(([s]) => {
      if (!seen.includes(s)) seen.push(s);
    });
    return seen;
  }, [rows]);

  const pageKeys = useMemo(() => rows.map(([s, a]) => ayahKey(s, a)), [rows]);

  /* فهرس كلمات التسميع: مفتاح "سورة:آية:فهرس الكلمة" → فهرس في tasmeeWordsList. */
  const tasmeeWordIndex = useMemo(() => {
    const map = new Map<string, number>();
    // build by counting per ayah
    const counters = new Map<string, number>();
    tasmeeWordsList.forEach((w, idx) => {
      const k = `${w.surah}:${w.ayah}`;
      const i = counters.get(k) ?? 0;
      counters.set(k, i + 1);
      map.set(`${w.surah}:${w.ayah}:${i}`, idx);
    });
    return map;
  }, [tasmeeWordsList]);

  const highlightGlobal = useMemo(() => {
    if (initialHighlight == null) return null;
    const value = Number(initialHighlight);
    return Number.isFinite(value) ? value : null;
  }, [initialHighlight]);

  /* ضبط حجم الخط حتى تدخل الصفحة كاملة في الشاشة دون تمرير وبأكبر حجم ممكن. */
  const fitPage = useCallback(() => {
    const pageEl = pageRef.current;
    const bodyEl = bodyRef.current;
    if (!pageEl || !bodyEl) return;
    const available = bodyEl.clientHeight;
    if (available < 40) return;
    const apply = (size: number) => {
      pageEl.style.setProperty("--qp-fs", `${size.toFixed(2)}px`);
    };
    /* رقم آخر آية في الصفحة يجب ألّا ينفرد في سطر وحده (كما في المصحف المطبوع).
       كما ندمج ١–٣ كلمات منفردة في آخر سطر مع السطر الذي فوقه. */
    const endsCleanly = () => {
      const marks = bodyEl.querySelectorAll(".ayah-mark");
      const last = marks[marks.length - 1] as HTMLElement | undefined;
      const textEl = last?.parentElement?.querySelector(".qp-ayah-text") as HTMLElement | null;
      if (!last || !textEl) return true;
      const rects = Array.from(textEl.getClientRects());
      if (!rects.length) return true;
      let textBottom = 0;
      for (const rect of rects) textBottom = Math.max(textBottom, rect.bottom);
      // رقم الآية يجب أن يكون على نفس سطر النص (لا ينفرد في سطر وحده).
      if (last.getBoundingClientRect().top >= textBottom - 1) return false;
      // آخر سطر يجب أن يحتوي على كلمات كافية (لا ١–٣ كلمات منفردة).
      const lastRect = rects[rects.length - 1];
      const containerWidth = bodyEl.clientWidth || 1;
      if (lastRect.width < containerWidth * 0.3) return false;
      return true;
    };
    const heightOk = () => bodyEl.scrollHeight <= available;
    let low = 9;
    let high = 80;
    let best = 0;
    for (let step = 0; step < 11; step += 1) {
      const mid = (low + high) / 2;
      apply(mid);
      if (heightOk()) {
        best = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    if (!best) {
      apply(9);
      best = 9;
    }
    for (let step = 0; step < 6; step += 1) {
      const next = best + 0.25;
      apply(next);
      if (heightOk()) best = next;
      else break;
    }
    /* ننزل قليلًا فقط إذا انفرد رقم آخر آية في سطر وحده. */
    let clean = best;
    for (let step = 0; step < 8 && clean > 9.5; step += 1) {
      apply(clean);
      if (endsCleanly()) break;
      clean -= 0.25;
    }
    apply(clean);
    setFontPx(clean);
  }, []);

  useEffect(() => {
    if (!data || !rows.length) return;
    let frame = 0;
    const run = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => fitPage());
    };
    run();
    const settle = window.setTimeout(run, 220);
    const onResize = () => run();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => run());
    }
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [data, rows, page, fitPage]);

  const syncSelected = (keys: string[]) => {
    if (!keys.length) {
      setSelected([]);
      return;
    }
    void loadHafsAyahs(keys)
      .then((value) => setSelected(value))
      .catch(() => setSelected([]));
  };

  const changeSelection = (keys: string[]) => {
    setSelection(keys);
    syncSelected(keys);
    if (!keys.length) setMenu(null);
  };

  /* النقر: تحديد الآية، أو إلغاء تحديدها، أو تحديد المدى بينها وبين المحدَّد. */
  const tapAyah = (key: string) => {
    if (selection.includes(key)) {
      changeSelection(selection.filter((item) => item !== key));
      return;
    }
    const target = pageKeys.indexOf(key);
    if (target < 0) {
      changeSelection([key]);
      return;
    }
    const indexes = selection
      .map((item) => pageKeys.indexOf(item))
      .filter((index) => index >= 0);
    if (!indexes.length) {
      changeSelection([key]);
      return;
    }
    const from = Math.min(target, ...indexes);
    const to = Math.max(target, ...indexes);
    changeSelection(pageKeys.slice(from, to + 1));
  };

  /* الضغط المطوّل: فتح الأزرار الدائرية. */
  const openMenuFor = (key: string | null, x: number, y: number) => {
    const keys = key && !selection.includes(key) ? [...selection, key] : selection;
    if (!key && !keys.length) return;
    if (keys !== selection) {
      setSelection(keys);
      syncSelected(keys);
    }
    setMenu({ x, y });
  };

  const clearSelection = () => {
    setSelection([]);
    setSelected([]);
    setMenu(null);
  };

  const go = (delta: number) => {
    setPage((current) => Math.min(TOTAL_PAGES, Math.max(1, current + delta)));
  };

  const endPress = () => {
    const press = pressRef.current;
    if (press?.timer) window.clearTimeout(press.timer);
    pressRef.current = null;
    return press;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const ayahEl = target?.closest("a.ayah") as HTMLElement | null;
    const key = ayahEl?.dataset.key ?? null;
    const press = {
      key,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      long: false,
      timer: null as number | null,
    };
    pressRef.current = press;
    if (key) {
      press.timer = window.setTimeout(() => {
        if (pressRef.current !== press) return;
        press.long = true;
        openMenuFor(key, press.x, press.y);
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press) return;
    press.lastX = event.clientX;
    press.lastY = event.clientY;
    if (Math.abs(press.lastX - press.x) > 10 || Math.abs(press.lastY - press.y) > 10) {
      press.moved = true;
      if (press.timer) {
        window.clearTimeout(press.timer);
        press.timer = null;
      }
    }
  };

  const onPointerUp = () => {
    const press = endPress();
    if (!press || press.long) return;
    const dx = press.lastX - press.x;
    const dy = press.lastY - press.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      /* اتجاه المصحف من اليمين إلى اليسار: السحب لليمين يقلّب إلى الصفحة التالية. */
      if (dx > 0) go(1);
      else go(-1);
      return;
    }
    if (press.moved) return;
    if (press.key) {
      tapAyah(press.key);
      return;
    }
    if (menu) setMenu(null);
  };

  const onPointerCancel = () => {
    endPress();
  };

  return (
    <div
      className="mushaf-full qp-reader"
      dir="rtl"
      style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", flexDirection: "column" }}
    >
      <div className="qp-reader-bar">
        <span className="qp-reader-juz">الجزء {arabicNumber(juz)}</span>
        <span className="qp-reader-surahs">
          {surahNames.map((n) => `سورة ${surahs[n - 1]?.name ?? n}`).join(" • ") || "المصحف"}
        </span>
        <span className="qp-reader-meta">
          <span className="qp-reader-page">{`${arabicNumber(page)} / ${arabicNumber(TOTAL_PAGES)}`}</span>
          <button type="button" className="qp-reader-close" onClick={closeMushaf} aria-label="إغلاق المصحف">
            ×
          </button>
        </span>
      </div>

      <div
        className="qp-reader-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div
          className="qp-page"
          id={`page-${page}`}
          ref={pageRef}
          style={fontPx ? ({ "--qp-fs": `${fontPx.toFixed(2)}px` } as React.CSSProperties) : undefined}
        >
          <div className="qp-page-body" ref={bodyRef}>
            {!data ? <p className="qp-page-status">جارٍ تحميل المصحف…</p> : null}
            {data && !linesData ? <p className="qp-page-status">جارٍ تحميل صفحات المصحف…</p> : null}
            {data && rows.length === 0 ? <p className="qp-page-status">تعذّر عرض هذه الصفحة.</p> : null}

            {linesData && data
              ? linesData.lines.map((lineWords, lineIdx) => {
                  const renderedSurahStarts = (linesData.surahStarts || []).filter(([idx]) => idx === lineIdx);
                  // group words into ayah runs
                  const runs: { surah: number; ayah: number; wordIndexes: number[] }[] = [];
                  for (const [s, a, widx] of lineWords) {
                    const last = runs[runs.length - 1];
                    if (last && last.surah === s && last.ayah === a) {
                      last.wordIndexes.push(widx);
                    } else {
                      runs.push({ surah: s, ayah: a, wordIndexes: [widx] });
                    }
                  }
                  return (
                    <Fragment key={`line-${lineIdx}`}>
                      {renderedSurahStarts.map(([, surah]) => (
                        <Fragment key={`ss-${surah}`}>
                          <div className="qp-surah-title" aria-label={`سورة ${surahs[surah - 1]?.name ?? surah}`}>
                            {`سورة ${surahs[surah - 1]?.name ?? surah}`}
                          </div>
                          {surah !== 1 && surah !== 9 ? <div className="qp-basmala">{BASMALA}</div> : null}
                        </Fragment>
                      ))}
                      <div className="qp-line">
                        {runs.map((run, runIdx) => {
                          const key = ayahKey(run.surah, run.ayah);
                          const encoded = data.verses[key];
                          const words = encoded ? tajweedText(encoded).split(/\s+/).filter(Boolean) : [];
                          const isSelected = selection.includes(key);
                          const isHidden = hidden.has(key);
                          const inTasmee =
                            tasmeeActive &&
                            isHidden &&
                            tasmeeAyahs.some((a) => a.surah === run.surah && a.ayah === run.ayah);
                          const isActive =
                            highlightGlobal != null &&
                            data.chapters.slice(0, run.surah - 1).reduce((n, c) => n + c.verses_count, 0) +
                              run.ayah ===
                              highlightGlobal;
                          const lastWordIndex = words.length - 1;
                          const showMark = run.wordIndexes.includes(lastWordIndex);
                          return (
                            <a
                              key={`${key}-${runIdx}`}
                              className={`ayah${isSelected || isActive ? " active" : ""}${isHidden && !inTasmee ? " is-ayah-hidden" : ""}`}
                              data-key={key}
                              role="button"
                              tabIndex={0}
                              aria-pressed={isSelected}
                              aria-label={`${surahs[run.surah - 1]?.name ?? run.surah} — الآية ${arabicNumber(run.ayah)}`}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  tapAyah(key);
                                }
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                openMenuFor(key, event.clientX, event.clientY);
                              }}
                            >
                              {inTasmee ? (
                                <span className="qp-ayah-text qp-tasmee-inline-words">
                                  {run.wordIndexes.map((widx) => {
                                    const ti = tasmeeWordIndex.get(`${run.surah}:${run.ayah}:${widx}`);
                                    if (ti == null) return null;
                                    const w = tasmeeWordsList[ti];
                                    return (
                                      <span
                                        key={`tw-${ti}`}
                                        className={`mushaf-tasmee-word is-${tasmeeStatuses[ti] ?? "pending"}${ti === tasmeeCursor && (tasmeeStatuses[ti] ?? "pending") === "pending" ? " is-current" : ""}${(tasmeeStatuses[ti] ?? "pending") === "pending" && tasmeeRevealAll ? " is-shown" : ""}`}
                                      >
                                        {w.text}
                                        {tasmeeStatuses[ti] === "ok" ? <span className="mushaf-tasmee-tick" aria-hidden="true">✓</span> : null}
                                      </span>
                                    );
                                  })}
                                </span>
                              ) : (
                                <span className="qp-ayah-text">
                                  {run.wordIndexes.map((widx) => {
                                    const w = encoded ? tajweedText(encoded).split(/\s+/).filter(Boolean)[widx] : "";
                                    return w ? <Fragment key={widx}>{w} </Fragment> : null;
                                  })}
                                </span>
                              )}
                              {showMark ? (
                                <span className="ayah-mark" data-len={String(arabicNumber(run.ayah)).length} aria-hidden="true">
                                  <img src={`${BASE}images/ayah-mark.svg`} alt="" draggable={false} />
                                  <span className="ayah-mark__n">{arabicNumber(run.ayah)}</span>
                                </span>
                              ) : null}
                            </a>
                          );
                        })}
                      </div>
                    </Fragment>
                  );
                })
              : null}
          </div>
        </div>
      </div>

      {menu && selected.length ? (
        <MushafAyahMenu
          ayahs={selected}
          page={page}
          anchor={menu}
          hidden={hidden}
          onClose={() => setMenu(null)}
          onClearSelection={clearSelection}
          onToggleHidden={toggleHidden}
          onToast={setToast}
          onOpenPage={(next) => setPage(Math.min(TOTAL_PAGES, Math.max(1, next)))}
          onStartTasmee={(revealVerses) => {
            setMenu(null);
            setTasmeeRevealVerses(revealVerses);
            setTasmeeOpen(true);
          }}
        />
      ) : null}

      {tasmeeOpen ? (
        <MushafTasmeeSheet
          inline
          page={page}
          pageKeys={pageKeys}
          selection={selected}
          revealVerses={tasmeeRevealVerses}
          onRevealVersesChange={setTasmeeRevealVerses}
          onClose={() => { setTasmeeOpen(false); setTasmeeActive(false); }}
          onAyahsChange={setTasmeeAyahs}
          onWordsChange={setTasmeeWordsList}
          onStatusesChange={(s, c) => { setTasmeeStatuses(s); setTasmeeCursor(c); }}
          onRevealChange={setTasmeeRevealAll}
          onActiveChange={setTasmeeActive}
        />
      ) : null}

      {toast ? <p className="mushaf-ayah-toast">{toast}</p> : null}
    </div>
  );

  function toggleHidden(keys: string[]) {
    setHidden((current) => {
      const next = new Set(current);
      const allHidden = keys.every((key) => next.has(key));
      keys.forEach((key) => (allHidden ? next.delete(key) : next.add(key)));
      writeHidden(next);
      return next;
    });
    setToast("أُخفي النص — اضغط الزر نفسه للإظهار");
  }
}
