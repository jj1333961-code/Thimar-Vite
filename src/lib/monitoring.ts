/**
 * مراقبة أخطاء الإنتاج.
 *
 * كل خطأ غير معالج (أو رفض وعد، أو خطأ رسم React) يُرسل مرة واحدة مع سياق
 * موجز إلى `/api/errors` (سجل Worker) وإلى `thimar_report_error` في القاعدة
 * إن وُجدت جلسة. لا تُرسل كلمات مرور ولا رموز جلسات ولا محتوى رسائل.
 */
import { SUPABASE_URL } from "./cloud";
import { currentToken } from "./api";

const SENT_KEY = "thimar.errors.sent.v1";
const MAX_PER_SESSION = 20;

type Context = { accountId?: string; role?: string };

let context: Context = {};
let sent = 0;
const seen = new Set<string>();

function readSeen(): Set<string> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SENT_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function remember(fingerprint: string): void {
  seen.add(fingerprint);
  try {
    sessionStorage.setItem(SENT_KEY, JSON.stringify([...seen].slice(-MAX_PER_SESSION)));
  } catch {
    /* ignore */
  }
}

const SENSITIVE = /(password|passwd|token|secret|authorization|apikey|api_key)=?\S*/gi;

/** يحذف أي قيمة قد تكون سرًّا من نص الخطأ. */
function scrub(value: string, limit: number): string {
  return value
    .replace(SENSITIVE, "$1=[redacted]")
    .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, "[jwt]")
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[blob]")
    .slice(0, limit);
}

function platform(): string {
  const native = (globalThis as any)?.ThimarNative;
  if (native?.platform) return String(native.platform());
  return "web";
}

export function setErrorContext(next: Context): void {
  context = { ...context, ...next };
}

async function deliver(payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify(payload);
  /* سجل Worker: يعمل حتى لو تعطّلت قاعدة البيانات. */
  try {
    await fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    /* بلا شبكة: لا شيء نفعله */
  }
  const token = currentToken();
  if (!token) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/thimar_report_error`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey:
          import.meta.env.VITE_SUPABASE_ANON_KEY ||
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impic3ZtcGl3ZHdvd2l6emZ6bHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NDU2NzksImV4cCI6MjEwMjAyMTY3OX0.CPq3jBruh47_ZS8i_W7FKs_dRWynrQi2znSTzHMJEQk",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ p_token: token, p_data: payload }),
      keepalive: true,
    });
  } catch {
    /* ignore */
  }
}

export function reportError(error: unknown, source = "window"): void {
  if (sent >= MAX_PER_SESSION) return;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  const fingerprint = `${source}:${message.slice(0, 120)}`;
  if (seen.has(fingerprint)) return;
  remember(fingerprint);
  seen.add(fingerprint);
  sent += 1;

  const payload = {
    kind: "error",
    message: scrub(message, 500),
    stack: scrub(stack, 2000),
    source: scrub(source, 120),
    accountId: context.accountId ?? "",
    role: context.role ?? "",
    version: (import.meta as any)?.env?.VITE_APP_VERSION ?? "",
    platform: platform(),
    url: typeof location !== "undefined" ? `${location.pathname}` : "",
  };

  void deliver(payload);
}

/** يثبّت المستمعات مرة واحدة عند الإقلاع. */
export function installErrorMonitoring(): void {
  seen.clear();
  readSeen().forEach((item) => seen.add(item));
  window.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, `onerror:${event.filename ?? ""}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, "unhandledrejection");
  });
}
