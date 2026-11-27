// Supabase Edge Function: thimar-session
// Issues a short-lived signed session token after verifying credentials server-side.
// Secrets: SESSION_SIGNING_SECRET (HMAC key), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// كل رمز يحمل معرّف جلسة (jti) مسجّلًا في public.thimar_sessions، فيمكن إبطاله
// فورًا عند تسجيل الخروج أو تغيير كلمة المرور أو حظر الحساب.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TTL_SECONDS = (() => {
  const raw = Number(Deno.env.get("SESSION_TTL_SECONDS") ?? 3 * 60 * 60);
  if (!Number.isFinite(raw)) return 3 * 60 * 60;
  return Math.min(Math.max(Math.floor(raw), 900), 12 * 60 * 60);
})();

/** يُقبل التجديد بعد انتهاء الرمز ما دام التوقيع صحيحًا ولم تُبطَل الجلسة. */
const REFRESH_GRACE_SECONDS = 30 * 24 * 60 * 60;

/**
 * التجديد يدوّر الرمز (rotated). كان إبطال الرمز الأب فورًا يعني أن أي ردّ
 * تجديد يضيع في الشبكة — أو أي تبويب/جهاز يخسر سباق التدوير — يبقى عالقًا
 * برمز مُبطَل لا يمكن تجديده، فتظهر رسالة «انتهت صلاحية الجلسة» بلا سبب.
 * نسمح للأب المُدوَّر بالتجديد داخل هذه المهلة فقط، ثم يصبح مُبطَلًا نهائيًا.
 */
const ROTATED_REFRESH_GRACE_SECONDS = 60 * 60;

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-session-token",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
});

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlStr(str: string): string {
  return b64url(new TextEncoder().encode(str));
}

function b64urlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/**
 * السر المستقل فقط. لا رجوع إلى مفتاح الخدمة عند غيابه: بلا سر مُعدّ
 * ترفض الدالة إصدار أي جلسة (فشل مُغلق) بدل الاعتماد على مفتاح آخر.
 */
function sessionSigningKey(): string {
  return (Deno.env.get("SESSION_SIGNING_SECRET") ?? "").trim();
}

function sha256Hex(input: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)).then((buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
}

type SessionClaims = { sub: string; jti: string; exp: number; iat: number };

/** يتحقق من التوقيع فقط (بلا فحص الانتهاء) ويعيد الحِمل أو null. */
async function readToken(token: string, secret: string): Promise<SessionClaims | null> {
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;
  let parsedHeader: { alg?: string };
  let parsedPayload: { sub?: unknown; exp?: unknown; iat?: unknown; scope?: unknown; jti?: unknown };
  try {
    parsedHeader = JSON.parse(new TextDecoder().decode(b64urlToBytes(header)));
    parsedPayload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
  } catch {
    return null;
  }
  if (parsedHeader.alg !== "HS256" || parsedPayload.scope !== "session") return null;
  const sub = typeof parsedPayload.sub === "string" ? parsedPayload.sub.trim() : "";
  const jti = typeof parsedPayload.jti === "string" ? parsedPayload.jti.trim() : "";
  const exp = Number(parsedPayload.exp);
  const iat = Number(parsedPayload.iat);
  if (!sub || !jti || !Number.isFinite(exp) || !Number.isFinite(iat)) return null;
  const expected = await hmacSign(secret, `${header}.${payload}`);
  let provided: Uint8Array;
  try {
    provided = b64urlToBytes(signature);
  } catch {
    return null;
  }
  if (expected.length !== provided.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ provided[i];
  if (diff !== 0) return null;
  return { sub, jti, exp, iat };
}

async function issueToken(secret: string, sub: string, jti: string, ttl: number) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttl;
  const header = b64urlStr(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64urlStr(JSON.stringify({ sub, jti, iat: now, exp, scope: "session", v: 2 }));
  const signature = b64url(await hmacSign(secret, `${header}.${payload}`));
  return { token: `${header}.${payload}.${signature}`, exp };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (request.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const signingSecret = sessionSigningKey();
    if (!supabaseUrl || !serviceKey || !signingSecret) {
      // لا نُصدر جلسات بلا سر مستقل، ولا نرجع إلى مفتاح الخدمة أبدًا.
      return new Response(JSON.stringify({ error: "SERVER_MISCONFIGURED" }), { status: 503, headers });
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "login").toLowerCase();
    /* البوابة تستهلك Authorization لمفتاح Supabase، لذا يُرسل رمز الجلسة
       في ترويسة مستقلة عند الخروج/التجديد (مع دعم Authorization للاختبارات). */
    const authHeader = request.headers.get("Authorization") ?? "";
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    const bearer = (request.headers.get("X-Session-Token") ?? "").trim() || (bearerMatch ? bearerMatch[1].trim() : "");

    if (action === "logout") {
      const claims = await readToken(bearer, signingSecret);
      if (!claims) return new Response(JSON.stringify({ error: "INVALID_SESSION" }), { status: 401, headers });
      const { error } = await supabase
        .from("thimar_sessions")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: "logout" })
        .eq("id", claims.jti)
        .eq("account_id", claims.sub)
        .is("revoked_at", null);
      if (error) return new Response(JSON.stringify({ error: "LOGOUT_FAILED" }), { status: 500, headers });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    if (action === "refresh") {
      const claims = await readToken(bearer, signingSecret);
      if (!claims) return new Response(JSON.stringify({ error: "INVALID_SESSION" }), { status: 401, headers });
      const { data: row } = await supabase
        .from("thimar_sessions")
        .select("id,account_id,expires_at,revoked_at,revoked_reason")
        .eq("id", claims.jti)
        .maybeSingle();
      if (!row || row.account_id !== claims.sub) {
        return new Response(JSON.stringify({ error: "SESSION_REVOKED" }), { status: 401, headers });
      }
      const revokedAtMs = row.revoked_at ? Date.parse(String(row.revoked_at)) : 0;
      const rotatedRecently =
        Boolean(row.revoked_at) &&
        String(row.revoked_reason ?? "") === "rotated" &&
        Number.isFinite(revokedAtMs) &&
        Date.now() - revokedAtMs < ROTATED_REFRESH_GRACE_SECONDS * 1000;
      if (row.revoked_at && !rotatedRecently) {
        return new Response(JSON.stringify({ error: "SESSION_REVOKED" }), { status: 401, headers });
      }
      const graceEnds = new Date(row.expires_at).getTime() / 1000 + REFRESH_GRACE_SECONDS;
      if (graceEnds < Date.now() / 1000) {
        return new Response(JSON.stringify({ error: "SESSION_EXPIRED" }), { status: 401, headers });
      }
      const { data: account } = await supabase
        .from("thimar_accounts")
        .select("id,status,banned")
        .eq("id", claims.sub)
        .maybeSingle();
      if (!account || account.banned || account.status !== "active") {
        return new Response(JSON.stringify({ error: "ACCOUNT_NOT_ACTIVE" }), { status: 403, headers });
      }
      const jti = crypto.randomUUID();
      const issued = await issueToken(signingSecret, claims.sub, jti, TTL_SECONDS);
      const { error: insErr } = await supabase.from("thimar_sessions").insert({
        id: jti,
        account_id: claims.sub,
        expires_at: new Date(issued.exp * 1000).toISOString(),
        rotated_from: claims.jti,
      });
      if (insErr) return new Response(JSON.stringify({ error: "SESSION_STORE_FAILED" }), { status: 500, headers });
      await supabase
        .from("thimar_sessions")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: "rotated" })
        .eq("id", claims.jti)
        .is("revoked_at", null);
      return new Response(
        JSON.stringify({ token: issued.token, accountId: claims.sub, expiresAt: issued.exp }),
        { status: 200, headers },
      );
    }

    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    if (!username || !password) {
      return new Response(JSON.stringify({ error: "MISSING_CREDENTIALS" }), { status: 400, headers });
    }

    const { data: row, error } = await supabase
      .from("thimar_accounts")
      .select("id,username,password_hash,password_salt,status,banned")
      .eq("username", username)
      .maybeSingle();
    if (error || !row) {
      return new Response(JSON.stringify({ error: "INVALID_CREDENTIALS" }), { status: 401, headers });
    }
    if (row.banned || row.status !== "active") {
      return new Response(JSON.stringify({ error: "ACCOUNT_NOT_ACTIVE" }), { status: 403, headers });
    }

    const salt = String(row.password_salt ?? "");
    const hash = String(row.password_hash ?? "");
    const candidate = await sha256Hex(`${salt}:${password}`);
    if (!salt || !hash || candidate !== hash) {
      return new Response(JSON.stringify({ error: "INVALID_CREDENTIALS" }), { status: 401, headers });
    }

    const jti = crypto.randomUUID();
    const issued = await issueToken(signingSecret, row.id, jti, TTL_SECONDS);
    const { error: insErr } = await supabase.from("thimar_sessions").insert({
      id: jti,
      account_id: row.id,
      expires_at: new Date(issued.exp * 1000).toISOString(),
    });
    if (insErr) {
      return new Response(JSON.stringify({ error: "SESSION_STORE_FAILED" }), { status: 500, headers });
    }

    return new Response(
      JSON.stringify({ token: issued.token, accountId: row.id, expiresAt: issued.exp, ttl: TTL_SECONDS }),
      { status: 200, headers },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "SERVER_ERROR" }), {
      status: 500,
      headers,
    });
  }
});
