/**
 * إشعارات FCM داخل تطبيق أندرويد (غلاف WebView أصلي بلا Capacitor).
 *
 * الجسر الأصلي (PushBridge.java) هو الذي يطلب الإذن، ينشئ القناة، يجلب رمز FCM
 * ويعرض الإشعارات في المقدمة والخلفية وحتى التطبيق مغلق. هذه الطبقة تربط الرمز
 * بالحساب المُسجَّل في Supabase (عبر دالة RPC آمنة) وتوصّل الضغط على الإشعار
 * بالصفحة المطلوبة داخل التطبيق.
 *
 * لا مفاتيح Firebase هنا: الإرسال يتم من الخادم بمفتاح OAuth لحساب الخدمة.
 */
import { cloud } from "./cloud";

type NativeBridge = {
  platform: () => string;
  appVersion?: () => string;
  appVersionCode?: () => number;
  deviceId: () => string;
  accountId?: () => string;
  permission: () => string;
  createChannel: () => boolean;
  requestPermission: () => void;
  register: () => void;
  token: () => string;
  takePendingUrl?: () => string;
  setActiveConversation?: (conversationId: string) => void;
  setMessagePreviewEnabled?: (enabled: boolean) => void;
  setAccount: (accountId: string) => void;
  setAccountSecret?: (secret: string) => void;
  clearAccount: () => void;
  deleteToken: () => void;
  openNotificationSettings?: () => void;
  setKeepScreenOn?: (enabled: boolean) => void;
  log?: (message: string) => void;
};

type PushEvent =
  | { type: "registration"; token: string }
  | { type: "registrationError"; message: string }
  | { type: "permission"; granted: boolean }
  | { type: "pushReceived"; title: string; body: string; url: string; tag: string }
  | { type: "open"; url: string };

declare global {
  interface Window {
    ThimarNative?: NativeBridge;
    __thimarPushBridge?: (event: string, payload: Record<string, unknown>) => void;
    __thimarPushOpen?: (url: string) => void;
  }
}

const STORAGE_KEY = "thimar.fcm.token";
let onOpenHandler: ((url: string) => void) | null = null;
let currentAccount: string | null = null;

/** هل يعمل التطبيق داخل الغلاف الأصلي؟ */
export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Boolean(window.ThimarNative);
}

/** رمز FCM الحالي للجهاز — يُستخدم كإثبات هوية عند إرسال إشعار.
 *  لا يُسجَّل في السجلات ولا يُرسل إلا إلى دالة ثمار الخادمية. */
export function nativePushToken(): string | null {
  try {
    const native = bridge();
    const token = native?.token?.() || localStorage.getItem(STORAGE_KEY) || "";
    return token || null;
  } catch {
    return null;
  }
}

function resolveBridge(raw: any): any {
  if (!raw) return null;
  if (raw.getInstalledVersionCode || raw.getAppVersionCode || raw.downloadUpdate || raw.appVersionCode) return raw;
  if (typeof raw === "function") {
    try {
      const result = raw();
      if (result) return result;
    } catch {
      /* ignore */
    }
  }
  return raw;
}

export function compareVersionNames(a: string, b: string): number {
  const pa = String(a).split(/[.\-]/).map((x) => Number(x) || 0);
  const pb = String(b).split(/[.\-]/).map((x) => Number(x) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function getInstalledVersionCode(): number | null {
  if (typeof window === "undefined") return null;
  const candidates = [(window as any).ThimarUpdater, (window as any).ThimarNative];
  for (const candidate of candidates) {
    const bridge = resolveBridge(candidate);
    if (!bridge) continue;
    const names = ["getInstalledVersionCode", "getAppVersionCode", "appVersionCode", "versionCode", "getVersionCode"];
    for (const name of names) {
      const value = bridge[name];
      if (typeof value === "function") {
        try {
          const result = Number(value.call(bridge));
          if (Number.isFinite(result)) return result;
        } catch {
          /* ignore */
        }
      } else if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
  }
  return null;
}

function bridge(): NativeBridge | null {
  return typeof window !== "undefined" ? window.ThimarNative ?? null : null;
}

function log(message: string) {
  try {
    bridge()?.log?.(message);
  } catch {
    /* ignore */
  }
}

/** يربط رمز الجهاز بالحساب في قاعدة البيانات (دالة RPC آمنة). */
function deviceSecret(accountId: string): string | null {
  try {
    return localStorage.getItem(`thimar.deviceSecret.${accountId}`);
  } catch {
    return null;
  }
}

function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function authorizeDevice(accountId: string, password: string): Promise<string | null> {
  const native = bridge();
  const deviceId = native?.deviceId?.() || `web-${accountId}`;
  try {
    const { data, error } = await cloud.rpc("thimar_authorize_device", {
      p_account_id: accountId,
      p_password: password,
      p_device_id: deviceId,
    });
    if (error || typeof data !== "string" || !data) return null;
    localStorage.setItem(`thimar.deviceSecret.${accountId}`, data);
    native?.setAccountSecret?.(data);
    return data;
  } catch {
    return null;
  }
}

/** يربط رمز الجهاز بالحساب في قاعدة البيانات (دالة RPC آمنة). */
export async function bindTokenToAccount(token: string, accountId: string): Promise<boolean> {
  const native = bridge();
  if (!native || !token || !accountId) return false;
  const deviceId = native.deviceId();
  const params: Record<string, unknown> = {
    p_token: token,
    p_account_id: accountId,
    p_device_id: deviceId,
    p_platform: native.platform() || "android",
    p_app_version: native.appVersion?.() ?? "1.6.0",
    p_app_version_code: native.appVersionCode?.() ?? getInstalledVersionCode() ?? null,
  };

  const secret = deviceSecret(accountId);
  if (!secret) {
    log("لا يوجد تفويض جهاز آمن لهذا الحساب.");
    return false;
  }

  params.p_device_secret = secret;
  params.p_request_nonce = generateNonce();
  try {
    const { error } = await cloud.rpc("thimar_bind_fcm_token_secure", params);
    if (error) throw error;
    localStorage.setItem(STORAGE_KEY, token);
    native.setAccountSecret?.(secret);
    return true;
  } catch (error) {
    log("فشل ربط رمز الإشعارات (secure): " + String(error));
    return false;
  }
}

/** يلغي ربط الجهاز (تسجيل الخروج) ويطلب من النظام حذف الرمز. */
export async function unregisterNativePush(accountId?: string): Promise<void> {
  const native = bridge();
  if (!native) return;
  const deviceId = native.deviceId();
  const secret = accountId ? deviceSecret(accountId) : null;
  if (!accountId || !secret) {
    log("لا يوجد تفويض جهاز آمن؛ تم تخطي الإلغاء على الخادم.");
    return;
  }
  try {
    await cloud.rpc("thimar_revoke_fcm_token_secure", {
      p_device_id: deviceId,
      p_account_id: accountId,
      p_device_secret: secret,
      p_request_nonce: generateNonce(),
    });
  } catch (error) {
    log("فشل إلغاء ربط رمز الإشعارات (secure): " + String(error));
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
    native.clearAccount();
    native.deleteToken();
  } catch {
    /* ignore */
  }
  currentAccount = null;
}

/**
 * يجهّز إشعارات الجهاز: إذن، قناة، رمز، وربطه بالحساب.
 * آمن للاستدعاء عند كل فتح للتطبيق أو تغيير الحساب.
 */
export async function registerNativePush(
  accountId: string,
  onOpen?: (url: string) => void,
): Promise<boolean> {
  const native = bridge();
  if (!native || !accountId) return false;

  if (onOpen) onOpenHandler = onOpen;
  currentAccount = accountId;
  installHandlers();
  installDeepLinkHandler();

  try {
    native.createChannel();
  } catch {
    /* القناة تُنشأ أيضًا عند بدء التطبيق. */
  }

  try {
    if (native.permission() !== "granted") native.requestPermission();
    native.setAccount(accountId);
    const secret = deviceSecret(accountId);
    if (secret) native.setAccountSecret?.(secret);
    native.register();

    const existing = native.token();
    if (existing) await bindTokenToAccount(existing, accountId);

    const pending = native.takePendingUrl?.();
    if (pending && pending !== "/") openInApp(pending);
    return true;
  } catch (error) {
    log("تعذّر تجهيز إشعارات الجهاز: " + String(error));
    return false;
  }
}

/** يعيد ربط الرمز الحالي (بعد تجديده أو تغيير الحساب). */
export async function syncNativePush(accountId: string): Promise<void> {
  const native = bridge();
  if (!native || !accountId) return;
  native.setAccount(accountId);
  const secret = deviceSecret(accountId);
  if (secret) native.setAccountSecret?.(secret);
  const token = native.token();
  if (token) await bindTokenToAccount(token, accountId);
}

function openInApp(url: string) {
  if (!url) return;
  if (onOpenHandler) onOpenHandler(url);
  window.dispatchEvent(new CustomEvent("thimar:push-open", { detail: { type: "open", url } }));
}

let handlersInstalled = false;

/** يستقبل أحداث الجسر الأصلي (تسجيل، إذن، وصول إشعار، ضغط). */
function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;

  window.__thimarPushBridge = (event: string, payload: Record<string, unknown>) => {
    const account = currentAccount;
    if (event === "registration") {
      const token = String(payload?.value ?? "");
      if (token) {
        localStorage.setItem(STORAGE_KEY, token);
        if (account) void bindTokenToAccount(token, account);
      }
      return;
    }
    if (event === "registrationError") {
      log("فشل تسجيل رمز FCM: " + String(payload?.message ?? ""));
      return;
    }
    if (event === "permission") {
      const granted = Boolean(payload?.granted);
      log("إذن الإشعارات: " + (granted ? "ممنوح" : "مرفوض"));
      if (granted && account) {
        const native = bridge();
        native?.register();
        const token = native?.token();
        if (token) void bindTokenToAccount(token, account);
      }
      window.dispatchEvent(new CustomEvent("thimar:push-permission", { detail: { granted } }));
      return;
    }
    if (event === "pushReceived") {
      window.dispatchEvent(
        new CustomEvent<PushEvent>("thimar:push", {
          detail: {
            type: "pushReceived",
            title: String(payload?.title ?? ""),
            body: String(payload?.body ?? ""),
            url: String(payload?.url ?? "/"),
            tag: String(payload?.tag ?? "thimar"),
          },
        }),
      );
      return;
    }
    if (event === "open") {
      openInApp(String(payload?.url ?? "/"));
    }
  };

  /* تسجيل الخروج يلغي ربط الجهاز حتى لا تصل إشعارات الحساب السابق. */
  window.addEventListener("thimar:signout", () => {
    void unregisterNativePush(currentAccount ?? undefined);
  });
}

let deepLinkInstalled = false;

/** يستقبل الروابط التي يفتحها النشاط عند الضغط على إشعار (حتى والتطبيق مغلق). */
function installDeepLinkHandler() {
  if (deepLinkInstalled) return;
  deepLinkInstalled = true;
  window.__thimarPushOpen = (url: string) => openInApp(url);
}

/** يفتح صفحة إعدادات إشعارات النظام (عند رفض الإذن نهائيًا). */
export function openNotificationSettings(): void {
  bridge()?.openNotificationSettings?.();
}

/** يزامن تفضيل معاينة الرسالة إلى الغلاف الأصلي. */
export function setNativeMessagePreview(enabled: boolean): void {
  try { bridge()?.setMessagePreviewEnabled?.(enabled); } catch { /* ignore */ }
}

/** يُعلِم الغلاف الأصلي بالمحادثة المفتوحة (لتجنب إشعارات غير ضرورية). */
export function setActiveConversation(conversationId: string | null): void {
  try {
    bridge()?.setActiveConversation?.(conversationId ?? "");
  } catch {
    /* ignore */
  }
}
