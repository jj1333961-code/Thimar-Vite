// Supabase Edge Function: إصدار بيانات اعتماد TURN قصيرة الأجل (coturn REST API style).
// الأسرار (Project settings ← Edge Functions ← Secrets):
//   TURN_SECRET       سر مشترك مع خادم TURN (coturn static-auth-secret)
//   TURN_URLS         قائمة URL مفصولة بفواصل، مثلاً:
//                     turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349
//   THIMAR_PUSH_SECRET? لا — هذه الدالة للعملاء (verify_jwt=false) وتتحقق من حساب ثمار.
// نشر: npx supabase functions deploy thimar-turn

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://thimar.freebuff.page",
  "https://site-a02c574077ed41d78e9450f109cacfd2.freebuff.page",
]);

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://thimar.freebuff.page",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    Vary: "Origin",
  };
}

function json(status: number, payload: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers });

  const turnSecret = (Deno.env.get("TURN_SECRET") ?? "").trim();
  const turnUrlsRaw = (Deno.env.get("TURN_URLS") ?? "").trim();
  if (!turnSecret || !turnUrlsRaw) {
    return json(501, {
      error: "TURN_NOT_CONFIGURED",
      message: "TURN_SECRET and TURN_URLS must be set in Edge Function secrets. Provision a production TURN server (coturn/Twilio/Metered) first.",
    }, headers);
  }

  const urls = turnUrlsRaw.split(",").map((u) => u.trim()).filter(Boolean);
  const username = `${Math.floor(Date.now() / 1000) + 3600}:thimar`;
  // coturn REST: password = base64(HMAC-SHA1(secret, username))
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(turnSecret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username));
  const password = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return json(200, {
    iceServers: [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
      { urls, username, credential: password },
    ],
    ttl: 3600,
  }, headers);
});