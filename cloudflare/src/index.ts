import type { Env } from "./env";
import { bearer, issueRoomGrant, issueSfuGrant, verifyRoomGrant, verifySession, verifySfuGrant } from "./auth";
import { clampTtl, mintTurnCredentials, TURN_DEFAULT_TTL_SECONDS } from "../../supabase/functions/_shared/turn.ts";
import {
  forwardSfu,
  isSessionDescription,
  isSfuSessionId,
  mintCloudflareTurn,
  readTrackList,
  realtimeSfuConfigured,
  realtimeTurnConfigured,
} from "./realtime";

export { CallRoom } from "./room";

/**
 * بوابة staging فوق Worker: مصادقة عند الحدود، توليد TURN مؤقت،
 * وتوجيه WebSocket إلى كائن الغرفة. لا تحتوي أي مفتاح سري في الاستجابات.
 */

const DEFAULT_TURN_URLS = [
  "turn:relay1.expressturn.com:3478?transport=udp",
  "turn:relay1.expressturn.com:3478?transport=tcp",
  "turns:relay1.expressturn.com:443?transport=tcp",
];

const DEFAULT_ORIGINS = ["https://thimar.freebuff.page", "http://localhost:3000", "http://localhost:5173"];

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowed = new Set(
    (env as Env & { THIMAR_ALLOWED_ORIGINS?: string }).THIMAR_ALLOWED_ORIGINS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .concat(DEFAULT_ORIGINS) ?? DEFAULT_ORIGINS,
  );
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type, x-sfu-session",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    Vary: "Origin",
  };
  const origin = request.headers.get("Origin") ?? "";
  if (origin && allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return Response.json(body, { status, headers: { ...headers, "Cache-Control": "no-store" } });
}

const limits = new Map<string, number[]>();

function rateLimited(key: string, limit: number, now = Date.now()): boolean {
  const windowMs = 60_000;
  const hits = (limits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (hits.length >= limit) return true;
  hits.push(now);
  limits.set(key, hits);
  return false;
}

type AuthorizeResult = "ok" | "forbidden" | "not_configured" | "error";

/**
 * العضوية تُقرأ من Supabase (مصدر الحقيقة) بمفتاح خدمة على الخادم فقط.
 * لا يُقبل roomId من العميل بلا تحقق من أنه طرف في المكالمة.
 */
async function authorizeRoomMember(env: Env, roomId: string, uid: string): Promise<AuthorizeResult> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return "not_configured";
  const query = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/thimar_calls?id=eq.${encodeURIComponent(roomId)}&select=caller_id,callee_id,state`;
  try {
    const response = await fetch(query, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return "error";
    const rows = (await response.json()) as Array<{ caller_id?: string; callee_id?: string; state?: string }>;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return "forbidden";
    const terminal = ["rejected", "cancelled", "busy", "unavailable", "missed", "ended", "failed"];
    if (row.state && terminal.includes(row.state)) return "forbidden";
    if (row.caller_id !== uid && row.callee_id !== uid) return "forbidden";
    return "ok";
  } catch {
    return "error";
  }
}

/**
 * العضوية في مكالمة جماعية تُقرأ من محادثة Supabase (member_ids) أو من
 * سجل مكالمة فردية (thimar_calls). لا يُقبل معرّف غرفة من العميل بلا تحقق.
 */
async function authorizeConversationMember(env: Env, conversationId: string, uid: string): Promise<AuthorizeResult> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return "not_configured";
  const direct = await authorizeRoomMember(env, conversationId, uid);
  if (direct === "ok") return "ok";
  if (direct === "not_configured") return "not_configured";

  const query = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}&select=member_ids`;
  try {
    const response = await fetch(query, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return direct === "error" ? "error" : "forbidden";
    const rows = (await response.json()) as Array<{ member_ids?: unknown }>;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    const members = Array.isArray(row?.member_ids) ? (row!.member_ids as unknown[]) : [];
    return members.some((member) => String(member) === uid) ? "ok" : "forbidden";
  } catch {
    return "error";
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const headers = corsHeaders(request, env);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  if (path === "/api/health" && request.method === "GET") {
    // لا يكشف حالة أي سر: فقط أن العامل يعمل.
    return json(200, { ok: true, environment: env.ENVIRONMENT ?? "unknown", service: "thimar-api", time: new Date().toISOString() }, headers);
  }

  if (path === "/api/turn" && (request.method === "GET" || request.method === "POST")) {
    const sessionSecret = env.SESSION_SIGNING_SECRET ?? "";
    if (!sessionSecret) return json(503, { error: "SESSION_NOT_CONFIGURED" }, headers);

    const session = await verifySession(bearer(request), sessionSecret);
    if (!session) return json(401, { error: "AUTH_REQUIRED" }, headers);
    if (rateLimited(`turn:${session.sub}`, 30)) {
      return json(429, { error: "RATE_LIMITED" }, { ...headers, "Retry-After": "60" });
    }

    const ttl = clampTtl(env.TURN_TTL_SECONDS || TURN_DEFAULT_TTL_SECONDS);

    // 1) Cloudflare Realtime TURN: مفتاح طويل الأجل على الخادم يولّد اعتمادًا مؤقتًا.
    if (realtimeTurnConfigured(env)) {
      const cloudflare = await mintCloudflareTurn(env, ttl);
      if (!cloudflare) return json(502, { error: "TURN_UPSTREAM_ERROR" }, headers);
      return json(
        200,
        {
          iceServers: cloudflare.iceServers,
          ttl: cloudflare.ttl,
          expiresAt: cloudflare.expiresAt,
          provider: "cloudflare-realtime",
          generatedAt: new Date().toISOString(),
        },
        headers,
      );
    }

    // 2) coturn / TURN REST API بمفتاح مشترك (لا اعتماد ثابت مكشوف).
    const turnSecret = env.TURN_SHARED_SECRET ?? "";
    if (!turnSecret) return json(503, { error: "TURN_NOT_CONFIGURED" }, headers);

    const { username, credential, expiresAt } = await mintTurnCredentials({ secret: turnSecret, userId: session.sub, ttlSeconds: ttl });
    const turnUrls = (env.TURN_URLS ?? "").split(",").map((value) => value.trim()).filter(Boolean);

    return json(
      200,
      {
        iceServers: [{ urls: turnUrls.length ? turnUrls : DEFAULT_TURN_URLS, username, credential }],
        ttl,
        expiresAt,
        provider: "expressturn",
        generatedAt: new Date().toISOString(),
      },
      headers,
    );
  }

  /* ---------------- Cloudflare Realtime SFU: وسائط المكالمات الجماعية ---------------- */
  const sfuRoute =
    path === "/api/calls/session/new" && request.method === "POST" ? "new-session"
      : path === "/api/calls/session/tracks/new" && request.method === "POST" ? "new-tracks"
        : path === "/api/calls/session/renegotiate" && request.method === "PUT" ? "renegotiate"
          : path === "/api/calls/session/tracks/close" && request.method === "PUT" ? "close-tracks"
            : null;

  if (sfuRoute) {
    const sessionSecret = env.SESSION_SIGNING_SECRET ?? "";
    if (!sessionSecret) return json(503, { error: "SESSION_NOT_CONFIGURED" }, headers);
    if (!realtimeSfuConfigured(env)) return json(503, { error: "SFU_NOT_CONFIGURED" }, headers);

    const session = await verifySession(bearer(request), sessionSecret);
    if (!session) return json(401, { error: "AUTH_REQUIRED" }, headers);
    if (rateLimited(`sfu:${session.sub}`, 120)) {
      return json(429, { error: "RATE_LIMITED" }, { ...headers, "Retry-After": "60" });
    }

    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json(400, { error: "INVALID_BODY" }, headers);
    const roomId = String(raw.roomId ?? "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) return json(400, { error: "INVALID_ROOM" }, headers);

    if (sfuRoute === "new-session") {
      const authorization = await authorizeConversationMember(env, roomId, session.sub);
      if (authorization === "not_configured") return json(503, { error: "AUTHORIZER_NOT_CONFIGURED" }, headers);
      if (authorization === "error") return json(502, { error: "AUTHORIZER_UNAVAILABLE" }, headers);
      if (authorization === "forbidden") return json(403, { error: "NOT_A_PARTICIPANT" }, headers);
      if (raw.sessionDescription !== undefined && !isSessionDescription(raw.sessionDescription)) {
        return json(400, { error: "INVALID_SDP" }, headers);
      }

      const upstream = await forwardSfu(env, {
        kind: "new-session",
        sessionDescription: raw.sessionDescription as RTCSessionDescriptionInit | undefined,
      });
      if (upstream.status !== 200) return json(upstream.status, upstream.body, headers);
      const created = upstream.body as { sessionId?: unknown; sessionDescription?: unknown };
      if (!isSfuSessionId(created.sessionId)) {
        return json(502, { error: "SFU_BAD_RESPONSE" }, headers);
      }
      if (created.sessionDescription !== undefined && !isSessionDescription(created.sessionDescription)) {
        return json(502, { error: "SFU_BAD_RESPONSE" }, headers);
      }
      // رمز موقّع يربط الجلسة بهذا المستخدم وهذه الغرفة؛ لا يمكن استخدام جلسة غيره.
      const sessionToken = await issueSfuGrant(sessionSecret, {
        sid: created.sessionId,
        sub: session.sub,
        roomId,
        ttlSeconds: 60 * 60,
      });
      return json(
        200,
        {
          sessionId: created.sessionId,
          ...(created.sessionDescription ? { sessionDescription: created.sessionDescription } : {}),
          sessionToken,
          expiresIn: 3600,
        },
        headers,
      );
    }

    const grant = await verifySfuGrant(sessionSecret, request.headers.get("X-Sfu-Session") ?? "");
    if (!grant || grant.sub !== session.sub || grant.roomId !== roomId) {
      return json(403, { error: "INVALID_SESSION_GRANT" }, headers);
    }

    if (sfuRoute === "renegotiate") {
      if (!isSessionDescription(raw.sessionDescription)) return json(400, { error: "INVALID_SDP" }, headers);
      const upstream = await forwardSfu(env, {
        kind: "renegotiate",
        sessionId: grant.sid,
        sessionDescription: raw.sessionDescription,
      });
      return json(upstream.status, upstream.body, headers);
    }

    if (sfuRoute === "close-tracks") {
      if (!Array.isArray(raw.tracks) || raw.tracks.length === 0 || raw.tracks.length > 12) {
        return json(400, { error: "INVALID_TRACKS" }, headers);
      }
      const mids: Array<{ mid: string }> = [];
      for (const entry of raw.tracks) {
        const mid = (entry as { mid?: unknown } | null)?.mid;
        if (typeof mid !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(mid)) return json(400, { error: "INVALID_TRACKS" }, headers);
        mids.push({ mid });
      }
      const upstream = await forwardSfu(env, { kind: "close-tracks", sessionId: grant.sid, tracks: mids });
      return json(upstream.status, upstream.body, headers);
    }

    // new-tracks: نشر محلي أو سحب بعيد داخل جلسة المستخدم نفسها.
    const tracks = readTrackList(raw.tracks);
    if (!tracks) return json(400, { error: "INVALID_TRACKS" }, headers);
    if (raw.sessionDescription !== undefined && !isSessionDescription(raw.sessionDescription)) {
      return json(400, { error: "INVALID_SDP" }, headers);
    }
    const upstream = await forwardSfu(env, {
      kind: "new-tracks",
      sessionId: grant.sid,
      tracks,
      sessionDescription: raw.sessionDescription as RTCSessionDescriptionInit | undefined,
    });
    return json(upstream.status, upstream.body, headers);
  }

  const roomMatch = path.match(/^\/api\/rooms\/([A-Za-z0-9_-]{1,64})\/(token|ws)$/);
  if (roomMatch) {
    const [, roomId, action] = roomMatch;
    const sessionSecret = env.SESSION_SIGNING_SECRET ?? "";
    if (!sessionSecret) return json(503, { error: "SESSION_NOT_CONFIGURED" }, headers);

    if (action === "token") {
      if (request.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" }, headers);
      const session = await verifySession(bearer(request), sessionSecret);
      if (!session) return json(401, { error: "AUTH_REQUIRED" }, headers);

      const authorization = await authorizeRoomMember(env, roomId, session.sub);
      if (authorization === "not_configured") return json(503, { error: "AUTHORIZER_NOT_CONFIGURED" }, headers);
      if (authorization === "error") return json(502, { error: "AUTHORIZER_UNAVAILABLE" }, headers);
      if (authorization === "forbidden") return json(403, { error: "NOT_A_PARTICIPANT" }, headers);

      const ttlSeconds = clampTtl(env.ROOM_TOKEN_TTL_SECONDS || 300);
      const maxParticipants = Math.min(10, Math.max(2, Number(env.ROOM_MAX_PARTICIPANTS ?? 10) || 10));
      const ticket = await issueRoomGrant(sessionSecret, {
        roomId,
        sub: session.sub,
        maxParticipants,
        ttlSeconds: Math.min(3600, ttlSeconds),
      });
      return json(200, { ticket, roomId, maxParticipants, expiresIn: Math.min(3600, ttlSeconds) }, headers);
    }

    // action === "ws"
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json(426, { error: "EXPECTED_WEBSOCKET" }, headers);
    }
    const grant = await verifyRoomGrant(sessionSecret, url.searchParams.get("ticket") ?? "");
    if (!grant || grant.roomId !== roomId) return json(401, { error: "INVALID_TICKET" }, headers);

    const stub = env.CALL_ROOMS.get(env.CALL_ROOMS.idFromName(roomId));
    const forwarded = new Request(`https://room.internal/ws`, {
      headers: {
        Upgrade: "websocket",
        "X-Thimar-User": grant.sub,
        "X-Thimar-Room": grant.roomId,
      },
    });
    return stub.fetch(forwarded);
  }

  return json(404, { error: "NOT_FOUND" }, headers);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
