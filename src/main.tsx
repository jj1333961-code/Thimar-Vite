import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TranslationLayer } from "./lib/autoTranslate";
import { enableBackgroundNotifications } from "./lib/notify";
import { pullCloud } from "./lib/cloud";
import "./styles.css";
import "./styles-v2.css";
import "./styles-v3.css";
import "./thimar-polish.css";

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

const warmTilawa = () => {
  void import("./lib/tilawaRecitation")
    .then((module) => module.scheduleTilawaPreload())
    .catch(() => undefined);
};
if (document.readyState === "complete") warmTilawa();
else window.addEventListener("load", warmTilawa, { once: true });

/*
 * Quran ASR Small مضمَّن إلزاميًا في الحزمة، فلا يوجد أي تنزيل أو تفعيل.
 * يُجهَّز في الخلفية فقط إذا كان المستخدم قد اختار وضعًا يستخدمه (وحين تكفي
 * الذاكرة)، وإلا يُجهَّز عند أول بدء تسميع من الملفات المحلية نفسها. لا يُحمَّل
 * نموذجان كبيران معًا في الإقلاع، ولا يُعاد تحميل النموذج بين المحاولات.
 */
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
