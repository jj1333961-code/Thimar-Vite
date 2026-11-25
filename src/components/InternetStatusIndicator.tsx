import { useCallback, useEffect, useRef, useState } from "react";

type Toast = { online: boolean } | null;
type Lang = "ar" | "en";

const HIDE_AFTER_MS = 3000;
const CHECK_TIMEOUT_MS = 4000;
const HEALTH_URL = "/api/ai/health";

const TEXT: Record<Lang, { online: string; offline: string }> = {
  ar: { online: "🟢 متصل بالإنترنت", offline: "🔴 غير متصل بالإنترنت" },
  en: { online: "🟢 Connected to the internet", offline: "🔴 No internet connection" },
};

function currentLanguage(): Lang {
  if (typeof document !== "undefined") {
    const lang = (document.documentElement.lang || "").toLowerCase();
    if (lang.startsWith("en")) return "en";
    if (lang.startsWith("ar")) return "ar";
  }
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("en")) return "en";
  return "ar";
}

/**
 * تنبيه مؤقت أعلى الشاشة عند تغيّر حالة الاتصال فقط.
 *
 * navigator.onLine وحده لا يكفي: قد يكون الاتصال المحلي موجودًا بينما تعذّر
 * الوصول إلى خادم التطبيق. لذلك نتحقق من /api/ai/health بعد أحداث online،
 * مع مهلة قصيرة، ونميّز «الخادم غير قابل للوصول» عن «الجهاز غير متصل».
 * لا نكرر التنبيه ما دامت الحالة نفسها، ولا نعرض شريطًا دائمًا.
 */
export default function InternetStatusIndicator() {
  const [toast, setToast] = useState<Toast>(null);
  const [lang, setLang] = useState<Lang>(() => currentLanguage());
  const timerRef = useRef<number | null>(null);
  const stateRef = useRef<boolean | null>(null);
  const checkSeqRef = useRef(0);
  const debounceRef = useRef<number | null>(null);

  const hideToast = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback((online: boolean) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setToast({ online });
    timerRef.current = window.setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, HIDE_AFTER_MS);
  }, []);

  const publish = useCallback(
    (online: boolean, announce: boolean) => {
      const previous = stateRef.current;
      if (previous === online) return;
      stateRef.current = online;
      // عند أول فحص: لا نزعج المستخدم برسالة «متصل» وهو يفتح التطبيق أصلًا.
      if (announce && (previous !== null || !online)) showToast(online);
    },
    [showToast],
  );

  const check = useCallback(async () => {
    const id = ++checkSeqRef.current;
    let online = typeof navigator === "undefined" ? true : navigator.onLine;

    if (online) {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeout = controller
        ? window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
        : null;
      try {
        // يكفي وصول أي استجابة HTTP من خادم التطبيق لإثبات أن المسار يعمل؛
        // فشل الشبكة/المهلة فقط يعني أن الخادم غير قابل للوصول.
        await fetch(HEALTH_URL, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          signal: controller?.signal,
        });
        online = true;
      } catch {
        online = false;
      } finally {
        if (timeout !== null) window.clearTimeout(timeout);
      }
    }

    if (id !== checkSeqRef.current) return;
    publish(online, true);
  }, [publish]);

  const scheduleCheck = useCallback(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void check();
    }, 250);
  }, [check]);

  useEffect(() => {
    const onOnline = () => scheduleCheck();
    const onOffline = () => {
      // اعرض الأحمر فورًا بدل انتظار مهلة فحص الخادم.
      checkSeqRef.current += 1;
      publish(false, true);
      scheduleCheck();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") scheduleCheck();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    void check();

    // لغة التطبيق تُضبط على <html lang> عند تغيير الإعدادات.
    const languageObserver =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => setLang(currentLanguage()))
        : null;
    languageObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });

    return () => {
      checkSeqRef.current += 1;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      languageObserver?.disconnect();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [check, publish, scheduleCheck]);

  if (!toast) return null;

  return (
    <div
      className={`internet-status-toast ${toast.online ? "is-online" : "is-offline"}`}
      role="status"
      aria-live="polite"
      dir={lang === "ar" ? "rtl" : "ltr"}
      onClick={hideToast}
    >
      {TEXT[lang][toast.online ? "online" : "offline"]}
    </div>
  );
}
