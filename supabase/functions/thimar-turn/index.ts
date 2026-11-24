// Supabase Edge Function: thimar-turn
// Issues short-lived (or static, if configured) TURN credentials to authenticated
// clients. Secrets stay in Supabase function secrets; they are never committed.
const ALLOWED_ORIGINS = new Set([
  "https://thimar.freebuff.page",
  "http://localhost:3000",
  "http://localhost:5173",
]);

type Json = Record<string, unknown>;

function cors(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://thimar.freebuff.page",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin",
  };
}

function json(status: number, body: Json, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

function num(name: string, fallback: number): number {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function dedupe(servers: RTCIceServer[]): RTCIceServer[] {
  const seen = new Set<string>();
  const result: RTCIceServer[] = [];
  for (const server of servers) {
    const key = JSON.stringify({ urls: server.urls, username: server.username ?? null });
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(server);
  }
  return result;
}

/** ExpressTURN shared-secret credentials: HMAC-SHA1 over "<expiry>:<name>". */
async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

type ProviderReport = {
  name: string;
  role: string;
  status: "configured" | "not_configured" | "error";
  mode: string;
  message?: string;
  bandwidth?: { provider: string; freeTierGb: number };
};

async function expressTurn(excluded: boolean): Promise<{ iceServers: RTCIceServer[]; report: ProviderReport }> {
  const freeTierGb = num("EXPRESSTURN_MONTHLY_LIMIT_GB", 1024);
  const secret = env("EXPRESSTURN_SECRET");
  const username = env("EXPRESSTURN_USERNAME");
  const credential = env("EXPRESSTURN_CREDENTIAL");
  const turnUrls = list(env("EXPRESSTURN_URLS"), [
    "turn:relay1.expressturn.com:3478?transport=udp",
    "turn:relay1.expressturn.com:3478?transport=tcp",
    "turns:relay1.expressturn.com:443?transport=tcp",
  ]);
  const stunUrls = list(env("EXPRESSTURN_STUN_URLS"), ["stun:stun.expressturn.com:3478"]);
  const bandwidth = { provider: "expressturn", freeTierGb };

  if (excluded) {
    return {
      iceServers: [],
      report: { name: "expressturn", role: "primary-relay", status: "not_configured", mode: "excluded", bandwidth },
    };
  }
  if (secret) {
    try {
      const ttl = Math.min(86400, Math.max(300, num("EXPRESSTURN_TTL_SECONDS", 3600)));
      const expiry = Math.floor(Date.now() / 1000) + ttl;
      const user = `${expiry}:thimar`;
      const pass = await hmacSha1Base64(secret, user);
      return {
        iceServers: [
          ...stunUrls.map((urls) => ({ urls })),
          { urls: turnUrls, username: user, credential: pass },
        ],
        report: { name: "expressturn", role: "primary-relay", status: "configured", mode: "shared-secret", bandwidth },
      };
    } catch (error) {
      return {
        iceServers: [],
        report: {
          name: "expressturn",
          role: "primary-relay",
          status: "error",
          mode: "shared-secret",
          message: String((error as Error)?.message ?? error),
          bandwidth,
        },
      };
    }
  }
  if (username && credential) {
    return {
      iceServers: [
        ...stunUrls.map((urls) => ({ urls })),
        { urls: turnUrls, username, credential },
      ],
      report: { name: "expressturn", role: "primary-relay", status: "configured", mode: "static", bandwidth },
    };
  }
  return {
    iceServers: [],
    report: { name: "expressturn", role: "primary-relay", status: "not_configured", mode: "none", bandwidth },
  };
}

async function metered(excluded: boolean): Promise<{ iceServers: RTCIceServer[]; report: ProviderReport }> {
  const appName = env("METERED_OPENRELAY_APP_NAME") || "thimarvoice";
  const apiKey = env("METERED_OPENRELAY_API_KEY");
  const username = env("METERED_OPENRELAY_USERNAME");
  const credential = env("METERED_OPENRELAY_CREDENTIAL");
  const urls = list(env("METERED_OPENRELAY_URLS"), []);
  const bandwidth = { provider: "metered-openrelay", freeTierGb: 20 };

  if (excluded) {
    return {
      iceServers: [],
      report: { name: "metered-openrelay", role: "secondary-relay", status: "not_configured", mode: "excluded", bandwidth },
    };
  }
  if (appName && apiKey) {
    try {
      const response = await fetch(
        `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error(`METERED_${response.status}`);
      const payload = await response.json();
      const servers: RTCIceServer[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.iceServers)
          ? payload.iceServers
          : [];
      if (!servers.length) throw new Error("EMPTY");
      return {
        iceServers: servers,
        report: { name: "metered-openrelay", role: "secondary-relay", status: "configured", mode: "rest-api", bandwidth },
      };
    } catch (error) {
      return {
        iceServers: [],
        report: {
          name: "metered-openrelay",
          role: "secondary-relay",
          status: "error",
          mode: "rest-api",
          message: String((error as Error)?.message ?? error),
          bandwidth,
        },
      };
    }
  }
  if (username && credential) {
    if (!urls.length) {
      return {
        iceServers: [],
        report: {
          name: "metered-openrelay",
          role: "secondary-relay",
          status: "not_configured",
          mode: "static",
          message: "URLS_REQUIRED",
          bandwidth,
        },
      };
    }
    const servers = urls.map((url) => (url.startsWith("stun:") ? { urls: url } : { urls: url, username, credential }));
    return {
      iceServers: servers,
      report: { name: "metered-openrelay", role: "secondary-relay", status: "configured", mode: "static", bandwidth },
    };
  }
  return {
    iceServers: [],
    report: { name: "metered-openrelay", role: "secondary-relay", status: "not_configured", mode: "none", bandwidth },
  };
}

const buckets = new Map<string, number[]>();

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function rateLimit(key: string, limit: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const hits = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);
  if (hits.length >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, retryAfter: 0 };
}

Deno.serve(async (request) => {
  const headers = cors(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers });

  const apiKey =
    request.headers.get("apikey") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!apiKey) return json(401, { error: "UNAUTHORIZED" }, headers);

  const byIp = rateLimit(`ip:${clientIp(request)}`, 30);
  if (!byIp.ok) {
    return json(429, { error: "RATE_LIMITED", retryAfter: byIp.retryAfter }, {
      ...headers,
      "Retry-After": String(byIp.retryAfter),
    });
  }

  let userKey = "anon";
  try {
    const payload = apiKey.split(".")[1];
    if (payload) {
      const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      if (typeof claims?.sub === "string" && claims.sub) userKey = claims.sub;
    }
  } catch { /* anon key */ }

  const byUser = rateLimit(`user:${userKey}`, 60);
  if (!byUser.ok) {
    return json(429, { error: "RATE_LIMITED", retryAfter: byUser.retryAfter }, {
      ...headers,
      "Retry-After": String(byUser.retryAfter),
    });
  }

  const url = new URL(request.url);
  const excluded = new Set(
    (url.searchParams.get("exclude") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  const stun: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:stun.cloudflare.com:3478" },
  ];
  const [express, meteredRelay] = await Promise.all([
    expressTurn(excluded.has("expressturn")),
    metered(excluded.has("metered-openrelay")),
  ]);

  return json(
    200,
    {
      iceServers: dedupe([...stun, ...express.iceServers, ...meteredRelay.iceServers]),
      iceTransportPolicy: "all",
      ttl: 3600,
      providers: [
        {
          name: "stun",
          role: "direct-p2p",
          status: "available",
          urls: stun.map((server) => server.urls),
        },
        express.report,
        meteredRelay.report,
      ],
      excludedProviders: [...excluded],
      generatedAt: new Date().toISOString(),
    },
    headers,
  );
});
