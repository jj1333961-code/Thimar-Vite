import { useEffect, useRef, useState } from "react";
import { surahs } from "../../data/surahs";
import { fetchSurah, type Ayah } from "../../lib/quran";
import { compareRecitation, type RecitationComparison } from "../../lib/recitation";
import { getMediaStreamChecks, getRecitationDiagnosticStatus } from "../../lib/adminDiagnosticsCore";

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionConstructor = new () => RecognitionLike;

function getRecognitionConstructor(): RecognitionConstructor | null {
  const scope = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, 5000);
    function done() {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onState);
      resolve();
    }
    function onState() {
      if (peer.iceGatheringState === "complete") done();
    }
    peer.addEventListener("icegatheringstatechange", onState);
  });
}

function waitForConnected(peer: RTCPeerConnection, timeoutMs = 10000): Promise<void> {
  if (peer.connectionState === "connected") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("انتهت مهلة إنشاء الاتصال المحلي.")), timeoutMs);
    function finish(error?: Error) {
      window.clearTimeout(timeout);
      peer.removeEventListener("connectionstatechange", onState);
      if (error) reject(error);
      else resolve();
    }
    function onState() {
      if (peer.connectionState === "connected") finish();
      else if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        finish(new Error("تعذّر إنشاء اتصال WebRTC محلي."));
      }
    }
    peer.addEventListener("connectionstatechange", onState);
  });
}

export default function AdminDiagnostics() {
  const [mode, setMode] = useState<"recitation" | "video">("recitation");
  const [surahNumber, setSurahNumber] = useState(1);
  const [ayahs, setAyahs] = useState<Ayah[]>([]);
  const [ayahNumber, setAyahNumber] = useState(1);
  const [loadingAyahs, setLoadingAyahs] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [recitationResult, setRecitationResult] = useState<RecitationComparison | null>(null);
  const [recitationError, setRecitationError] = useState("");
  const recognitionRef = useRef<RecognitionLike | null>(null);

  const [videoBusy, setVideoBusy] = useState(false);
  const [videoStatus, setVideoStatus] = useState("لم يبدأ الاختبار بعد.");
  const [videoError, setVideoError] = useState("");
  const [mediaChecks, setMediaChecks] = useState({ audio: false, video: false, ready: false });
  const [connectionReady, setConnectionReady] = useState(false);
  const selfVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<RTCPeerConnection[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoadingAyahs(true);
    setRecitationError("");
    fetchSurah(surahNumber)
      .then((result) => {
        if (cancelled) return;
        setAyahs(result);
        setAyahNumber(1);
        setRecitationResult(null);
      })
      .catch((error) => {
        if (!cancelled) setRecitationError(error instanceof Error ? error.message : "تعذّر تحميل آيات السورة.");
      })
      .finally(() => {
        if (!cancelled) setLoadingAyahs(false);
      });
    return () => { cancelled = true; };
  }, [surahNumber]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    stopVideoTest();
  }, []);

  function stopVideoTest() {
    peersRef.current.forEach((peer) => peer.close());
    peersRef.current = [];
    [localStreamRef.current, remoteStreamRef.current].forEach((stream) => {
      stream?.getTracks().forEach((track) => track.stop());
    });
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    if (selfVideoRef.current) selfVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setConnectionReady(false);
    setMediaChecks({ audio: false, video: false, ready: false });
  }

  function startListening() {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      setRecitationError("التعرف الصوتي غير مدعوم في هذا المتصفح؛ يمكنك كتابة النص في حقل الاختبار.");
      return;
    }
    recognitionRef.current?.stop();
    const recognition = new Recognition();
    recognition.lang = "ar-SA";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) finalText += ` ${event.results[index][0].transcript}`;
      }
      if (finalText.trim()) setTranscript((previous) => `${previous} ${finalText}`.trim());
    };
    recognition.onerror = (event) => {
      setListening(false);
      setRecitationError(event.error === "not-allowed" ? "لم يُسمح بالوصول إلى الميكروفون." : `تعذّر التعرف على الصوت: ${event.error ?? "خطأ غير معروف"}`);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setRecitationError("");
    try {
      recognition.start();
      setListening(true);
    } catch {
      setRecitationError("تعذّر بدء التسجيل؛ أوقف أي تسجيل آخر ثم أعد المحاولة.");
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  function analyzeRecitation() {
    const ayah = ayahs.find((item) => item.numberInSurah === ayahNumber);
    if (!ayah || !transcript.trim()) {
      setRecitationError("اختر آية والتقط أو اكتب نص التلاوة أولًا.");
      return;
    }
    setRecitationResult(compareRecitation(ayah.text, transcript));
    setRecitationError("");
  }

  async function runVideoTest() {
    stopVideoTest();
    setVideoBusy(true);
    setVideoError("");
    setVideoStatus("طلب إذن الكاميرا والميكروفون...");
    try {
      const local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      localStreamRef.current = local;
      setMediaChecks(getMediaStreamChecks(local));
      if (selfVideoRef.current) selfVideoRef.current.srcObject = local;

      setVideoStatus("إنشاء طرفين محليين لاختبار WebRTC...");
      const caller = new RTCPeerConnection({ iceServers: [] });
      const receiver = new RTCPeerConnection({ iceServers: [] });
      peersRef.current = [caller, receiver];
      const remote = new MediaStream();
      remoteStreamRef.current = remote;
      receiver.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => remote.addTrack(track));
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
      };
      local.getTracks().forEach((track) => caller.addTrack(track, local));

      const offer = await caller.createOffer();
      await caller.setLocalDescription(offer);
      await waitForIceGathering(caller);
      if (!caller.localDescription) throw new Error("لم يتم إنشاء عرض الاتصال.");
      await receiver.setRemoteDescription(caller.localDescription);

      const answer = await receiver.createAnswer();
      await receiver.setLocalDescription(answer);
      await waitForIceGathering(receiver);
      if (!receiver.localDescription) throw new Error("لم يتم إنشاء رد الاتصال.");
      await caller.setRemoteDescription(receiver.localDescription);
      await waitForConnected(caller);
      setConnectionReady(true);
      setVideoStatus("نجح اتصال WebRTC المحلي واستُقبلت وسائط الاختبار.");
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : "فشل اختبار الكاميرا والاتصال.");
      setVideoStatus("لم يكتمل الاختبار.");
      stopVideoTest();
    } finally {
      setVideoBusy(false);
    }
  }

  const selectedAyah = ayahs.find((item) => item.numberInSurah === ayahNumber);
  const status = recitationResult ? getRecitationDiagnosticStatus(recitationResult.accuracy) : null;

  return (
    <div className="page">
      <div className="page-head">
        <h2>مختبر الاختبار الداخلي</h2>
        <p>أدوات تشخيص للمسؤول فقط؛ لا تُجري اتصالات حقيقية بمستخدمين آخرين.</p>
      </div>
      <div className="admin-tabs" role="tablist" aria-label="أدوات الاختبار">
        <button type="button" className={mode === "recitation" ? "tab is-active" : "tab"} onClick={() => setMode("recitation")}>محاكي التسميع</button>
        <button type="button" className={mode === "video" ? "tab is-active" : "tab"} onClick={() => setMode("video")}>محاكي مكالمات الفيديو</button>
      </div>

      {mode === "recitation" ? (
        <section className="panel" style={{ display: "grid", gap: 14 }}>
          <div className="panel-head"><h2>اختبار محرك التسميع</h2><span className="counter">تجربة محلية</span></div>
          <p className="panel-text">اختر سورة وآية، ثم جرّب الميكروفون أو أدخل نصًا تجريبيًا. تتم مقارنة النص الملتقط بمحرك ثمار الحالي.</p>
          <label>السورة
            <select value={surahNumber} onChange={(event) => setSurahNumber(Number(event.target.value))}>
              {surahs.map((item) => <option key={item.n} value={item.n}>{item.n}. {item.name}</option>)}
            </select>
          </label>
          <label>الآية
            <select value={ayahNumber} onChange={(event) => setAyahNumber(Number(event.target.value))} disabled={loadingAyahs || ayahs.length === 0}>
              {ayahs.map((item) => <option key={item.numberInSurah} value={item.numberInSurah}>{item.numberInSurah}</option>)}
            </select>
          </label>
          {selectedAyah && <div className="panel" style={{ background: "var(--surface, rgba(128,128,128,.08))" }}><b>النص المرجعي للاختبار</b><p dir="rtl">{selectedAyah.text}</p></div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={listening ? stopListening : startListening} disabled={loadingAyahs}>{listening ? "إيقاف الميكروفون" : "بدء اختبار الميكروفون"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setTranscript(""); setRecitationResult(null); setRecitationError(""); }}>مسح النتيجة</button>
          </div>
          <label>النص الذي التقطه الميكروفون (يمكن تعديله يدويًا)
            <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={4} dir="rtl" placeholder="سيظهر النص هنا، أو اكتب نصًا لاختبار المقارنة..." />
          </label>
          <button type="button" className="btn btn-primary" onClick={analyzeRecitation} disabled={loadingAyahs || !selectedAyah || !transcript.trim()}>تحليل المطابقة</button>
          {loadingAyahs && <p className="panel-text">جارٍ تحميل الآيات...</p>}
          {recitationError && <p role="alert" className="panel-text">{recitationError}</p>}
          {recitationResult && (
            <div className="panel" aria-live="polite">
              <div className="panel-head"><h3>نتيجة المقارنة النصية</h3><b>{recitationResult.accuracy}%</b></div>
              <p>{status === "excellent" ? "مطابقة مرتفعة" : status === "review" ? "تحتاج مراجعة" : "أعد المحاولة"}</p>
              <p>الكلمات المطابقة: {recitationResult.matched} من {recitationResult.total}</p>
              <p>كلمات لم تُلتقط: {recitationResult.missingWords.join("، ") || "لا توجد"}</p>
              <p>كلمات إضافية: {recitationResult.extraWords.join("، ") || "لا توجد"}</p>
              <small>هذه مقارنة نصية ناتجة عن التعرف على الكلام، وليست حكمًا صوتيًا دقيقًا على المخارج أو التجويد.</small>
            </div>
          )}
        </section>
      ) : (
        <section className="panel" style={{ display: "grid", gap: 14 }}>
          <div className="panel-head"><h2>اختبار الكاميرا والاتصال</h2><span className="counter">WebRTC محلي</span></div>
          <p className="panel-text">ينشئ الاختبار طرفي اتصال داخل المتصفح نفسه. لا يتصل بشخص آخر ولا يرسل الفيديو إلى خادم.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <div><b>الكاميرا المحلية</b><video ref={selfVideoRef} autoPlay muted playsInline style={{ width: "100%", minHeight: 150, background: "#111", borderRadius: 12, marginTop: 8 }} /></div>
            <div><b>الفيديو المستقبَل</b><video ref={remoteVideoRef} autoPlay playsInline style={{ width: "100%", minHeight: 150, background: "#111", borderRadius: 12, marginTop: 8 }} /></div>
          </div>
          <div className="stat-grid">
            <div className="stat-card"><span>الميكروفون</span><b>{mediaChecks.audio ? "جاهز" : "لم يُختبر"}</b></div>
            <div className="stat-card"><span>الكاميرا</span><b>{mediaChecks.video ? "جاهزة" : "لم تُختبر"}</b></div>
            <div className="stat-card"><span>اتصال WebRTC</span><b>{connectionReady ? "متصل" : "غير متصل"}</b></div>
          </div>
          <p aria-live="polite">{videoStatus}</p>
          {videoError && <p role="alert" className="panel-text">{videoError}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={() => void runVideoTest()} disabled={videoBusy}>{videoBusy ? "جارٍ الاختبار..." : "بدء اختبار الفيديو"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { stopVideoTest(); setVideoError(""); setVideoStatus("تم إيقاف الاختبار."); }}>إيقاف الاختبار</button>
          </div>
          <small>لنجاح الاختبار يجب فتح الموقع عبر HTTPS والسماح للمتصفح باستخدام الكاميرا والميكروفون.</small>
        </section>
      )}
    </div>
  );
}
