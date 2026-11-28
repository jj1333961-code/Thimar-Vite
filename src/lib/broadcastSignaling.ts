import type { CallSignal, CallSignalHandler, SignalingState } from "./callTypes";

/**
 * ناقل إشارات مكالمة فوق Supabase Realtime Broadcast.
 *
 * هذا هو الناقل الفعلي في الإنتاج (البُنية لا تُهيّئ عامل إشارات WebSocket)،
 * وكان فيه عيبان يفسّران انقطاع المكالمات:
 *
 * 1) الإرسال قبل اكتمال الاشتراك كان يُهمَل بلا أثر: أول عرض SDP وأول طلب عرض
 *    يُرسلان مباشرة بعد `subscribe` غير المنتظر، فتضيع الرسالة ويبقى الطرفان
 *    في انتظار لا ينتهي.
 * 2) لا يوجد تمييز للرسائل المكرّرة ولا تعافٍ من سقوط القناة: إعادة المحاولة
 *    كانت تُنتج تفاوضًا مزدوجًا، والقناة الميتة تبقى ميتة.
 *
 * الحل: طابور إرسال لا يُفرَّغ إلا بعد SUBSCRIBED، ومُعرّف رسالة (msgId) لكل
 * إشارة مع إسقاط المكرّر عند الاستقبال، وحالة اتصال ظاهرة، وإعادة اشتراك
 * بتراجع أُسّي عند CHANNEL_ERROR/TIMED_OUT/CLOSED أو عند انتهاء مهلة الاشتراك.
 *
 * لا وسائط هنا إطلاقًا: SDP وICE والإشارات الصغيرة فقط.
 */

export type BroadcastChannelLike = {
  on: (type: string, filter: Record<string, unknown>, callback: (message: unknown) => void) => unknown;
  subscribe: (callback?: (status: string, error?: Error) => void) => unknown;
  send: (message: unknown) => Promise<unknown> | unknown;
  unsubscribe: () => unknown;
};

export type BroadcastSignalingOptions = {
  channelName: string;
  selfId: string;
  createChannel: (name: string) => BroadcastChannelLike;
  onSignal: CallSignalHandler;
  onState?: (state: SignalingState) => void;
  onPresence?: (participants: string[]) => void;
  now?: () => number;
  random?: () => number;
  subscribeTimeoutMs?: number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
};

const MAX_QUEUE = 200;
const SEEN_LIMIT = 512;
export const SUBSCRIBE_TIMEOUT_MS = 8_000;

/** تراجع أُسّي محدود: 1s, 2s, 4s … 15s مع اهتزاز ±20%. */
export function signalingBackoff(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(15_000, 1_000 * 2 ** Math.max(0, attempt));
  const jitter = base * 0.2 * (random() * 2 - 1);
  return Math.max(500, Math.round(base + jitter));
}

type Queued = { msgId: string; signal: CallSignal };

export class BroadcastSignaling {
  #options: BroadcastSignalingOptions;
  #channel: BroadcastChannelLike | null = null;
  #queue: Queued[] = [];
  #seen: string[] = [];
  #state: SignalingState = "connecting";
  #closed = false;
  #started = false;
  #attempt = 0;
  #sequence = 0;
  #retryHandle: unknown = null;
  #subscribeHandle: unknown = null;

  constructor(options: BroadcastSignalingOptions) {
    this.#options = options;
  }

  get state(): SignalingState {
    return this.#state;
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  #schedule(callback: () => void, delayMs: number): unknown {
    return (this.#options.schedule ?? ((fn, ms) => setTimeout(fn, ms)))(callback, delayMs);
  }

  #cancel(handle: unknown): void {
    if (handle === null || handle === undefined) return;
    (this.#options.cancel ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>)))(handle);
  }

  #setState(state: SignalingState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#options.onState?.(state);
  }

  connect(): void {
    if (this.#closed || this.#started) return;
    this.#started = true;
    this.#open();
  }

  #open(): void {
    if (this.#closed) return;
    this.#setState(this.#attempt > 0 ? "reconnecting" : "connecting");

    const channel = this.#options.createChannel(this.#options.channelName);
    this.#channel = channel;
    channel.on("broadcast", { event: "signal" }, (message) => this.#receive(message));

    channel.subscribe((status: string) => {
      if (this.#closed || this.#channel !== channel) return;
      if (status === "SUBSCRIBED") {
        this.#cancel(this.#subscribeHandle);
        this.#subscribeHandle = null;
        this.#attempt = 0;
        this.#setState("open");
        this.#flush();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        this.#drop(channel);
      }
    });

    /* لا نفترض أن الاشتراك سينجح: بلا هذه المهلة تبقى القناة "معلّقة" بلا نهاية. */
    this.#subscribeHandle = this.#schedule(() => {
      this.#subscribeHandle = null;
      if (this.#channel === channel && this.#state !== "open") this.#drop(channel);
    }, this.#options.subscribeTimeoutMs ?? SUBSCRIBE_TIMEOUT_MS);
  }

  #drop(channel: BroadcastChannelLike): void {
    if (this.#channel !== channel) return;
    this.#channel = null;
    this.#cancel(this.#subscribeHandle);
    this.#subscribeHandle = null;
    try {
      channel.unsubscribe();
    } catch {
      /* القناة قد تكون مغلقة أصلًا. */
    }
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (this.#closed || this.#retryHandle !== null) return;
    this.#setState("reconnecting");
    const delay = signalingBackoff(this.#attempt, this.#options.random);
    this.#attempt += 1;
    this.#retryHandle = this.#schedule(() => {
      this.#retryHandle = null;
      this.#open();
    }, delay);
  }

  #receive(message: unknown): void {
    if (this.#closed) return;
    const payload = (message as { payload?: CallSignal } | null)?.payload;
    if (!payload || typeof payload !== "object") return;
    const signal = payload as CallSignal & { msgId?: string };
    if (signal.from === this.#options.selfId) return;

    const msgId = typeof signal.msgId === "string" ? signal.msgId : "";
    if (msgId) {
      if (this.#seen.includes(msgId)) return;
      this.#seen.push(msgId);
      if (this.#seen.length > SEEN_LIMIT) this.#seen.shift();
    }
    this.#options.onSignal(signal);
  }

  #write(channel: BroadcastChannelLike, item: Queued): void {
    const frame = {
      type: "broadcast",
      event: "signal",
      payload: { ...item.signal, msgId: item.msgId },
    };
    try {
      const result = channel.send(frame) as Promise<{ status?: string; error?: unknown }> | undefined;
      if (result && typeof result.then === "function") {
        void result.then((response) => {
          /* Supabase يعيد "ok" عند القبول، و"error"/"timed out" عند الفشل. */
          if (response && typeof response === "object" && response.status && response.status !== "ok") {
            this.#requeue(item);
          }
        }).catch(() => this.#requeue(item));
      }
    } catch {
      this.#requeue(item);
    }
  }

  #requeue(item: Queued): void {
    if (this.#closed) return;
    if (this.#queue.some((queued) => queued.msgId === item.msgId)) return;
    this.#queue.push(item);
    if (this.#queue.length > MAX_QUEUE) this.#queue.shift();
    this.#scheduleReconnect();
  }

  #flush(): void {
    const channel = this.#channel;
    if (!channel || this.#state !== "open") return;
    const pending = this.#queue;
    this.#queue = [];
    for (const item of pending) this.#write(channel, item);
  }

  /** يرسل إشارة، أو يحتفظ بها حتى يكتمل الاشتراك/يعود الاتصال. */
  send(signal: CallSignal): void {
    if (this.#closed) return;
    this.#sequence += 1;
    const msgId = `${this.#options.selfId}-${this.#sequence}-${this.#now().toString(36)}`;
    const item: Queued = { msgId, signal };
    const channel = this.#channel;
    if (channel && this.#state === "open") {
      this.#write(channel, item);
      return;
    }
    this.#queue.push(item);
    if (this.#queue.length > MAX_QUEUE) this.#queue.shift();
    if (!channel) this.#scheduleReconnect();
  }

  close(): void {
    this.#closed = true;
    this.#setState("closed");
    this.#cancel(this.#retryHandle);
    this.#cancel(this.#subscribeHandle);
    this.#retryHandle = null;
    this.#subscribeHandle = null;
    this.#queue = [];
    const channel = this.#channel;
    this.#channel = null;
    try {
      channel?.unsubscribe();
    } catch {
      /* ignore */
    }
  }

  /** عدد الرسائل المنتظرة — للتشخيص والاختبارات. */
  get pending(): number {
    return this.#queue.length;
  }
}
