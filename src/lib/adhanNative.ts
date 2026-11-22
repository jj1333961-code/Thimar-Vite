import { Capacitor } from "@capacitor/core";

export type AdhanNativeTimes = Record<string, string>;

const PRAYER_NAMES: Record<string, string> = {
  Fajr: "الفجر",
  Dhuhr: "الظهر",
  Asr: "العصر",
  Maghrib: "المغرب",
  Isha: "العشاء",
};

const NOTIFICATION_IDS = [1001, 1002, 1003, 1004, 1005];

export async function requestAdhanPermissions(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const perm = await LocalNotifications.requestPermissions();
    return perm.display === "granted";
  } catch {
    return false;
  }
}

export async function registerAdhanTapHandler(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
      const title = action?.notification?.title ?? "";
      window.dispatchEvent(new CustomEvent("thimar:prayer-notification-tap", { detail: { title } }));
    });
  } catch {
    /* تجاهل */
  }
}

export async function scheduleIosAdhan(
  times: AdhanNativeTimes,
  enabled: Record<string, boolean>,
  master: boolean,
): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");

    // إلغاء أي جدولة قديمة (منع التكرار).
    await LocalNotifications.cancel({ notifications: NOTIFICATION_IDS.map((id) => ({ id })) });

    if (!master) return true;

    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") return false;

    const now = new Date();
    const notifications: any[] = [];
    let idx = 0;
    for (const key of ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]) {
      if (enabled[key] === false) continue;
      const t = times[key];
      if (!t) continue;
      const [h, m] = t.split(":").map((x) => parseInt(x, 10));
      if (isNaN(h) || isNaN(m)) continue;
      const at = new Date();
      at.setHours(h, m, 0, 0);
      if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
      notifications.push({
        id: NOTIFICATION_IDS[idx],
        title: `حان وقت صلاة ${PRAYER_NAMES[key]}`,
        body: `الوقت: ${t}`,
        schedule: { at, allowWhileIdle: true },
        sound: "default",
        smallIcon: "ic_stat_thimar",
      });
      idx += 1;
      if (idx >= NOTIFICATION_IDS.length) break;
    }
    if (notifications.length) {
      await LocalNotifications.schedule({ notifications });
    }
    return true;
  } catch {
    return false;
  }
}
