import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPageMap, loadTajweed, tajweedText, type PageMap, type TajweedData } from "../../lib/tajweed";
import { surahs } from "../../data/surahs";
import { useHistoryBack } from "../../lib/useHistoryBack";
import { ayahKey, loadHafsAyahs, loadHafsOrder, type HafsAyah } from "../../lib/mushafText";
import { selectionAfterTap } from "../../lib/ayahSelectionCore";
import { loadSettings } from "../../lib/appStore";
import { useKeepScreenAwake } from "../../lib/useKeepScreenAwake";
import { cachedPageLines, loadPageLines, prefetchPageLines, type PageLines } from "../../lib/quranPageLayout";
import type { TasmeeWord, WordStatus } from "../../lib/mushafTasmee";
import MushafAyahMenu from "./MushafAyahMenu";
import AyahAudioSheet from "./AyahAudioSheet";
const MushafTasmeeSheet = lazy(() => import("./MushafTasmeeSheet"));

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

/* علامات زخرفية/وقف قائمة بذاتها (مثل ۞) ليست كلمات في تخطيط الصفحة،
   وتعدادها ككلمة كان يُزيح فهرس الكلمات فيختلّ نص الآية وترتيبه. */
const STANDALONE_MARK = /^[\s\u0610-\u061A\u06D6-\u06ED\u08D3-\u08FF\u200E\u200F\uFEFF]+$/;

/** كلمات الآية بنفس التقسيم الذي يعتمده تخطيط الصفحة المطبوع. */
function ayahWords(encoded: string): string[] {
  return tajweedText(encoded)
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STANDALONE_MARK.test(word));
}

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
  const [keepScreenAwake] = useState(() => loadSettings().keepScreenAwake);
  useKeepScreenAwake(keepScreenAwake);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const isSpecialPageRef = useRef(false);
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
  const selectionRef = useRef<string[]>([]);
  const [selected, setSelected] = useState<HafsAyah[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [audioCompact, setAudioCompact] = useState(false);
  const [audioAyahs, setAudioAyahs] = useState<HafsAyah[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden());
  const [fontPx, setFontPx] = useState(0);
  /* أسطر الصفحة مرتبطة برقمها: لا يجوز أبدًا رسم أسطر صفحة سابقة فوق صفحة
     جديدة ولو لإطار واحد، فهذا هو الوميض الذي يراه القارئ عند التقليب. */
  const [linesData, setLinesData] = useState<{ page: number; value: PageLines } | null>(null);
  const [tasmeeOpen, setTasmeeOpen] = useState(false);
  const [tasmeeWordsList, setTasmeeWordsList] = useState<TasmeeWord[]>([]);
  const [tasmeeStatuses, setTasmeeStatuses] = useState<WordStatus[]>([]);
  const [tasmeeCursor, setTasmeeCursor] = useState(0);
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

  /* أسطر الصفحة: تُقرأ فورًا من الذاكرة إن كانت حِزمتها محمّلة (بلا شاشة
     تحميل)، ويُحمّل ما حولها مسبقًا حتى يكون التقليب فوريًا. */
  useEffect(() => {
    const cached = cachedPageLines(page);
    if (cached) {
      setLinesData({ page, value: cached });
      for (let offset = -2; offset <= 2; offset += 1) prefetchPageLines(page + offset);
      return;
    }
    let cancelled = false;
    loadPageLines(page)
      .then((value) => {
        if (cancelled || !value) return;
        setLinesData({ page, value });
        for (let offset = -2; offset <= 2; offset += 1) prefetchPageLines(page + offset);
      })
      .catch(() => {
        /* لا نعرض أسطر صفحة أخرى مكانها */
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

  /* تقليب الصفحة لا يلغي التحديد: النطاق المتتابع قد يمتد عبر صفحات وسور. */
  useEffect(() => {
    setMenu(null);
  }, [page]);

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

  /* الأسطر المعروضة لهذه الصفحة فقط. القراءة المتزامنة من الذاكرة تمنع ظهور
     أسطر الصفحة السابقة للحظة عند التقليب داخل الجزء نفسه. */
  const pageLines = useMemo(
    () => (linesData?.page === page ? linesData.value : cachedPageLines(page)),
    [linesData, page],
  );

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

  /* أول آية في الصفحة التالية: بها نعرف أن آيةً ما زالت مستمرة عبر الصفحة. */
  const nextPageFirstKey = useMemo(() => {
    const first = map?.[page]?.[0];
    return first ? ayahKey(first[0], first[1]) : null;
  }, [map, page]);

  /* كلمات كل آية في الصفحة + آخر سطر تظهر فيه + أكبر فهرس يطلبه التخطيط،
     لكشف الكلمات التي سقطت من بيانات الأسطر واستدراكها في نهايتها. */
  const pageWords = useMemo(() => {
    const tokens = new Map<string, string[]>();
    const maxIndex = new Map<string, number>();
    const lastLine = new Map<string, number>();
    for (const key of pageKeys) {
      const encoded = data?.verses[key];
      tokens.set(key, encoded ? ayahWords(encoded) : []);
    }
    (pageLines?.lines ?? []).forEach((lineWords, lineIndex) => {
      for (const [surah, ayah, wordIndex] of lineWords) {
        const key = ayahKey(surah, ayah);
        maxIndex.set(key, Math.max(maxIndex.get(key) ?? -1, wordIndex));
        lastLine.set(key, lineIndex);
      }
    });
    return { tokens, maxIndex, lastLine };
  }, [data, pageKeys, pageLines]);

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

  /* ضبط حجم الخط حتى تدخل الصفحة كاملة في الشاشة.
     حجم واحد لكل سطور الصفحة (لا حجم لكل سطر): الحجم المختلف لكل سطر كان
     يجعل كلمة واحدة تملأ الشاشة وأخرى صغيرة في الصفحة نفسها. ثم تُوزّع
     الزيادة المتبقية في عرض السطر على المسافات بين الكلمات (word-spacing)
     فيمتلئ الجانب بالكامل ولا يبقى فراغ بعد نهاية الآية. */
  const fitPage = useCallback(() => {
    const pageEl = pageRef.current;
    const bodyEl = bodyRef.current;
    const stageEl = stageRef.current;
    if (!pageEl || !bodyEl || !stageEl) return;

    /*
     * مقاس الصفحة من صندوق المحتوى لا من clientWidth/clientHeight: هذان يشملان
     * حشو الـstage، فكانت الصفحة تزيد ٨ بكسل عن المساحة المتاحة ويُقتطع آخر
     * سطر عند حد الشاشة.
     */
    const stageStyle = window.getComputedStyle(stageEl);
    const padX = (parseFloat(stageStyle.paddingLeft) || 0) + (parseFloat(stageStyle.paddingRight) || 0);
    const padY = (parseFloat(stageStyle.paddingTop) || 0) + (parseFloat(stageStyle.paddingBottom) || 0);
    const stageWidth = stageEl.clientWidth - padX;
    const stageHeight = stageEl.clientHeight - padY;
    if (stageWidth < 40 || stageHeight < 40) return;
    /*
     * الصفحة تملأ عرض المساحة المتاحة بالكامل: عرضها = عرض الـstage وارتفاعها =
     * ارتفاعه. تثبيت العرض صراحةً قبل القياس يضمن أن حساب حجم الخط يتم على
     * المساحة الفعلية، فلا يبقى فراغ جانبي غير مستغل.
     */
    const availableWidth = Math.max(220, stageWidth);
    const availableHeight = stageHeight;
    pageEl.style.width = `${availableWidth}px`;
    pageEl.style.height = `${availableHeight}px`;

    const available = bodyEl.clientHeight;
    if (available < 40) return;

    const applyBase = (size: number) => {
      pageEl.style.setProperty("--qp-fs", `${size.toFixed(2)}px`);
    };

    /* قياس السطر عبر Range لا عبر scrollWidth: في RTL لا يمدّ النص
       الفائض scrollWidth، فيبدو السطر داخلًا وهو خارج الحدود أو ملتفّ. */
    const measureLine = (line: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
      if (typeof range.detach === "function") range.detach();
      if (rects.length === 0) return null;
      const box = line.getBoundingClientRect();
      let left = Infinity;
      let right = -Infinity;
      const tops: number[] = [];
      for (const rect of rects) {
        left = Math.min(left, rect.left);
        right = Math.max(right, rect.right);
        tops.push(rect.top);
      }
      tops.sort((a, b) => a - b);
      /* الارتفاع يحكم: تشكيل الحروف والعلامات يجعل أعلى المستطيلات مختلفًا
         ببضع بكسلات داخل السطر الواحد، فلا يصلح ذلك لكشف الالتفاف. */
      const lineHeight = parseFloat(window.getComputedStyle(line).lineHeight) || 24;
      return { box, width: right - left, wrapped: box.height > lineHeight * 1.4 };
    };

    const linesStaySingle = () => {
      const lines = bodyEl.querySelectorAll<HTMLElement>(".qp-line");
      for (const line of Array.from(lines)) {
        const metrics = measureLine(line);
        if (metrics && (metrics.wrapped || metrics.width > metrics.box.width + 1)) return false;
      }
      return true;
    };
    /* ارتفاع المحتوى الحقيقي = مجموع ارتفاع الأبناء. `scrollHeight` لا يصلح
       هنا: جسم الصفحة flex مع justify-content: space-between، فيساوي ارتفاع
       الصندوق دائمًا ويُوهم بأن الصفحة ممتلئة فتوقف البحث عند خط صغير. */
    const contentHeight = () => {
      const children = Array.from(bodyEl.children) as HTMLElement[];
      let total = 0;
      for (const child of children) total += child.offsetHeight || 0;
      const gap = parseFloat(window.getComputedStyle(bodyEl).rowGap) || 0;
      if (children.length > 1 && gap > 0) total += gap * (children.length - 1);
      return total;
    };
    const heightOk = () => contentHeight() <= available + 1 && linesStaySingle();

    const lines = Array.from(bodyEl.querySelectorAll<HTMLElement>(".qp-line"));
    /* لا أسطر بعد (البيانات في الطريق): لا نضبط حجمًا على صفحة فارغة ونترك
       البحث يصل إلى الحد الأعلى. نعيد الضبط عند وصول الأسطر. */
    if (lines.length === 0 && !isSpecialPageRef.current) return;
    const clearLineMetrics = () => {
      for (const line of lines) {
        line.style.removeProperty("--qp-line-fs");
        line.style.removeProperty("--qp-line-ws");
      }
    };

    /* توزيع الفراغ المتبقي بعد آخر كلمة على المسافات بين الكلمات، بسقف
       يمنع التمدّد القبيح في سطر قصير جدًا. */
    const justifyLines = () => {
      for (const line of lines) {
        line.style.removeProperty("--qp-line-ws");
        const metrics = measureLine(line);
        if (!metrics) continue;
        const words = (line.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
        const gaps = words - 1;
        const extra = metrics.box.width - metrics.width - 2;
        if (gaps <= 0 || extra <= 0.5) continue;
        const fontSize = parseFloat(window.getComputedStyle(line).fontSize) || 22;
        line.style.setProperty("--qp-line-ws", `${Math.min(extra / gaps, fontSize * 0.85).toFixed(2)}px`);
      }
    };

    /* حجم واحد للصفحة: أكبر حجم تبقى فيه كل الأسطر في سطر واحد وتدخل في
       الارتفاع المتاح — ثم تُضبط المسافات لتملأ عرض الصفحة. */
    clearLineMetrics();
    let low = 9;
    let high = 80;
    let best = 9;
    for (let step = 0; step < 13; step += 1) {
      const mid = (low + high) / 2;
      applyBase(mid);
      if (heightOk()) {
        best = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    applyBase(best);
    /* الصفحتان الأولى والثانية نصّهما موسّط لا مسطّر: بلا توزيع مسافات. */
    if (!isSpecialPageRef.current) {
      justifyLines();
      /* قد يزيد ارتفاع السطر بعد توزيع المسافات: نتحقق ونصغّر عند الحاجة. */
      for (let guard = 0; guard < 3 && !heightOk(); guard += 1) {
        best = Math.max(8, best * 0.98);
        applyBase(best);
        justifyLines();
      }
    }
    setFontPx(best);
  }, []);

  useEffect(() => {
    if (!data || !rows.length) return;
    if (tasmeeOpen) return; // لا تغيير الخط أثناء عرض صفحة التسميع
    let frame = 0;
    const run = () => {
      isSpecialPageRef.current = page === 1 || page === 2;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => fitPage());
    };
    run();
    const settle = window.setTimeout(run, 220);
    const onResize = () => run();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", onResize);
    // ResizeObserver also catches WebView/container changes that do not emit a
    // window resize (for example safe-area and split-screen size changes).
    const stage = stageRef.current;
    const resizeObserver = typeof ResizeObserver !== "undefined" && stage
      ? new ResizeObserver(onResize)
      : null;
    if (stage && resizeObserver) resizeObserver.observe(stage);
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => run());
    }
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      visualViewport?.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
    };
  }, [data, rows, page, fitPage, tasmeeOpen, pageLines]);

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
    selectionRef.current = keys;
    setSelection(keys);
    syncSelected(keys);
    if (!keys.length) setMenu(null);
  };

  /*
   * النقر: يمدّ النطاق من أول آية محددة، والنقر على آية داخل المجموعة يقصّها
   * قبل الآية المضغوطة. يعتمد النطاق على الرقم العام للآية (سورة:آية)، فيعمل
   * عبر حدود الصفحات والسور ولا يخلط بين أرقام الآيات المتشابهة.
   */
  const tapAyah = (key: string) => {
    void loadHafsOrder()
      .then(({ keysByGlobal, globalOf }) => {
        changeSelection(
          selectionAfterTap({ keysByGlobal, globalOf, current: selectionRef.current, tapped: key }),
        );
      })
      .catch(() => {
        const current = selectionRef.current;
        changeSelection(current.includes(key) ? current.slice(0, current.indexOf(key)) : [key]);
      });
  };

  /* الضغط المطوّل: فتح الأزرار الدائرية. */
  const openMenuFor = (key: string | null, x: number, y: number) => {
    /*
     * الضغط المطوّل لا يلغي تحديدًا قائمًا: إذا كانت الآية المضغوطة داخل
     * المجموعة المحددة تبقى المجموعة كما هي (وهذا ما يتوقعه المستخدم عند فتح
     * قائمة الخيارات لآيات اختارها). وإن كانت خارجها تُحدَّد وحدها.
     */
    const current = selectionRef.current;
    const keys = key && !current.includes(key) ? [key] : current;
    if (!keys.length) return;
    if (keys !== current) changeSelection(keys);
    setMenu({ x, y });
  };

  const clearSelection = () => {
    selectionRef.current = [];
    setSelection([]);
    setSelected([]);
    setMenu(null);
  };

  /* لا نغيّر رقم الصفحة قبل أن تصبح أسطرها جاهزة. بهذا تبقى الصفحة الحالية
     معروضة أثناء تجهيز التالية، بدل عرض أسطر لا تخصّها ولو لأجزاء من الثانية. */
  const openPage = (target: number) => {
    const next = Math.min(TOTAL_PAGES, Math.max(1, Math.round(target)));
    if (next === page) return;
    if (cachedPageLines(next)) {
      setPage(next);
      return;
    }
    void loadPageLines(next).then((value) => {
      if (value) setPage(next);
    });
  };

  const go = (delta: number) => {
    openPage(page + delta);
  };

  const endPress = () => {
    const press = pressRef.current;
    if (press?.timer) window.clearTimeout(press.timer);
    pressRef.current = null;
    return press;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    /* منع تحديد النص (نسخ) عند الضغط المطوّل على الأجهزة. */
    event.preventDefault();
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
    /* لمس الصفحة أثناء التشغيل المصغّر لا يغلق القائمة حتى لا ينقطع الصوت. */
    if (menu && !audioCompact) setMenu(null);
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
          className={`qp-page${page === 1 || page === 2 ? " qp-page--special" : ""}`}
          id={`page-${page}`}
          ref={pageRef}
          style={fontPx ? ({ "--qp-fs": `${fontPx.toFixed(2)}px` } as React.CSSProperties) : undefined}
        >
          <div className="qp-page-body" ref={bodyRef}>
            {/* لا شاشة "جارٍ تحميل": بيانات المصحف تُحمّل مسبقًا وتُخزّن،
                والصفحة تظهر مباشرة بدل إظهار رسالة انتظار للمستخدم. */}
            {data && rows.length === 0 ? <p className="qp-page-status">تعذّر عرض هذه الصفحة.</p> : null}

            {pageLines && data
              ? pageLines.lines.map((lineWords, lineIdx) => {
                  const renderedSurahStarts = (pageLines.surahStarts || []).filter(([idx]) => idx === lineIdx);
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
                          const words = pageWords.tokens.get(key) ?? [];
                          const isLastOnPage = pageWords.lastLine.get(key) === lineIdx;
                          const continuesNextPage = nextPageFirstKey === key;
                          /* كلمات سقطت من أواخر بعض الآيات في بيانات الأسطر:
                             تُضاف في نهايتها بدل أن تختفي من الصفحة. */
                          const tailWords = isLastOnPage && !continuesNextPage
                            ? words.slice((pageWords.maxIndex.get(key) ?? -1) + 1)
                            : [];
                          const isSelected = selection.includes(key);
                          const isHidden = hidden.has(key);
                          const inTasmee =
                            tasmeeActive &&
                            tasmeeAyahs.some((a) => a.surah === run.surah && a.ayah === run.ayah);
                          const isActive =
                            highlightGlobal != null &&
                            data.chapters.slice(0, run.surah - 1).reduce((n, c) => n + c.verses_count, 0) +
                              run.ayah ===
                              highlightGlobal;
                          const showMark = isLastOnPage && !continuesNextPage;
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
                              <span className="qp-ayah-text">
                                {run.wordIndexes.map((widx) => {
                                  const w = words[widx];
                                  if (!w) return null;
                                  /* أثناء التسميع: نفس الكلمات والخط والترتيب تمامًا،
                                     مع خلفية خضراء للصحيحة وحمراء للخطأ فقط. */
                                  const ti = inTasmee
                                    ? tasmeeWordIndex.get(`${run.surah}:${run.ayah}:${widx}`)
                                    : undefined;
                                  if (ti == null) return <Fragment key={widx}>{w} </Fragment>;
                                  const status = tasmeeStatuses[ti] ?? "pending";
                                  const current = ti === tasmeeCursor && status === "pending";
                                  return (
                                    <Fragment key={widx}>
                                      <span className={`mushaf-tasmee-inline-word is-${status}${current ? " is-current" : ""}`}>{w}</span>{" "}
                                    </Fragment>
                                  );
                                })}
                                {tailWords.map((word, index) => (
                                  <Fragment key={`tail-${index}`}>{word} </Fragment>
                                ))}
                              </span>
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
          onOpenPage={(next) => openPage(next)}
          onStartTasmee={() => {
            setMenu(null);
            setTasmeeOpen(true);
          }}
          audioCompact={audioCompact}
          onStartAudio={(items) => setAudioAyahs(items)}
        />
      ) : null}

      {audioAyahs ? (
        <AyahAudioSheet ayahs={audioAyahs} page={page} onCompactChange={setAudioCompact} onClose={() => { setAudioAyahs(null); setAudioCompact(false); }} />
      ) : null}

      {tasmeeOpen ? (
        <Suspense fallback={null}>
        <MushafTasmeeSheet
          inline
          page={page}
          pageKeys={pageKeys}
          selection={selected}
          onClose={() => { setTasmeeOpen(false); setTasmeeActive(false); }}
          onAyahsChange={setTasmeeAyahs}
          onWordsChange={setTasmeeWordsList}
          onStatusesChange={(s, c) => { setTasmeeStatuses(s); setTasmeeCursor(c); }}
          onActiveChange={setTasmeeActive}
        />
        </Suspense>
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
