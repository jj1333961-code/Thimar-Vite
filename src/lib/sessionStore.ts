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
  cache = token;
  loaded = true;
  const secure = bridge();
  if (secure?.set) {
    try {
      secure.set(token);
      try {
        localStorage.removeItem(SESSION_TOKEN_KEY);
      } catch { /* ignore */ }
      return;
    } catch { /* يسقط إلى التخزين العادي عند فشل التشفير */ }
  }
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch { /* ignore */ }
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
}

type SessionResponse = { token?: string; error?: string };

/** يجدّد الرمز قبل انتهائه؛ الدالة تقبل رمزًا منتهيًا ما دام لم يُبطَل. */
export async function refreshSessionToken(): Promise<string | null> {
  const current = cachedSessionToken();
  if (!current) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/thimar-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "X-Session-Token": current,
      },
      body: JSON.stringify({ action: "refresh" }),
    });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => ({}))) as SessionResponse;
    if (!data.token) return null;
    saveSessionToken(data.token);
    return data.token;
  } catch {
    return null;
  }
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
