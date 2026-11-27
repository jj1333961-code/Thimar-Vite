import type { Env } from "./env";

/**
 * تكامل Cloudflare Realtime (TURN + SFU) من الخادم فقط.
 *
 * - TURN: مفتاح طويل الأجل (TURN_KEY_ID + TURN_KEY_API_TOKEN) يولّد اعتمادًا
 *   مؤقتًا لكل مستخدم. لا يُعاد المفتاح ولا API token إلى المتصفح أبدًا.
 * - SFU: App ID + App Secret يبقيان هنا؛ المتصفح يتحدث مع `/api/calls/*`
 *   فقط، ولا يمكنه استدعاء Cloudflare مباشرة ولا سرقة جلسة غيره.
 *
 * التوثيق: rtc.live.cloudflare.com/v1
 */

export const REALTIME_BASE = "https://rtc.live.cloudflare.com/v1";

const TURN_TTL_MIN = 300;
const TURN_TTL_MAX = 86_400;

export function realtimeSfuConfigured(env: Env): boolean {
  return Boolean(env.CF_REALTIME_APP_ID && env.CF_REALTIME_APP_SECRET);
}

export function realtimeTurnConfigured(env: Env): boolean {
  return Boolean(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN);
}

export function clampTurnTtl(value: unknown): number {
  const ttl = Number(value);
  if (!Number.isFinite(ttl) || ttl <= 0) return 3600;
  return Math.min(TURN_TTL_MAX, Math.max(TURN_TTL_MIN, Math.floor(ttl)));
}

export type CloudflareIce = {
  iceServers: RTCIceServer[];
  expiresAt: number;
  ttl: number;
};

/**
 * يطلب اعتماد TURN قصير العمر من Cloudflare.
 * الاستجابة تحتوي stun.cloudflare.com ومُرحّل turn.cloudflare.com.
 */
export async function mintCloudflareTurn(
  env: Env,
  ttlSeconds: unknown,
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<CloudflareIce | null> {
  if (!realtimeTurnConfigured(env)) return null;
  const ttl = clampTurnTtl(env.TURN_TTL_SECONDS || ttlSeconds);
  const response = await fetchImpl(
    `${REALTIME_BASE}/turn/keys/${encodeURIComponent(String(env.TURN_KEY_ID))}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl }),
    },
  );
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as { iceServers?: RTCIceServer[] } | null;
  const servers = Array.isArray(body?.iceServers) ? body!.iceServers : [];
  if (!servers.length) return null;
  return {
    iceServers: servers,
    ttl,
    expiresAt: Math.floor(nowMs / 1000) + ttl,
  };
}

/** مسارات SFU المسموح تمريرها فقط؛ لا يُمرَّر أي شيء آخر. */
export type SfuOperation =
  | { kind: "new-session"; sessionDescription?: RTCSessionDescriptionInit }
  | { kind: "new-tracks"; sessionId: string; tracks: unknown[]; sessionDescription?: RTCSessionDescriptionInit }
  | { kind: "renegotiate"; sessionId: string; sessionDescription: RTCSessionDescriptionInit }
  | { kind: "close-tracks"; sessionId: string; tracks: Array<{ mid: string }> };

export function sfuUpstreamPath(env: Env, operation: SfuOperation): string {
  const app = encodeURIComponent(String(env.CF_REALTIME_APP_ID));
  switch (operation.kind) {
    case "new-session":
      return `/apps/${app}/sessions/new`;
    case "new-tracks":
      return `/apps/${app}/sessions/${encodeURIComponent(operation.sessionId)}/tracks/new`;
    case "renegotiate":
      return `/apps/${app}/sessions/${encodeURIComponent(operation.sessionId)}/renegotiate`;
    case "close-tracks":
      return `/apps/${app}/sessions/${encodeURIComponent(operation.sessionId)}/tracks/close`;
  }
}

export function sfuUpstreamMethod(operation: SfuOperation): "POST" | "PUT" {
  return operation.kind === "new-session" || operation.kind === "new-tracks" ? "POST" : "PUT";
}

export function sfuUpstreamBody(operation: SfuOperation): unknown {
  switch (operation.kind) {
    case "new-session":
      return operation.sessionDescription ? { sessionDescription: operation.sessionDescription } : {};
    case "new-tracks":
      return {
        tracks: operation.tracks,
        ...(operation.sessionDescription ? { sessionDescription: operation.sessionDescription } : {}),
      };
    case "renegotiate":
      return { sessionDescription: operation.sessionDescription };
    case "close-tracks":
      return { tracks: operation.tracks.map((track) => ({ mid: track.mid })), force: true };
  }
}

/** يمرّر عملية SFU واحدة ويعيد حالة Cloudflare والجسم كما هو (بلا أسرار). */
export async function forwardSfu(
  env: Env,
  operation: SfuOperation,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; body: unknown }> {
  if (!realtimeSfuConfigured(env)) return { status: 503, body: { error: "SFU_NOT_CONFIGURED" } };
  const response = await fetchImpl(`${REALTIME_BASE}${sfuUpstreamPath(env, operation)}`, {
    method: sfuUpstreamMethod(operation),
    headers: {
      Authorization: `Bearer ${env.CF_REALTIME_APP_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(sfuUpstreamBody(operation)),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      status: 502,
      body: {
        error: "SFU_UPSTREAM_ERROR",
        upstreamStatus: response.status,
        detail: typeof (body as { errorDescription?: string })?.errorDescription === "string"
          ? (body as { errorDescription: string }).errorDescription.slice(0, 200)
          : undefined,
      },
    };
  }
  return { status: 200, body };
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isSfuSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

/** يتحقق من شكل مسار/عرض SDP القادم من العميل قبل تمريره. */
export function isSessionDescription(value: unknown): value is RTCSessionDescriptionInit {
  if (!value || typeof value !== "object") return false;
  const description = value as { type?: unknown; sdp?: unknown };
  return (description.type === "offer" || description.type === "answer")
    && typeof description.sdp === "string"
    && description.sdp.length > 0
    && description.sdp.length < 200_000;
}

const MAX_TRACKS = 12;

export function readTrackList(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TRACKS) return null;
  const cleaned: unknown[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const track = entry as Record<string, unknown>;
    const name = track.trackName;
    if (typeof name !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(name)) return null;
    if (track.location === "local") {
      if (typeof track.mid !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(track.mid)) return null;
      cleaned.push({ location: "local", mid: track.mid, trackName: name });
    } else if (track.location === "remote") {
      if (!isSfuSessionId(track.sessionId)) return null;
      cleaned.push({ location: "remote", sessionId: track.sessionId, trackName: name });
    } else {
      return null;
    }
  }
  return cleaned;
}
