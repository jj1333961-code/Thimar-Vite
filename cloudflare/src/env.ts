export interface Env {
  CALL_ROOMS: DurableObjectNamespace;
  ENVIRONMENT?: string;
  SESSION_SIGNING_SECRET?: string;
  /** coturn / المزوّد المتوافق مع TURN REST API (اختياري). */
  TURN_SHARED_SECRET?: string;
  TURN_TTL_SECONDS?: string;
  TURN_URLS?: string;
  /** Cloudflare Realtime TURN: مفتاح طويل الأجل يولّد اعتمادًا مؤقتًا. */
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  /** Cloudflare Realtime SFU: App ID وسرّه (على الخادم فقط). */
  CF_REALTIME_APP_ID?: string;
  CF_REALTIME_APP_SECRET?: string;
  ROOM_MAX_PARTICIPANTS?: string;
  ROOM_TOKEN_TTL_SECONDS?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
}
