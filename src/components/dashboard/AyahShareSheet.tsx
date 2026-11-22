import { useEffect, useState } from "react";
import { buildAyahImage, selectionTitle, shareAyahImage, type AyahImageResult } from "../../lib/ayahImage";
import type { HafsAyah } from "../../lib/mushafText";

/* معاينة صورة المشاركة: نص الآيات المحددة فقط + شعار ثمار + اسم السورة وأرقام الآيات. */
export default function AyahShareSheet({
  ayahs,
  onClose,
}: {
  ayahs: HafsAyah[];
  onClose: () => void;
}) {
  const [result, setResult] = useState<AyahImageResult | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const title = selectionTitle(ayahs);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError("");
    buildAyahImage(ayahs)
      .then((value) => {
        if (!cancelled) setResult(value);
      })
      .catch(() => {
        if (!cancelled) setError("تعذّر إنشاء صورة الآيات على هذا الجهاز.");
      });
    return () => {
      cancelled = true;
    };
  }, [ayahs]);

  const share = async () => {
    if (!result) return;
    try {
      const mode = await shareAyahImage(result, title);
      setMessage(mode === "shared" ? "تمت المشاركة." : "حُفظت الصورة في جهازك.");
    } catch {
      setMessage("تعذّر إتمام المشاركة. جرّب الحفظ.");
    }
  };

  return (
    <div className="mushaf-ayah-sheet-backdrop" onClick={onClose}>
      <div className="mushaf-ayah-sheet ayah-share-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mushaf-ayah-sheet-head">
          <h3>صورة الآيات</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق">
            ×
          </button>
        </div>
        <p className="mushaf-ayah-sheet-sub">{title}</p>

        {error ? <p className="mushaf-ayah-sheet-note">{error}</p> : null}
        {!result && !error ? <p className="mushaf-ayah-sheet-note">جارٍ تجهيز الصورة…</p> : null}

        {result ? (
          <>
            <img className="ayah-share-preview" src={result.dataUrl} alt={title} />
            <div className="ayah-share-actions">
              <button type="button" className="primary-button" onClick={() => void share()}>
                مشاركة الصورة
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  const link = document.createElement("a");
                  link.href = result.dataUrl;
                  link.download = "thimar-ayah.png";
                  link.click();
                  setMessage("حُفظت الصورة في جهازك.");
                }}
              >
                حفظ الصورة
              </button>
            </div>
          </>
        ) : null}

        {message ? <p className="mushaf-ayah-sheet-note">{message}</p> : null}
      </div>
    </div>
  );
}
