import { cloud, SUPABASE_URL, SUPABASE_ANON_KEY } from "./cloud";
import { CALL_SIGNALING_BASE, CALL_TURN_BASE } from "./callConfig";
import { RoomSignaling, readSessionToken, type CallSignalingHandle } from "./callSignaling";
import type { CallMode, CallSignal, CallSignalHandler, SignalingState } from "./callTypes";

/**
 * إشارات مكالمات ثمار (صوت وفيديو).
 *
 * - `openCallSignaling` يختار ناقل الإشارات: WebSocket على عامل Cloudflare
 *   عند تهيئة `VITE_CALL_WORKER_URL` ووجود جلسة، وإلا Supabase Realtime.
 * - مرشحات ICE: STUN دائمًا، وTURN الاختياري من `/api/turn` أو دالة
 *   `thimar-turn` ببيانات اعتماد قصيرة الأجل.
 * - الوسائط لا تمر عبر قنوات الإشارات إطلاقًا.
 */

export type { CallMode, CallSignal } from "./callTypes";
export { CALL_ICE_TRANSPORT_POLICY } from "./callConfig";

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export type IceConfig = {
  iceServers: RTCIceServer[];
  relay: boolean;
  provider: string | null;
  notice?: "UNAVAILABLE" | "AUTH_REQUIRED";
};

/** يتحقّق أن المزوّد أعاد مرشح TURN صالحًا مع بيانات اعتماد. */
function hasTurnCredentials(servers: RTCIceServer[]): boolean {
  return servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    const hasTurnUrl = urls.some((url) => typeof url === "string" && /^turns?:/.test(url));
    return hasTurnUrl
      && typeof server.username === "string" && server.username.length > 0
      && typeof server.credential === "string" && server.credential.length > 0;
  });
}

type TurnCredentials = { servers: RTCIceServer[]; ttl: number; provider: string };

/** يجلب بيانات اعتماد TURN قصيرة الأجل من نقطة النهاية. */
async function fetchTurnCredentials(endpoint: string, token: string): Promise<TurnCredentials | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    const servers = Array.isArray(data?.iceServers) ? (data.iceServers as RTCIceServer[]) : [];
    if (!hasTurnCredentials(servers)) return null;
    const ttl = Number(data?.ttl);
    return {
      servers,
      ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : 300,
      provider: typeof data?.provider === "string" ? data.provider : "unknown",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let iceCache: { config: IceConfig; expiresAt: number } | null = null;
let iceRequest: Promise<IceConfig> | null = null;

/**
 * يرجع مرشحات ICE مع حالة الترحيل:
 * - `relay: true` عند توفّر TURN صالح (مزوّد + مدة صلاحية قصيرة).
 * - `relay: false` مع STUN فقط، و`notice` يوضّح السبب للواجهة.
 */
export async function getIceConfig(): Promise<IceConfig> {
  if (iceCache && iceCache.expiresAt > Date.now()) return iceCache.config;
  if (iceRequest) return iceRequest;

  const request = (async (): Promise<IceConfig> => {
    const token = readSessionToken();
    if (token) {
      const endpoints = [
        CALL_TURN_BASE ? `${CALL_TURN_BASE}/api/turn` : "",
        `${SUPABASE_URL}/functions/v1/thimar-turn`,
      ].filter(Boolean);
      for (const endpoint of endpoints) {
        const credentials = await fetchTurnCredentials(endpoint, token);
        if (!credentials) continue;
        const config: IceConfig = {
          iceServers: [...ICE_SERVERS, ...credentials.servers],
          relay: true,
          provider: credentials.provider,
        };
        // نُبقي هامشًا قبل انتهاء الصلاحية حتى لا تُستخدم اعتمادات منتهية.
        iceCache = { config, expiresAt: Date.now() + Math.max(60_000, credentials.ttl * 1000 - 60_000) };
        return config;
      }
    }
    const fallback: IceConfig = {
      iceServers: ICE_SERVERS,
      relay: false,
      provider: null,
      notice: token ? "UNAVAILABLE" : "AUTH_REQUIRED",
    };
    iceCache = { config: fallback, expiresAt: Date.now() + 60_000 };
    return fallback;
  })();

  iceRequest = request;
  try {
    return await request;
  } finally {
    iceRequest = null;
  }
}

/** واجهة مبسطة للمجموعات: المرشحات فقط دون تفاصيل حالة الترحيل. */
export async function getIceServers(): Promise<RTCIceServer[]> {
  const config = await getIceConfig();
  return config.iceServers;
}

export function subscribeChannel(channel: ReturnType<typeof createChannel>): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, 2500);
    try {
      channel.subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          finish();
        }
      });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

export function userChannelName(userId: string): string {
  return `thimar-inbox-${userId}`;
}

export function callChannelName(callId: string): string {
  return `thimar-call-${callId}`;
}

export function createChannel(name: string, selfId: string, onSignal: (signal: CallSignal) => void) {
  const channel = cloud.channel(name, { config: { broadcast: { self: false } } });
  channel.on("broadcast", { event: "signal" }, (message: unknown) => {
    const signal = (message as { payload?: CallSignal } | null)?.payload;
    if (signal && signal.from !== selfId) onSignal(signal);
  });
  return channel;
}

type RealtimeChannel = ReturnType<typeof createChannel>;

export async function sendSignal(channel: RealtimeChannel, signal: CallSignal): Promise<void> {
  try {
    await channel.send({ type: "broadcast", event: "signal", payload: signal });
  } catch {
    /* الشبكة انقطعت — ستُغلق المكالمة بالتاريخ الزمني للمستخدم. */
  }
}

export type CallTransportOptions = {
  onPresence?: (participants: string[]) => void;
  onState?: (state: SignalingState) => void;
};

/**
 * يفتح ناقل إشارات للغرفة: WebSocket على العامل عند توفّره، وإلا قناة
 * Supabase Realtime. الناقل يعيد الاتصال بنفسه؛ على المكوّن إعادة العرض فقط.
 */
export function openCallSignaling(
  roomId: string,
  selfId: string,
  onSignal: CallSignalHandler,
  options: CallTransportOptions = {},
): CallSignalingHandle {
  const token = readSessionToken();
  if (CALL_SIGNALING_BASE && token) {
    const bus = new RoomSignaling({
      roomId,
      selfId,
      token,
      onSignal,
      onPresence: options.onPresence,
      onState: options.onState,
    });
    void bus.connect();
    return {
      kind: "worker",
      send: (signal: CallSignal) => bus.send(signal),
      close: () => bus.close(),
    };
  }

  const channel = createChannel(callChannelName(roomId), selfId, onSignal);
  void subscribeChannel(channel);
  options.onState?.("connecting");
  return {
    kind: "supabase",
    send: (signal: CallSignal) => { void sendSignal(channel, signal); },
    close: () => {
      try { channel.unsubscribe(); } catch { /* ignore */ }
    },
  };
}

/** يجهّز الميكروفون والكاميرا مع تقليل الضوضاء والصدى. */
export async function getLocalStream(mode: CallMode): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("المتصفح لا يدعم المكالمات. افتح التطبيق في متصفح حديث.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: mode === "video" ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false,
  });
}

export async function callServer(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  try {
    const token = readSessionToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    };
    const response = await fetch(`${SUPABASE_URL}/functions/v1/thimar-calls`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, token: token ?? undefined, ...payload }),
    });
    return await response.json().catch(() => ({}));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

export function closeCall(pc: RTCPeerConnection | null, stream: MediaStream | null): void {
  try {
    stream?.getTracks().forEach((track) => track.stop());
  } catch { /* ignore */ }
  try {
    pc?.close();
  } catch { /* ignore */ }
}
