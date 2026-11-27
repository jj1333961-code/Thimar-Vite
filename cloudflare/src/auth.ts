/**
 * رموز داخلية موقّعة: جلسة المستخدم تُتحقّق مرة واحدة عند الحدود،
 * ثم تُمنح بطاقة دخول للغرفة قصيرة العمر (room token) حتى لا تُعاد إعادة
 * التحقق مع كل رسالة WebSocket، ولا يستطيع عميل تزوير هويته.
 */
const encoder = new TextEncoder();

export type SessionClaims = { sub: string; exp: number };

export type RoomGrant = { roomId: string; sub: string; exp: number; maxParticipants: number };

function b64urlEncode(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** يتحقق من رمز جلسة ثمار الموقّع (نفس صيغة thimar-calls). */
export async function verifySession(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<SessionClaims | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = b64urlEncode(await hmac(secret, `${header}.${payload}`));
  if (!timingSafeEqual(expected, signature)) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (typeof claims?.sub !== "string" || !claims.sub) return null;
    if (typeof claims?.exp !== "number" || claims.exp <= nowSeconds) return null;
    if (claims?.scope !== "session") return null;
    return { sub: claims.sub, exp: claims.exp };
  } catch {
    return null;
  }
}

export function bearer(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

/** بطاقة غرفة قصيرة العمر: تُوقّع على الخادم فقط. */
export async function issueRoomGrant(
  secret: string,
  grant: Omit<RoomGrant, "exp"> & { ttlSeconds: number },
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const body: RoomGrant = {
    roomId: grant.roomId,
    sub: grant.sub,
    maxParticipants: grant.maxParticipants,
    exp: nowSeconds + grant.ttlSeconds,
  };
  const payload = b64urlEncode(JSON.stringify(body));
  const signature = b64urlEncode(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

/**
 * تفويض جلسة SFU: يربط `sessionId` من Cloudflare بمستخدم ومساحة محادثة.
 * بدونه يستطيع أي مستخدم إغلاق مسارات جلسة غيره بمعرفة المعرّف فقط.
 */
export type SfuGrant = { sid: string; sub: string; roomId: string; exp: number };

export async function issueSfuGrant(
  secret: string,
  grant: Omit<SfuGrant, "exp"> & { ttlSeconds: number },
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const body: SfuGrant = { sid: grant.sid, sub: grant.sub, roomId: grant.roomId, exp: nowSeconds + grant.ttlSeconds };
  const payload = b64urlEncode(JSON.stringify(body));
  const signature = b64urlEncode(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

export async function verifySfuGrant(
  secret: string,
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SfuGrant | null> {
  if (!token || !secret) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = b64urlEncode(await hmac(secret, payload));
  if (!timingSafeEqual(expected, signature)) return null;
  try {
    const grant = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as SfuGrant;
    if (!grant?.sid || !grant?.sub || !grant?.roomId) return null;
    if (typeof grant.exp !== "number" || grant.exp <= nowSeconds) return null;
    return grant;
  } catch {
    return null;
  }
}

export async function verifyRoomGrant(secret: string, token: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<RoomGrant | null> {
  if (!token || !secret) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = b64urlEncode(await hmac(secret, payload));
  if (!timingSafeEqual(expected, signature)) return null;
  try {
    const grant = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as RoomGrant;
    if (!grant?.roomId || !grant?.sub) return null;
    if (typeof grant.exp !== "number" || grant.exp <= nowSeconds) return null;
    return grant;
  } catch {
    return null;
  }
}
