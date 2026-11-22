import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./QuranReader.css";

/**
 * Exact-page Quran reader.
 * ملف المصحف الأصلي: public/quran/mushaf.pdf
 * يعرض صفحات الـPDF الأصلية كما هي دون إعادة تنسيق أو تشكيل أو تعديل للنص القرآني.
 */
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDF_URL = "/quran/mushaf.pdf";
const EXPECTED_PAGE_COUNT = 604;

type Props = {
  pdfUrl?: string;
  initialPage?: number;
  onPageChange?: (page: number) => void;
  onError?: (message: string) => void;
};

export default function QuranReader({
  pdfUrl = PDF_URL,
  initialPage = 1,
  onPageChange,
  onError,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const [pageCount, setPageCount] = useState(EXPECTED_PAGE_COUNT);
  const [pageNumber, setPageNumber] = useState(
    Math.min(Math.max(1, initialPage), EXPECTED_PAGE_COUNT)
  );
  const [loadError, setLoadError] = useState("");
  /* يصبح true بعد جهوزية الملف، ليُعاد الرسم على الصفحة الأولى. */
  const [docReady, setDocReady] = useState(false);

  const goNext = useCallback(() => {
    setPageNumber((p) => Math.min(p + 1, pageCount));
  }, [pageCount]);

  const goPrevious = useCallback(() => {
    setPageNumber((p) => Math.max(p - 1, 1));
  }, []);

  /* إبلاغ الأب برقم الصفحة الحالي (لعرضه في شريط التطبيق). */
  useEffect(() => {
    onPageChange?.(pageNumber);
  }, [pageNumber, onPageChange]);

  /* تحميل ملف المصحف الأصلي مرة واحدة. لا يُولَّد أي نص قرآني ولا يُعدَّل. */
  useEffect(() => {
    let cancelled = false;

    const loadingTask = getDocument({
      url: pdfUrl,
      withCredentials: false,
    });

    loadingTask.promise
      .then((pdf) => {
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setPageNumber((p) => Math.min(p, pdf.numPages));
        setDocReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("[QuranReader] تعذر تحميل ملف المصحف", error);
          setLoadError(error instanceof Error ? error.message : "تعذر تحميل ملف المصحف");
        }
      });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      pdfRef.current = null;
      setDocReady(false);
      void loadingTask.destroy();
    };
  }, [pdfUrl]);

  /* تسلسل عمليات الرسم: لا يجوز استخدام نفس اللوحة في رسمين متزامنين. */
  const renderSeqRef = useRef(0);

  /* عرض الصفحة الحالية فقط، مع الحفاظ على نسبة أبعاد الصفحة الأصلية. */
  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    const renderCurrentPage = async () => {
      const pdf = pdfRef.current;
      const host = hostRef.current;
      const canvas = canvasRef.current;
      if (!pdf || !host || !canvas) return;

      const seq = ++renderSeqRef.current;

      /* انتظار انتهاء الرسم السابق قبل إعادة استخدام اللوحة نفسها. */
      const previous = renderTaskRef.current;
      if (previous) {
        try {
          previous.cancel();
          await previous.promise;
        } catch {
          /* إلغاء متوقع. */
        }
      }
      if (cancelled || seq !== renderSeqRef.current) return;

      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || seq !== renderSeqRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(1, host.clientWidth);
        const availableHeight = Math.max(1, host.clientHeight);

        /* «احتواء»: تبقى الصفحة الأصلية كاملة ظاهرة.
           لا قصّ، ولا تمديد، ولا تكبير مستقل للعرض والارتفاع. */
        const fitScale = Math.min(
          availableWidth / baseViewport.width,
          availableHeight / baseViewport.height
        );

        const viewport = page.getViewport({ scale: fitScale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2.5);

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas context unavailable");

        const task = page.render({
          canvasContext: context,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
          background: "var(--card)",
        });

        renderTaskRef.current = task;
        await task.promise;
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.name !== "RenderingCancelledException" &&
          !cancelled &&
          seq === renderSeqRef.current
        ) {
          console.error("[QuranReader] تعذر عرض صفحة المصحف", error);
          setLoadError(error.message);
        }
      }
    };

    void renderCurrentPage();

    if (hostRef.current) {
      resizeObserver = new ResizeObserver(() => {
        void renderCurrentPage();
      });
      resizeObserver.observe(hostRef.current);
    }

    return () => {
      cancelled = true;
      renderSeqRef.current += 1;
      resizeObserver?.disconnect();
      renderTaskRef.current?.cancel();
    };
  }, [pageNumber, pageCount, docReady]);

  /* الإبلاغ عن فشل التحميل كي يعرض التطبيق بديله عند غياب الملف. */
  useEffect(() => {
    if (loadError) onError?.(loadError);
  }, [loadError, onError]);

  /* السحب لليسار = الصفحة التالية؛ السحب لليمين = الصفحة السابقة. */
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    /* تجاهل الإيماءات الرأسية واللمسات الصغيرة. */
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return;

    if (dx < 0) goNext();
    else goPrevious();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") goNext();
      if (event.key === "ArrowRight") goPrevious();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrevious]);

  return (
    <main
      className="quran-reader"
      ref={hostRef}
      dir="ltr"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        pointerStartRef.current = null;
      }}
      aria-label="مصحف القرآن الكريم"
    >
      {loadError ? (
        <div className="quran-reader__error" dir="rtl">
          تعذر عرض المصحف. تأكد من وجود الملف في public/quran/mushaf.pdf.
          <span>{loadError}</span>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          className="quran-reader__page"
          aria-label={`صفحة المصحف ${pageNumber} من ${pageCount}`}
        />
      )}
    </main>
  );
}
