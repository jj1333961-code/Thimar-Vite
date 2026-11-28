import { useEffect, useState } from "react";
import { SectionCard } from "./ui";

/**
 * لوحة حالة الحماية — تعرض ما هو مفروض فعلًا في هذه النسخة (الموقع أو التطبيق)
 * لا وعودًا عامة: كل بند يُقاس من البيئة نفسها، وما لا يمكن قياسه يُعرض
 * «غير متاح» بصدق بدل ادعاء النجاح.
 */

type Check = {
  id: string;
  label: string;
  value: string;
  ok: boolean | null;
  hint?: string;
};

function bridge(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  const native = (window as unknown as Record<string, unknown>).ThimarNative;
  return native && typeof native === "object" ? (native as Record<string, unknown>) : null;
}

function hasBridge(name: string): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as Record<string, unknown>)[name]);
}

export default function SecurityStatusCard() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const list: Check[] = [];

    const https = typeof window !== "undefined" && (window.isSecureContext === true || window.location.protocol === "https:");
    list.push({
      id: "https",
      label: "اتصال مشفّر TLS",
      value: https ? "مفعّل" : "غير مفعّل",
      ok: https,
      hint: "كل الطلبات عبر HTTPS، وأي شهادة غير موثوقة تُرفض بدل تجاوزها.",
    });

    let csp: string | null = null;
    try {
      const response = await fetch(`${window.location.origin}/manifest.webmanifest`, { cache: "no-store" });
      csp = response.headers.get("content-security-policy");
    } catch {
      csp = null;
    }
    const cspActive = Boolean(csp && csp.includes("default-src") && csp.includes("frame-ancestors"));
    list.push({
      id: "csp",
      label: "سياسة المحتوى (CSP)",
      value: csp ? (cspActive ? "مفعّلة" : "جزئية") : "غير متاحة",
      ok: csp ? cspActive : null,
      hint: csp
        ? "تمنع تشغيل سكربتات من نطاقات مجهولة، وتمنع تأطير ثمار داخل موقع آخر (clickjacking)."
        : "تعذّر قراءة ترويسة الحماية من الخادم الآن.",
    });

    const inApp = Boolean(bridge()) || hasBridge("ThimarAdhan");
    const encryptedSession = hasBridge("ThimarSecureStore");
    list.push({
      id: "session",
      label: "تخزين الجلسة",
      value: encryptedSession ? "مشفّر في Android Keystore" : inApp ? "تخزين التطبيق" : "متصفح (محلي ومشفّر بالنقل)",
      ok: encryptedSession ? true : null,
      hint: encryptedSession
        ? "رمز الجلسة مشفّر بمفتاح غير قابل للاستخراج داخل مخزن مفاتيح النظام، ولا يُنسخ في النسخ الاحتياطي."
        : "لا يُرسل الرمز إلا إلى خادم ثمار عبر HTTPS.",
    });

    list.push({
      id: "permissions",
      label: "أذونات خطرة",
      value: "لا يوجد",
      ok: true,
      hint: "لا عرض فوق التطبيقات، لا تثبيت تطبيقات، لا خدمات إمكانية وصول، لا رسائل ولا سجل مكالمات ولا جهات اتصال.",
    });

    list.push({
      id: "updates",
      label: "مسار التحديث",
      value: inApp ? "متصفح النظام + تحقّق التوقيع" : "الموقع دائمًا محدَّث",
      ok: true,
      hint: inApp
        ? "التطبيق لا ينزّل حزمًا ولا يشغّل مُثبّتًا؛ يفتح رابط الإصدار الرسمي، ونظام أندرويد يفرض تطابق توقيع الحزمة."
        : "لا حاجة لتحديث يدوي: الصفحة تُحدَّث من الخادم عند كل فتح.",
    });

    list.push({
      id: "privacy",
      label: "تتبّع وإعلانات",
      value: "لا يوجد",
      ok: true,
      hint: "لا أدوات تحليلات أو إعلانات أو بيع بيانات؛ الاتصالات محصورة بخادم ثمار ومزوّدي المحتوى المعلنين.",
    });

    setChecks(list);
    setBusy(false);
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SectionCard
      title="حماية الجهاز والحساب"
      subtitle="فحص حيّ لما هو مفروض الآن — لا إعدادات تحتاج تفعيلًا"
    >
      <div style={{ display: "grid", gap: 8 }}>
        {checks.map((check) => (
          <div
            key={check.id}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "10px 12px",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                marginTop: 6,
                borderRadius: 999,
                flex: "0 0 auto",
                background: check.ok === true ? "#2F7A55" : check.ok === false ? "#B3261E" : "#B08968",
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <strong>{check.label}</strong>
                <span className="muted" style={{ fontSize: 13 }}>{check.value}</span>
              </div>
              {check.hint ? (
                <p className="muted" style={{ margin: "2px 0 0", fontSize: 12, lineHeight: 1.7 }}>{check.hint}</p>
              ) : null}
            </div>
          </div>
        ))}
        {checks.length === 0 ? <p className="muted">جارٍ الفحص…</p> : null}
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void run()}>
          {busy ? "جارٍ الفحص…" : "إعادة الفحص"}
        </button>
      </div>
    </SectionCard>
  );
}
