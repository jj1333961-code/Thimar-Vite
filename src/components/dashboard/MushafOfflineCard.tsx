import { useEffect, useRef, useState } from "react";
import { Icon, SectionCard } from "./ui";

const AUTO_DOWNLOAD_KEY = "thimar.mushaf.autoDownload";
import {
  deleteMushafPages,
  downloadMushafPages,
  mushafOfflineStatus,
  MUSHAF_PAGE_BYTES,
  MUSHAF_TOTAL_PAGES,
} from "../../lib/mushafOffline";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} م.ب`;
}

/** بطاقة تحميل المصحف النصي كاملًا لتعمل القراءة دون إنترنت. */
export default function MushafOfflineCard() {
  const [cached, setCached] = useState(0);
  const [bundled, setBundled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [message, setMessage] = useState("");
  const stopRef = useRef(false);

  const refresh = () => {
    void mushafOfflineStatus().then((status) => {
      setCached(status.cached);
      setBundled(status.bundled);
    });
  };

  useEffect(() => {
    refresh();
    return () => {
      stopRef.current = true;
    };
  }, []);

  const start = async () => {
    if (bundled) return;
    setBusy(true);
    setMessage("");
    stopRef.current = false;
    try {
      const finished = await downloadMushafPages(
        (value) => setDone(value),
        () => stopRef.current,
      );
      setDone(finished);
      const complete = finished >= MUSHAF_TOTAL_PAGES;
      setMessage(complete ? "تم تحميل المصحف كاملًا — يعمل الآن دون إنترنت." : "توقف التحميل.");
      try {
        if (complete) localStorage.setItem(AUTO_DOWNLOAD_KEY, "done");
        else localStorage.removeItem(AUTO_DOWNLOAD_KEY);
      } catch {
        /* ignore — download status remains available in Cache Storage */
      }
    } catch {
      setMessage("تعذّر إكمال التحميل، حاول مرة أخرى.");
      try {
        localStorage.removeItem(AUTO_DOWNLOAD_KEY);
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const remove = async () => {
    await deleteMushafPages();
    setCached(0);
    setDone(0);
    setMessage("حُذفت صفحات المصحف من الجهاز.");
  };

  /* لا تحميل تلقائي: ملفات المصحف مضمَّنة، والتنزيل اليدوي يبقى متاحًا فقط إن كانت ناقصة. */

  const complete = cached >= MUSHAF_TOTAL_PAGES;

  return (
    <SectionCard
      title={bundled ? "المصحف مثبَّت مع التطبيق" : "تحميل المصحف كاملًا للعمل دون إنترنت"}
      subtitle="مصحف حفص النصي كاملًا (٦٠٤ صفحات) — يفتح مباشرة دون تحميل"
    >
      <p className="muted">
        {bundled
          ? `✅ ملفات المصحف (${MUSHAF_TOTAL_PAGES} صفحة) مضمَّنة داخل التطبيق وتعمل دون إنترنت بلا أي تحميل.`
          : complete
            ? `✅ المصحف محفوظ على الجهاز (${MUSHAF_TOTAL_PAGES} صفحة).`
            : `المحفوظ الآن ${cached} من ${MUSHAF_TOTAL_PAGES} صفحة — الحجم الكامل ${formatSize(MUSHAF_TOTAL_PAGES * MUSHAF_PAGE_BYTES)} تقريبًا.`}
      </p>
      {busy ? (
        <div style={{ marginTop: 8, background: "#e5e7eb", borderRadius: 8, height: 8, overflow: "hidden" }}>
          <div
            style={{
              width: `${Math.round((done / MUSHAF_TOTAL_PAGES) * 100)}%`,
              background: "#16a34a",
              height: "100%",
              transition: "width 0.3s",
            }}
          />
        </div>
      ) : null}
      <div className="form-actions" style={{ marginTop: 10 }}>
        {bundled ? null : !busy ? (
          <button type="button" className="primary-button" onClick={() => void start()}>
            <Icon name="download" size={16} /> {complete ? "إعادة التحميل" : "تحميل المصحف كاملًا"}
          </button>
        ) : (
          <button
            type="button"
            className="danger-button"
            onClick={() => {
              stopRef.current = true;
            }}
          >
            إيقاف التحميل ({done}/{MUSHAF_TOTAL_PAGES})
          </button>
        )}
        {!bundled && cached > 0 && !busy ? (
          <button type="button" className="ghost-button" onClick={() => void remove()}>
حذف نسخة المصحف من الجهاز
          </button>
        ) : null}
      </div>
      {message ? <p className="muted" style={{ marginTop: 8 }}>{message}</p> : null}
    </SectionCard>
  );
}
