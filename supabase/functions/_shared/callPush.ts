/**
 * إشعار المكالمة الواردة على جهاز المستقبِل (FCM HTTP v1 عبر send-push).
 *
 * لماذا هنا وليس في العميل: التطبيق المغلق أو في الخلفية لا يملك اتصال
 * Realtime، فالدعوة المبثوثة على القناة تضيع ولا يعلم المستقبِل أن أحدًا
 * يتصل به. الخادم وحده يعرف لحظة إنشاء الرنين، فيُرسل الإشعار من هناك.
 *
 * قواعد الأمان والسلوك:
 * - لا يُرسل شيء بلا `THIMAR_PUSH_SECRET` (فشل مُغلق، لا إرسال مجهول).
 * - الإرسال أفضل-جهد: فشله لا يُفشل إنشاء المكالمة، لأن المستقبِل قد يكون
 *   فاتحًا للتطبيق ويستقبل الدعوة من قناة الإشارات أصلًا.
 * - الوسم ثابت لكل مكالمة (`call-<callId>`)، فيستبدل أندرويد إشعار نفس
 *   المكالمة بدل تكديس نسخ مكرّرة، وتُفصل المكالمات المختلفة عن بعضها.
 * - الرابط مسار داخلي فقط (`/messages?incoming=<id>`)؛ لا عنوان خارجي ولا
 *   بيانات حساسة في الإشعار.
 */

export type IncomingCallPushInput = {
  supabaseUrl: string;
  secret: string;
  calleeId: string;
  callId: string;
  callerName: string;
  mode: "audio" | "video";
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type IncomingCallPushResult =
  | { sent: true }
  | { sent: false; reason: "NO_SECRET" | "NO_URL" | "INVALID_INPUT" | "NETWORK" | "REJECTED" };

/** مسار داخلي يفتح شاشة المكالمة الواردة نفسها عند الضغط على الإشعار. */
export function incomingCallUrl(callId: string): string {
  return `/messages?incoming=${encodeURIComponent(String(callId ?? "").trim())}`;
}

/** وسم ثابت لكل مكالمة: إشعار واحد لكل رنين، وإشعارات المكالمات لا تتراكم. */
export function incomingCallTag(callId: string): string {
  return `call-${String(callId ?? "").trim()}`.slice(0, 80);
}

/** نص الإشعار حسب نوع المكالمة. */
export function incomingCallText(mode: "audio" | "video", callerName: string) {
  const name = String(callerName ?? "").trim().slice(0, 60);
  const title = mode === "video" ? "مكالمة فيديو واردة" : "مكالمة صوتية واردة";
  return { title, body: name ? `${name} يتصل بك الآن` : "يتصل بك الآن" };
}

/** يرسل إشعار الرنين إلى أجهزة المستقبِل المسجّلة في FCM. */
export async function notifyIncomingCall(input: IncomingCallPushInput): Promise<IncomingCallPushResult> {
  const supabaseUrl = String(input.supabaseUrl ?? "").trim().replace(/\/+$/, "");
  const secret = String(input.secret ?? "").trim();
  const calleeId = String(input.calleeId ?? "").trim();
  const callId = String(input.callId ?? "").trim();
  if (!secret) return { sent: false, reason: "NO_SECRET" };
  if (!supabaseUrl) return { sent: false, reason: "NO_URL" };
  if (!calleeId || !callId) return { sent: false, reason: "INVALID_INPUT" };

  const payload = {
    ...incomingCallText(input.mode, input.callerName),
    url: incomingCallUrl(callId),
    tag: incomingCallTag(callId),
    accountIds: [calleeId],
  };

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, input.timeoutMs ?? 3000));
  try {
    const response = await fetchImpl(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { sent: false, reason: "REJECTED" };
    return { sent: true };
  } catch {
    return { sent: false, reason: "NETWORK" };
  } finally {
    clearTimeout(timer);
  }
}
