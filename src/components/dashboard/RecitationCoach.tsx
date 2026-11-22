import { useEffect, useMemo, useRef, useState } from "react";
import { surahs } from "../../data/surahs";
import { fetchSurah, type Ayah } from "../../lib/quran";
import { loadSettings } from "../../lib/appStore";
import { playNotificationSound } from "../../lib/sound";
import {
  checkAiAvailability,
  fallbackRecitationFeedback,
  getRecitationFeedback,
  type AiAvailability,
} from "../../lib/ai";
import { compareRecitation, type RecitationComparison } from "../../lib/recitation";
import {
  hasSpeechRecognition,
  recognitionErrorMessage,
} from "../../lib/speech";
import { Icon, SectionCard } from "./ui";

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

export default function RecitationCoach() {
  const [surah, setSurah] = useState(78);
  const [fromAyah, setFromAyah] = useState(1);
  const [toAyah, setToAyah] = useState(5);
  const [ayahs, setAyahs] = useState<Ayah[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [comparison, setComparison] = useState<RecitationComparison | null>(null);
  const lockRef = useRef<number | null>(null);
  const [lockedIndex, setLockedIndex] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [ai, setAi] = useState<AiAvailability>({ mode: "off" });
  const [manualMode, setManualMode] = useState(false);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Ayah[]>([]);
  const reciter = loadSettings().reciter;

  useEffect(() => {
    checkAiAvailability().then(setAi);
    const refreshSupport = () => {
      const recognition = hasSpeechRecognition();
      if (!recognition) setManualMode(true);
    };
    refreshSupport();
    const timer = window.setTimeout(refreshSupport, 900);
    window.speechSynthesis?.addEventListener?.("voiceschanged", refreshSupport);
    return () => {
      window.clearTimeout(timer);
      window.speechSynthesis?.removeEventListener?.("voiceschanged", refreshSupport);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchSurah(surah)
      .then((result) => {
        if (cancelled) return;
        setAyahs(result);
        setFromAyah(1);
        setToAyah(Math.min(5, result.length));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "تعذّر تحميل السورة.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [surah]);

  const selectedAyahs = useMemo(
    () =>
      ayahs.filter(
        (ayah) => ayah.numberInSurah >= fromAyah && ayah.numberInSurah <= toAyah,
      ),
    [ayahs, fromAyah, toAyah],
  );

  const expectedText = selectedAyahs.map((ayah) => ayah.text).join(" ");
  const label = `${surahs[surah - 1]?.name ?? "سورة"} (${fromAyah}–${toAyah})`;

  const stopAudio = () => {
    queueRef.current = [];
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const playNext = () => {
    const next = queueRef.current.shift();
    if (!audioRef.current) audioRef.current = new Audio();
    if (!next) return;
    audioRef.current.src = `https://cdn.islamic.network/quran/audio/128/${reciter}/${next.number}.mp3`;
    audioRef.current.play().catch(() => undefined);
  };

  const playRange = () => {
    if (selectedAyahs.length === 0) return;
    stopAudio();
    queueRef.current = [...selectedAyahs];
    playNext();
  };

  const startListening = () => {
    const Recognition = getRecognition();
    if (!Recognition) {
      setError("متصفحك لا يدعم تحويل الكلام إلى نص. تم تفعيل الكتابة/اللصق لتتمكن من المتابعة.");
      setManualMode(true);
      return;
    }
    stopAudio();
    const recognition = new Recognition();
    recognition.lang = "ar-SA";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += ` ${result[0].transcript}`;
        else interimText += ` ${result[0].transcript}`;
      }
      if (finalText.trim()) {
        setTranscript((previous) => `${previous} ${finalText}`.trim());
      }
      setInterim(interimText.trim());
    };
    recognition.onerror = (event) => {
      const message = recognitionErrorMessage(event.error);
      if (message) setError(`${message} تم تفعيل الكتابة اليدوية للمتابعة.`);
      setListening(false);
      setManualMode(true);
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
    };
    recognitionRef.current = recognition;
    setError("");
    setComparison(null);
    lockRef.current = null;
    setLockedIndex(null);
    setFeedback("");
    setTranscript("");
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("تعذّر بدء التعرف على الصوت. أعد المحاولة أو استخدم الكتابة اليدوية.");
      setManualMode(true);
      setListening(false);
    }
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const analyze = async () => {
    if (!transcript.trim()) {
      setError("لم يُلتقط أي نص بعد. اضغط «سمّع الآن» واقرأ الآيات، أو الصق النص يدويًا.");
      return;
    }
    if (!expectedText) {
      setError("اختر آية واحدة على الأقل.");
      return;
    }
    const result = compareRecitation(expectedText, transcript);
    setComparison(result);
    lockErrorWord(result);
    playNotificationSound(result.accuracy >= 70 ? "success" : "error");
    setFeedback(fallbackRecitationFeedback(result));
    setError("");
    if (ai.mode !== "off") {
      setFeedbackLoading(true);
      try {
        const aiFeedback = await getRecitationFeedback(result, label);
        setFeedback(aiFeedback);
      } catch {
        // نُبقي الملاحظات النصية المحلية.
      } finally {
        setFeedbackLoading(false);
      }
    }
  };

  /** يثبّت المؤشر على أول خطأ، ولا يتحرك حتى تُقرأ الكلمة صحيحة. */
  const lockErrorWord = (result: RecitationComparison) => {
    const previous = lockRef.current;
    let next: number | null = null;
    if (previous !== null && result.diff[previous] && result.diff[previous].status === "missing") {
      next = previous; // الخطأ نفسه لم يُقرأ بعد: ابقَ مكانك
    } else {
      const firstMissing = result.diff.findIndex((item) => item.status === "missing");
      next = firstMissing === -1 ? null : firstMissing;
    }
    lockRef.current = next;
    setLockedIndex(next);
  };

  const reset = () => {
    stopListening();
    stopAudio();
    setTranscript("");
    setInterim("");
    setComparison(null);
    lockRef.current = null;
    setLockedIndex(null);
    setFeedback("");
    setError("");
  };

  return (
    <div className="page coach-page">
      <div className="page-head">
        <h2>القراءة الذكية</h2>
      </div>

      <SectionCard title="اختر موضع التسميع">
        <div className="coach-controls">
          <label>
            <span>السورة</span>
            <select value={surah} onChange={(event) => setSurah(Number(event.target.value))}>
              {surahs.map((item) => (
                <option key={item.n} value={item.n}>
                  {item.n}. {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>من آية</span>
            <input
              type="number"
              min={1}
              max={ayahs.length || 1}
              value={fromAyah}
              onChange={(event) => setFromAyah(Number(event.target.value))}
            />
          </label>
          <label>
            <span>إلى آية</span>
            <input
              type="number"
              min={1}
              max={ayahs.length || 1}
              value={toAyah}
              onChange={(event) => setToAyah(Number(event.target.value))}
            />
          </label>
          <button type="button" className="ghost-button" onClick={playRange}>
            <Icon name="play" size={16} /> استمع للمقطع
          </button>
        </div>
      </SectionCard>

      <SectionCard title={`النص المتوقع — ${label}`}>
        {loading ? (
          <div className="skeleton-list">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        ) : expectedText ? (
          <div className="coach-expected">
            {selectedAyahs.map((ayah) => (
              <div key={ayah.number} className="coach-ayah">
                <span className="ayah-number">{ayah.numberInSurah}</span>
                <p>{ayah.text}</p>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    stopAudio();
                    queueRef.current = [ayah];
                    playNext();
                  }}
                  aria-label="استمع للآية"
                >
                  <Icon name="play" size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">اختر نطاقًا صحيحًا.</p>
        )}
        {error ? <div className="error-box compact"><p>{error}</p></div> : null}
      </SectionCard>

      <SectionCard title="تسميعك">
        <div className="coach-record">
          {listening ? (
            <button type="button" className="danger-button" onClick={stopListening}>
              <span className="recording-dot" /> إيقاف التسجيل
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={startListening}>
              <Icon name="mic" size={18} /> سمّع الآن
            </button>
          )}
          <button type="button" className="ghost-button" onClick={() => setManualMode((value) => !value)}>
            <Icon name="file" size={16} /> {manualMode ? "إخفاء الكتابة" : "كتابة/لصق النص"}
          </button>
          {transcript ? (
            <button type="button" className="ghost-button" onClick={reset}>
              مسح
            </button>
          ) : null}
        </div>

        {manualMode ? (
          <textarea
            className="coach-textarea"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="اكتب ما تحفظه من الآيات هنا..."
          />
        ) : null}

        <div className="coach-transcript">
          <strong>ما التقطه النظام:</strong>
          <p>
            {transcript || "لم يُلتقط شيء بعد."}
            {interim ? <span className="interim"> {interim}</span> : null}
          </p>
        </div>

        <div className="coach-actions">
          <button type="button" className="primary-button" onClick={analyze} disabled={!transcript.trim()}>
            <Icon name="check" size={16} /> قارن وصحّح
          </button>
          {feedbackLoading ? <span className="muted">جارٍ طلب ملاحظات الذكاء الاصطناعي…</span> : null}
        </div>
      </SectionCard>

      {comparison ? (
        <SectionCard title="نتيجة التسميع">
          <div className="accuracy-row">
            <div className="accuracy-circle" style={{ background: `conic-gradient(var(--primary) ${comparison.accuracy}%, var(--border) 0)` }}>
              <span>{comparison.accuracy}%</span>
            </div>
            <div>
              <strong>
                {comparison.matched} من {comparison.total} كلمة مطابقة
              </strong>
              <p className="muted">
                {comparison.accuracy >= 95
                  ? "إتقان ممتاز، ما شاء الله."
                  : comparison.accuracy >= 70
                    ? "جيد، ويحتاج مراجعة بسيطة."
                    : "يحتاج تكرارًا ومراجعة."}
              </p>
            </div>
          </div>

          <div className="diff-text">
            {comparison.diff.map((item, index) => {
              const boundary = lockedIndex ?? comparison.diff.length;
              const isError = lockedIndex === index;
              const className = isError
                ? "diff-error"
                : index < boundary && item.status === "matched"
                  ? "diff-ok"
                  : index < boundary
                    ? "diff-ok"
                    : "diff-pending";
              return (
                <span key={`${item.word}-${index}`} className={className}>
                  {item.word}{" "}
                </span>
              );
            })}
          </div>

          {lockedIndex !== null && comparison.diff[lockedIndex] ? (
            <div className="recite-stop">
              <strong>توقّف عند: «{comparison.diff[lockedIndex].word}»</strong>
              <p>
                أعِد قراءة هذه الكلمة وحدها ثم أكمل. الخطأ يُعلَّم على كلمة واحدة فقط، والانتقال لا يتم حتى
                تُقرأ صحيحة.
              </p>
              {(() => {
                const remaining = comparison.diff.filter(
                  (item, index) => item.status === "missing" && index >= (lockedIndex ?? 0),
                ).length;
                return remaining > 1 ? (
                  <small className="muted">وبعدها {remaining - 1} كلمة تحتاج تصحيحًا.</small>
                ) : (
                  <small className="muted">هذه هي آخر كلمة تحتاج تصحيحًا.</small>
                );
              })()}
            </div>
          ) : comparison.accuracy === 100 ? (
            <p className="muted">لا أخطاء — تسميع متقن، بارك الله فيك.</p>
          ) : null}
          {comparison.extraWords.length ? (
            <div className="coach-words">
              <strong>كلمات زائدة:</strong>{" "}
              {comparison.extraWords.slice(0, 14).map((word, index) => (
                <span key={`${word}-${index}`} className="word-chip warning">{word}</span>
              ))}
            </div>
          ) : null}

          <div className="feedback-box">
            <strong>ملاحظات رفيق ثمار:</strong>
            <p>{feedback}</p>
            {ai.mode === "off" ? <small className="muted">ملاحظات محلية — فعّل AI من الإعدادات.</small> : null}
          </div>
        </SectionCard>
      ) : null}
      <audio ref={audioRef} onEnded={playNext} preload="none" />
    </div>
  );
}
