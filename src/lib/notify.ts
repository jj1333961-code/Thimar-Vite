type BackgroundRegistration = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> };
  periodicSync?: { register: (tag: string, options: { minInterval: number }) => Promise<void> };
};

/**
 * يُفعّل فحص الإشعارات في الخلفية: Background Sync عند عودة الإنترنت،
 * وPeriodic Background Sync حيث يدعمه النظام (أندرويد/كروم)، حتى تصل
 * الرسائل والتذكيرات خارج التطبيق.
 */
export async function enableBackgroundNotifications(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const registration = (await navigator.serviceWorker.ready) as BackgroundRegistration;
    try {
      await registration.sync?.register("thimar-notifications");
    } catch {
      /* غير مدعوم */
    }
    if (registration.periodicSync?.register) {
      try {
        const permissions = navigator.permissions;
        const status = permissions
          ? await permissions.query({ name: "periodic-background-sync" as PermissionName })
          : null;
        if (!status || status.state === "granted") {
          await registration.periodicSync.register("thimar-check", {
            minInterval: 15 * 60 * 1000,
          });
        }
      } catch {
        /* غير مدعوم */
      }
    }
  } catch {
    /* ignore */
  }
}

/** حالة إذن الإشعارات الحالية كما يراها النظام (granted / denied / default / unsupported). */
export function currentNotificationPermission(): string {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/**
 * يقرأ الإذن من واجهة الأذونات إن توفرت (أدق على أندرويد بعد تغييره من إعدادات الهاتف)،
 * وإلا يعود إلى Notification.permission.
 */
export async function refreshNotificationPermission(): Promise<string> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    const status = await navigator.permissions?.query({ name: "notifications" as PermissionName });
    if (status) return status.state === "prompt" ? "default" : status.state;
  } catch {
    /* بعض المتصفحات لا تدعم الاستعلام */
  }
  return Notification.permission;
}

/**
 * يطلب إذن الإشعارات ويحدّث الحالة. يجب استدعاؤه من داخل نقرة المستخدم مباشرة
 * (بدون await قبله) حتى يظهر مربع السماح على الهاتف.
 */
export async function requestNotificationPermission(): Promise<string> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
  const state = await refreshNotificationPermission();
  if (state === "granted") {
    await enableBackgroundNotifications();
  }
  return state;
}

/**
 * يراقب تغيّر إذن الإشعارات (بما في ذلك تغييره من إعدادات الهاتف ثم العودة للتطبيق)
 * ويعيد دالة لإلغاء المراقبة.
 */
export function watchNotificationPermission(onChange: (state: string) => void): () => void {
  if (typeof Notification === "undefined") {
    onChange("unsupported");
    return () => undefined;
  }
  let disposed = false;
  let status: PermissionStatus | null = null;
  const sync = () => {
    void refreshNotificationPermission().then((state) => {
      if (!disposed) onChange(state);
    });
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") sync();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", sync);
  void (async () => {
    try {
      status = (await navigator.permissions?.query({ name: "notifications" as PermissionName })) ?? null;
      if (disposed) {
        status = null;
        return;
      }
      status?.addEventListener("change", sync);
    } catch {
      /* غير مدعوم */
    }
  })();
  sync();
  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", sync);
    status?.removeEventListener("change", sync);
  };
}

export async function requestAppPermissions(): Promise<void> {
  // إذن الإشعارات يُطلب من زر صريح في الإعدادات فقط؛ الطلب التلقائي قد يُرفض
  // فيُقفل زر الإشعارات في «معلومات التطبيق» على أندرويد دون إمكانية إعادة الطلب.
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    await enableBackgroundNotifications();
  }
  // الميكروفون لا يُفتح هنا إطلاقًا: يُطلب فقط عند ضغط المستخدم على زر التسميع/التسجيل.
  // الموقع لا يُطلب هنا: تُطلبه بطاقة المواقيت مرة واحدة ثم يُحفظ على الجهاز.
  // حساسات الحركة (iOS)
  try {
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      await DOE.requestPermission();
    }
  } catch {
    /* ignore */
  }
  // التخزين المستمر ليبقى التطبيق يعمل دون إنترنت
  try {
    if (navigator.storage?.persist) {
      await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
}

/**
 * يعرض إشعارًا خارج التطبيق عبر عامل الخدمة (يبقى ظاهرًا ولو كان التطبيق في الخلفية).
 * يقبل صورة كبيرة (image) تظهر داخل الإشعار على أندرويد، مثل صورة الصلاة.
 */
export async function showSystemNotification(
  title: string,
  body: string,
  options: { image?: string; url?: string; tag?: string } = {},
): Promise<void> {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const image = options.image;
    const url = options.url ?? "/";
    const tag = options.tag ?? "thimar-external";
    try {
      const active = (window as any).__thimarActiveConversation;
      if (active && typeof url === "string" && url.includes(`c=${active}`)) return;
    } catch { /* ignore */ }
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      try {
        await registration.showNotification(title, {
          body,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          dir: "rtl",
          lang: "ar",
          vibrate: [200, 100, 200],
          tag,
          renotify: true,
          timestamp: Date.now(),
          ...(image ? { image } : {}),
          data: { url, image },
        } as NotificationOptions);
        return;
      } catch {
        /* نجرّب الطريقة المباشرة أدناه */
      }
    }
    new Notification(title, {
      body,
      icon: "/icons/icon-192.png",
      dir: "rtl",
      lang: "ar",
      ...(image ? { image } : {}),
    } as NotificationOptions);
  } catch {
    /* ignore */
  }
}
