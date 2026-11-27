import React, { useEffect, useRef, useState } from "react";
import { useRecorder } from "../../lib/recorder";
import {
  loadAccounts,
  findAccountByUsername,
  type Account,
} from "../../lib/auth";
import {
  ensureChatSeeds,
  ensureDirectConversation,
  loadChats,
  sendChatMessage,
  deleteChatMessage,
  deleteConversation,
  createConversation,
  addConversationMember,
  removeConversationMember,
  setConversationAdmin,
  setConversationMuted,
  loadSubmissions,
  evaluateSubmission,
  markChatRead,
  unreadMessagesForConversation,
  type Conversation,
} from "../../lib/appStore";
import { uploadChatMedia, pullCloud } from "../../lib/cloud";
import { useMediaSrc } from "../../lib/mediaRef";
import { setActiveConversation } from "../../lib/nativePush";
import { aiChat, buildCompanionMessages, offlineCompanionReply } from "../../lib/ai";
import { callServer, type CallMode } from "../../lib/call";
import { ensureSessionToken } from "../../lib/sessionStore";
import { announceInvite } from "../../lib/callInbox";
import CallOverlay from "./CallOverlay";
import CallSimulator from "./CallSimulator";
import { Icon, EmptyState } from "./ui";

type AiTurn = { role: "user" | "assistant"; content: string; at: number };

const AI_CHAT_KEY = "thimar.ai.thread.v1";

export default function MessagesPage({
  account,
  initialConversationId,
}: {
  account: Account;
  /** محادثة مطلوبة من ضغط إشعار. */
  initialConversationId?: string;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId ?? null);
  const [text, setText] = useState("");
  const [lastRecording, setLastRecording] = useState<{ dataUrl: string; duration: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newMode, setNewMode] = useState<"direct" | "group" | "announce">("direct");
  const [announceTitle, setAnnounceTitle] = useState("");
  const [announceText, setAnnounceText] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newMembers, setNewMembers] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [addMemberName, setAddMemberName] = useState("");
  const [callMode, setCallMode] = useState<"audio" | "video" | null>(null);
  const [showCallSimulator, setShowCallSimulator] = useState(false);
  const [outgoingCallId, setOutgoingCallId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTurns, setAiTurns] = useState<AiTurn[]>(() => {
    try {
      const raw = localStorage.getItem(AI_CHAT_KEY);
      return raw ? (JSON.parse(raw) as AiTurn[]) : [];
    } catch {
      return [];
    }
  });
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewScore, setReviewScore] = useState(4);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const recorder = useRecorder();
  const stopAnnounceRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    stopAnnounceRef.current?.();
    stopAnnounceRef.current = null;
  }, []);

  const refresh = () => {
    ensureChatSeeds(account);
    const all = loadChats().filter((conversation) => conversation.memberIds.includes(account.id));
    setConversations(all);
  };

  useEffect(() => {
    try {
      localStorage.setItem(AI_CHAT_KEY, JSON.stringify(aiTurns.slice(-60)));
    } catch { /* ignore */ }
  }, [aiTurns]);

  /* فتح المحادثة المطلوبة من إشعار (أو من رابط داخلي). */
  useEffect(() => {
    if (!initialConversationId) return;
    if (!loadChats().some((conversation) =>
      conversation.id === initialConversationId && conversation.memberIds.includes(account.id),
    )) return;
    setAiOpen(false);
    setSelectedId(initialConversationId);
    refresh();
    void pullCloud().then(() => refresh());
  }, [initialConversationId, account.id]);

  /* استقبال المكالمات الواردة تم نقله إلى IncomingCallHost على مستوى التطبيق
     حتى يعمل في كل الشاشات، لا في هذه الصفحة وحدها. */

  const logCall = (conversationId: string, text: string) => {
    sendChatMessage(conversationId, { senderId: account.id, kind: "call", text });
    refresh();
  };

  const askAi = async () => {
    const question = aiInput.trim();
    if (!question || aiBusy) return;
    const history = aiTurns.map((turn) => ({ role: turn.role, content: turn.content }));
    setAiTurns((prev) => [...prev, { role: "user", content: question, at: Date.now() }]);
    setAiInput("");
    setAiBusy(true);
    try {
      const answer = await aiChat(buildCompanionMessages(account, history, question), {
        temperature: 0.5,
        maxTokens: 700,
      });
      setAiTurns((prev) => [...prev, { role: "assistant", content: answer, at: Date.now() }]);
    } catch {
      const fallback = offlineCompanionReply(question, account.type);
      setAiTurns((prev) => [
        ...prev,
        { role: "assistant", content: `${fallback}\n\n(تعذّر الوصول إلى الذكاء الاصطناعي الآن، هذا رد محلي مختصر.)`, at: Date.now() },
      ]);
    } finally {
      setAiBusy(false);
    }
  };

  const peerIdOf = (conversation: Conversation) =>
    conversation.memberIds.find((id) => id !== account.id) ?? "";

  /** بدء مكالمة حقيقية: نطلب من الخادم إنشاء سجل المكالمة (تفويض/مشغول)،
   *  ثم نرسل دعوة إلى قناة المستخدم الآخر ونفتح واجهة المكالمة. */
  /* أخطاء الهوية: callServer يجدّد الرمز تلقائيًا ويعيد المحاولة. لا نُطالب
     المستخدم بإعادة الدخول إلا إذا لم تكن هناك جلسة أصلًا على هذا الجهاز. */
  const SESSION_ERRORS = new Set(["SESSION_REQUIRED", "INVALID_SESSION", "AUTH_REQUIRED", "SESSION_EXPIRED", "SESSION_REVOKED"]);

  const startCall = async (mode: CallMode) => {
    if (!selected) return;
    if (callMode || outgoingCallId) return;
    const peer = peerIdOf(selected);
    if (!peer) {
      alert("لا يوجد مستخدم آخر في هذه المحادثة.");
      return;
    }
    const result = await callServer("create", { callerId: account.id, calleeId: peer, mode, timeoutSec: 45 });
    /* لا نُظهر «جارٍ الاتصال» إن لم يُنشأ سجل المكالمة فعلًا. */
    if (!result?.callId) {
      const error = result?.error ?? "CREATE_FAILED";
      console.warn("[call-diag] create failed", { error, peer, mode });
      if (error === "CALLEE_BUSY") alert("المستخدم مشغول في مكالمة أخرى.");
      else if (error === "CALLER_BUSY") alert("لديك مكالمة نشطة بالفعل.");
      else if (SESSION_ERRORS.has(String(error))) {
        const token = await ensureSessionToken();
        alert(token
          ? "تعذّر تجديد جلستك الأمنية الآن (غالبًا بسبب الشبكة). تحقّق من الاتصال ثم أعد المحاولة."
          : "لا توجد جلسة دخول على هذا الجهاز. سجّل الدخول لتتمكن من إجراء المكالمات.");
      }
      else if (error === "CALLEE_UNAVAILABLE") alert("لا يمكن الاتصال بهذا الحساب الآن.");
      else if (error === "RATE_LIMITED") alert("محاولات كثيرة سريعة. انتظر لحظات ثم أعد المحاولة.");
      else if (error === "TOO_MANY_REQUESTS_TO_USER") alert("تجاوزت عدد المحاولات المسموح لهذا الشخص. جرّب لاحقًا.");
      else alert(`تعذّر بدء المكالمة: ${error}`);
      return;
    }
    const callId = String(result.callId);
    console.info("[call-diag] call created", { callId, peer, mode, expiresAt: result.expiresAt });
    /* نكرر الدعوة حتى انتهاء الرنين لأن Realtime لا يحتفظ بالرسائل الفائتة. */
    stopAnnounceRef.current?.();
    stopAnnounceRef.current = announceInvite(peer, account.id, {
      callId,
      fromName: account.fullName,
      mode,
      expiresAt: result.expiresAt ? Date.parse(String(result.expiresAt)) : undefined,
    });
    setOutgoingCallId(callId);
    setCallMode(mode);
  };

  /** فتح محادثة الإدارة (المسؤول) — لا تظهر للمسؤول نفسه. */
  const openAdminChat = () => {
    const accountsNow = loadAccounts();
    const admin = accountsNow.find((item) => item.type === "admin");
    if (!admin) {
      alert("لم يتم العثور على حساب الإدارة بعد.");
      return;
    }
    if (admin.id === account.id) return;
    const existing = loadChats().find(
      (conversation) =>
        !conversation.isGroup &&
        conversation.memberIds.includes(account.id) &&
        conversation.memberIds.includes(admin.id),
    );
    const conversationId = existing ? existing.id : ensureDirectConversation(account, admin);
    refresh();
    if (conversationId) setSelectedId(conversationId);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  /* تحديث قائمة المحادثات (وشارات غير المقروء) عند مزامنة السحابة (رسائل جديدة). */
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("thimar:cloud", handler);
    return () => window.removeEventListener("thimar:cloud", handler);
  }, []);

  /* الرسائل الواردة: لا ننتظر دورة المزامنة العامة (20 ثانية). نسحب فور فتح
     صفحة الرسائل ثم كل بضع ثوانٍ ما دامت ظاهرة، فتظهر رسالة الطرف الآخر
     مباشرة بدل أن تبدو كأنها لم تُرسل. */
  useEffect(() => {
    let stopped = false;
    const sync = () => {
      if (stopped || document.visibilityState === "hidden") return;
      void pullCloud().then((changed) => {
        if (!stopped && changed) refresh();
      });
    };
    sync();
    const timer = window.setInterval(sync, 6000);
    const onVisible = () => sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  useEffect(() => {
    setActiveConversation(selectedId);
    try { (window as any).__thimarActiveConversation = selectedId; } catch { /* ignore */ }
  }, [selectedId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [selectedId, conversations]);

  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const accounts = loadAccounts();

  /* فتح المحادثة وعرض الرسائل يعلّمها مقروءة عند المرسل (✓✓). */
  useEffect(() => {
    if (!selectedId) return;
    markChatRead(selectedId, account.id);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.messages.length, account.id]);

  const mediaSrc = useMediaSrc();
  const nameOf = (id: string) => accounts.find((item) => item.id === id)?.fullName ?? "مستخدم";

  const conversationTitle = (conversation: Conversation) => {
    if (conversation.isGroup) return conversation.title;
    const other = conversation.memberIds.find((id) => id !== account.id);
    return other ? nameOf(other) : conversation.title;
  };

  const sendText = () => {
    if (!selected || !text.trim()) return;
    sendChatMessage(selected.id, { senderId: account.id, kind: "text", text: text.trim() });
    setText("");
    refresh();
  };

  /* الرسائل الصوتية والملفات تُرفع للسحابة أولًا لتصل للطرف الآخر على أي جهاز
     مع إمكانية سماعها وتحميلها وعرضها؛ وإن تعذّر الرفع تبقى محلية. */
  const sendAudio = async () => {
    if (!selected || !lastRecording) return;
    const conversationId = selected.id;
    const recording = lastRecording;
    setLastRecording(null);
    setUploading(true);
    const url = await uploadChatMedia(recording.dataUrl, `voice-${Date.now()}.webm`, conversationId);
    setUploading(false);
    sendChatMessage(conversationId, {
      senderId: account.id,
      kind: "audio",
      audioUrl: url ?? recording.dataUrl,
      duration: recording.duration,
      text: "رسالة صوتية",
    });
    refresh();
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const conversationId = selected?.id;
    if (!file || !conversationId) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) return;
      setUploading(true);
      const url = await uploadChatMedia(dataUrl, file.name, conversationId);
      setUploading(false);
      sendChatMessage(conversationId, {
        senderId: account.id,
        kind: "file",
        fileName: file.name,
        audioUrl: url ?? dataUrl,
        text: `ملف: ${file.name}`,
      });
      refresh();
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const createDirect = () => {
    const target = findAccountByUsername(newUsername);
    if (!target) {
      alert("لم يتم العثور على المستخدم.");
      return;
    }
    if (target.id === account.id) {
      alert("لا يمكنك مراسلة نفسك.");
      return;
    }
    const existing = loadChats().find(
      (conversation) =>
        !conversation.isGroup &&
        conversation.memberIds.includes(account.id) &&
        conversation.memberIds.includes(target.id),
    );
    if (existing) {
      setSelectedId(existing.id);
    } else {
      const created = createConversation(target.fullName, [target.id], account.id);
      setSelectedId(created.id);
    }
    setShowNew(false);
    setNewUsername("");
    refresh();
  };

  /** إعلان إداري: محادثة جماعية تضم كل الحسابات، ورسالتها تصل كإشعار فوري. */
  const sendAnnouncement = () => {
    if (account.type !== "admin") return;
    const body = announceText.trim();
    const title = announceTitle.trim() || "إعلان إداري";
    if (!body) {
      alert("اكتب نص الإعلان.");
      return;
    }
    const memberIds = loadAccounts()
      .filter((item) => item.id !== account.id)
      .map((item) => item.id);
    if (!memberIds.length) {
      alert("لا يوجد مستخدمون آخرون لإرسال الإعلان إليهم.");
      return;
    }
    const created = createConversation(`إعلان: ${title}`, memberIds, account.id);
    sendChatMessage(created.id, { senderId: account.id, kind: "text", text: `${title}\n\n${body}` });
    setSelectedId(created.id);
    setShowNew(false);
    setAnnounceTitle("");
    setAnnounceText("");
    refresh();
  };

  const createGroup = () => {
    const memberIds = newMembers
      .split(/[,،\s]+/)
      .map((name) => findAccountByUsername(name)?.id)
      .filter((id): id is string => Boolean(id));
    if (memberIds.length === 0) {
      alert("أضف أسماء المستخدمين مفصولة بفواصل أو مسافات.");
      return;
    }
    const created = createConversation(newTitle || "مجموعة جديدة", memberIds, account.id);
    setSelectedId(created.id);
    setShowNew(false);
    setNewTitle("");
    setNewMembers("");
    refresh();
  };

  const canManageGroup = Boolean(selected?.isGroup && selected.createdBy === account.id);

  const addMember = () => {
    if (!selected || !canManageGroup) return;
    const target = findAccountByUsername(addMemberName);
    if (!target) {
      alert("المستخدم غير موجود.");
      return;
    }
    addConversationMember(selected.id, target.id);
    setShowAddMember(false);
    setAddMemberName("");
    refresh();
  };

  const toggleAdmin = (memberId: string) => {
    if (!selected || !canManageGroup || memberId === selected.createdBy) return;
    setConversationAdmin(selected.id, memberId, !(selected.admins ?? [selected.createdBy]).includes(memberId));
    refresh();
  };

  const removeMember = (memberId: string) => {
    if (!selected || !canManageGroup || memberId === selected.createdBy) return;
    if (!confirm("إزالة هذا العضو من المجموعة؟")) return;
    removeConversationMember(selected.id, memberId);
    refresh();
  };

  const submissions = loadSubmissions().filter((submission) =>
    account.type === "teacher"
      ? submission.teacherId === account.id && submission.score === undefined
      : submission.studentId === account.id,
  );

  const submitReview = () => {
    if (!reviewId) return;
    evaluateSubmission(reviewId, reviewScore, reviewFeedback);
    setReviewId(null);
    setReviewFeedback("");
    refresh();
  };

  return (
    <div className="page messages-page">
      <div className={`chat-layout ${selected || aiOpen ? "chat-open" : "chat-closed"}`}>
        <aside className="chat-sidebar">
          <div className="chat-sidebar-head">
            <h3>الرسائل</h3>
            <button type="button" className="icon-button" onClick={() => setShowNew(true)} aria-label="محادثة جديدة">
              <Icon name="plus" size={18} />
            </button>
          </div>
          <div className="chat-pinned">
            <button
              type="button"
              className={`conversation-item pinned ${aiOpen ? "active" : ""}`}
              onClick={() => { setAiOpen(true); setSelectedId(null); }}
            >
              <div className="conversation-avatar ai">🤖</div>
              <div className="conversation-meta">
                <strong>مساعد ثمار الذكي</strong>
                <span>اسأل عن أي شيء: الحفظ، الخطط، الأذكار، التطبيق…</span>
              </div>
            </button>
            {account.type !== "admin" ? (
              <button type="button" className="conversation-item pinned" onClick={openAdminChat}>
                <div className="conversation-avatar admin">إ</div>
                <div className="conversation-meta">
                  <strong>إدارة ثمار (المسؤول)</strong>
                  <span>تواصل مباشر مع إدارة التطبيق</span>
                </div>
              </button>
            ) : null}
          </div>
          <div className="conversation-list">
            {conversations.length === 0 ? (
              <EmptyState title="لا توجد محادثات" body="ابدأ محادثة جديدة." />
            ) : (
              conversations.map((conversation) => {
                const last = conversation.messages[conversation.messages.length - 1];
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    className={`conversation-item ${!aiOpen && selectedId === conversation.id ? "active" : ""}`}
                    onClick={() => { setAiOpen(false); setSelectedId(conversation.id); }}
                  >
                    <div className="conversation-avatar" style={{ position: "relative" }}>
                      {conversation.isGroup ? "ج" : nameOf(conversation.memberIds.find((id) => id !== account.id) ?? "").charAt(0)}
                      {(() => {
                        const unread = unreadMessagesForConversation(conversation, account.id);
                        if (unread <= 0) return null;
                        return (
                          <span
                            aria-label={`${unread} رسائل غير مقروءة`}
                            style={{
                              position: "absolute",
                              top: -4,
                              insetInlineEnd: -4,
                              minWidth: 18,
                              height: 18,
                              padding: "0 5px",
                              borderRadius: 999,
                              background: "#dc2626",
                              color: "#fff",
                              fontSize: 11,
                              fontWeight: 800,
                              display: "grid",
                              placeItems: "center",
                              lineHeight: 1,
                              boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                            }}
                          >
                            {unread > 99 ? "99+" : unread}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="conversation-meta">
                      <strong>{conversationTitle(conversation)}</strong>
                      <span>{last ? (last.kind === "audio" ? "🎤 رسالة صوتية" : last.text) : "لا رسائل"}</span>
                    </div>
                    {conversation.isGroup ? <Icon name="group" size={14} /> : null}
                  </button>
                );
              })
            )}
          </div>

          {account.type === "teacher" && submissions.length > 0 ? (
            <div className="pending-submissions">
              <h4>تسميعات بانتظار التصحيح</h4>
              {submissions.slice(0, 6).map((submission) => {
                const student = accounts.find((item) => item.id === submission.studentId);
                return (
                  <button
                    key={submission.id}
                    type="button"
                    className="submission-chip"
                    onClick={() => setReviewId(submission.id)}
                  >
                    <span>{student?.fullName ?? "طالب"}</span>
                    <span>★ {submission.score ?? "—"}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </aside>

        <section className="chat-thread">
          {aiOpen ? (
            <>
              <header className="thread-head">
                <div>
                  <strong>مساعد ثمار الذكي</strong>
                  <span>لا يشارك أسرار المنصة ولا بيانات المستخدمين</span>
                </div>
                <div className="thread-actions">
                  <button type="button" className="icon-button chat-back" onClick={() => setAiOpen(false)} aria-label="إغلاق المحادثة">
                    ×
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => { if (confirm("مسح محادثة المساعد؟")) setAiTurns([]); }}
                    aria-label="مسح المحادثة"
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              </header>
              <div className="thread-messages" ref={listRef}>
                {aiTurns.length === 0 ? (
                  <div className="ai-chat-intro">
                    <p>السلام عليكم {account.fullName}، أنا مساعد ثمار. اسألني عن خطة حفظ، معنى آية، أو كيفية استخدام ميزة في التطبيق.</p>
                  </div>
                ) : null}
                {aiTurns.map((turn, index) => (
                  <div key={`${turn.at}-${index}`} className={`message ${turn.role === "user" ? "mine" : "theirs"} text`}>
                    <p style={{ whiteSpace: "pre-wrap" }}>{turn.content}</p>
                    <span className="message-time">
                      {new Date(turn.at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
                {aiBusy ? <div className="message theirs text"><p>… يفكّر</p></div> : null}
              </div>
              <div className="composer">
                <input
                  className="composer-input"
                  value={aiInput}
                  onChange={(event) => setAiInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void askAi();
                    }
                  }}
                  placeholder="اكتب سؤالك للمساعد الذكي…"
                />
                <button type="button" className="send-button" onClick={() => void askAi()} aria-label="إرسال" disabled={aiBusy}>
                  <Icon name="send" size={18} />
                </button>
              </div>
            </>
          ) : selected ? (
            <>
              <header className="thread-head">
                <div>
                  <strong>{conversationTitle(selected)}</strong>
                  <span>{selected.memberIds.length} أعضاء</span>
                </div>
                <div className="thread-actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => {
                      if (!confirm(`حذف محادثة «${conversationTitle(selected)}» وكل رسائلها نهائيًا؟`)) return;
                      deleteConversation(selected.id);
                      setSelectedId(null);
                      refresh();
                    }}
                    aria-label="حذف المحادثة"
                    title="حذف المحادثة"
                  >
                    <Icon name="trash" size={18} />
                  </button>
                  <button type="button" className="icon-button chat-back" onClick={() => setSelectedId(null)} aria-label="إغلاق المحادثة">
                    ×
                  </button>
                  {selected ? (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => {
                        const muted = (selected.mutedBy ?? []).includes(account.id);
                        setConversationMuted(selected.id, account.id, !muted);
                        refresh();
                      }}
                      aria-label="كتم الإشعارات"
                      title={(selected.mutedBy ?? []).includes(account.id) ? "إلغاء كتم الإشعارات" : "كتم الإشعارات"}
                    >
                      {(selected.mutedBy ?? []).includes(account.id) ? "🔕" : "🔔"}
                    </button>
                  ) : null}
                  {selected.isGroup ? (
                    <button type="button" className="icon-button" onClick={() => setShowMembers((value) => !value)} aria-label="أعضاء المجموعة">
                      <Icon name="group" size={18} />
                    </button>
                  ) : null}
                  {canManageGroup ? (
                    <button type="button" className="icon-button" onClick={() => setShowAddMember(true)} aria-label="إضافة عضو">
                      <Icon name="plus" size={18} />
                    </button>
                  ) : null}
                  <button type="button" className="icon-button" onClick={() => startCall("audio")} aria-label="مكالمة صوتية">
                    <Icon name="phone" size={18} />
                  </button>
                  <button type="button" className="icon-button" onClick={() => startCall("video")} aria-label="مكالمة فيديو">
                    <Icon name="video" size={18} />
                  </button>
                  {account.type === "admin" ? (
                    <button type="button" className="icon-button call-simulator-launch" onClick={() => setShowCallSimulator(true)} aria-label="فتح محاكي المكالمات" title="محاكي المكالمات">
                      <Icon name="sparkles" size={18} />
                    </button>
                  ) : null}
                </div>
              </header>

              {showMembers && selected.isGroup ? (
                <div className="group-members-panel">
                  <div className="group-members-head">
                    <strong>أعضاء المجموعة ({selected.memberIds.length})</strong>
                    <span className="muted">المنشئ: {nameOf(selected.createdBy)}</span>
                  </div>
                  {selected.memberIds.map((memberId) => {
                    const member = accounts.find((item) => item.id === memberId);
                    const isCreator = memberId === selected.createdBy;
                    const isAdmin = (selected.admins ?? [selected.createdBy]).includes(memberId);
                    return (
                      <div key={memberId} className="group-member-row">
                        <div className="group-member-name">
                          <span className="member-avatar">{member?.fullName.charAt(0) ?? "؟"}</span>
                          <div>
                            <strong>{member?.fullName ?? "مستخدم"}</strong>
                            <span className="muted">{isCreator ? "منشئ المجموعة" : isAdmin ? "مشرف" : "عضو"}</span>
                          </div>
                        </div>
                        {canManageGroup && !isCreator ? (
                          <div className="group-member-actions">
                            <button type="button" className="ghost-button mini" onClick={() => toggleAdmin(memberId)}>
                              {isAdmin ? "إلغاء الإشراف" : "جعله مشرفًا"}
                            </button>
                            <button type="button" className="danger-button mini" onClick={() => removeMember(memberId)}>إزالة</button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="thread-messages" ref={listRef}>
                {selected.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`message ${message.senderId === account.id ? "mine" : "theirs"} ${message.kind}`}
                  >
                    {selected.isGroup && message.senderId !== account.id ? (
                      <span className="message-sender">{nameOf(message.senderId)}</span>
                    ) : null}
                    {message.kind === "text" ? <p>{message.text}</p> : null}
                    {message.kind === "audio" ? (
                      <div className="audio-message">
                        <Icon name="mic" size={16} />
                        {mediaSrc(message.audioUrl) ? <audio controls src={mediaSrc(message.audioUrl)} preload="none" /> : null}
                        {message.duration ? <span>{message.duration}ث</span> : null}
                        {message.audioUrl ? (
                          <a className="media-link" href={mediaSrc(message.audioUrl)} download={`رسالة-صوتية-${message.id}.webm`}>
                            تحميل
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                    {message.kind === "file" ? (
                      <div className="file-message">
                        {(message.audioUrl && mediaSrc(message.audioUrl)) && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(message.fileName ?? "") ? (
                          <a className="file-message-thumb" href={mediaSrc(message.audioUrl)} target="_blank" rel="noreferrer">
                            <img src={mediaSrc(message.audioUrl)} alt={message.fileName ?? "ملف"} />
                          </a>
                        ) : (
                          <Icon name="file" size={16} />
                        )}
                        <span>{message.fileName}</span>
                        {message.audioUrl ? (
                          <>
                            {/\.(png|jpe?g|gif|webp|bmp|svg|pdf|txt)$/i.test(message.fileName ?? "") ? (
                              <a className="media-link" href={mediaSrc(message.audioUrl)} target="_blank" rel="noreferrer">
                                عرض
                              </a>
                            ) : null}
                            <a className="media-link" href={mediaSrc(message.audioUrl)} download={message.fileName}>
                              تحميل
                            </a>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {message.kind === "system" ? <p className="system-message">{message.text}</p> : null}
                    {message.kind === "call" ? <p className="system-message">📞 {message.text}</p> : null}
                    <span className="message-time">
                      {new Date(message.createdAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {message.senderId === account.id ? (
                      <span
                        className={`message-receipt${
                          selected.memberIds
                            .filter((memberId) => memberId !== account.id)
                            .every((memberId) => (message.readBy ?? []).includes(memberId))
                            ? " read"
                            : ""
                        }`}
                        aria-label={
                          selected.memberIds
                            .filter((memberId) => memberId !== account.id)
                            .every((memberId) => (message.readBy ?? []).includes(memberId))
                            ? "تمت المشاهدة"
                            : "أُرسلت"
                        }
                      >
                        {selected.memberIds
                          .filter((memberId) => memberId !== account.id)
                          .every((memberId) => (message.readBy ?? []).includes(memberId))
                          ? "✓✓"
                          : "✓"}
                      </span>
                    ) : null}
                    {message.senderId === account.id ? (
                      <button
                        type="button"
                        className="message-delete"
                        aria-label="حذف الرسالة"
                        title="حذف الرسالة من الجهاز ومن السيرفر"
                        onClick={() => {
                          deleteChatMessage(selected.id, message.id);
                          refresh();
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="composer">
                {uploading ? <p className="recorder-error">جارٍ إرسال الملف…</p> : null}
                {recorder.error ? <p className="recorder-error">{recorder.error}</p> : null}
                {recorder.recording ? (
                  <div className="recording-bar">
                    <span className="recording-dot" />
                    <span>جارٍ التسجيل… {recorder.seconds}ث</span>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={async () => {
                        const result = await recorder.stop();
                        if (result) setLastRecording(result);
                      }}
                    >
                      إيقاف
                    </button>
                  </div>
                ) : lastRecording ? (
                  <div className="recording-bar">
                    <audio controls src={lastRecording.dataUrl} />
                    <button type="button" className="primary-button" onClick={() => void sendAudio()}>
                      إرسال
                    </button>
                    <button type="button" className="ghost-button" onClick={() => setLastRecording(null)}>
                      إلغاء
                    </button>
                  </div>
                ) : (
                  <>
                    <button type="button" className="icon-button" onClick={recorder.start} aria-label="تسجيل صوتي">
                      <Icon name="mic" size={18} />
                    </button>
                    <button type="button" className="icon-button" onClick={() => fileInputRef.current?.click()} aria-label="إرسال ملف">
                      <Icon name="file" size={18} />
                    </button>
                    <input ref={fileInputRef} type="file" hidden onChange={handleFile} />
                    <input
                      className="composer-input"
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          sendText();
                        }
                      }}
                      placeholder="اكتب رسالة..."
                    />
                    <button type="button" className="send-button" onClick={sendText} aria-label="إرسال">
                      <Icon name="send" size={18} />
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <EmptyState title="اختر محادثة" body="أو ابدأ محادثة جديدة." />
          )}
        </section>
      </div>

      {showNew ? (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>محادثة جديدة</h3>
            <div className="tab-row">
              <button type="button" className={`tab ${newMode === "direct" ? "active" : ""}`} onClick={() => setNewMode("direct")}>
                فردية
              </button>
              <button type="button" className={`tab ${newMode === "group" ? "active" : ""}`} onClick={() => setNewMode("group")}>
                مجموعة
              </button>
              {account.type === "admin" ? (
                <button type="button" className={`tab ${newMode === "announce" ? "active" : ""}`} onClick={() => setNewMode("announce")}>
                  إعلان
                </button>
              ) : null}
            </div>
            {newMode === "announce" ? (
              <>
                <label>
                  <span>عنوان الإعلان</span>
                  <input value={announceTitle} onChange={(event) => setAnnounceTitle(event.target.value)} placeholder="اختبار الأسبوع القادم" />
                </label>
                <label>
                  <span>نص الإعلان</span>
                  <textarea value={announceText} onChange={(event) => setAnnounceText(event.target.value)} rows={4} />
                </label>
                <p className="thread-hint">يُرسل إلى جميع الحسابات ويصل كإشعار على أجهزتهم.</p>
                <button type="button" className="primary-button" onClick={sendAnnouncement}>
                  إرسال الإعلان
                </button>
              </>
            ) : newMode === "direct" ? (
              <>
                <label>
                  <span>اسم المستخدم</span>
                  <input value={newUsername} onChange={(event) => setNewUsername(event.target.value)} placeholder="student" />
                </label>
                <button type="button" className="primary-button" onClick={createDirect}>
                  بدء
                </button>
              </>
            ) : (
              <>
                <label>
                  <span>اسم المجموعة</span>
                  <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
                </label>
                <label>
                  <span>أسماء المستخدمين للأعضاء (مفصولة بفواصل)</span>
                  <input value={newMembers} onChange={(event) => setNewMembers(event.target.value)} placeholder="student, sara, guardian" />
                </label>
                <button type="button" className="primary-button" onClick={createGroup}>
                  إنشاء
                </button>
              </>
            )}
            <button type="button" className="ghost-button" onClick={() => setShowNew(false)}>
              إلغاء
            </button>
          </div>
        </div>
      ) : null}

      {showAddMember ? (
        <div className="modal-backdrop" onClick={() => setShowAddMember(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>إضافة عضو</h3>
            <label>
              <span>اسم المستخدم</span>
              <input value={addMemberName} onChange={(event) => setAddMemberName(event.target.value)} />
            </label>
            <button type="button" className="primary-button" onClick={addMember}>
              إضافة
            </button>
            <button type="button" className="ghost-button" onClick={() => setShowAddMember(false)}>
              إلغاء
            </button>
          </div>
        </div>
      ) : null}

      {callMode && selected ? (
        <CallOverlay
          selfId={account.id}
          selfName={account.fullName}
          peerId={peerIdOf(selected)}
          peerName={conversationTitle(selected)}
          mode={callMode}
          conversationId={selected.id}
          callId={outgoingCallId ?? undefined}
          onClose={() => {
            stopAnnounceRef.current?.();
            stopAnnounceRef.current = null;
            setCallMode(null);
            setOutgoingCallId(null);
            refresh();
          }}
          onLog={(text) => logCall(selected.id, text)}
        />
      ) : null}

      {showCallSimulator && account.type === "admin" ? (
        <CallSimulator onClose={() => setShowCallSimulator(false)} />
      ) : null}

      {reviewId ? (
        <div className="modal-backdrop" onClick={() => setReviewId(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>تصحيح التسميع</h3>
            <label>
              <span>التقييم (1–5)</span>
              <input
                type="range"
                min={1}
                max={5}
                value={reviewScore}
                onChange={(event) => setReviewScore(Number(event.target.value))}
              />
              <strong>{reviewScore} / 5</strong>
            </label>
            <label>
              <span>ملاحظات</span>
              <textarea
                value={reviewFeedback}
                onChange={(event) => setReviewFeedback(event.target.value)}
                placeholder="ملاحظات للمتعلم..."
              />
            </label>
            <button type="button" className="primary-button" onClick={submitReview}>
              حفظ التقييم
            </button>
            <button type="button" className="ghost-button" onClick={() => setReviewId(null)}>
              إلغاء
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
