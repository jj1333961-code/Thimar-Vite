/**
 * التحقق من رمز جلسة ثمار الموقّع (HMAC-SHA256) على الخادم.
 *
 * الصيغة: header.payload.signature — كلها base64url، والتوقيع على "header.payload".
 * يُستخدم في thimar-calls وthimar-turn؛ لا يُقبل أي رمز بلا توقيع صحيح،
 * ولا يُشتق هوية المستخدم من جسم الطلب أو من حقول JWT غير موقّعة.
 */

export type SessionClaims = {
  sub: string;
  exp: number;
  scope: "session";
};

const encoder = new TextEncoder();

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacVerify(secret: string, message: string, signatureB64: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, b64urlDecode(signatureB64), encoder.encode(message));
}

/** يعيد المطالبات إن كان الرمز موقّعًا وصالحًا وغير منتهٍ، وإلا null. */
export async function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SessionClaims | null> {
  if (!token || !secret) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const ok = await hmacVerify(secret, `${header}.${payload}`, signature);
    if (!ok) return null;
    const decoded = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (!decoded || typeof decoded.sub !== "string" || !decoded.sub) return null;
    if (typeof decoded.exp !== "number" || decoded.exp <= nowSeconds) return null;
    if (decoded.scope !== "session") return null;
    return { sub: String(decoded.sub), exp: decoded.exp, scope: "session" };
  } catch {
    return null;
  }
}

/** يستخرج الرمز من ترويسة Authorization فقط (لا من جسم الطلب). */
export function bearerToken(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}
