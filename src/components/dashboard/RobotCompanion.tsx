import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Account } from "../../lib/auth";
import {
  aiChat,
  buildCompanionMessages,
  checkAiAvailability,
  offlineCompanionReply,
  type AiAvailability,
  type AiMessage,
} from "../../lib/ai";
import {
  getArabicVoice,
  hasSpeechRecognition,
  hasSpeechSynthesis,
  recognitionErrorMessage,
} from "../../lib/speech";
import { Icon } from "./ui";

type RecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type RecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
};

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognition(): (new () => RecognitionLike) | null {
  const scope = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function loadPosition() {
  try {
    const raw = localStorage.getItem("thimar.robot.pos.v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: number; y?: number };
    if (typeof parsed.x === "number" && typeof parsed.y === "number") return { x: parsed.x, y: parsed.y };
  } catch {
    // ignore
  }
  return null;
}

function RobotAvatar({
  speaking,
  listening,
  small,
}: {
  speaking: boolean;
  listening: boolean;
  small?: boolean;
}) {
  return (
    <div className={`robot-scene ${small ? "small" : ""} ${speaking ? "speaking" : ""} ${listening ? "listening" : ""}`}>
      <div className="robot-glow" />
      <div className="robot-3d">
        <div className="robot-antenna"><span /></div>
        <div className="robot-head">
          <div className="robot-face">
            <span className="robot-eye" />
            <span className="robot-eye" />
            <span className="robot-mouth" />
          </div>
          <span className="robot-ear left" />
          <span className="robot-ear right" />
        </div>
        <div className="robot-neck" />
        <div className="robot-body">
          <span className="robot-core" />
        </div>
        <span className="robot-arm left" />
        <span className="robot-arm right" />
      </div>
      <span className="robot-shadow" />
    </div>
  );
}

export default function RobotCompanion({
  account,
  onNavigate,
  visible,
  onHide,
}: {
  account: Account;
  onNavigate: (tab: string) => void;
  visible: boolean;
  onHide: () => void;
}) {
  const historyKey = `thimar.robot.${account.id}.v1`;
  const firstName = account.fullName.split(" ").slice(0, 2).join(" ");
  const greeting = `أهلًا ${firstName}! أنا رفيق ثمار، مساعدك داخل التطبيق. أستطيع شرح الصفحات، مساعدتك في التسميع وخطة الحفظ، أو الإجابة عن أسئلة القرآن والصلاة. اسحبني لتحريكي إلى أي مكان. كيف أساعدك؟`;

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AiMessage[]>(() => {
    try {
      const raw = localStorage.getItem(historyKey);
      if (raw) {
        const parsed = JSON.parse(raw) as AiMessage[];
        if (Array.isArray(parsed) && parsed.length) return parsed.slice(-20);
      }
    } catch {
      // ignore
    }
    return [{ role: "assistant", content: greeting }];
  });
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [ai, setAi] = useState<AiAvailability>({ mode: "off" });
  const [micError, setMicError] = useState("");
  const [ttsStatus, setTtsStatus] = useState("");
  const [wakeArmed, setWakeArmed] = useState(false);
  const [support, setSupport] = useState({
    recognition: true,
    synthesis: true,
    arabicVoice: true,
  });
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => loadPosition());
  const [dragging, setDragging] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const wakeRecognitionRef = useRef<RecognitionLike | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const launcherRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    checkAiAvailability().then(setAi);
    const refreshSupport = () =>
      setSupport({
        recognition: hasSpeechRecognition(),
        synthesis: hasSpeechSynthesis(),
        arabicVoice: Boolean(getArabicVoice()),
      });
    refreshSupport();
    const timer = window.setTimeout(refreshSupport, 900);
    window.speechSynthesis?.addEventListener?.("voiceschanged", refreshSupport);
    return () => {
      window.clearTimeout(timer);
      window.speechSynthesis?.removeEventListener?.("voiceschanged", refreshSupport);
    };
  }, []);

  useEffect(() => {
    const refreshAi = () => checkAiAvailability().then(setAi);
    window.addEventListener("thimar:ai-settings", refreshAi);
    return () => window.removeEventListener("thimar:ai-settings", refreshAi);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(historyKey, JSON.stringify(messages.slice(-20)));
    } catch {
      // ignore
    }
  }, [messages, historyKey]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open, thinking]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      wakeRecognitionRef.current?.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (pos) {
      try {
        localStorage.setItem("thimar.robot.pos.v1", JSON.stringify(pos));
      } catch {
        // ignore
      }
    }
  }, [pos]);

  useEffect(() => {
    const onResize = () => {
      setPos((current) => {
        if (!current) return current;
        const margin = 12;
        const w = launcherRef.current?.offsetWidth ?? 120;
        const h = launcherRef.current?.offsetHeight ?? 120;
        return {
          x: clamp(current.x, margin, Math.max(margin, window.innerWidth - w - margin)),
          y: clamp(current.y, margin, Math.max(margin, window.innerHeight - h - margin)),
        };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const speak = (text: string, force = false) => {
    if (!hasSpeechSynthesis()) {
      setTtsStatus("النطق الصوتي غير مدعوم في هذا المتصفح. يمكنك قراءة الردود نصيًا.");
      return;
    }
    if (!force && !voiceOn) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ar-EG";
    utterance.rate = 1;
    utterance.pitch = 1.05;
    const voice = getArabicVoice();
    if (voice) utterance.voice = voice;
    else setTtsStatus("لا يوجد صوت عربي مثبت على هذا الجهاز؛ سيُستخدم الصوت الافتراضي للنطق.");
    utterance.onstart = () => {
      setSpeaking(true);
      setTtsStatus("تم بدء النطق…");
    };
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => {
      setSpeaking(false);
      setTtsStatus("تعذّر تشغيل النطق الصوتي. تأكد من وجود مخرج صوتي أو استخدم النص.");
    };
    window.speechSynthesis.speak(utterance);
  };

  const sensitiveRequest = (text: string) =>
    /(api[-_\s]?key|مفتاح\s*(?:api|ال)?|كلمة\s*(?:ال)?مرور|كلمة\s*(?:ال)?سر|system\s*prompt|تعليمات\s*النظام|توكن|token|قائمة\s*الحسابات|بيانات\s*المستخدمين)/i.test(
      text,
    );

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || thinking) return;
    setInput("");
    setMicError("");
    const history = messages;

    if (sensitiveRequest(text)) {
      const refusal =
        "لا أستطيع عرض كلمات المرور أو المفاتيح أو بيانات المستخدمين أو تعليمات النظام. هذه معلومات محمية. إذا واجهت مشكلة في الدخول، تواصل مع مسؤول التطبيق عبر صفحة الشكاوى.";
      setMessages((previous) => [
        ...previous,
        { role: "user", content: text },
        { role: "assistant", content: refusal },
      ]);
      speak(refusal);
      return;
    }

    setMessages((previous) => [...previous, { role: "user", content: text }]);
    setThinking(true);
    let answer = "";
    try {
      if (ai.mode === "off") {
        answer = offlineCompanionReply(text, account.type);
      } else {
        answer = await aiChat(buildCompanionMessages(account, history, text), {
          temperature: 0.45,
          maxTokens: 420,
        });
      }
    } catch {
      answer = offlineCompanionReply(text, account.type);
    } finally {
      setThinking(false);
    }
    setMessages((previous) => [...previous, { role: "assistant", content: answer }]);
    speak(answer);
  };

  const startListening = () => {
    const Recognition = getRecognition();
    if (!Recognition) {
      setSupport((previous) => ({ ...previous, recognition: false }));
      setMicError("متصفحك لا يدعم الإدخال الصوتي. اكتب سؤالك في الحقل، وسأجيبك نصيًا.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new Recognition();
    const browserLanguage = navigator.language || "ar-EG";
    recognition.lang = browserLanguage.toLowerCase().startsWith("ar") ? "ar-EG" : browserLanguage;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (result) {
        setInput((previous) => `${previous} ${result[0].transcript}`.trim());
      }
    };
    recognition.onerror = (event) => {
      const message = recognitionErrorMessage(event.error);
      if (message) setMicError(message);
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setMicError("");
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      setMicError("تعذّر بدء الإدخال الصوتي. جرّب الكتابة اليدوية.");
    }
  };

  const startWakeListener = () => {
    const Recognition = getRecognition();
    if (!Recognition) {
      setMicError("الإدخال الصوتي غير مدعوم في هذا المتصفح. يمكنك كتابة «ثمار» في الحقل.");
      return;
    }
    if (wakeArmed) {
      wakeRecognitionRef.current?.stop();
      wakeRecognitionRef.current = null;
      setWakeArmed(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "ar-EG";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const phrase = result?.[0]?.transcript ?? "";
      if (!/ثمار|thimar/i.test(phrase)) return;
      recognition.stop();
      wakeRecognitionRef.current = null;
      setWakeArmed(false);
      setOpen(true);
      const reply = "أيوه يا فندم، أنا ثمار معاك. هل هناك حاجة أقدر أساعدك فيها؟";
      setMessages((previous) => [
        ...previous,
        { role: "user", content: "ثمار" },
        { role: "assistant", content: reply },
      ]);
      speak(reply, true);
      window.setTimeout(() => startListening(), 2600);
    };
    recognition.onerror = (event) => {
      const message = recognitionErrorMessage(event.error);
      if (message) setMicError(message);
      setWakeArmed(false);
    };
    recognition.onend = () => {
      if (wakeArmed) setWakeArmed(false);
    };
    wakeRecognitionRef.current = recognition;
    setMicError("");
    try {
      recognition.start();
      setWakeArmed(true);
    } catch {
      setWakeArmed(false);
      setMicError("تعذّر تشغيل الاستماع لكلمة ثمار. اضغط مرة أخرى بعد السماح بالميكروفون.");
    }
  };

  const quickPrompts =
    account.type === "student"
      ? ["كيف أسمّع؟", "أعطني خطة حفظ", "كيف أراجع وردي؟", "ما هي الألغاز؟"]
      : account.type === "teacher"
        ? ["كيف أصحّح تسميعًا؟", "كيف أنشئ واجبًا؟", "ما هي التقارير؟", "كيف أتابع طلابي؟"]
        : account.type === "guardian"
          ? ["كيف أتابع ابني؟", "كيف يربط الأبناء؟", "ما هو القراءة الذكية؟", "كيف أرسل شكوى؟"]
          : ["كيف أرد على شكوى؟", "كيف أعتمد معلمًا؟", "ما هي الإشعارات؟", "كيف أتابع المستخدمين؟"];

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (open) return;
    const rect = launcherRef.current?.getBoundingClientRect();
    const originX = rect ? rect.left : pos?.x ?? 0;
    const originY = rect ? rect.top : pos?.y ?? 0;
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX, originY, moved: false };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragRef.current.moved = true;
    const w = launcherRef.current?.offsetWidth ?? 120;
    const h = launcherRef.current?.offsetHeight ?? 120;
    const margin = 8;
    setPos({
      x: clamp(dragRef.current.originX + dx, margin, Math.max(margin, window.innerWidth - w - margin)),
      y: clamp(dragRef.current.originY + dy, margin, Math.max(margin, window.innerHeight - h - margin)),
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current) {
      const moved = dragRef.current.moved;
      dragRef.current = null;
      setDragging(false);
      if (moved) event.preventDefault();
    }
  };

  const launcherStyle = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;
  const panelStyle = pos
    ? {
        left: clamp(pos.x, 12, Math.max(12, window.innerWidth - 372)),
        top: clamp(pos.y - 420, 12, Math.max(12, window.innerHeight - 540)),
        right: "auto",
        bottom: "auto",
      }
    : undefined;

  if (!visible) return null;

  return (
    <div className={`robot-companion-root ${open ? "open" : ""}`} style={open ? panelStyle : launcherStyle}>
      {!open ? (
        <div className="robot-launcher-wrap" ref={launcherRef}>
          <button
            type="button"
            className={`robot-launcher ${dragging ? "dragging" : ""}`}
            onClick={() => {
              if (dragging || dragRef.current?.moved) return;
              setOpen(true);
            }}
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label="رفيق ثمار"
            title="اسحب لتحريك الرفيق، واضغط لفتحه"
          >
            <RobotAvatar speaking={speaking} listening={listening} small />
            <span>رفيق ثمار</span>
            <small className="robot-hint">اسحب للتحريك</small>
            {listening ? <span className="robot-live-dot" /> : null}
          </button>
          <button
            type="button"
            className="robot-hide"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onHide();
            }}
            aria-label="إخفاء رفيق ثمار"
            title="إخفاء رفيق ثمار من الواجهة"
          >
            ×
          </button>
        </div>
      ) : (
        <div className="robot-panel">
          <header className="robot-panel-head">
            <RobotAvatar speaking={speaking} listening={listening} small />
            <div>
              <strong>رفيق ثمار</strong>
              <span>
                {ai.mode === "off"
                  ? "وضع محلي — فعّل AI من الإعدادات"
                  : ai.mode === "proxy"
                    ? "متصل بالذكاء الاصطناعي"
                    : `متصل (${ai.model ?? "مزوّدك"})`}
              </span>
            </div>
            <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="إغلاق">
              <Icon name="x" size={18} />
            </button>
          </header>

          {ai.mode === "off" ? (
            <button
              type="button"
              className="robot-setup-banner"
              onClick={() => {
                setOpen(false);
                onNavigate("settings");
              }}
            >
              <Icon name="sparkles" size={16} /> فعّل الذكاء الاصطناعي لردود أذكى — اضغط هنا
            </button>
          ) : null}

          {!support.recognition || !support.synthesis || !support.arabicVoice ? (
            <p className="robot-support-note">
              {!support.recognition ? "الإدخال الصوتي غير مدعوم؛ اكتب سؤالك. " : ""}
              {!support.synthesis ? "النطق الآلي غير مدعوم. " : ""}
              {!support.arabicVoice ? "لا يوجد صوت عربي مثبت؛ قد يكون النطق بلكنة أخرى." : ""}
            </p>
          ) : null}

          <div className="robot-messages" ref={listRef}>
            {messages
              .filter((message) => message.role !== "system")
              .map((message, index) => (
                <div key={index} className={`robot-message ${message.role === "user" ? "mine" : "bot"}`}>
                  {message.role === "assistant" ? <span className="robot-bot-mark">ث</span> : null}
                  <p>{message.content}</p>
                </div>
              ))}
            {thinking ? (
              <div className="robot-message bot">
                <span className="robot-bot-mark">ث</span>
                <p className="robot-typing"><span /><span /><span /></p>
              </div>
            ) : null}
          </div>

          <div className="robot-quick">
            {quickPrompts.map((prompt) => (
              <button key={prompt} type="button" onClick={() => send(prompt)}>
                {prompt}
              </button>
            ))}
            <button type="button" onClick={() => { setOpen(false); onNavigate("coach"); }}>
              <Icon name="mic" size={14} /> القراءة الذكية
            </button>
          </div>

          {micError ? <p className="robot-error">{micError}</p> : null}

          <div className="robot-composer">
            <button
              type="button"
              className={`icon-button ${listening ? "listening" : ""}`}
              onClick={startListening}
              aria-label="تحدث"
            >
              <Icon name="mic" size={18} />
            </button>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={listening ? "أتحدث الآن…" : "اسأل رفيق ثمار…"}
            />
            <button type="button" className="send-button" onClick={() => send()} aria-label="إرسال">
              <Icon name="send" size={18} />
            </button>
          </div>

          <div className="robot-foot">
            <button
              type="button"
              onClick={() => {
                setVoiceOn((value) => !value);
                window.speechSynthesis.cancel();
                setSpeaking(false);
              }}
            >
              <Icon name={voiceOn ? "sun" : "moon"} size={14} /> {voiceOn ? "الصوت مفعّل" : "الصوت مكتوم"}
            </button>
            <button type="button" className={wakeArmed ? "wake-active" : ""} onClick={startWakeListener}>
              <Icon name="mic" size={14} /> {wakeArmed ? "أستمع لكلمة ثمار…" : "قل «ثمار»"}
            </button>
            <button type="button" onClick={() => speak("أهلًا بك في ثمار. أنا رفيقك في رحلة الحفظ.", true)}>
              <Icon name="play" size={12} /> اختبار الصوت
            </button>
            <button type="button" onClick={() => { setPos(null); try { localStorage.removeItem("thimar.robot.pos.v1"); } catch {} }}>
              إعادة الموضع
            </button>
            <button type="button" onClick={() => { setOpen(false); onHide(); }}>
              إخفاء من الواجهة
            </button>
          </div>
          {ttsStatus ? <p className="robot-tts-status">{ttsStatus}</p> : null}
        </div>
      )}
    </div>
  );
}
