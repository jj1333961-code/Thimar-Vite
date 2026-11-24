import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

type Mode = "audio" | "video";
type Phase = "idle" | "ringing" | "active" | "ended" | "failed";

/**
 * محاكي محلي للمسؤول: لا ينشئ سجلات ولا يرسل دعوات أو وسائط إلى مستخدمين آخرين.
 * يستخدم الميكروفون/الكاميرا محليًا لاختبار الأذونات والأجهزة فقط.
 */
export default function CallSimulator({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<Mode>("video");
  const [direction, setDirection] = useState<"incoming" | "outgoing">("outgoing");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [chat, setChat] = useState<string[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const release = () => {
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setSharing(false);
  };

  useEffect(() => () => {
    screenRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => {
    if (phase !== "active") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = sharing ? screenRef.current : streamRef.current;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [phase, mode, sharing]);

  const begin = (nextMode: Mode, nextDirection: "incoming" | "outgoing") => {
    release();
    setMode(nextMode);
    setDirection(nextDirection);
    setPhase("ringing");
    setSeconds(0);
    setMuted(false);
    setCameraOff(false);
    setNotice(nextDirection === "incoming" ? "محاكاة: توجد مكالمة واردة." : "محاكاة: جارٍ رنين الطرف الآخر.");
    setChat([]);
  };

  const accept = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("المتصفح لا يدعم اختبار الميكروفون والكاميرا.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: mode === "video" ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
      streamRef.current = stream;
      setPhase("active");
      setNotice("المحاكاة نشطة. الصوت والصورة محليان ولا يتم الاتصال بمستخدم آخر.");
    } catch (error) {
      setPhase("failed");
      setNotice(error instanceof Error ? error.message : "تعذّر الوصول إلى أجهزة الوسائط.");
    }
  };

  const finish = (next: "ended" | "failed" = "ended", message = "انتهت المحاكاة.") => {
    release();
    setPhase(next);
    setNotice(message);
  };

  const toggleMute = () => {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  };
  const toggleCamera = () => {
    const next = !cameraOff;
    streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !next; });
    setCameraOff(next);
  };
  const shareScreen = async () => {
    if (sharing) {
      screenRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      screenRef.current = null;
      setSharing(false);
      setNotice("تم إيقاف مشاركة الشاشة التجريبية.");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice("مشاركة الشاشة غير مدعومة في هذه البيئة. اختبرها من متصفح كمبيوتر يدعم التقاط الشاشة.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenRef.current = stream;
      setSharing(true);
      const track = stream.getVideoTracks()[0];
      if (track) track.onended = () => { screenRef.current = null; setSharing(false); };
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تم إلغاء مشاركة الشاشة أو تعذّر تشغيلها.");
    }
  };
  const sendTestMessage = () => {
    const value = draft.trim();
    if (!value) return;
    setChat((items) => [...items, value]);
    setDraft("");
  };

  return (
    <div className="call-overlay call-simulator" role="dialog" aria-modal="true" aria-label="محاكي مكالمات ثمار">
      <div className="call-simulator-shell">
        <header className="call-simulator-head">
          <div><strong>محاكي Thimar Connect</strong><span>بيئة اختبار داخلية للمسؤول</span></div>
          <button type="button" onClick={() => { release(); onClose(); }} aria-label="إغلاق المحاكي">×</button>
        </header>
        <div className="call-simulator-warning"><Icon name="flask-conical" size={17} /> محاكاة فقط — لا يتم الاتصال بمستخدم حقيقي ولا إرسال صوت أو فيديو عبر الإنترنت.</div>
        {phase === "idle" || phase === "ended" || phase === "failed" ? (
          <div className="call-simulator-start">
            <div className="call-simulator-avatar"><Icon name="phone-call" size={34} /></div>
            <h2>{phase === "idle" ? "اختبر نظام المكالمات" : phase === "ended" ? "انتهى الاختبار" : "تعذّر الاختبار"}</h2>
            <p>{phase === "idle" ? "اختر سيناريو وارد أو صادر، ثم اختبر الأذونات وأزرار التحكم." : notice}</p>
            <div className="call-simulator-grid">
              <button type="button" onClick={() => begin("audio", "outgoing")}><Icon name="phone" size={18} /> مكالمة صوتية صادرة</button>
              <button type="button" onClick={() => begin("video", "outgoing")}><Icon name="video" size={18} /> مكالمة فيديو صادرة</button>
              <button type="button" onClick={() => begin("audio", "incoming")}><Icon name="phone-incoming" size={18} /> مكالمة صوتية واردة</button>
              <button type="button" onClick={() => begin("video", "incoming")}><Icon name="video" size={18} /> مكالمة فيديو واردة</button>
            </div>
          </div>
        ) : (
          <div className="call-simulator-stage">
            <div className="call-simulator-remote">
              <div className="call-simulator-avatar"><Icon name="user-round" size={42} /></div>
              <strong>{direction === "incoming" ? "متصل تجريبي" : "المستخدم التجريبي"}</strong>
              <span>{phase === "ringing" ? direction === "incoming" ? "مكالمة واردة تجريبية" : "جارٍ الرنين..." : phase === "active" ? "متصل (محاكاة)" : "جارٍ الاختبار"}</span>
            </div>
            {phase === "ringing" ? (
              <div className="call-simulator-actions">
                {direction === "incoming" ? <button type="button" className="success-button" onClick={() => void accept()}>قبول تجريبي</button> : <button type="button" className="success-button" onClick={() => void accept()}>محاكاة الرد</button>}
                <button type="button" className="danger-button" onClick={() => finish("ended", "تم رفض المكالمة التجريبية.")}>رفض</button>
                <button type="button" className="ghost-button" onClick={() => finish("ended", "انتهت مهلة الرنين التجريبية.")}>محاكاة عدم الرد</button>
              </div>
            ) : (
              <>
                {mode === "video" || sharing ? <video ref={videoRef} className="call-simulator-local" autoPlay playsInline muted /> : null}
                <div className="call-simulator-timer">{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</div>
                <div className="call-simulator-controls">
                  <button type="button" className={muted ? "active" : ""} onClick={toggleMute}><Icon name="mic" size={18} /> {muted ? "إلغاء الكتم" : "كتم"}</button>
                  {mode === "video" ? <button type="button" className={cameraOff ? "active" : ""} onClick={toggleCamera}><Icon name="camera" size={18} /> {cameraOff ? "تشغيل الكاميرا" : "إيقاف الكاميرا"}</button> : null}
                  <button type="button" className={sharing ? "active" : ""} onClick={() => void shareScreen()}><Icon name="monitor" size={18} /> {sharing ? "إيقاف المشاركة" : "مشاركة الشاشة"}</button>
                  <button type="button" className="danger-button" onClick={() => finish()}>إنهاء الاختبار</button>
                  <button type="button" className="ghost-button" onClick={() => finish("failed", "تمت محاكاة انقطاع الشبكة.")}>محاكاة انقطاع الشبكة</button>
                </div>
                <section className="call-simulator-chat">
                  <strong>دردشة تجريبية محلية</strong>
                  <div>{chat.map((item, index) => <p key={index}>{item}</p>)}</div>
                  <form onSubmit={(event) => { event.preventDefault(); sendTestMessage(); }}>
                    <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="اكتب رسالة اختبار..." />
                    <button type="submit" disabled={!draft.trim()}>إرسال</button>
                  </form>
                </section>
              </>
            )}
          </div>
        )}
        {notice ? <p className="call-simulator-notice">{notice}</p> : null}
      </div>
    </div>
  );
}
