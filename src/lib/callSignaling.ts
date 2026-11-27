import { CALL_SIGNALING_BASE } from "./callConfig";
import { cachedSessionToken, ensureSessionToken, SESSION_TOKEN_KEY } from "./sessionStore";
import type { CallSignal, CallSignalHandler, SignalingState } from "./callTypes";

/**
 * ناقل إشارات المكالمة.
 *
 * الإشارات (SDP/ICE/الحضور) فقط تمر عبر WebSocket؛ الصوت والفيديو يمرّان
 * دائمًا عبر WebRTC (مباشر أو TURN أو SFU) ولا يُرسلان عبر WebSocket أبدًا.
 *
 * المزايا على قناة Supabase Realtime:
 * - إعادة اتصال تلقائية بتراجع أُسّي مع اهتزاز عشوائي.
 * - إعادة إرسال ما لم يُرسل بعد فتح الاتصال (طابور محدود).
 * - نبضات قلب تكشف الاتصال الميت وتسارع الاستئناف.
 * - بطاقة غرفة قصيرة العمر (ticket) ولا يُرسل رمز الجلسة في كل رسالة.
 */

export { SESSION_TOKEN_KEY };

export function readSessionToken(): string | null {
  /* يقرأ من المخزن الآمن (Keystore في أندرويد) مع تراجع للتخزين العادي. */
  return cachedSessionToken();
}

/** تراجع أُسّي محدود: 1s, 2s, 4s … 15s مع اهتزاز ±20%. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(15_000, 1_000 * 2 ** Math.max(0, attempt));
  const jitter = base * 0.2 * (random() * 2 - 1);
  return Math.max(500, Math.round(base + jitter));
}

export const HEARTBEAT_INTERVAL_MS = 20_000;
export const HEARTBEAT_TIMEOUT_MS = 45_000;
const MAX_QUEUE = 200;

export type RoomSignalingOptions = {
  roomId: string;
  selfId: string;
  token: string;
  onSignal: CallSignalHandler;
  onPresence?: (participants: string[]) => void;
  onState?: (state: SignalingState) => void;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  socketFactory?: (url: string) => WebSocket;
  now?: () => number;
  random?: () => number;
};

type QueuedSignal = { msgId: string; signal: CallSignal };

export class RoomSignaling {
  #options: RoomSignalingOptions;
  #baseUrl: string;
  #socket: WebSocket | null = null;
  #queue: QueuedSignal[] = [];
  #attempt = 0;
  #closed = false;
  #started = false;
  #state: SignalingState = "connecting";
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #lastPongAt = 0;
  #sequence = 0;
  #seen: string[] = [];

  constructor(options: RoomSignalingOptions) {
    this.#options = options;
    this.#baseUrl = (options.baseUrl ?? CALL_SIGNALING_BASE).replace(/\/+$/, "");
  }

  get state(): SignalingState {
    return this.#state;
  }

  #setState(state: SignalingState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#options.onState?.(state);
  }

  async connect(): Promise<void> {
    if (this.#closed || this.#started) return;
    this.#started = true;
    await this.#open();
  }

  async #open(): Promise<void> {
    if (this.#closed) return;
    this.#setState(this.#attempt > 0 ? "reconnecting" : "connecting");
    const fetchImpl = this.#options.fetchImpl ?? fetch;
    let ticket = "";
    let unauthorized = false;
    try {
      /* نطلب بطاقة الغرفة بأحدث رمز جلسة؛ التجديد يحدث هنا تلقائيًا
         بدل إغلاق الاتصال ومطالبة المستخدم بالخروج والدخول. */
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = attempt === 0
          ? (await ensureSessionToken()) ?? this.#options.token
          : (await ensureSessionToken({ force: true })) ?? cachedSessionToken() ?? "";
        if (this.#closed) return;
        const response = await fetchImpl(`${this.#baseUrl}/api/rooms/${encodeURIComponent(this.#options.roomId)}/token`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({}),
        });
        if (this.#closed) return;
        if (response.status === 401 || response.status === 403) {
          const renewed = await ensureSessionToken({ force: true });
          if (renewed && renewed !== token) continue;
          unauthorized = true;
          break;
        }
        if (!response.ok) throw new Error(`TICKET_${response.status}`);
        const body = (await response.json()) as { ticket?: string };
        ticket = String(body?.ticket ?? "");
        if (!ticket) throw new Error("TICKET_MISSING");
        break;
      }
      if (unauthorized) {
        this.#setState("closed");
        this.#closed = true;
        return;
      }
      if (!ticket) throw new Error("TICKET_MISSING");
    } catch {
      this.#scheduleReconnect();
      return;
    }

    const wsBase = this.#baseUrl.replace(/^http/i, "ws");
    const url = `${wsBase}/api/rooms/${encodeURIComponent(this.#options.roomId)}/ws?ticket=${encodeURIComponent(ticket)}`;
    let socket: WebSocket;
    try {
      socket = (this.#options.socketFactory ?? ((target: string) => new WebSocket(target)))(url);
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;

    socket.addEventListener("open", () => {
      if (this.#closed || this.#socket !== socket) return;
      this.#attempt = 0;
      this.#lastPongAt = this.#now();
      this.#setState("open");
      this.#flush();
      this.#startHeartbeat();
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      if (this.#closed || this.#socket !== socket) return;
      this.#lastPongAt = this.#now();
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (frame.type === "presence" || frame.type === "welcome") {
        const participants = Array.isArray(frame.participants)
          ? frame.participants.filter((value): value is string => typeof value === "string")
          : [];
        this.#options.onPresence?.(participants);
        return;
      }
      if (frame.type === "signal") {
        const signal = frame.payload as CallSignal | undefined;
        if (!signal || typeof signal !== "object") return;
        if (signal.from === this.#options.selfId) return;
        const msgId = typeof frame.msgId === "string" ? frame.msgId : "";
        if (msgId) {
          if (this.#seen.includes(msgId)) return;
          this.#seen.push(msgId);
          if (this.#seen.length > 512) this.#seen.shift();
        }
        this.#options.onSignal(signal);
      }
    });

    const drop = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#stopHeartbeat();
      this.#scheduleReconnect();
    };
    socket.addEventListener("close", drop);
    socket.addEventListener("error", () => {
      try {
        socket.close();
      } catch {
        drop();
      }
    });
  }

  #scheduleReconnect(): void {
    if (this.#closed || this.#reconnectTimer) return;
    this.#setState("reconnecting");
    const delay = backoffDelay(this.#attempt, this.#options.random);
    this.#attempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#open();
    }, delay);
  }

  #startHeartbeat(): void {
    this.#stopHeartbeat();
    this.#heartbeatTimer = setInterval(() => {
      const socket = this.#socket;
      if (!socket || socket.readyState !== 1) return;
      if (this.#now() - this.#lastPongAt > HEARTBEAT_TIMEOUT_MS) {
        // الاتصال يبدو ميتًا (شبكة متغيّرة) — إغلاقه يفتح مسار الاستئناف.
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        socket.send(JSON.stringify({ type: "ping" }));
      } catch {
        /* ignore */
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
  }

  #flush(): void {
    const socket = this.#socket;
    if (!socket || socket.readyState !== 1) return;
    const pending = this.#queue;
    this.#queue = [];
    for (const item of pending) this.#write(socket, item);
  }

  #write(socket: WebSocket, item: QueuedSignal): void {
    try {
      socket.send(JSON.stringify({ type: "signal", msgId: item.msgId, payload: item.signal }));
    } catch {
      this.#queue.push(item);
    }
  }

  /** يرسل إشارة، ويحتفظ بها في الطابور إن كان الاتصال مغلقًا مؤقتًا. */
  send(signal: CallSignal): void {
    if (this.#closed) return;
    this.#sequence += 1;
    const msgId = `${this.#options.selfId}-${this.#sequence}-${this.#now().toString(36)}`;
    const item: QueuedSignal = { msgId, signal };
    const socket = this.#socket;
    if (socket && socket.readyState === 1) {
      this.#write(socket, item);
      return;
    }
    this.#queue.push(item);
    if (this.#queue.length > MAX_QUEUE) this.#queue.shift();
  }

  close(): void {
    this.#closed = true;
    this.#setState("closed");
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#stopHeartbeat();
    this.#queue = [];
    const socket = this.#socket;
    this.#socket = null;
    try {
      socket?.close(1000, "call ended");
    } catch {
      /* ignore */
    }
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }
}

export type CallSignalingHandle = {
  kind?: "worker" | "supabase";
  send: (signal: CallSignal) => void;
  close: () => void;
};
