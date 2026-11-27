// Supabase Edge Function: thimar-session
// Issues a short-lived signed session token after verifying credentials server-side.
// The token is used to authenticate protected Edge Function calls (thimar-calls, etc.).
// Secrets: SESSION_SIGNING_SECRET (HMAC key), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
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

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64url(new Uint8Array(sig));
}

async function sessionSigningKey(): Promise<string> {
  const explicit = Deno.env.get("SESSION_SIGNING_SECRET") ?? "";
  if (explicit) return explicit;
  const base = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!base) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`thimar-session-v1:${base}`));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sha256Hex(input: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)).then((buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };
  if (request.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    // نفس اشتقاق thimar-calls: سرّ مخصص إن وُجد، وإلا مفتاح مشتق من مفتاح الخدمة.
    const signingSecret = await sessionSigningKey();
    if (!supabaseUrl || !serviceKey || !signingSecret) {
      return new Response(JSON.stringify({ error: "SERVER_MISCONFIGURED" }), { status: 500, headers });
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await request.json().catch(() => ({}));
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

    // Verify SHA-256(salt:password)
    const salt = String(row.password_salt ?? "");
    const hash = String(row.password_hash ?? "");
    const candidate = await sha256Hex(`${salt}:${password}`);
    if (!salt || !hash || candidate !== hash) {
      // Legacy plaintext fallback (only if stored)
      // We do not store plaintext; if no hash, reject.
      return new Response(JSON.stringify({ error: "INVALID_CREDENTIALS" }), { status: 401, headers });
    }

    // Issue JWT (HS256), 24h expiry
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 24 * 60 * 60;
    const header = b64urlStr(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64urlStr(JSON.stringify({ sub: row.id, iat: now, exp, scope: "session" }));
    const signingInput = `${header}.${payload}`;
    const signature = await hmacSign(signingSecret, signingInput);
    const token = `${signingInput}.${signature}`;

    return new Response(JSON.stringify({ token, accountId: row.id, expiresAt: exp }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "SERVER_ERROR" }), { status: 500, headers });
  }
});
