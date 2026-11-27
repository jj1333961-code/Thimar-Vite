/**
 * توليد بيانات اعتماد TURN قصيرة العمر (TURN REST API / coturn use-auth-secret).
 *
 * username = "<expiry>:<user>" وpassword = base64(HMAC-SHA1(secret, username)).
 * بيانات الاعتماد الدائمة أو المفتاح المشترك لا يُعادان للعميل أبدًا؛
 * كل عميل يستلم زوجًا ينتهي خلال TTL مرتبط بهويته.
 */

export const TURN_MIN_TTL_SECONDS = 300;
export const TURN_MAX_TTL_SECONDS = 7200;
export const TURN_DEFAULT_TTL_SECONDS = 3600;

export type TurnCredential = {
  username: string;
  credential: string;
  /** Unix seconds — نفس القيمة المضمّنة في username. */
  expiresAt: number;
};

const encoder = new TextEncoder();

export async function hmacSha1Base64(secret: string, message: string): Promise<string> {
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

/** TURN يقبل محارف محدودة في username، و":" فاصل بين الانتهاء والهوية. */
export function sanitizeTurnUser(userId: string): string {
  const cleaned = String(userId).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40);
  return cleaned || "user";
}

export function clampTtl(value: unknown): number {
  const ttl = Number(value);
  if (!Number.isFinite(ttl) || ttl <= 0) return TURN_DEFAULT_TTL_SECONDS;
  return Math.min(TURN_MAX_TTL_SECONDS, Math.max(TURN_MIN_TTL_SECONDS, Math.floor(ttl)));
}

export async function mintTurnCredentials(options: {
  secret: string;
  userId: string;
  ttlSeconds?: number;
  nowMs?: number;
}): Promise<TurnCredential> {
  const { secret, userId } = options;
  if (!secret) throw new Error("TURN_SECRET_MISSING");
  const ttl = clampTtl(options.ttlSeconds);
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const expiresAt = Math.floor(nowMs / 1000) + ttl;
  const username = `${expiresAt}:${sanitizeTurnUser(userId)}`;
  const credential = await hmacSha1Base64(secret, username);
  return { username, credential, expiresAt };
}
