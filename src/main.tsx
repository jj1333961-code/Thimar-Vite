import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TranslationLayer } from "./lib/autoTranslate";
import { enableBackgroundNotifications } from "./lib/notify";
import { pullCloud } from "./lib/cloud";
import { installErrorMonitoring, setErrorContext } from "./lib/monitoring";
import "./styles.css";
import "./styles-v2.css";
import "./styles-v3.css";
import "./thimar-redesign.css";

/* مراقبة أخطاء الإنتاج: مستمعات عامة + سياق الحساب عند الدخول. */
installErrorMonitoring();
window.addEventListener("thimar:signed-in", ((event: Event) => {
  const detail = (event as CustomEvent<{ accountId?: string; role?: string }>).detail;
  if (detail) setErrorContext({ accountId: detail.accountId, role: detail.role });
}) as EventListener);

// يجعل التطبيق قابلًا للتثبيت ويعمل واجهته دون اتصال في النسخة المنشورة.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const register = () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        void enableBackgroundNotifications();
        const check = () => registration.update().catch(() => undefined);
        window.setInterval(check, 30 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
      })
      .catch(() => undefined);
  };
  window.addEventListener("load", register);
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === "thimar-background-check") {
      void pullCloud();
      window.dispatchEvent(new Event("thimar:background-check"));
    }
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TranslationLayer />
    <App />
  </React.StrictMode>,
);

/* لا نُجهّز محرك التسميع تلقائيًا عند الإقلاع: تحميله يستهلك المعالج والذاكرة
   ويبطئ التطبيق على الأجهزة المتوسطة. يُحمَّل عند فتح التسميع فقط. */

/* Quran ASR Small يظل محليًا ويُجهّز فقط عند الحاجة ومع توفر الذاكرة. */
const warmQuranAsr = () => {
  void import("./lib/tasmeeEngines")
    .then((orchestration) => {
      if (orchestration.readTasmeeEngineMode() === "tilawa") return undefined;
      if (orchestration.tasmeeMemoryRisk().level === "high") return undefined;
      return import("./lib/quranAsrSmall").then((engine) => engine.scheduleQuranAsrPreload());
    })
    .catch(() => undefined);
};
if (document.readyState === "complete") window.setTimeout(warmQuranAsr, 3000);
else window.addEventListener("load", () => window.setTimeout(warmQuranAsr, 3000), { once: true });
