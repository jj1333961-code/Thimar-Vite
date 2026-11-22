import { loadSettings } from "./appStore";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    return ctx;
  } catch {
    return null;
  }
}

/**
 * نغمة قصيرة مولّدة داخل التطبيق (بلا ملفات صوت).
 * تُحترم فيها خانة «صوت الإشعارات» في الإعدادات.
 */
export function playNotificationSound(kind: "info" | "success" | "error" | "transition" = "info") {
  const settings = loadSettings();
  if (!settings.notificationSound) return;
  const c = getCtx();
  if (!c) return;
  // بعض المتصفحات تبدأ السياق معلّقًا حتى أول تفاعل من المستخدم.
  if (c.state === "suspended") {
    void c.resume().catch(() => undefined);
  }

  const freqs: Record<string, number[]> = {
    info: [784, 988],
    success: [660, 880, 1046],
    error: [392, 262],
    transition: [523, 659],
  };
  const seq = freqs[kind] ?? freqs.info;
  const start = c.currentTime + 0.02;
  const step = 0.11;
  const volume = 0.18;

  seq.forEach((f, i) => {
    const at = start + i * step;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + step * 0.95);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(at);
    osc.stop(at + step);
  });
}

/** يعيد فتح الصوت بعد أول لمسة/نقرة، لتضمن الأجهزة المحمولة audible sound. */
export function primeNotificationSound() {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume().catch(() => undefined);
}

/** مفتاح الاهتزاز العام: يتحكم في كل اهتزازات التطبيق (أخطاء، إشعارات، تسبيح…). */
let vibrationEnabled = true;
export function applyVibrationSetting(enabled: boolean) {
  vibrationEnabled = Boolean(enabled);
}

let gateInstalled = false;
/**
 * يغلّف navigator.vibrate مرة واحدة، فأي نداء اهتزاز في التطبيق (حتى لو لم
 * يمرّ عبر vibrate()) يتوقف فورًا عندما يكون الاهتزاز مغلقًا في الإعدادات.
 */
export function installVibrationGate() {
  if (gateInstalled || typeof navigator === "undefined") return;
  const nativeVibrate = navigator.vibrate?.bind(navigator);
  if (!nativeVibrate) return;
  try {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: (pattern: number | number[]) => {
        if (!vibrationEnabled) return false;
        try { return nativeVibrate(pattern); } catch { return false; }
      },
    });
    gateInstalled = true;
  } catch {
    // متصفح يمنع التعديل: يبقى الفحص داخل vibrate() كافيًا.
  }
}

/** اهتزاز قصير (إن كان مفعّلًا في الإعدادات ودعمه المتصفح). */
export function vibrate(pattern: number | number[] = 200) {
  try {
    if (!vibrationEnabled) return;
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    navigator.vibrate(pattern);
  } catch {
    // تجاهل الأجهزة غير المدعومة.
  }
}
