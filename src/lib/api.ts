/**
 * نقل واحد إلى واجهة الخادم `public.thimar_api`.
 *
 * لا تُستخدم جداول PostgREST مباشرة بعد الآن: كل قراءة/كتابة تمرّ بهذه الدالة،
 * والخادم يشتقّ هوية المستخدم من رمز الجلسة ويتحقق من الملكية بنفسه.
 */

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://jbsvmpiwdwowizzfzlqr.supabase.co";

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impic3ZtcGl3ZHdvd2l6emZ6bHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NDU2NzksImV4cCI6MjEwMjAyMTY3OX0.CPq3jBruh47_ZS8i_W7FKs_dRWynrQi2znSTzHMJEQk";

const SESSION_KEY = "thimar.api.session.v1";

export type ApiSession = { token: string; accountId: string; expiresAt?: string };

export class ApiError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.name = "ApiError";
    this.code = code;
  }
}

export function getApiSession(): ApiSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ApiSession;
    if (!parsed?.token || !parsed?.accountId) return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setApiSession(session: ApiSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* التخزين غير متاح — تبقى الجلسة في الذاكرة فقط */
  }
}

export function clearApiSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** يحوّل رسالة PostgREST إلى رمز خطأ قصير. */
function codeFromBody(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const raw = String(record.message ?? record.error ?? record.hint ?? "");
    const match = raw.match(/\b([A-Z][A-Z0-9_]{3,})\b/);
    if (match) return match[1];
    if (record.code) {
      const sqlstate = String(record.code);
      if (sqlstate === "28000") return "UNAUTHENTICATED";
      if (sqlstate === "42501") return "FORBIDDEN";
      if (sqlstate === "23505") return "USERNAME_TAKEN";
      if (sqlstate === "28P01") return "INVALID_CREDENTIALS";
      if (sqlstate === "42901") return "TOO_MANY_ATTEMPTS";
    }
  }
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  return `HTTP_${status}`;
}

/**
 * ينفّذ عملية على الخادم. يرمي ApiError عند الفشل.
 * أي ردّ 401/28000 يُسقط الجلسة المحلية فورًا.
 */
export async function apiCall<T = unknown>(
  op: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const session = getApiSession();
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/thimar_api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        p_token: session?.token ?? null,
        p_op: op,
        p_data: data,
      }),
      signal:
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(20000)
          : undefined,
    });
  } catch (error) {
    throw new ApiError("NETWORK", error instanceof Error ? error.message : "network");
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const code = codeFromBody(body, response.status);
    if (code === "UNAUTHENTICATED") clearApiSession();
    throw new ApiError(code, typeof body === "string" ? body : undefined);
  }

  return body as T;
}

/** رمز الجلسة الحالي (يُستخدم لإرفاق الهوية في المكالمات الأخرى). */
export function currentToken(): string | null {
  return getApiSession()?.token ?? null;
}
