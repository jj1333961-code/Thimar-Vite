import { cloud, SUPABASE_URL, SUPABASE_ANON_KEY } from "./cloud";
import type { CallMode, CallSignal } from "./callTypes";
export type { CallMode, CallSignal } from "./callTypes";

/**
 * إشارات مكالمات ثمار (صوت وفيديو) عبر Supabase Realtime.
 * تُستخدم قناة خاصة لكل مستخدم لاستقبال المكالمات الواردة،
 * وقناة لكل مكالمة لتتبادل فيها العروض والردود ومرشّحي ICE.
 */

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
  // TURN احتياطي (openrelay) — للاختبار/التطوير. للإنتاج استخدم خادم TURN مخصص
  // (Twilio/Metered/coturn) مع بيانات اعتماد قصيرة الأجل من Edge Function.
  {
    urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turns:openrelay.metered.ca:443"],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

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

/**
 * وسائط المكالمة تمر عبر خادم TURN فقط، فلا يُكشف عنوان IP للطرف الآخر
 * ولا يعتمد الاتصال على نجاح الاتصال المباشر بين الشبكتين.
 */
export const CALL_ICE_TRANSPORT_POLICY: RTCIceTransportPolicy = "relay";

let iceCache: { servers: RTCIceServer[]; expiresAt: number } | null = null;
let iceRequest: Promise<RTCIceServer[]> | null = null;

/** يجلب مرشحات TURN ويخزّنها مؤقتًا لتقليل زمن بدء المكالمة. */
export async function getIceServers(): Promise<RTCIceServer[]> {
  if (iceCache && iceCache.expiresAt > Date.now()) return iceCache.servers;
  if (iceRequest) return iceRequest;

  iceRequest = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/thimar-turn`, {
        method: "GET",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return ICE_SERVERS;
      const data = await response.json();
      const servers = Array.isArray(data?.iceServers) && data.iceServers.length
        ? (data.iceServers as RTCIceServer[])
        : ICE_SERVERS;
      iceCache = { servers, expiresAt: Date.now() + 10 * 60 * 1000 };
      return servers;
    } catch {
      return ICE_SERVERS;
    } finally {
      clearTimeout(timer);
    }
  })();

  try {
    return await iceRequest;
  } finally {
    iceRequest = null;
  }
}

function getSessionToken(): string | null {
  try { return localStorage.getItem("thimar_session_token"); } catch { return null; }
}

export async function callServer(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  try {
    const token = getSessionToken();
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
