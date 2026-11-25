/**
 * اشتراك الجهاز في إشعارات Web Push الحقيقية.
 *
 * الاشتراك يُحفظ في جدول thimar_push_subscriptions على السحابة، فيستطيع الخادم
 * إرسال الإشعارات والرسائل والأذان والتذكير اليومي حتى لو كان التطبيق مغلقًا.
 */
import { cloud, SUPABASE_ANON_KEY, SUPABASE_URL } from "./cloud";
import { nativePushToken } from "./nativePush";
import { fallbackCities } from "./islamic";

const TABLE = "thimar_push_subscriptions";

export type PushPrefs = {
  latitude?: number;
  longitude?: number;
  method: number;
  adhan: boolean;
  daily: boolean;
};

/** يقرأ تفضيلات الجهاز (الموقع وطريقة الحساب) من الإعدادات المحفوظة. */
export function pushPrefsFromDevice(): PushPrefs {
  let method = 4;
  let adhan = true;
  try {
    const raw = localStorage.getItem("thimar.settings.v1");
    if (raw) {
      const parsed = JSON.parse(raw) as { prayerMethod?: number; notifications?: boolean };
      if (typeof parsed.prayerMethod === "number") method = parsed.prayerMethod;
      if (typeof parsed.notifications === "boolean") adhan = parsed.notifications;
    }
  } catch {
    /* ignore */
  }

  let latitude: number | undefined;
  let longitude: number | undefined;
  try {
    const rawCoords = localStorage.getItem("thimar.prayer.coords");
    const coords = rawCoords ? (JSON.parse(rawCoords) as { lat?: number; lng?: number }) : null;
    if (coords && typeof coords.lat === "number" && typeof coords.lng === "number") {
      latitude = coords.lat;
      longitude = coords.lng;
    }
    if (latitude === undefined || longitude === undefined) {
      const cityId = localStorage.getItem("thimar.prayer.city") ?? "makkah";
      const city = fallbackCities.find((item) => item.id === cityId) ?? fallbackCities[0];
      if (city) {
        latitude = city.lat;
        longitude = city.lng;
      }
    }
  } catch {
    /* ignore */
  }

  return { latitude, longitude, method, adhan, daily: true };
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

/** يسجّل الجهاز لدى خدمة الدفع ويرفع الاشتراك إلى السحابة. */
export async function subscribeToPush(
  accountId: string,
  prefs: PushPrefs = pushPrefsFromDevice(),
): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const keyResponse = await fetch("/api/push/key", { cache: "no-store" });
    if (!keyResponse.ok) return false;
    const keyData = (await keyResponse.json()) as { publicKey?: string };
    if (!keyData?.publicKey) return false;

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as BufferSource,
      });
    }
    const json = subscription.toJSON();
    const keys = json.keys as { p256dh?: string; auth?: string } | undefined;
    if (!keys?.p256dh || !keys?.auth) return false;

    const { error } = await cloud.from(TABLE).upsert(
      {
        account_id: accountId,
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        latitude: prefs.latitude ?? null,
        longitude: prefs.longitude ?? null,
        prayer_method: prefs.method,
        adhan_enabled: prefs.adhan,
        daily_enabled: prefs.daily,
        updated_at: Date.now(),
      },
      { onConflict: "endpoint" },
    );
    if (error) throw error;
    return true;
  } catch (error) {
    console.warn("Thimar push subscribe:", error);
    return false;
  }
}

/** يحدّث الاشتراك بصمت (عند فتح التطبيق أو تغيير الإعدادات). */
export async function syncPushSubscription(
  accountId: string,
  prefs: PushPrefs = pushPrefsFromDevice(),
): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  return subscribeToPush(accountId, prefs);
}

/** يطلب من الخادم إرسال إشعار حقيقي إلى أجهزة هذا الحساب (اختبار السلسلة كاملة). */
export async function serverTestPush(accountId: string): Promise<boolean> {
  try {
    const response = await fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        title: "ثمار",
        body: "إشعار من الخادم — ستصل الرسائل والتذكيرات حتى والتطبيق مغلق ✓",
        url: "/",
        tag: "thimar-server-test",
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * يرسل إشعارات FCM فورية إلى حسابات أخرى (رسالة محادثة أو مهمة معلم).
 *
 * الإرسال لا يعتمد على `senderId` وحده: يُرفق رمز FCM المربوط بهذا الجهاز،
 * وتتحقق دالة `thimar-notify` من أن الرمز يخص المرسل ومن صلاحيته على المستلمين.
 * على الويب بلا رمز FCM يبقى الإشعار داخل التطبيق فقط.
 */
export async function notifyAccounts(
  accountIds: string[],
  payload: { title: string; body: string; url?: string; tag?: string },
  options: { senderId?: string; kind?: "chat" | "homework"; conversationId?: string } = {},
): Promise<void> {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (!ids.length) return;
  const senderToken = nativePushToken();

  /* مسار الخادم الموقّع (FCM) — يتطلب رمز جهاز المرسل. */
  if (options.senderId && options.kind && senderToken) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/thimar-notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          senderId: options.senderId,
          senderToken,
          kind: options.kind,
          conversationId: options.conversationId,
          recipientIds: ids,
          ...payload,
        }),
        keepalive: true,
      });
    } catch {
      /* نكمل بالمسار البديل */
    }
  }

  /* مسار بديل (نفس الأصل): يرسل FCM/Web Push للحسابات مباشرة.
     يغطي المرسل من الويب (بلا رمز FCM) وحالات تعذّر المسار الموقّع. */
  try {
    await fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountIds: ids,
        title: payload.title,
        body: payload.body,
        url: payload.url,
        tag: payload.tag,
      }),
      keepalive: true,
    });
  } catch {
    /* لا نعطّل إرسال الرسالة إن فشل الإشعار */
  }
}
