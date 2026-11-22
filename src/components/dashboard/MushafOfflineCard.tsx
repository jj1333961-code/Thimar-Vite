import { useEffect, useRef, useState } from "react";
import { Icon, SectionCard } from "./ui";
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
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [message, setMessage] = useState("");
  const stopRef = useRef(false);

  const refresh = () => {
    void mushafOfflineStatus().then((status) => setCached(status.cached));
  };

  useEffect(() => {
    refresh();
    return () => {
      stopRef.current = true;
    };
  }, []);

  const start = async () => {
    setBusy(true);
    setMessage("");
    stopRef.current = false;
    try {
      const finished = await downloadMushafPages(
        (value) => setDone(value),
        () => stopRef.current,
      );
      setDone(finished);
      setMessage(finished >= MUSHAF_TOTAL_PAGES ? "تم تحميل المصحف كاملًا — يعمل الآن دون إنترنت." : "توقف التحميل.");
    } catch {
      setMessage("تعذّر إكمال التحميل، حاول مرة أخرى.");
    }
    setBusy(false);
    refresh();
  };

  const remove = async () => {
    await deleteMushafPages();
    setCached(0);
    setDone(0);
    setMessage("حُذفت صفحات المصحف من الجهاز.");
  };

  /* تحميل تلقائي لمرة واحدة عند توفر الإنترنت، حتى لا يضطر المستخدم إلى طلبه. */
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    let key = "";
    try {
      key = localStorage.getItem("thimar.mushaf.autoDownload") ?? "";
    } catch {
      key = "";
    }
    if (key === "done" || key === "running") return;
    if (cached >= MUSHAF_TOTAL_PAGES) {
      try {
        localStorage.setItem("thimar.mushaf.autoDownload", "done");
      } catch {
        /* ignore */
      }
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    try {
      localStorage.setItem("thimar.mushaf.autoDownload", "running");
    } catch {
      /* ignore */
    }
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cached]);

  const complete = cached >= MUSHAF_TOTAL_PAGES;

  return (
    <SectionCard
      title="تحميل المصحف كاملًا للعمل دون إنترنت"
      subtitle="مصحف حفص النصي كاملًا (٦٠٤ صفحات) يُحفظ على الجهاز ولا يحتاج اتصالًا بعد ذلك"
    >
      <p className="muted">
        {complete
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
        {!busy ? (
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
        {cached > 0 && !busy ? (
          <button type="button" className="ghost-button" onClick={() => void remove()}>
حذف نسخة المصحف من الجهاز
          </button>
        ) : null}
      </div>
      {message ? <p className="muted" style={{ marginTop: 8 }}>{message}</p> : null}
    </SectionCard>
  );
}
