import { useCallback, useEffect, useState } from "react";
import {
  hasNativeOverlay,
  hideFloatingOverlay,
  openAdhanDiagnostics,
  openOverlaySettings,
  readOverlayDiagnostics,
  readOverlayStatus,
  showFloatingOverlay,
  type OverlayStatus,
} from "../../lib/overlayBridge";

/**
 * إعداد «الظهور فوق التطبيقات» داخل ثمار:
 * يعرض الحالة الحقيقية من أندرويد، ويفتح إعداد النظام الرسمي فقط بطلب المستخدم،
 * ويعيد الفحص تلقائياً عند العودة. لا تظهر النافذة قبل منح الإذن.
 */
export default function OverlayPermissionCard() {
  const native = hasNativeOverlay();
  const [status, setStatus] = useState<OverlayStatus | null>(null);
  const [message, setMessage] = useState("");
  const [diagnostics, setDiagnostics] = useState("");

  const refresh = useCallback(() => {
    if (!native) return;
    const next = readOverlayStatus();
    if (next) setStatus(next);
    if (next?.granted !== true) setDiagnostics(readOverlayDiagnostics());
  }, [native]);

  useEffect(() => {
    if (!native) return;
    refresh();
    const timer = window.setInterval(refresh, 2000);
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("thimar:overlay-permission", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("thimar:overlay-permission", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [native, refresh]);

  if (!native) {
    return (
      <div className="adhan-perms">
        <div className="adhan-perms-head">
          <div>
            <strong>الظهور فوق التطبيقات</strong>
            <p className="muted">
              النافذة العائمة تعمل داخل تطبيق أندرويد فقط. في المتصفح لا يمنح النظام
              هذه الصلاحية للمواقع.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const granted = status?.granted === true;
  const showing = status?.showing === true;

  const openSettings = () => {
    openOverlaySettings();
    /* أندرويد 11+ يتجاهل تحديد اسم الحزمة ويفتح قائمة «الظهور فوق التطبيقات» العامة،
       لذا نُخبر المستخدم بما سيراه فعلًا: قائمة يبحث فيها عن «ثمار». */
    setMessage(
      "فُتحت شاشة النظام «الظهور فوق التطبيقات». على أندرويد 11 وأحدث تظهر قائمة بكل التطبيقات: ابحث فيها عن «ثمار» وفعّل المفتاح أمامه، ثم عُد إلى هنا — تتحدث الحالة تلقائياً. إن لم تجد «ثمار» في القائمة، افتح «معلومات التطبيق» ← القائمة ⋮ ← «السماح بالإعدادات المقيدة» ثم أعد المحاولة.",
    );
    window.setTimeout(refresh, 1200);
  };

  const show = () => {
    if (!granted) {
      setMessage("الإذن غير ممنوح بعد. افتح إعدادات النظام واسمح لثمار أولاً.");
      return;
    }
    const ok = showFloatingOverlay();
    setMessage(ok ? "أُرسل طلب عرض النافذة العائمة." : "تعذّر عرض النافذة. تحقق من الإذن.");
    window.setTimeout(refresh, 500);
  };

  const hide = () => {
    hideFloatingOverlay();
    setMessage("أُغلقت النافذة العائمة.");
    window.setTimeout(refresh, 500);
  };

  return (
    <div className="adhan-perms">
      <div className="adhan-perms-head">
        <div>
          <strong>الظهور فوق التطبيقات</strong>
          <p className="muted">
            يسمح بعرض نافذة ثمار الصغيرة فوق التطبيقات الأخرى. الإذن اختياري،
            ولا تُنشأ أي نافذة قبل منحه من إعدادات أندرويد.
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={refresh} aria-label="تحديث الحالة">
          تحديث
        </button>
      </div>

      <ul className="adhan-perm-list">
        <li className={granted ? "ok" : "warn"}>
          <span className="adhan-perm-dot" aria-hidden="true">
            {granted ? "✓" : "!"}
          </span>
          <div className="adhan-perm-text">
            <strong>الظهور فوق التطبيقات: {granted ? "مسموح" : "غير مسموح"}</strong>
            <small className="muted">
              {granted
                ? "الإذن ممنوح من نظام أندرويد. يمكنك إظهار النافذة الآن."
                : "افتح إعدادات النظام، ثم ابحث عن «ثمار» في قائمة «الظهور فوق التطبيقات» وفعّل المفتاح، وعُد — تتحدث الحالة تلقائياً."}
            </small>
          </div>
          <button type="button" className="ghost-button adhan-perm-btn" onClick={openSettings}>
            {granted ? "إدارة الإذن" : "فتح الإعدادات"}
          </button>
        </li>
      </ul>

      <div className="adhan-perms-block">
        <div className="adhan-perms-head">
          <div>
            <strong>نافذة ثمار العائمة</strong>
            <p className="muted">
              نافذة صغيرة قابلة للسحب، فيها زر لفتح ثمار وزر للإغلاق. تظهر فوق
              التطبيق الآخر بعد منح الإذن فقط، وتُغلق عند سحبه أو إغلاق التطبيق.
            </p>
          </div>
          <div className="adhan-perm-stats">
            <button
              type="button"
              className="primary-button"
              onClick={show}
              disabled={!granted || showing}
            >
              {showing ? "ظاهرة الآن" : "إظهار النافذة"}
            </button>
            <button type="button" className="ghost-button" onClick={hide} disabled={!showing}>
              إخفاء
            </button>
            <button type="button" className="ghost-button" onClick={openAdhanDiagnostics}>
              أدوات تشخيص الأذان
            </button>
          </div>
        </div>
      </div>

      {message ? <small className="muted">{message}</small> : null}

      {!granted && diagnostics ? (
        <details className="adhan-perms-block">
          <summary className="muted">تشخيص هذا الجهاز (يُنسخ للمراجعة)</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, direction: "ltr" }}>
            {diagnostics}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
