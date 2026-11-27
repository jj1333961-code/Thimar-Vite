import { CALL_MAX_PARTICIPANTS, CALL_SIGNALING_BASE } from "./callConfig";
import { readSessionToken } from "./callSignaling";
import { cachedSessionToken, ensureSessionToken } from "./sessionStore";

/**
 * عميل Cloudflare Realtime SFU (واجهة HTTPS للاتصال).
 *
 * الوسائط تتوقف عند SFU: كل مشارك يرفع مساراته مرة واحدة ويستقبل نسخًا من
 * الآخرين — لا شبكة P2P كاملة ولا نقل وسائط عبر WebSocket.
 *
 * App ID وApp Secret يبقيان على الخادم فقط؛ هذا العميل يتحدث مع عاملنا
 * (`/api/calls/*`) الذي يوقّع الطلب ويمرّره إلى rtc.live.cloudflare.com.
 */

export type SfuLocalTrack = { location: "local"; mid: string; trackName: string };
export type SfuRemoteTrack = { location: "remote"; sessionId: string; trackName: string };
export type SfuTrackRequest = SfuLocalTrack | SfuRemoteTrack;

export type SfuSessionHandle = { sessionId: string; token: string };

export type SfuTracksResponse = {
  sessionDescription?: RTCSessionDescriptionInit;
  requiresImmediateRenegotiation?: boolean;
  tracks?: Array<{ mid?: string; trackName?: string; errorCode?: string; errorDescription?: string }>;
  errorCode?: string;
  errorDescription?: string;
};

export class SfuError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 0) {
    super(
      code === "SFU_NOT_CONFIGURED"
        ? "المكالمات الجماعية تحتاج تفعيل Cloudflare Realtime SFU (مفتاح التطبيق على الخادم)."
        : code === "ROOM_FULL"
          ? `المكالمة الجماعية ممتلئة (الحد ${CALL_MAX_PARTICIPANTS} مشاركين).`
          : "تعذّر الاتصال بخادم الوسائط الجماعي. تحقّق من الشبكة ثم أعد المحاولة.",
    );
    this.name = "SfuError";
    this.code = code;
    this.status = status;
  }
}

type RequestOptions = { method: "GET" | "POST" | "PUT"; body?: unknown; sfuSession?: string };

export type SfuClientOptions = {
  baseUrl?: string;
  /** رمز جلسة ثمار (ليس رمز SFU). */
  sessionToken?: string | null;
  /** مصدر رمز الجلسة (يُستخدم في الاختبارات). الافتراضي: التجديد التلقائي. */
  sessionTokenProvider?: () => Promise<string | null>;
  roomId: string;
  fetchImpl?: typeof fetch;
};

export class CloudflareSfuClient {
  #baseUrl: string;
  #sessionToken: string | null;
  #tokenProvider: () => Promise<string | null>;
  #roomId: string;
  #fetch: typeof fetch;

  constructor(options: SfuClientOptions) {
    this.#baseUrl = (options.baseUrl ?? CALL_SIGNALING_BASE).replace(/\/+$/, "");
    this.#sessionToken = options.sessionToken ?? readSessionToken();
    this.#tokenProvider = options.sessionTokenProvider ?? (async () => {
      /* جلسة المكالمة الجماعية قد تطول أكثر من عمر الرمز (٣ ساعات): نطلب رمزًا
         صالحًا عند كل عملية SFU بدل تثبيت رمز واحد حتى انتهائه. */
      const renewed = await ensureSessionToken();
      return renewed ?? cachedSessionToken() ?? this.#sessionToken;
    });
    this.#roomId = options.roomId;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async #currentToken(): Promise<string> {
    try {
      const fresh = await this.#tokenProvider();
      if (fresh) this.#sessionToken = fresh;
    } catch { /* يُستمر بالرمز الحالي ما دام موجودًا */ }
    return this.#sessionToken ?? cachedSessionToken() ?? "";
  }

  async #send(token: string, path: string, method: string, body: unknown, sfuSession?: string): Promise<Response> {
    return this.#fetch(`${this.#baseUrl}/api/calls${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(sfuSession ? { "X-Sfu-Session": sfuSession } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify({ ...(body as Record<string, unknown>), roomId: this.#roomId }),
      cache: "no-store",
    });
  }

  async #request<T>(path: string, { method, body, sfuSession }: RequestOptions): Promise<T> {
    if (!this.#baseUrl) throw new SfuError("SFU_NOT_CONFIGURED");
    let token = await this.#currentToken();
    if (!token) throw new SfuError("AUTH_REQUIRED");
    let response = await this.#send(token, path, method, body, sfuSession);
    if (response.status === 401) {
      /* الرمز انتهى أثناء المكالمة: تجديد آمن ثم إعادة المحاولة مرة واحدة. */
      const renewed = await ensureSessionToken({ force: true }).catch(() => null);
      if (renewed && renewed !== token) {
        token = renewed;
        this.#sessionToken = renewed;
        response = await this.#send(token, path, method, body, sfuSession);
      }
    }
    if (response.status === 401) throw new SfuError("AUTH_REQUIRED", 401);
    if (response.status === 403) throw new SfuError("NOT_A_PARTICIPANT", 403);
    if (response.status === 409) throw new SfuError("ROOM_FULL", 409);
    if (response.status === 503) throw new SfuError("SFU_NOT_CONFIGURED", 503);
    if (!response.ok) throw new SfuError("SFU_UNAVAILABLE", response.status);
    return (await response.json()) as T;
  }

  /** يفتح جلسة SFU فارغة؛ تُضاف المسارات بعدها مع عرض المتصفح. */
  async newSession(): Promise<{ session: SfuSessionHandle; answer?: RTCSessionDescriptionInit }> {
    const body = await this.#request<{ sessionId: string; sessionToken: string; sessionDescription?: RTCSessionDescriptionInit }>(
      "/session/new",
      { method: "POST", body: {} },
    );
    return { session: { sessionId: body.sessionId, token: body.sessionToken }, answer: body.sessionDescription };
  }

  /** يضيف مسارات (نشر محلي أو سحب بعيد) ويعيد ردّ SFU كما هو. */
  addTracks(
    session: SfuSessionHandle,
    tracks: SfuTrackRequest[],
    sessionDescription?: RTCSessionDescriptionInit,
  ): Promise<SfuTracksResponse> {
    return this.#request<SfuTracksResponse>("/session/tracks/new", {
      method: "POST",
      sfuSession: session.token,
      body: { sessionId: session.sessionId, tracks, sessionDescription },
    });
  }

  renegotiate(session: SfuSessionHandle, answer: RTCSessionDescriptionInit): Promise<unknown> {
    return this.#request("/session/renegotiate", {
      method: "PUT",
      sfuSession: session.token,
      body: { sessionId: session.sessionId, sessionDescription: answer },
    });
  }

  closeTracks(session: SfuSessionHandle, mids: string[]): Promise<unknown> {
    return this.#request("/session/tracks/close", {
      method: "PUT",
      sfuSession: session.token,
      body: { sessionId: session.sessionId, tracks: mids.map((mid) => ({ mid })) },
    });
  }
}

/** اسم نشر ثابت يسهل على الآخرين معرفة صاحب المسار ونوعه. */
export function sfuTrackName(userId: string, kind: "audio" | "video"): string {
  const safe = userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "user";
  return `${safe}.${kind}`;
}

export function parseSfuTrackName(trackName: string): { userId: string; kind: "audio" | "video" } | null {
  const match = /^(.+)\.(audio|video)$/.exec(trackName);
  if (!match) return null;
  return { userId: match[1], kind: match[2] as "audio" | "video" };
}

/** هل يتسع لانضمام مشارك جديد؟ (المضيف نفسه لا يُحسب مرتين). */
export function canJoinGroup(participants: string[], selfId: string, max = CALL_MAX_PARTICIPANTS): boolean {
  const unique = new Set(participants);
  unique.add(selfId);
  return unique.size <= max;
}
