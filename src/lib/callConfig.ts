/**
 * إعدادات المكالمات العامة (تُحقن وقت البناء عبر VITE_*).
 *
 * - `VITE_CALL_WORKER_URL`: أصل عامل Cloudflare الذي يخدم `/api/turn`
 *   و`/api/rooms/*` و`/api/calls/*`. إن كان فارغًا يعمل التطبيق بمسار
 *   Supabase Realtime القديم للإشارات، ويجرّب دالة `thimar-turn` للاعتمادات.
 * - `VITE_CALL_ICE_POLICY`: `all` (افتراضي) أو `relay`.
 *   `relay` يمنع أي اتصال مباشر بين الطرفين لكنه يمنع المكالمة كليًا إن لم
 *   يتوفر TURN؛ لذلك الافتراضي `all` مع TURN كاحتياط للشبكات المقيّدة.
 * - `VITE_CALL_SFU`: `off` لتعطيل المكالمات الجماعية صراحة.
 */

function envValue(key: string): string {
  try {
    const env = import.meta.env as unknown as Record<string, string | undefined>;
    return String(env?.[key] ?? "").trim();
  } catch {
    return "";
  }
}

export const CALL_SIGNALING_BASE = envValue("VITE_CALL_WORKER_URL").replace(/\/+$/, "");

/** عنوان مخصص لاعتمادات TURN؛ افتراضيًا نفس أصل العامل. */
export const CALL_TURN_BASE = (envValue("VITE_CALL_TURN_URL") || CALL_SIGNALING_BASE).replace(/\/+$/, "");

export const CALL_ICE_TRANSPORT_POLICY: RTCIceTransportPolicy =
  envValue("VITE_CALL_ICE_POLICY").toLowerCase() === "relay" ? "relay" : "all";

export const CALL_MAX_PARTICIPANTS = 10;

/**
 * المكالمات الجماعية تحتاج SFU حقيقيًا (Cloudflare Realtime)؛ لا يُستخدم
 * WebSocket/Durable Object لنقل الوسائط إطلاقًا، بل للإشارات والحضور فقط.
 */
export const CALL_SFU_ENABLED =
  envValue("VITE_CALL_SFU").toLowerCase() !== "off" && Boolean(CALL_SIGNALING_BASE);
