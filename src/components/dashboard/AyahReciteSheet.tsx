import { useEffect, useMemo, useRef, useState } from "react";
import { compareRecitation, type RecitationComparison } from "../../lib/recitation";
import { hasSpeechRecognition, recognitionErrorMessage } from "../../lib/speech";
import { arabicNumber } from "../../lib/ayahImage";
import type { HafsAyah } from "../../lib/mushafText";

/*
 * تقييم التسميع: يسجّل صوت المستخدم بإذن الميكروفون، يحوّله إلى نص، ثم يقارنه
 * بنص الآيات الصحيح ويظهر الكلمات الناقصة والزيادات ونسبة المطابقة.
 */

type RecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
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

export default function AyahReciteSheet({
  ayahs,
  onClose,
}: {
  ayahs: HafsAyah[];
  onClose: () => void;
}) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [comparison, setComparison] = useState<RecitationComparison | null>(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  const [manualText, setManualText] = useState("");
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const supported = useMemo(() => hasSpeechRecognition(), []);

  /* النص المعروض يحمل أرقام الآيات، والمقارنة على كلمات القرآن وحدها. */
  const expectedText = useMemo(
    () => ayahs.map((ayah) => `${ayah.text} ﴿${arabicNumber(ayah.ayah)}﴾`).join(" "),
    [ayahs],
  );
  const compareText = useMemo(() => ayahs.map((ayah) => ayah.text).join(" "), [ayahs]);

  useEffect(() => {
    setManual(!supported);
  }, [supported]);

  useEffect(
    () => () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.stop();
      }
    },
    [],
  );

  const finish = (text: string) => {
    if (!text.trim()) {
      setError("لم نسمع نصًا واضحًا. اقترب من الميكروفون ثم أعد المحاولة.");
      return;
    }
    setComparison(compareRecitation(compareText, text));
    setError("");
  };

  const startListening = async () => {
    const Recognition = getRecognition();
    if (!Recognition) {
      setManual(true);
      setError("التعرف على الكلام غير مدعوم في هذا المتصفح. يمكنك كتابة ما تسمّعته للمقارنة.");
      return;
    }
    setError("");
    setComparison(null);
    setTranscript("");
    setInterim("");
    try {
      // طلب إذن الميكروفون صراحةً حتى يعرف المستخدم أن التسجيل يبدأ الآن.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setError("لم يُسمح باستخدام الميكروفون. اسمح به من إعدادات المتصفح ثم أعد المحاولة.");
      return;
    }
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = "ar-SA";
    recognition.continuous = true;
    recognition.interimResults = true;
    let finalText = "";
    recognition.onresult = (event) => {
      let draft = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText = `${finalText} ${result[0].transcript}`.trim();
        else draft = `${draft} ${result[0].transcript}`.trim();
      }
      setTranscript(finalText);
      setInterim(draft);
    };
    recognition.onerror = (event) => {
      setError(recognitionErrorMessage(event.error));
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      finish(finalText);
    };
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("تعذّر بدء التسجيل. حاول مرة أخرى.");
    }
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  return (
    <div
      className="mushaf-ayah-sheet-backdrop"
      onClick={() => {
        recognitionRef.current?.stop();
        onClose();
      }}
    >
      <div className="mushaf-ayah-sheet ayah-recite-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mushaf-ayah-sheet-head">
          <h3>تسميع الآيات</h3>
          <button
            type="button"
            onClick={() => {
              recognitionRef.current?.stop();
              onClose();
            }}
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>

        <p className="mushaf-ayah-sheet-sub">
          {`سمّع ${ayahs.length > 1 ? `${ayahs.length} آيات` : "الآية"} بالميكروفون ثم قارن النتيجة بالنص الصحيح`}
        </p>

        <p className="mushaf-ayah-sheet-text">{expectedText}</p>

        <div className="ayah-recite-actions">
          {listening ? (
            <button type="button" className="danger-button" onClick={stopListening}>
              إيقاف التسجيل والتحقق
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={() => void startListening()}>
              بدء التسميع بالميكروفون
            </button>
          )}
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setComparison(null);
              setTranscript("");
              setInterim("");
              setError("");
              setManualText("");
            }}
          >
            محاولة جديدة
          </button>
        </div>

        {listening ? <p className="ayah-recite-live">{`يستمع… ${transcript} ${interim}`.trim()}</p> : null}

        {error ? <p className="mushaf-ayah-sheet-note">{error}</p> : null}

        {manual ? (
          <div className="ayah-recite-manual">
            <label>
              <span>اكتب ما تسمّعته لمقارنته بالنص الصحيح</span>
              <textarea
                value={manualText}
                rows={3}
                onChange={(event) => setManualText(event.target.value)}
                placeholder="اكتب هنا…"
              />
            </label>
            <button type="button" className="ghost-button" onClick={() => finish(manualText)}>
              قارن
            </button>
          </div>
        ) : null}

        {comparison ? (
          <div className="ayah-recite-result">
            <p className="ayah-recite-score">
              نسبة المطابقة <strong>{comparison.accuracy}%</strong> — {comparison.matched} من{" "}
              {comparison.total} كلمة
            </p>
            <p className="ayah-recite-diff">
              {comparison.diff.map((item, index) => (
                <span
                  key={`${item.word}-${index}`}
                  className={item.status === "missing" ? "is-missing" : "is-matched"}
                >
                  {item.word}{" "}
                </span>
              ))}
            </p>
            {comparison.extraWords.length ? (
              <p className="mushaf-ayah-sheet-note">
                {`كلمات زائدة عن النص: ${comparison.extraWords.join("، ")}`}
              </p>
            ) : null}
            {comparison.missingWords.length ? (
              <p className="mushaf-ayah-sheet-note">
                {`كلمات ناقصة: ${comparison.missingWords.join("، ")}`}
              </p>
            ) : null}
            <p className="mushaf-ayah-sheet-note">
              المقارنة نصية للكلمات؛ دقة المخارج وأحكام التجويد لا تُقاس صوتيًا هنا.
            </p>
            <button type="button" className="primary-button" onClick={() => void startListening()}>
              إعادة التسميع
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
