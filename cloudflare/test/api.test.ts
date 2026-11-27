import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import { handleRequest } from "../src/index";
import type { Env } from "../src/env";

const SESSION_SECRET = "test-session-secret-not-real";
const TURN_SECRET = "test-turn-shared-secret-not-real";
const ORIGIN = "https://thimar.freebuff.page";

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function hmac(secret: string, hash: "SHA-256" | "SHA-1", message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

async function sessionToken({ sub = "user-a", expOffset = 600, scope = "session", secret = SESSION_SECRET } = {}): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ sub, scope, exp: Math.floor(Date.now() / 1000) + expOffset }));
  return `${header}.${payload}.${b64url(await hmac(secret, "SHA-256", `${header}.${payload}`))}`;
}

function baseEnv(overrides: Partial<Env> = {}): Env {
  return { ...(env as unknown as Env), ...overrides };
}

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`https://thimar.test${path}`, { ...init, headers: { Origin: ORIGIN, ...(init.headers ?? {}) } });
}

/**
 * اعتراض الطلبات الصادرة داخل workerd: لا اتصال شبكي حقيقي في الاختبارات،
 * وأي طلب غير متوقّع يُسجَّل ويفشل الاختبار.
 */
const realFetch = globalThis.fetch;
let outbound: Array<{ status: number; body: unknown }> = [];
let conversationsOutbound: Array<{ status: number; body: unknown }> = [];
let realtimeOutbound: Array<{ status: number; body: unknown }> = [];
let unexpected: string[] = [];

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const supabaseTable = url.startsWith("https://test.supabase.co/rest/v1/thimar_calls")
      ? outbound
      : url.startsWith("https://test.supabase.co/rest/v1/conversations")
        ? conversationsOutbound
        : null;
    if (supabaseTable) {
      const next = supabaseTable.shift();
      if (!next) {
        unexpected.push(url);
        return Response.json({}, { status: 500 });
      }
      return Response.json(next.body, { status: next.status, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://rtc.live.cloudflare.com/")) {
      const next = realtimeOutbound.shift();
      if (!next) {
        unexpected.push(url);
        return Response.json({}, { status: 500 });
      }
      return Response.json(next.body, { status: next.status, headers: { "content-type": "application/json" } });
    }
    unexpected.push(url);
    return new Response("blocked", { status: 403 });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  expect(unexpected).toEqual([]);
  expect(outbound).toEqual([]);
  expect(conversationsOutbound).toEqual([]);
  expect(realtimeOutbound).toEqual([]);
  unexpected = [];
  outbound = [];
  conversationsOutbound = [];
  realtimeOutbound = [];
});

describe("health", () => {
  it("يعمل عبر العامل ويعيد حالة بلا أسرار", async () => {
    const response = await SELF.fetch("https://thimar.test/api/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.service).toBe("thimar-api");
    const text = JSON.stringify(body);
    expect(text).not.toContain("secret");
    expect(text).not.toContain(TURN_SECRET);
  });

  it("يعيد 404 لمسار غير معروف", async () => {
    const response = await handleRequest(req("/api/nope"), baseEnv());
    expect(response.status).toBe(404);
  });
});

describe("/api/turn", () => {
  it("يرفض طلبًا بلا جلسة", async () => {
    const response = await handleRequest(req("/api/turn"), baseEnv());
    expect(response.status).toBe(401);
    expect(((await response.json()) as Record<string, unknown>).error).toBe("AUTH_REQUIRED");
  });

  it("يرفض رمزًا منتهيًا أو موقّعًا بمفتاح آخر", async () => {
    const expired = await sessionToken({ expOffset: -10 });
    expect((await handleRequest(req("/api/turn", { headers: { Authorization: `Bearer ${expired}` } }), baseEnv())).status).toBe(401);
    const forged = await sessionToken({ secret: "other" });
    expect((await handleRequest(req("/api/turn", { headers: { Authorization: `Bearer ${forged}` } }), baseEnv())).status).toBe(401);
  });

  it("يصدر اعتمادًا مؤقتًا مرتبطًا بالمستخدم وصالحًا للتوقيع", async () => {
    const token = await sessionToken({ sub: "user-77" });
    const response = await handleRequest(
      req("/api/turn", { headers: { Authorization: `Bearer ${token}` } }),
      baseEnv({ TURN_SHARED_SECRET: TURN_SECRET }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { iceServers: RTCIceServer[]; ttl: number; expiresAt: number };
    expect(body.ttl).toBe(900);

    const relay = body.iceServers[0];
    expect(Array.isArray(relay.urls) ? relay.urls : [relay.urls]).toContain("turns:relay1.expressturn.com:443?transport=tcp");
    const [expiryRaw, user] = String(relay.username).split(":");
    expect(user).toBe("user-77");
    const expiry = Number(expiryRaw);
    const now = Math.floor(Date.now() / 1000);
    expect(expiry).toBeGreaterThan(now);
    expect(expiry - now).toBeLessThanOrEqual(900 + 5);
    expect(body.expiresAt).toBe(expiry);

    // TURN REST API يستخدم base64 القياسي (لا base64url) لتوقيع HMAC-SHA1.
    expect(relay.credential).toBe(b64(await hmac(TURN_SECRET, "SHA-1", String(relay.username))));
    expect(JSON.stringify(body)).not.toContain(TURN_SECRET);
  });

  it("لا يعيد شيئًا بلا مفتاح مشترك", async () => {
    const token = await sessionToken();
    const response = await handleRequest(
      req("/api/turn", { headers: { Authorization: `Bearer ${token}` } }),
      baseEnv({ TURN_SHARED_SECRET: "" }),
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as Record<string, unknown>).error).toBe("TURN_NOT_CONFIGURED");
  });

  it("لا يعكس أصلًا غير مسموح", async () => {
    const token = await sessionToken();
    const good = await handleRequest(req("/api/turn", { headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN } }), baseEnv());
    expect(good.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const bad = await handleRequest(
      req("/api/turn", { headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.example" } }),
      baseEnv(),
    );
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("/api/rooms/:id/token", () => {
  const authorizedEnv = () => baseEnv({ SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_KEY: "service-key-not-real" });

  function expectCallLookup(reply: unknown, status = 200) {
    outbound.push({ status, body: reply });
  }

  it("يتطلب جلسة", async () => {
    const response = await handleRequest(req("/api/rooms/room-1/token", { method: "POST" }), authorizedEnv());
    expect(response.status).toBe(401);
  });

  it("يرفض عندما لا يوجد مُتحقّق عضوية مضبوط", async () => {
    const token = await sessionToken();
    const response = await handleRequest(
      req("/api/rooms/room-1/token", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
      baseEnv({ SUPABASE_URL: "", SUPABASE_SERVICE_KEY: "" }),
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as Record<string, unknown>).error).toBe("AUTHORIZER_NOT_CONFIGURED");
  });

  it("يمنح بطاقة لمشارك فعلي فقط", async () => {
    const token = await sessionToken({ sub: "caller-1" });
    expectCallLookup([{ caller_id: "caller-1", callee_id: "callee-1", state: "ringing" }]);
    const response = await handleRequest(
      req("/api/rooms/room-1/token", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
      authorizedEnv(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ticket: string; maxParticipants: number; expiresIn: number };
    expect(body.maxParticipants).toBe(10);
    expect(body.ticket.split(".")).toHaveLength(2);
  });

  it("يرفض غير المشارك ومكالمة منتهية", async () => {
    const stranger = await sessionToken({ sub: "stranger" });
    expectCallLookup([{ caller_id: "caller-1", callee_id: "callee-1", state: "ringing" }]);
    const forbidden = await handleRequest(
      req("/api/rooms/room-1/token", { method: "POST", headers: { Authorization: `Bearer ${stranger}` } }),
      authorizedEnv(),
    );
    expect(forbidden.status).toBe(403);

    const ended = await sessionToken({ sub: "caller-1" });
    expectCallLookup([{ caller_id: "caller-1", callee_id: "callee-1", state: "ended" }]);
    const endedResponse = await handleRequest(
      req("/api/rooms/room-1/token", { method: "POST", headers: { Authorization: `Bearer ${ended}` } }),
      authorizedEnv(),
    );
    expect(endedResponse.status).toBe(403);
  });

  it("يعيد 502 عند تعذّر التحقق من العضوية", async () => {
    const token = await sessionToken({ sub: "caller-1" });
    expectCallLookup({ message: "boom" }, 500);
    const response = await handleRequest(
      req("/api/rooms/room-1/token", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
      authorizedEnv(),
    );
    expect(response.status).toBe(502);
  });

  it("يرفض WebSocket بلا بطاقة صالحة", async () => {
    const response = await handleRequest(
      req("/api/rooms/room-1/ws?ticket=forged.sig", { headers: { Upgrade: "websocket" } }),
      baseEnv(),
    );
    expect(response.status).toBe(401);
  });
});

describe("TURN عبر Cloudflare Realtime", () => {
  const cloudflareEnv = () => baseEnv({ TURN_KEY_ID: "turn-key-1", TURN_KEY_API_TOKEN: "turn-token-not-real" });
  it("يصدر اعتمادًا مؤقتًا من Cloudflare دون كشف المفتاح", async () => {
    const token = await sessionToken({ sub: "user-cf" });
    realtimeOutbound.push({
      status: 200,
      body: { iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }, { urls: "turn:turn.cloudflare.com:3478?transport=udp", username: "u", credential: "c" }] },
    });
    const response = await handleRequest(
      req("/api/turn", { headers: { Authorization: `Bearer ${token}` } }),
      cloudflareEnv(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { provider: string; ttl: number; iceServers: RTCIceServer[] };
    expect(body.provider).toBe("cloudflare-realtime");
    expect(body.ttl).toBe(900);
    expect(JSON.stringify(body)).not.toContain("turn-token-not-real");
    expect(JSON.stringify(body)).not.toContain("turn-key-1");
  });

  it("لا يُخفي فشل مزوّد TURN باعتماد ثابت", async () => {
    const token = await sessionToken();
    realtimeOutbound.push({ status: 500, body: { errors: [{ code: 1000 }] } });
    const response = await handleRequest(
      req("/api/turn", { headers: { Authorization: `Bearer ${token}` } }),
      cloudflareEnv(),
    );
    expect(response.status).toBe(502);
    expect(((await response.json()) as Record<string, unknown>).error).toBe("TURN_UPSTREAM_ERROR");
  });
});

describe("/api/calls (Cloudflare Realtime SFU)", () => {
  const sfuEnv = () => baseEnv({
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key-not-real",
    CF_REALTIME_APP_ID: "app-id-1",
    CF_REALTIME_APP_SECRET: "app-secret-not-real",
  });
  const offer = { type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n" };
  const answer = { type: "answer", sdp: "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n" };

  function directConversation() {
    outbound.push({ status: 200, body: [] });
    conversationsOutbound.push({ status: 200, body: [{ member_ids: ["member-1", "member-2"] }] });
  }

  it("يتطلب جلسة", async () => {
    const response = await handleRequest(req("/api/calls/session/new", { method: "POST", body: "{}" }), sfuEnv());
    expect(response.status).toBe(401);
  });

  it("يعيد 503 بصراحة عندما لا يكون SFU مضبوطًا", async () => {
    const token = await sessionToken({ sub: "member-1" });
    const response = await handleRequest(
      req("/api/calls/session/new", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomId: "conv-1", sessionDescription: offer }),
      }),
      baseEnv({ SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_KEY: "k" }),
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as Record<string, unknown>).error).toBe("SFU_NOT_CONFIGURED");
  });

  it("يرفض غير عضو المحادثة", async () => {
    const token = await sessionToken({ sub: "stranger" });
    outbound.push({ status: 200, body: [] });
    conversationsOutbound.push({ status: 200, body: [{ member_ids: ["member-1"] }] });
    const response = await handleRequest(
      req("/api/calls/session/new", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomId: "conv-1", sessionDescription: offer }),
      }),
      sfuEnv(),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as Record<string, unknown>).error).toBe("NOT_A_PARTICIPANT");
  });

  it("ينشئ جلسة ويربطها برمز موقّع للمستخدم", async () => {
    const token = await sessionToken({ sub: "member-1" });
    directConversation();
    realtimeOutbound.push({ status: 200, body: { sessionId: "session-abcdefgh", sessionDescription: answer } });
    const response = await handleRequest(
      req("/api/calls/session/new", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomId: "conv-1", sessionDescription: offer }),
      }),
      sfuEnv(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sessionId: string; sessionToken: string; sessionDescription: { type: string } };
    expect(body.sessionId).toBe("session-abcdefgh");
    expect(body.sessionToken.split(".")).toHaveLength(2);
    expect(body.sessionDescription.type).toBe("answer");
    expect(JSON.stringify(body)).not.toContain("app-secret-not-real");
  });

  it("يرفض جلسة SFU بلا رمز موقّع صالح", async () => {
    const token = await sessionToken({ sub: "member-1" });
    const response = await handleRequest(
      req("/api/calls/session/tracks/new", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "X-Sfu-Session": "forged.sig" },
        body: JSON.stringify({ roomId: "conv-1", tracks: [{ location: "local", mid: "0", trackName: "me.audio" }] }),
      }),
      sfuEnv(),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as Record<string, unknown>).error).toBe("INVALID_SESSION_GRANT");
  });

  it("يمرّر سحب مسار بعيد ويعيد عرض SFU", async () => {
    const token = await sessionToken({ sub: "member-1" });
    directConversation();
    realtimeOutbound.push({ status: 200, body: { sessionId: "session-abcdefgh", sessionDescription: answer } });
    const created = await handleRequest(
      req("/api/calls/session/new", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomId: "conv-1", sessionDescription: offer }),
      }),
      sfuEnv(),
    );
    const { sessionToken: sfuGrant } = (await created.json()) as { sessionToken: string };

    realtimeOutbound.push({ status: 200, body: { sessionDescription: offer, requiresImmediateRenegotiation: true } });
    const pull = await handleRequest(
      req("/api/calls/session/tracks/new", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "X-Sfu-Session": sfuGrant },
        body: JSON.stringify({
          roomId: "conv-1",
          tracks: [{ location: "remote", sessionId: "session-peer-1", trackName: "peer.audio" }],
        }),
      }),
      sfuEnv(),
    );
    expect(pull.status).toBe(200);
    expect(((await pull.json()) as Record<string, unknown>).requiresImmediateRenegotiation).toBe(true);
  });

  it("يرفض مسارًا مشوّهًا أو تصعيد أصل غير مسموح", async () => {
    const token = await sessionToken({ sub: "member-1" });
    const response = await handleRequest(
      req("/api/calls/session/tracks/new", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "X-Sfu-Session": "forged.sig" },
        body: JSON.stringify({ roomId: "conv-1", tracks: [{ location: "local" }] }),
      }),
      sfuEnv(),
    );
    expect([400, 403]).toContain(response.status);
  });
});
