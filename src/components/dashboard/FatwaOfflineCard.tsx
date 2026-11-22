import { useEffect, useRef, useState } from "react";
import { Icon, SectionCard } from "./ui";
import {
  clearOfflineFatwas,
  downloadFatwas,
  FATWA_DOWNLOAD_TARGET,
  offlineFatwaCount,
} from "../../lib/fatwaOffline";

/** بطاقة تحميل الفتاوى إلى الجهاز لتعمل صفحة الإفتاء دون إنترنت. */
export default function FatwaOfflineCard() {
  const [saved, setSaved] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const stopRef = useRef(false);

  useEffect(() => {
    void offlineFatwaCount().then(setSaved);
    return () => {
      stopRef.current = true;
    };
  }, []);

  const start = async () => {
    if (busy) return;
    stopRef.current = false;
    setBusy(true);
    setMessage("");
    try {
      const total = await downloadFatwas((count) => setSaved(count), () => stopRef.current);
      setSaved(total);
      setMessage(
        total >= FATWA_DOWNLOAD_TARGET
          ? "تم تحميل الفتاوى — تعمل صفحة الإفتاء الآن دون إنترنت."
          : `توقف التحميل عند ${total.toLocaleString("ar")} فتوى، ويمكنك إكماله لاحقًا.`,
      );
    } catch {
      setMessage("تعذّر إكمال التحميل، حاول مرة أخرى.");
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!confirm("حذف الفتاوى المحفوظة على الجهاز؟")) return;
    await clearOfflineFatwas();
    setSaved(0);
    setMessage("حُذفت الفتاوى المحفوظة من الجهاز.");
  };

  const complete = saved >= FATWA_DOWNLOAD_TARGET;

  return (
    <SectionCard
      title="تحميل الفتاوى للعمل دون إنترنت"
      subtitle="يحفظ نصوص الفتاوى وأجوبتها على الجهاز لتُقرأ وتُبحث دون اتصال"
    >
      <p className="muted">
        {complete
          ? `✅ ${saved.toLocaleString("ar")} فتوى محفوظة على الجهاز.`
          : `المحفوظ الآن ${saved.toLocaleString("ar")} فتوى — الهدف حتى ${FATWA_DOWNLOAD_TARGET.toLocaleString("ar")} فتوى.`}
      </p>
      {busy ? (
        <div className="fatwa-progress" role="progressbar" aria-valuenow={saved} aria-valuemax={FATWA_DOWNLOAD_TARGET}>
          <span style={{ width: `${Math.min(100, (saved / FATWA_DOWNLOAD_TARGET) * 100)}%` }} />
        </div>
      ) : null}
      <div className="form-actions" style={{ marginTop: 10 }}>
        {!busy ? (
          <button type="button" className="primary-button" onClick={() => void start()} disabled={complete}>
            <Icon name="download" size={16} /> {saved ? "إكمال التحميل" : "تحميل الفتاوى"}
          </button>
        ) : (
          <button type="button" className="danger-button" onClick={() => { stopRef.current = true; }}>
            إيقاف التحميل ({saved.toLocaleString("ar")})
          </button>
        )}
        {saved > 0 && !busy ? (
          <button type="button" className="ghost-button" onClick={() => void remove()}>
            حذف المحفوظ
          </button>
        ) : null}
      </div>
      {message ? <p className="muted" style={{ marginTop: 8 }}>{message}</p> : null}
    </SectionCard>
  );
}
