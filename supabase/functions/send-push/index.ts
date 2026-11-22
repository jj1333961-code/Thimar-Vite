// Supabase Edge Function: إرسال إشعارات FCM HTTP v1 إلى أجهزة أندرويد.
// بديل خادمي لمسار الـWorker (مفيد للإرسال من مجدول أو Trigger داخل Supabase).
//
// الأسرار المطلوبة (Project settings ← Edge Functions ← Secrets):
//   FCM_SERVICE_ACCOUNT       محتوى ملف حساب الخدمة (JSON) من Firebase
//   THIMAR_PUSH_SECRET        سر مشترك يتحقق منه الطالب (Authorization: Bearer)
//   SUPABASE_URL              يُضبط تلقائيًا
//   SUPABASE_SERVICE_ROLE_KEY يُضبط تلقائيًا
// لا يوضع أي مفتاح داخل التطبيق أو داخل المستودع.
//
// نشر الدالة:
//   npx supabase functions deploy send-push

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

const ALLOWED_ORIGINS = new Set([
  "https://thimar.freebuff.page",
  "https://site-a02c574077ed41d78e9450f109cacfd2.freebuff.page",
]);
const CHANNEL_ID = "thimar_notifications";
const CLICK_ACTION = "app.thimar.quran.OPEN_NOTIFICATION";

const encoder = new TextEncoder();
let cached: { token: string; expiresAt: number } | null = null;

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) return cached.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`token ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  cached = { token: data.access_token as string, expiresAt: now + Number(data.expires_in ?? 3600) };
  return cached.token;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://thimar.freebuff.page",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(status: number, payload: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** يتحقق أن الطالب خادم موثوق (سر مشترك) وليس أي عميل مجهول. */
function authorized(request: Request): boolean {
  const expected = (Deno.env.get("THIMAR_PUSH_SECRET") ?? "").trim();
  if (!expected) return false;
  const header = request.headers.get("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i += 1) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" }, headers);

  if (!(Deno.env.get("THIMAR_PUSH_SECRET") ?? "").trim()) {
    return json(501, { error: "THIMAR_PUSH_SECRET_MISSING" }, headers);
  }
  if (!authorized(request)) return json(401, { error: "UNAUTHORIZED" }, headers);

  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";
  if (!raw) return json(501, { error: "FCM_SERVICE_ACCOUNT_MISSING" }, headers);

  let account: ServiceAccount;
  try {
    account = JSON.parse(raw) as ServiceAccount;
  } catch {
    return json(500, { error: "FCM_SERVICE_ACCOUNT_INVALID" }, headers);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const body = await request.json().catch(() => ({}));
  const title: string = String(body.title ?? "ثمار").slice(0, 120);
  const message: string = String(body.body ?? "").slice(0, 300);
  const url: string = typeof body.url === "string" && body.url.startsWith("/") ? body.url : "/";
  const tag: string = String(body.tag ?? "thimar").slice(0, 80);
  const accountIds: string[] = Array.isArray(body.accountIds)
    ? body.accountIds.filter((id: unknown) => typeof id === "string").slice(0, 500)
    : [];
  const directTokens: string[] = Array.isArray(body.tokens)
    ? body.tokens.filter((token: unknown) => typeof token === "string").slice(0, 500)
    : [];

  let tokens = directTokens;
  if (accountIds.length) {
    const { data, error } = await supabase
      .from("thimar_fcm_tokens")
      .select("token")
      .in("account_id", accountIds);
    if (error) return json(500, { error: error.message }, headers);
    tokens = [...new Set([...tokens, ...(data ?? []).map((row) => row.token as string)])];
  }

  if (!tokens.length) return json(200, { sent: 0, note: "NO_TOKENS" }, headers);

  const bearer = await accessToken(account);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  const results: Array<{ token: string; ok: boolean; status: number }> = [];
  const stale: string[] = [];

  for (const token of tokens) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body: message },
          data: { title, body: message, url, tag },
          android: {
            priority: "HIGH",
            ttl: "86400s",
            collapse_key: tag,
            notification: {
              channel_id: CHANNEL_ID,
              icon: "ic_stat_thimar",
              color: "#0F5F4E",
              sound: "default",
              default_vibrate_timings: true,
              tag,
              click_action: CLICK_ACTION,
              visibility: "PUBLIC",
            },
          },
        },
      }),
    });
    results.push({ token: token.slice(-8), ok: response.ok, status: response.status });
    if (response.status === 404 || response.status === 400) stale.push(token);
  }

  if (stale.length) {
    await supabase.from("thimar_fcm_tokens").delete().in("token", stale);
  }

  return json(
    200,
    { sent: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results },
    headers,
  );
});
