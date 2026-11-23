import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./cloud";
import { CALL_SESSION_KEY } from "./authRpc";

/**
 * Call signaling is relayed through the authenticated Edge Function.
 * The client never joins a public Realtime channel and never writes signaling
 * payloads directly to the database.
 */

export type CallMode = "audio" | "video";

export type CallSignal =
  | { kind: "invite"; from: string; fromName: string; mode: CallMode; callId: string }
  | { kind: "accept"; from: string; callId: string }
  | { kind: "decline"; from: string; callId: string }
  | { kind: "offer"; from: string; callId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; from: string; callId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; from: string; callId: string; candidate: RTCIceCandidateInit }
  | { kind: "hangup"; from: string; callId: string };

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
];

type SignalChannel = {
  send: (message: { type: string; event: string; payload: CallSignal }) => Promise<void>;
  subscribe: (callback?: (status: string) => void) => SignalChannel;
  unsubscribe: () => Promise<void>;
};

export function subscribeChannel(channel: SignalChannel): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    const timer = setTimeout(finish, 3000);
    try {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
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

type CallSession = { token: string; expiresAt: number; accountId: string };

function readCallSession(): CallSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(CALL_SESSION_KEY) || "null");
    if (
      typeof value?.token !== "string"
      || !/^[a-f0-9]{64}$/i.test(value.token)
      || typeof value?.accountId !== "string"
      || !value.accountId
      || Number(value.expiresAt) * 1000 <= Date.now()
    ) return null;
    return value as CallSession;
  } catch {
    return null;
  }
}

export async function callServer(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  try {
    const session = readCallSession();
    if (!session) return { error: "AUTH_REQUIRED" };
    const response = await fetch(`${SUPABASE_URL}/functions/v1/thimar-calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && !result?.error) return { error: `HTTP_${response.status}` };
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }
}

export function createChannel(
  name: string,
  selfId: string,
  onSignal: (signal: CallSignal) => void,
): SignalChannel {
  const isInbox = name.startsWith("thimar-inbox-");
  const inboxOwner = isInbox ? name.slice("thimar-inbox-".length) : "";
  const isOwnInbox = isInbox && inboxOwner === selfId;
  const callId = name.startsWith("thimar-call-") ? name.slice("thimar-call-".length) : "";
  let active = false;
  let polling = false;
  let lastId = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let statusCallback: ((status: string) => void) | undefined;

  const poll = async () => {
    if (!active || polling || (!isOwnInbox && !callId)) return;
    polling = true;
    try {
      const action = isOwnInbox ? "signal:poll-inbox" : "signal:poll";
      const result = await callServer(action, {
        callerId: selfId,
        ...(callId ? { callId } : {}),
        afterId: lastId,
      });
      if (result?.error) {
        if (["AUTH_REQUIRED", "INVALID_SESSION", "ACCOUNT_UNAVAILABLE"].includes(String(result.error))) {
          statusCallback?.("CHANNEL_ERROR");
          if (timer) clearInterval(timer);
          timer = null;
          active = false;
        }
        return;
      }
      const signals = Array.isArray(result?.signals) ? result.signals : [];
      for (const row of signals) {
        const id = Number(row?.id) || 0;
        if (id > lastId) lastId = id;
        const signal = row?.payload as CallSignal | undefined;
        if (signal && typeof signal === "object") onSignal(signal);
      }
      statusCallback?.("SUBSCRIBED");
    } finally {
      polling = false;
    }
  };

  const channel: SignalChannel = {
    send: async (message) => {
      if (message?.type !== "broadcast" || message?.event !== "signal") {
        throw new Error("UNSUPPORTED_SIGNAL_TRANSPORT");
      }
      const signal = message.payload;
      if (!signal?.callId || signal.from !== selfId) throw new Error("INVALID_SIGNAL");
      const result = await callServer("signal:send", {
        callerId: selfId,
        callId: signal.callId,
        signal,
      });
      if (result?.error) throw new Error(String(result.error));
    },
    subscribe: (callback) => {
      statusCallback = callback;
      active = true;
      if (isOwnInbox || callId) {
        void poll();
        if (!timer) timer = setInterval(() => void poll(), 900);
      } else {
        statusCallback?.("SUBSCRIBED");
      }
      return channel;
    },
    unsubscribe: async () => {
      active = false;
      if (timer) clearInterval(timer);
      timer = null;
      statusCallback = undefined;
    },
  };
  return channel;
}

export async function sendSignal(channel: SignalChannel, signal: CallSignal): Promise<void> {
  await channel.send({ type: "broadcast", event: "signal", payload: signal });
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

export async function getIceServers(): Promise<RTCIceServer[]> {
  try {
    const session = readCallSession();
    if (!session) throw new Error("AUTH_REQUIRED");
    const response = await fetch(`${SUPABASE_URL}/functions/v1/thimar-turn`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.token}`,
      },
      cache: "no-store",
    });
    if (!response.ok) return ICE_SERVERS;
    const data = await response.json();
    if (Array.isArray(data?.iceServers) && data.iceServers.length) {
      return data.iceServers as RTCIceServer[];
    }
    return ICE_SERVERS;
  } catch {
    return ICE_SERVERS;
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
