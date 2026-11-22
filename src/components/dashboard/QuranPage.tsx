import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./QuranPage.css";

export type QuranToken =
  | { type: "word"; text: string; globalAyah?: number | null }
  | { type: "ayah"; number: string; globalAyah?: number | null };

export interface QuranLine {
  tokens: QuranToken[];
  align?: "center" | "right" | "left";
  gap?: number;
}

export interface QuranPageData {
  pageNumber: number;
  juzNumber: number;
  surahName: string;
  showSurahTitle?: boolean;
  showBasmalah: boolean;
  lines: QuranLine[];
}

interface Props {
  page: QuranPageData;
  onWordClick?: (globalAyah: number | null) => void;
  selected?: Set<number>;
  highlightAyah?: number | null;
}

export default function QuranPage({ page, onWordClick, selected, highlightAyah }: Props) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState<number>(26);
  const [pageWidth, setPageWidth] = useState<number | null>(null);
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const [filledLines, setFilledLines] = useState<boolean[]>([]);
  const [resizeTick, setResizeTick] = useState(0);

  useEffect(() => {
    const onResize = () => setResizeTick((value) => value + 1);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    // إعادة القياس بعد تحميل خط المصحف حتى تكون المقاسات دقيقة.
    let active = true;
    document.fonts?.ready.then(() => {
      if (active) setResizeTick((value) => value + 1);
    });
    return () => {
      active = false;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  useLayoutEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    // Measure the natural (non-justified) width of every authenticated line at a
    // reference size, then scale the font so the widest line exactly fills the page.
    el.classList.add("quran-page--measuring");
    el.style.setProperty("--quran-font", "28px");
    void el.offsetHeight;

    /* مقياس الصفحة بحسب شاشة العرض: نسبة صفحة المصحف المطبوعة (عرض/ارتفاع ≈ 0.73)
       مع ضبط الارتفاع على المساحة المتاحة فعلًا أسفل شريط المصحف. */
    const viewerWidth = Math.max(260, (el.parentElement?.clientWidth ?? window.innerWidth) - 6);
    const top = el.getBoundingClientRect().top;
    const viewerHeight = Math.max(280, window.innerHeight - (top > 0 ? top : 0) - 8);
    const width = Math.round(Math.min(viewerWidth, Math.max(260, viewerHeight * 0.715)));
    /* الارتفاع يملأ المساحة المتاحة داخل الشريط، ولا يقل عن نسبة الصفحة المطبوعة،
       فلا تُقصّ الصفحة ولا تبقى مساحة فارغة أسفلها. */
    const height = Math.round(Math.max(viewerHeight, width / 0.715));
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.minHeight = "0px";
    void el.offsetHeight;

    const lines = Array.from(el.querySelectorAll<HTMLElement>(".quran-line"));
    if (lines.length === 0) {
      el.classList.remove("quran-page--measuring");
      return;
    }
    const available = Math.max(1, lines[0].clientWidth || el.clientWidth);
    const widths = lines.map((line) => line.scrollWidth);
    const contentHeight = Math.max(1, el.scrollHeight);
    el.classList.remove("quran-page--measuring");
    const widest = Math.max(1, ...widths);
    const byWidth = 28 * (available / widest);
    const byHeight = 28 * (height / contentHeight);
    // A single size for the whole page (never per line), clamped to readable bounds.
    let size = Math.min(48, Math.max(12, Math.round(Math.min(byWidth, byHeight) * 2) / 2));
    // تأكيد عدم تجاوز أي سطر للإطار (القياسات قد تختلف بضع نقاط بسبب تنقيط الخط).
    for (let attempt = 0; attempt < 4; attempt += 1) {
      el.style.setProperty("--quran-font", `${size}px`);
      void el.offsetHeight;
      const overflow = Math.max(0, ...lines.map((line) => line.scrollWidth - line.clientWidth));
      if (overflow <= 0) break;
      size = Math.max(12, size * ((available - 2) / (available + overflow)));
      size = Math.round(size * 10) / 10;
    }
    // هامش أمان صغير يمنع أي تجاوز ولو بضعة بكسلات بسبب تنقيط الخط.
    el.style.setProperty("--quran-font", `${size}px`);
    void el.offsetHeight;
    if (Math.max(0, ...lines.map((line) => line.scrollWidth - line.clientWidth)) > 0) {
      size = Math.max(12, size - 0.5);
    }
    setFontSize(size);
    setPageWidth(width);
    setPageHeight(height);
    // Only lines that nearly reach the widest line are justified; shorter lines keep
    // natural word spacing aligned to the right edge instead of huge gaps.
    setFilledLines(widths.map((width) => width / widest >= 0.9));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.pageNumber, resizeTick]);

  return (
    <main className="quran-viewer" dir="rtl">
      <article
        className="quran-page"
        ref={pageRef}
        style={{
          "--quran-font": `${fontSize}px`,
          ...(pageWidth ? { width: `${pageWidth}px` } : null),
          ...(pageHeight ? { height: `${pageHeight}px` } : null),
        } as React.CSSProperties}
      >

        {page.showSurahTitle !== false && (
          <header className="quran-surah-title">
            {page.surahName}
          </header>
        )}

        {page.showBasmalah && (
          <div className="quran-basmalah">
            بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
          </div>
        )}

        <section className="quran-lines">
          {page.lines.map((line, index) => {
            const wordCount = line.tokens.filter((token) => token.type === "word").length;
            const justify =
              filledLines[index] ?? (wordCount >= 5 && index < page.lines.length - 1);
            return (
            <div
              className={`quran-line ${justify ? "quran-line--justified" : ""}`}
              key={index}
              dir="rtl"
              style={{
                justifyContent: justify
                  ? "space-between"
                  : line.align === "left"
                  ? "flex-end"
                  : "flex-start",
                gap: "0"
              }}
            >
              {line.tokens.map((token, i) => (
                token.type === "ayah" ? (
                  <span
                    className="quran-ayah-marker"
                    key={i}
                    onClick={() => onWordClick?.(token.globalAyah ?? null)}
                    style={{
                      cursor: onWordClick ? "pointer" : undefined,
                      background: token.globalAyah && highlightAyah === token.globalAyah ? "rgba(250,204,21,0.5)" : token.globalAyah && selected?.has(token.globalAyah) ? "rgba(250,204,21,0.3)" : undefined,
                      borderRadius: 3,
                    }}
                  >
                    ﴿{token.number}﴾
                  </span>
                ) : (
                  <span
                    className="quran-word"
                    key={i}
                    onClick={() => onWordClick?.(token.globalAyah ?? null)}
                    style={{
                      cursor: onWordClick ? "pointer" : undefined,
                      background: token.globalAyah && highlightAyah === token.globalAyah ? "rgba(250,204,21,0.5)" : token.globalAyah && selected?.has(token.globalAyah) ? "rgba(250,204,21,0.3)" : undefined,
                      borderRadius: 3,
                    }}
                  >
                    {token.text}
                  </span>
                )
              ))}
            </div>
            );
          })}
        </section>

      </article>
    </main>
  );
}

export const samplePage: QuranPageData = {
  pageNumber: 2,
  juzNumber: 1,
  surahName: "سُورَةُ الْبَقَرَةِ",
  showBasmalah: true,

  lines: [
    {
      tokens: [
        { type: "word", text: "الٓمٓ" },
        { type: "ayah", number: "١" },
        { type: "word", text: "ذَٰلِكَ الْكِتَابُ" },
        { type: "word", text: "لَا رَيْبَ فِيهِ" }
      ]
    },
    {
      tokens: [
        { type: "word", text: "هُدًى لِّلْمُتَّقِينَ" },
        { type: "ayah", number: "٢" }
      ]
    }
  ]
};
