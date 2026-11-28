// Supabase Edge Function: thimar-turn
//
// يمنح بيانات اعتماد TURN قصيرة العمر لمستخدم مُتحقّق فقط.
//
// المشكلة التي حُلّت هنا: النسخة السابقة كانت تقبل أي `apikey` (بما فيه المفتاح
// العام anon الموجود في حزمة المتصفح) وتُعيد بيانات اعتماد TURN دائمة من نوع
// static. أي شخص يستطيع قراءة المفتاح العام كان يستطيع سحب بيانات المُرحّل
// الدائمة واستهلاك حصتها. الآن:
//   - الهوية تُستخرج من رمز جلسة موقّع (HMAC-SHA256) صادر عن thimar-session.
//   - بيانات الاعتماد تُولَّد بمفتاح مشترك (TURN REST API) وتنتهي خلال TTL قصير
//     ومرتبطة بهوية المستخدم؛ المفتاح المشترك لا يغادر الخادم أبدًا.
//   - بلا مفتاح مشترك تُرفض الطلب صراحة (503) بدل الرجوع لبيانات دائمة.
//
// الأسرار تبقى في أسرار الدالة على Supabase ولا تُرفع إلى المستودع.

import { bearerToken, verifySessionToken } from "../_shared/session.ts";
import { clampTtl, mintTurnCredentials } from "../_shared/turn.ts";

const ALLOWED_ORIGINS = new Set([
  "https://thimar.freebuff.page",
  "http://localhost:3000",
  "http://localhost:5173",
]);

const DEFAULT_TURN_URLS = [
  "turn:relay1.expressturn.com:3478?transport=udp",
  "turn:relay1.expressturn.com:3478?transport=tcp",
  "turns:relay1.expressturn.com:443?transport=tcp",
];

const DEFAULT_STUN_URLS = ["stun:stun.expressturn.com:3478"];

type EnvReader = (name: string) => string;

function list(value: string, fallback: string[]): string[] {
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  // نعكس الأصل المسموح فقط؛ الأصل الأجنبي لا يحصل على ترويسة سماح.
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(status: number, body: Record<string, unknown>, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

/* حدّ بسيط لكل مستخدم داخل سياق التشغيل نفسه. */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, now = Date.now()): { ok: boolean; retryAfter: number } {
  const windowMs = 60_000;
  const hits = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);
  if (hits.length >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, retryAfter: 0 };
}

/** يُستدعى من Deno.serve ومن الاختبارات بلا أي اعتماد على الشبكة. */
export async function handleTurnRequest(request: Request, env: EnvReader): Promise<Response> {
  const headers = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED" }, headers);
  }

  const sessionSecret = (env("SESSION_SIGNING_SECRET") ?? "").trim();
  if (!sessionSecret) return json(503, { error: "SESSION_NOT_CONFIGURED" }, headers);

  const token = bearerToken(request);
  if (!token) return json(401, { error: "AUTH_REQUIRED" }, headers);

  const claims = await verifySessionToken(token, sessionSecret);
  if (!claims) return json(401, { error: "INVALID_SESSION" }, headers);

  const limited = rateLimit(`turn:${claims.sub}`, 60);
  if (!limited.ok) {
    return new Response(JSON.stringify({ error: "RATE_LIMITED", retryAfter: limited.retryAfter }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(limited.retryAfter) },
    });
  }

  // بلا مفتاح مشترك لا يوجد مسار آمن: لا نُعيد بيانات اعتماد دائمة أبدًا.
  const turnSecret = (env("EXPRESSTURN_SECRET") ?? "").trim();
  if (!turnSecret) return json(503, { error: "TURN_NOT_CONFIGURED" }, headers);

  const ttl = clampTtl(env("EXPRESSTURN_TTL_SECONDS"));
  const { username, credential, expiresAt } = await mintTurnCredentials({
    secret: turnSecret,
    userId: claims.sub,
    ttlSeconds: ttl,
  });

  const turnUrls = list(env("EXPRESSTURN_URLS") ?? "", DEFAULT_TURN_URLS);
  const stunUrls = list(env("EXPRESSTURN_STUN_URLS") ?? "", DEFAULT_STUN_URLS);

  return json(
    200,
    {
      iceServers: [
        ...stunUrls.map((urls) => ({ urls })),
        { urls: turnUrls, username, credential },
      ],
      iceTransportPolicy: "all",
      ttl,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      providers: ["stun", "expressturn"],
      generatedAt: new Date().toISOString(),
    },
    headers,
  );
}

/* التشغيل على Supabase فقط؛ يُتجاوز عند استيراد الملف في اختبارات Node. */
const deno = (globalThis as { Deno?: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): unknown } }).Deno;
if (deno) deno.serve((request) => handleTurnRequest(request, (name) => deno.env.get(name) ?? ""));
