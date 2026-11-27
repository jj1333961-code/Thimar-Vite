/**
 * تخزين رمز الجلسة.
 *
 * داخل تطبيق أندرويد يُحفظ الرمز مشفّرًا بمفتاح Android Keystore عبر الجسر
 * `ThimarSecureStore` (AES-GCM، المفتاح لا يغادر مخزن المفاتيح). في المتصفح
 * يبقى `localStorage` لأنه الخيار الوحيد المتاح. أي رمز قديم في localStorage
 * يُنقل إلى المخزن المشفّر ثم يُحذف من التخزين العادي.
 */
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./cloud";

export const SESSION_TOKEN_KEY = "thimar_session_token";

type SecureBridge = {
  get?: () => string;
  set?: (value: string) => void;
  clear?: () => void;
};

let cache: string | null = null;
let loaded = false;

function bridge(): SecureBridge | null {
  try {
    return (window as any).ThimarSecureStore ?? null;
  } catch {
    return null;
  }
}

function readLocal(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** يُحمّل الرمز مرة واحدة، وينقل أي رمز قديم إلى المخزن المشفّر إن وُجد. */
export function loadSessionToken(): string | null {
  if (loaded) return cache;
  const secure = bridge();
  const legacy = readLocal();
  if (secure?.get) {
    let stored = "";
    try {
      stored = String(secure.get() || "");
    } catch {
      stored = "";
    }
    if (!stored && legacy) {
      try {
        secure.set?.(legacy);
        stored = legacy;
      } catch {
        stored = legacy;
      }
      try {
        localStorage.removeItem(SESSION_TOKEN_KEY);
      } catch { /* ignore */ }
    }
    cache = stored || null;
  } else {
    cache = legacy;
  }
  loaded = true;
  return cache;
}

/** قراءة متزامنة بلا انتظار (تستخدمها قنوات الإشارات). */
export function cachedSessionToken(): string | null {
  if (!loaded) return loadSessionToken();
  return cache;
}

export function saveSessionToken(token: string): void {
  const changed = cache !== token;
  cache = token;
  loaded = true;
  const secure = bridge();
  if (secure?.set) {
    try {
      secure.set(token);
      try {
        localStorage.removeItem(SESSION_TOKEN_KEY);
      } catch { /* ignore */ }
      if (changed) emit(token);
      return;
    } catch { /* يسقط إلى التخزين العادي عند فشل التشفير */ }
  }
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch { /* ignore */ }
  if (changed) emit(token);
}

export function clearSessionToken(): void {
  cache = null;
  loaded = true;
  const secure = bridge();
  try {
    secure?.clear?.();
  } catch { /* ignore */ }
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch { /* ignore */ }
  if (cache === null) emit(null);
}

type SessionResponse = { token?: string; error?: string; expiresAt?: number };

/* ==================== دورة حياة الجلسة ====================
 *
 * الرمز الموقّع قصير العمر (٣ ساعات افتراضيًا). لكي لا تظهر رسالة "انتهت
 * صلاحية الجلسة" أبدًا:
 *  - يُجدّد الرمز **قبل** انتهائه (مؤقّت دوري + عند العودة للتطبيق + قبل المكالمات).
 *  - التجديد لا يحدث أكثر من مرة واحدة في الوقت نفسه داخل التطبيق (single-flight).
 *  - التبويبات تتشارك الرمز عبر التخزين المحلي: تبويب واحد يجدّد والباقي يتبنّى
 *    الرمز الجديد، فلا يُبطل أحد رمز الآخر بالتدوير.
 *  - عند فشل التجديد مؤقتًا (شبكة) يُستمر بالرمز الصالح بدل قطع المكالمة.
 */

const listeners = new Set<(token: string | null) => void>();
let refreshPromise: Promise<string | null> | null = null;
let refreshLockHeld = false;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let keepAliveRefs = 0;
let bindingsReady = false;

const REFRESH_LOCK_KEY = "thimar_session_refresh_lock";
const REFRESH_LOCK_TTL_MS = 12_000;
const TAB_ID = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

function emit(token: string | null): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(token);
    } catch { /* مستمع معطوب لا يوقف الباقين */ }
  }
}

/** يُشترك في تغيّر رمز الجلسة (تسجيل دخول/تجديد/خروج). يعيد دالة إلغاء. */
export function onSessionTokenChange(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** وقت انتهاء الرمز بالمللي ثانية من حِمله (بلا تحقّق من التوقيع). */
export function sessionExpiresAt(token: string | null = cachedSessionToken()): number | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    const exp = Number(payload.exp);
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function rawStoredToken(): string | null {
  const secure = bridge();
  if (secure?.get) {
    try {
      return String(secure.get() || "") || null;
    } catch {
      return null;
    }
  }
  return readLocal();
}

/** يتبنّى رمزًا أحدث كتبه تبويب/سياق آخر. */
function adoptSharedToken(current: string | null): string | null {
  const stored = rawStoredToken();
  if (!stored || stored === current) return null;
  const exp = sessionExpiresAt(stored);
  if (exp && exp - Date.now() < 30_000) return null;
  saveSessionToken(stored);
  emit(stored);
  return stored;
}

function waitForSharedToken(current: string | null, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const shared = adoptSharedToken(current);
      if (shared || Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(shared);
      }
    }, 150);
  });
}

function readLock(): { id?: string; until?: number } | null {
  try {
    const value = localStorage.getItem(REFRESH_LOCK_KEY);
    return value ? (JSON.parse(value) as { id?: string; until?: number }) : null;
  } catch {
    return null;
  }
}

function acquireRefreshLock(): boolean {
  try {
    const now = Date.now();
    const lock = readLock();
    if (lock && lock.id !== TAB_ID && Number(lock.until) > now) return false;
    localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify({ id: TAB_ID, until: now + REFRESH_LOCK_TTL_MS }));
    refreshLockHeld = true;
    return true;
  } catch {
    /* لا يوجد تخزين محلي: التجديد داخل هذا السياق وحده مضمون بالـsingle-flight. */
    refreshLockHeld = true;
    return true;
  }
}

function releaseRefreshLock(): void {
  if (!refreshLockHeld) return;
  refreshLockHeld = false;
  try {
    const lock = readLock();
    if (!lock || lock.id === TAB_ID) localStorage.removeItem(REFRESH_LOCK_KEY);
  } catch { /* ignore */ }
}

async function requestRefresh(token: string): Promise<string | null> {
  /* التجديد يدوّر الرمز على الخادم. إن انقطع الاتصال بعد أن نفّذ الخادم
     التدوير وضاع الردّ، يبقى الرمز القديم قابلًا للتجديد ضمن مهلة الخادم؛
     لذلك نعيد المحاولة مرة واحدة قبل اعتبار التجديد فاشلًا. */
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/thimar-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "X-Session-Token": token,
        },
        body: JSON.stringify({ action: "refresh" }),
      });
      const data = (await response.json().catch(() => ({}))) as SessionResponse;
      if (response.ok && data.token) {
        saveSessionToken(data.token);
        emit(data.token);
        return data.token;
      }
      /* رفض نهائي (جلسة مُبطلة/منتهية): لا فائدة من إعادة المحاولة. */
      if (response.status >= 400 && response.status < 500) return null;
    } catch { /* خطأ شبكة: نعيد المحاولة */ }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

/** يجدّد الرمز قبل انتهائه؛ الدالة تقبل رمزًا منتهيًا ما دام لم يُبطَل. */
export function refreshSessionToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  const start = cachedSessionToken();
  if (!start) return Promise.resolve(null);
  refreshPromise = (async (): Promise<string | null> => {
    const shared = adoptSharedToken(start);
    if (shared) return shared;
    if (!acquireRefreshLock()) {
      const waited = await waitForSharedToken(start, 2_000);
      if (waited) return waited;
      if (!acquireRefreshLock()) {
        const renewedAnyway = await requestRefresh(cachedSessionToken() ?? start);
        if (renewedAnyway) return renewedAnyway;
        return null;
      }
    }
    const renewed = await requestRefresh(cachedSessionToken() ?? start);
    if (renewed) return renewed;
    /* قد يكون تبويب آخر جدّد بينما كان طلبنا يفشل. */
    return adoptSharedToken(start);
  })().finally(() => {
    refreshPromise = null;
    releaseRefreshLock();
  });
  return refreshPromise;
}

/**
 * يعيد رمزًا صالحًا للاستخدام الآن: يجدّد تلقائيًا إن كان قريب الانتهاء،
 * ويتبنّى تجديدًا جرى في تبويب آخر. إذا تعذّر التجديد لسبب شبكي يُعيد
 * الرمز القائم ما دام صالحًا (لا قطع للمكالمة).
 */
export async function ensureSessionToken(
  options: { minValidityMs?: number; force?: boolean } = {},
): Promise<string | null> {
  const minValidityMs = Math.max(0, options.minValidityMs ?? 10 * 60_000);
  let token = cachedSessionToken();
  if (!token) return null;
  const adopted = adoptSharedToken(token);
  if (adopted) token = adopted;
  const exp = sessionExpiresAt(token);
  if (!options.force && exp !== null && exp - Date.now() > minValidityMs) return token;
  const renewed = await refreshSessionToken();
  if (renewed) return renewed;
  const stillValid = sessionExpiresAt(token);
  if (stillValid !== null && stillValid - Date.now() > 60_000) return token;
  return null;
}

/** يفعّل حفظ الجلسة حيّة أثناء فتح التطبيق: تجديد دوري + عند العودة للواجهة. */
export function startSessionKeepAlive(): () => void {
  keepAliveRefs += 1;
  const tick = () => {
    if (!cachedSessionToken()) return;
    void ensureSessionToken({ minValidityMs: 45 * 60_000 });
  };
  tick();
  if (!keepAliveTimer) keepAliveTimer = setInterval(tick, 10 * 60_000);
  if (!bindingsReady && typeof window !== "undefined") {
    bindingsReady = true;
    const onVisible = () => {
      if (document.visibilityState === "visible") void ensureSessionToken({ minValidityMs: 45 * 60_000 });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", tick);
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== SESSION_TOKEN_KEY) return;
      loaded = false;
      const next = loadSessionToken();
      emit(next);
    });
  }
  return () => {
    keepAliveRefs = Math.max(0, keepAliveRefs - 1);
    if (keepAliveRefs > 0) return;
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  };
}

/** إبطال الجلسة على الخادم ثم حذف الرمز محليًا. */
export async function revokeSession(): Promise<void> {
  const current = cachedSessionToken();
  clearSessionToken();
  if (!current) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/thimar-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "X-Session-Token": current,
      },
      body: JSON.stringify({ action: "logout" }),
    });
  } catch { /* الشبكة غير متاحة: الرمز حُذف محليًا على كل حال */ }
}
