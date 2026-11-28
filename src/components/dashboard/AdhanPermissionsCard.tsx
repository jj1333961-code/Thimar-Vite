import { useCallback, useEffect, useState } from "react";
import {
  hasNativeAdhan,
  readAdhanStatus,
  requestAdhanNotificationPermission,
  requestAdhanPermission,
  syncAdhanAssets,
  testAdhanNow,
  type AdhanStatus,
} from "../../lib/adhanBridge";
import { Icon } from "./ui";

type Props = {
  imageUrls: Record<string, string>;
  audioUrls: Record<string, string>;
  defaultAudioUrl: string;
};

type PermissionRow = {
  key: string;
  title: string;
  why: string;
  ok: boolean;
  optional?: boolean;
};

const PRAYER_ORDER = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"] as const;
const PRAYER_LABELS: Record<string, string> = {
  Fajr: "الفجر",
  Dhuhr: "الظهر",
  Asr: "العصر",
  Maghrib: "المغرب",
  Isha: "العشاء",
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "٠";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

/**
 * شاشة إعداد أذونات وقت الصلاة: تشرح كل إذن، وتعرض حالته الحقيقية من أندرويد،
 * وتفتح شاشة النظام المناسبة بطلب صريح من المستخدم. كما تدير تنزيل صور
 * الصلوات والأذان المختار للاستخدام دون إنترنت.
 */
export default function AdhanPermissionsCard({ imageUrls, audioUrls, defaultAudioUrl }: Props) {
  const native = hasNativeAdhan();
  const [status, setStatus] = useState<AdhanStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!native) return;
    const next = readAdhanStatus();
    if (next) setStatus(next);
  }, [native]);

  useEffect(() => {
    if (!native) return;
    refresh();
    const timer = window.setInterval(refresh, 5000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [native, refresh]);

  if (!native) {
    return (
      <div className="adhan-perms">
        <p className="muted">
          إعدادات الأذونات وشاشة الصلاة الكاملة تعمل داخل تطبيق أندرويد. في المتصفح يظهر
          إشعار النظام فقط، وفق ما يسمح به الجهاز.
        </p>
      </div>
    );
  }

  const permissions = status?.permissions || {};
  const android = permissions.android ?? 0;
  const rows: PermissionRow[] = [
    {
      key: "notifications",
      title: "إشعارات التطبيق",
      why: "إشعار وقت الصلاة هو ما يفتح شاشة الصلاة ويُشغّل الأذان، حتى والتطبيق مغلق.",
      ok: permissions.notifications === true,
    },
    {
      key: "exactAlarms",
      title: "المنبهات الدقيقة",
      why: "يضبط الأذان في وقته بالدقيقة بدل التأخير. بدونه قد يتأخر الإشعار دقائق.",
      ok: permissions.exactAlarms === true,
    },
  ];

  const request = (key: string) => {
    if (key === "notifications" && android >= 33) {
      requestAdhanNotificationPermission();
    } else {
      requestAdhanPermission(key);
    }
    setMessage("سيُفتح إعداد النظام — عُد إلى ثمار بعد التفعيل.");
    window.setTimeout(refresh, 1500);
  };

  const download = () => {
    setBusy(true);
    setMessage("جارٍ تنزيل الصور والأذان المختار…");
    const result = syncAdhanAssets({
      imageUrls,
      urls: audioUrls,
      defaultUrl: defaultAudioUrl,
    });
    if (result?.error) {
      setMessage(`تعذّر بدء التنزيل: ${result.error}`);
    } else {
      setMessage("بدأ التنزيل في الخلفية — يمكنك استخدام التطبيق، ويُحدَّث الحجم تلقائيًا.");
    }
    window.setTimeout(() => {
      refresh();
      setBusy(false);
    }, 3500);
  };

  const imagesCached = PRAYER_ORDER.filter((key) => status?.assets?.images?.[key]?.cached).length;
  const audioCount = status?.assets?.audio?.count ?? 0;
  const nextAlarm = Object.entries(status?.scheduled || {}).sort((a, b) => a[1].localeCompare(b[1]))[0];
  const nextPrayerKey = nextAlarm
    ? PRAYER_ORDER.find((key) => key.toLowerCase() === nextAlarm[0].toLowerCase())
    : undefined;

  return (
    <div className="adhan-perms">
      <div className="adhan-perms-head">
        <div>
          <strong>أذونات وقت الصلاة وشاشة الأذان</strong>
          <p className="muted">
            شاشة الصلاة تعمل عندما يكون التطبيق مفتوحًا أو في الخلفية أو مغلقًا، وفوق شاشة
            القفل — كل إذن هنا يشرح سبب الحاجة إليه.
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={refresh} aria-label="تحديث الحالة">
          تحديث
        </button>
      </div>

      <ul className="adhan-perm-list">
        {rows.map((row) => (
          <li key={row.key} className={row.ok ? "ok" : row.optional ? "warn" : "bad"}>
            <span className="adhan-perm-dot" aria-hidden="true">
              {row.ok ? "✓" : row.optional ? "!" : "✕"}
            </span>
            <div className="adhan-perm-text">
              <strong>
                {row.title}
                {row.optional ? <span className="muted"> — اختياري</span> : null}
              </strong>
              <small className="muted">{row.why}</small>
            </div>
            <button
              type="button"
              className="ghost-button adhan-perm-btn"
              onClick={() => request(row.key)}
              disabled={row.ok}
            >
              {row.ok ? "مفعّل" : row.optional ? "تفعيل" : "فتح الإعدادات"}
            </button>
          </li>
        ))}
      </ul>

      <div className="adhan-perms-block">
        <div className="adhan-perms-head">
          <div>
            <strong>ملفات الأذان دون إنترنت</strong>
            <p className="muted">
              تُنزَّل صورة كل صلاة وصوت الأذان المختار مرة واحدة إلى التخزين المحلي، وتُستخدم
              بلا إنترنت. لا يُعاد التنزيل إن كان الملف موجودًا.
            </p>
          </div>
          <button type="button" className="primary-button" onClick={download} disabled={busy}>
            <Icon name="volume" size={16} /> {busy ? "جارٍ التنزيل…" : "تنزيل الآن"}
          </button>
        </div>
        <div className="adhan-perm-stats">
          <span>
            الصور: <strong>{imagesCached}/5</strong>
          </span>
          <span>
            ملفات الأذان: <strong>{audioCount}</strong>
          </span>
          <span>
            المساحة: <strong>{formatBytes(status?.assetsBytes || 0)}</strong>
          </span>
          <span>
            أقرب منبه: <strong>{nextAlarm ? `${PRAYER_LABELS[nextPrayerKey || ""] || nextAlarm[0]} — ${nextAlarm[1]}` : "غير مجدول"}</strong>
          </span>
        </div>
        {status?.assets?.lastError ? (
          <small className="muted">آخر ملاحظة: {status.assets.lastError}</small>
        ) : null}
        <button
          type="button"
          className="ghost-button"
          onClick={() => {
            testAdhanNow("Fajr");
            setMessage("أُرسلت تجربة أذان الفجر — ستظهر الشاشة ويُشغّل الصوت خلال ثوانٍ.");
          }}
        >
          تجربة الأذان الآن (منبه ← إشعار ← شاشة ← صوت)
        </button>
      </div>

      {message ? <small className="muted">{message}</small> : null}
      <p className="muted adhan-perms-note">
        ثمار لا تتجاوز حماية أندرويد ولا تفتح قفل الجهاز تلقائيًا. بعد منح «العرض فوق
        التطبيقات» تُفتح شاشة الأذان وحدها فوق التطبيقات الأخرى وتُضيء الشاشة؛ وبلا الإذن
        يظهر إشعار بوقت الصلاة يمكن الضغط عليه. ولكتم الصوت: اضغط زر رفع أو خفض الصوت
        أثناء الأذان — يُفعّل من خانة «كتم الأذان بأزرار الصوت» في الإعدادات.
      </p>
    </div>
  );
}
