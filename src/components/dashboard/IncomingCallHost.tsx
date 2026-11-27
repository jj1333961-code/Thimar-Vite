import { useEffect, useRef, useState } from "react";
import { loadAccounts, type Account } from "../../lib/auth";
import { loadChats, sendChatMessage } from "../../lib/appStore";
import { callServer } from "../../lib/call";
import { watchIncomingCalls, type IncomingCall } from "../../lib/callInbox";
import CallOverlay from "./CallOverlay";

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

  useEffect(() => {
    activeRef.current = call !== null;
  }, [call]);

  useEffect(() => {
    const stop = watchIncomingCalls(account.id, (invite) => {
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
    });
    return stop;
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
