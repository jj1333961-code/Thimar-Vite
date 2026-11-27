import {
  callServer,
  createChannel,
  sendSignal,
  subscribeChannel,
  userChannelName,
  type CallMode,
  type CallSignal,
} from "./call";

/**
 * صندوق المكالمات الواردة.
 *
 * المشكلة التي يحلها هذا الملف: رسالة `invite` كانت تُبثّ مرة واحدة على قناة
 * المستخدم من داخل شاشة المحادثات فقط، فإن لم يكن المستقبِل واقفًا على تلك
 * الشاشة في تلك اللحظة ضاعت الدعوة إلى الأبد (Realtime لا يحتفظ بالرسائل).
 *
 * الحل هنا من طبقتين دون تغيير البنية:
 * 1) مستمع دائم لقناة `thimar-inbox-<id>` يعمل في أي شاشة داخل التطبيق.
 * 2) استعلام `pending` من دالة `thimar-calls` (بصلاحية الخادم) كل بضع ثوانٍ
 *    لالتقاط أي مكالمة رنين قائمة في قاعدة البيانات، حتى لو ضاعت الدعوة.
 *
 * ولا يُبثّ رمز الجلسة ولا أي سر في الرسائل: الخادم يستنتج هوية الطرف من
 * رمز الجلسة الموقّع نفسه.
 */

export const RING_TIMEOUT_MS = 45_000;
const PENDING_POLL_MS = 4_000;
const INVITE_REPEAT_MS = 2_000;

export type IncomingCall = {
  callId: string;
  from: string;
  fromName: string;
  mode: CallMode;
  expiresAt: number;
};

function modeOf(value: unknown): CallMode {
  return value === "video" ? "video" : "audio";
}

/** يوّحد تاريخ الانتهاء: رقم أو نص ISO، وإلا المهلة الافتراضية. */
export function expiryOf(value: unknown, fallbackMs = RING_TIMEOUT_MS): number {
  const raw = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Date.parse(value)
      : NaN;
  if (Number.isFinite(raw) && (raw as number) > 0) return raw as number;
  return Date.now() + fallbackMs;
}

function inviteFromSignal(signal: CallSignal): IncomingCall | null {
  if (signal.kind !== "invite") return null;
  const callId = String(signal.callId ?? "").trim();
  if (!callId) return null;
  return {
    callId,
    from: String(signal.from ?? ""),
    fromName: String(signal.fromName ?? ""),
    mode: modeOf(signal.mode),
    expiresAt: expiryOf(signal.expiresAt),
  };
}

/**
 * يستمع للمكالمات الواردة طوال بقاء التطبيق مفتوحًا، ويعيد دالة لإيقافه.
 * لا يعرض شيئًا ولا يحتفظ بحالة: المستدعي هو من يقرر عرض شاشة المكالمة.
 */
export function watchIncomingCalls(
  selfId: string,
  onInvite: (call: IncomingCall) => void,
): () => void {
  let stopped = false;

  const channel = createChannel(userChannelName(selfId), selfId, (signal: CallSignal) => {
    const call = inviteFromSignal(signal);
    if (!call) return;
    console.info("[call-diag] invite received", { callId: call.callId, from: call.from, mode: call.mode });
    onInvite(call);
  });
  void subscribeChannel(channel);

  const pollPending = async () => {
    if (stopped) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const result = await callServer("pending", { callerId: selfId });
    if (stopped || !result?.call?.callId) return;
    const call: IncomingCall = {
      callId: String(result.call.callId),
      from: String(result.call.from ?? ""),
      fromName: String(result.call.fromName ?? ""),
      mode: modeOf(result.call.mode),
      expiresAt: expiryOf(result.call.expiresAt),
    };
    console.info("[call-diag] pending call", { callId: call.callId, from: call.from, expiresAt: call.expiresAt });
    onInvite(call);
  };

  void pollPending();
  const timer = window.setInterval(() => void pollPending(), PENDING_POLL_MS);

  const onWake = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void pollPending();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onWake);
  window.addEventListener("online", onWake);
  window.addEventListener("focus", onWake);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("online", onWake);
    window.removeEventListener("focus", onWake);
    try { channel.unsubscribe(); } catch { /* ignore */ }
  };
}

/**
 * يُبثّ دعوة المكالمة على قناة الطرف الآخر أكثر من مرة حتى ينتهي الرنين،
 * لأن Realtime لا يعيد إرسال ما فات قبل الاشتراك. يعيد دالة إيقاف.
 */
export function announceInvite(
  peerId: string,
  selfId: string,
  invite: { callId: string; fromName: string; mode: CallMode; expiresAt?: number },
): () => void {
  let stopped = false;
  let timer: number | null = null;
  const expiresAt = invite.expiresAt && invite.expiresAt > Date.now()
    ? invite.expiresAt
    : Date.now() + RING_TIMEOUT_MS;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    try { channel.unsubscribe(); } catch { /* ignore */ }
  };

  const channel = createChannel(userChannelName(peerId), selfId, () => undefined);
  void subscribeChannel(channel).then(() => {
    if (stopped) {
      try { channel.unsubscribe(); } catch { /* ignore */ }
      return;
    }
    const payload: CallSignal = {
      kind: "invite",
      from: selfId,
      fromName: invite.fromName,
      mode: invite.mode,
      callId: invite.callId,
      expiresAt,
    };
    let sends = 0;
    const send = () => {
      if (stopped) return;
      if (Date.now() > expiresAt) {
        stop();
        return;
      }
      void sendSignal(channel, payload);
      sends += 1;
      if (sends === 1) {
        console.info("[call-diag] invite broadcast", { callId: invite.callId, peerId, expiresAt });
      }
    };
    send();
    timer = window.setInterval(send, INVITE_REPEAT_MS);
  });

  return stop;
}
