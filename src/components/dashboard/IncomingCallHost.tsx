import { useEffect, useRef, useState } from "react";
import { loadAccounts, type Account } from "../../lib/auth";
import { loadChats, sendChatMessage } from "../../lib/appStore";
import { callServer } from "../../lib/call";
import { watchIncomingCalls, expiryOf, type IncomingCall } from "../../lib/callInbox";
import CallOverlay from "./CallOverlay";

/** رقم المكالمة من رابط إشعار FCM (`/messages?incoming=<callId>`). */
function callIdFromUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return String(parsed.searchParams.get("incoming") ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * مستقبِل المكالمات الوارد على مستوى التطبيق كله.
 *
 * كان الاستماع للدعوة داخل صفحات المحادثات فقط، فمن لم يكن واقفًا عليها لم
 * يرَ المكالمة إطلاقًا. هذا المكوّن يُركّب في الجذر ويبقى مستمعًا في كل شاشة،
 * ويسأل الخادم عن أي مكالمة رنين قائمة كنسخة احتياطية للدعوة الفورية.
 */
export default function IncomingCallHost({ account }: { account: Account }) {
  const [call, setCall] = useState<IncomingCall | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const activeRef = useRef(false);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const presentRef = useRef<(invite: IncomingCall) => void>(() => undefined);

  presentRef.current = (invite) => {
    if (!invite.callId || invite.from === account.id) return;
    if (invite.expiresAt <= Date.now()) return;
    if (seenRef.current.has(invite.callId)) return;
    // مكالمة واحدة في كل مرة: لا نفتح شاشة ثانية فوق مكالمة قائمة.
    if (activeRef.current) return;
    seenRef.current.add(invite.callId);
    const name = invite.fromName
      || loadAccounts().find((item) => item.id === invite.from)?.fullName
      || "مستخدم";
    conversationIdRef.current = loadChats().find(
      (item) => item.memberIds.includes(account.id) && item.memberIds.includes(invite.from),
    )?.id;
    activeRef.current = true;
    setCall({ ...invite, fromName: name });
  };

  useEffect(() => {
    activeRef.current = call !== null;
  }, [call]);

  useEffect(() => {
    const stop = watchIncomingCalls(account.id, (invite) => presentRef.current(invite));
    return stop;
  }, [account.id]);

  /*
   * الضغط على إشعار المكالمة الواردة (التطبيق مغلق أو في الخلفية):
   * الإشعار يفتح `/messages?incoming=<callId>`، فنجلب المكالمة من الخادم
   * ونعرض شاشة الرد فورًا بدل انتظار دورة الاستعلام الدورية.
   */
  useEffect(() => {
    let disposed = false;
    const openById = async (callId: string) => {
      if (!callId) return;
      const result = await callServer("pending", { callerId: account.id });
      if (disposed || !result?.call?.callId) return;
      if (String(result.call.callId) !== callId) return;
      presentRef.current({
        callId,
        from: String(result.call.from ?? ""),
        fromName: String(result.call.fromName ?? ""),
        mode: result.call.mode === "video" ? "video" : "audio",
        expiresAt: expiryOf(result.call.expiresAt),
      });
    };
    const onPushOpen = (event: Event) => {
      const url = String((event as CustomEvent)?.detail?.url ?? "");
      void openById(callIdFromUrl(url));
    };
    window.addEventListener("thimar:push-open", onPushOpen);
    try {
      const initial = new URLSearchParams(window.location.search).get("incoming") ?? "";
      if (initial) void openById(initial.trim());
    } catch {
      /* ignore */
    }
    return () => {
      disposed = true;
      window.removeEventListener("thimar:push-open", onPushOpen);
    };
  }, [account.id]);

  /* الرنين ينتهي بانتهاء صلاحية المكالمة في قاعدة البيانات. */
  useEffect(() => {
    if (!call) return;
    const remaining = Math.max(1_000, call.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      void callServer("missed", { callId: call.callId, reason: "ring_timeout" });
      setCall(null);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [call]);

  if (!call) return null;

  return (
    <CallOverlay
      key={call.callId}
      selfId={account.id}
      selfName={account.fullName}
      peerId={call.from}
      peerName={call.fromName}
      mode={call.mode}
      conversationId={conversationIdRef.current}
      incoming={{ callId: call.callId, fromName: call.fromName }}
      onClose={() => setCall(null)}
      onLog={(text) => {
        try {
          if (conversationIdRef.current) {
            sendChatMessage(conversationIdRef.current, { senderId: account.id, kind: "call", text });
          }
        } catch { /* ignore */ }
      }}
    />
  );
}
