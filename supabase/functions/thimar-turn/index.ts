import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://thimar.freebuff.page",
  "https://site-a02c574077ed41d78e9450f109cacfd2.freebuff.page",
  "capacitor://localhost",
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:5173",
]);

const encoder = new TextEncoder();
const requestBuckets = new Map<string, number[]>();

function response(status: number, body: unknown, origin?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

function rateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const recent = (requestBuckets.get(key) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= limit) return false;
  recent.push(now);
  requestBuckets.set(key, recent);
  return true;
}

function ipAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function csv(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

async function expressTurnServers() {
  const secret = env("EXPRESSTURN_SECRET");
  if (!secret) return { servers: [] as RTCIceServer[], status: "not_configured" };
  const ttl = Math.min(86_400, Math.max(300, Number(env("EXPRESSTURN_TTL_SECONDS")) || 3600));
  const username = `${Math.floor(Date.now() / 1000) + ttl}:thimar`;
  const credential = await hmacSha1Base64(secret, username);
  const urls = csv(env("EXPRESSTURN_URLS") || [
    "turn:relay1.expressturn.com:3478?transport=udp",
    "turn:relay1.expressturn.com:3478?transport=tcp",
    "turns:relay1.expressturn.com:443?transport=tcp",
  ].join(","));
  if (!urls.length) return { servers: [] as RTCIceServer[], status: "not_configured" };
  return {
    servers: [{ urls, username, credential }],
    status: "configured",
  };
}

async function meteredTurnServers() {
  const appName = env("METERED_OPENRELAY_APP_NAME") || "thimarvoice";
  const apiKey = env("METERED_OPENRELAY_API_KEY");
  if (!apiKey) return { servers: [] as RTCIceServer[], status: "not_configured" };
  try {
    const url = new URL(`https://${appName}.metered.live/api/v1/turn/credentials`);
    url.searchParams.set("apiKey", apiKey);
    const result = await fetch(url, { headers: { Accept: "application/json" } });
    if (!result.ok) return { servers: [] as RTCIceServer[], status: "provider_error" };
    const payload = await result.json();
    const servers = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.iceServers)
        ? payload.iceServers
        : [];
    if (!servers.length) return { servers: [] as RTCIceServer[], status: "provider_error" };
    return { servers: servers as RTCIceServer[], status: "configured" };
  } catch {
    return { servers: [] as RTCIceServer[], status: "provider_error" };
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin") ?? undefined;
  if (request.method === "OPTIONS") return response(204, {}, origin);
  if (request.method !== "GET") return response(405, { error: "METHOD_NOT_ALLOWED" }, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return response(403, { error: "ORIGIN_NOT_ALLOWED" });

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\\s+([a-f0-9]{64})$/i)?.[1];
  if (!token) return response(401, { error: "AUTH_REQUIRED" }, origin);

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return response(503, { error: "SERVER_NOT_CONFIGURED" }, origin);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tokenHash = await sha256(token);
  const { data: session, error: sessionError } = await supabase
    .from("thimar_call_sessions")
    .select("account_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (sessionError || !session?.account_id) return response(401, { error: "INVALID_SESSION" }, origin);

  const { data: account, error: accountError } = await supabase
    .from("thimar_accounts")
    .select("id,status,banned")
    .eq("id", session.account_id)
    .maybeSingle();
  if (accountError || !account || account.status !== "active" || account.banned) {
    return response(403, { error: "ACCOUNT_UNAVAILABLE" }, origin);
  }

  const ip = ipAddress(request);
  if (!rateLimit(`ip:${ip}`, 30) || !rateLimit(`account:${account.id}`, 60)) {
    return response(429, { error: "RATE_LIMITED" }, origin);
  }

  const stun: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:stun.cloudflare.com:3478" },
  ];
  const [express, metered] = await Promise.all([
    expressTurnServers().catch(() => ({ servers: [] as RTCIceServer[], status: "provider_error" })),
    meteredTurnServers(),
  ]);
  const iceServers = [...stun, ...express.servers, ...metered.servers];
  const deduplicated = iceServers.filter((server, index, all) =>
    all.findIndex((item) =>
      JSON.stringify(item.urls) === JSON.stringify(server.urls)
      && item.username === server.username
    ) === index
  );

  return response(200, {
    iceServers: deduplicated,
    iceTransportPolicy: "all",
    ttl: 3600,
    providers: {
      stun: "available",
      expressturn: express.status,
      meteredOpenRelay: metered.status,
    },
    generatedAt: new Date().toISOString(),
  }, origin);
});
