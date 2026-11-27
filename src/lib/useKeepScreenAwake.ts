import { useEffect } from "react";

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

type NativeWakeBridge = {
  setKeepScreenOn?: (enabled: boolean) => void;
};

/**
 * يُبقي شاشة الجهاز مفتوحة أثناء القراءة عندما يفعّل المستخدم الخيار.
 *
 * يستخدم Screen Wake Lock في المتصفح/WebView الحديث، وواجهة أندرويد الأصلية
 * عند توفرها حتى تعمل الميزة في WebView الأقدم أيضًا. أي رفض أو عدم دعم
 * يُتجاهل بهدوء: لا يجوز أن يمنع فتح المصحف أو تحفة الأطفال.
 */
export function useKeepScreenAwake(enabled: boolean): void {
  useEffect(() => {
    const native = (window as unknown as { ThimarNative?: NativeWakeBridge }).ThimarNative;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    try {
      native?.setKeepScreenOn?.(enabled);
    } catch {
      /* الجسر الأصلي غير متاح أو رفض الطلب */
    }

    if (!enabled) {
      return () => {
        try {
          native?.setKeepScreenOn?.(false);
        } catch {
          /* ignore */
        }
      };
    }

    const request = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
      if (!wakeLock) return;
      try {
        const next = await wakeLock.request("screen");
        if (cancelled) {
          await next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      } catch {
        /* المتصفح رفض الطلب (طاقة منخفضة أو سياسة النظام) */
      }
    };

    void request();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (sentinel && !sentinel.released) {
        void sentinel.release().catch(() => undefined);
      }
      sentinel = null;
      try {
        native?.setKeepScreenOn?.(false);
      } catch {
        /* ignore */
      }
    };
  }, [enabled]);
}
