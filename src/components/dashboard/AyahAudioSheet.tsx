import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ayahAudioUrl, reciters, reciterIsSurah, repeatOptions } from "../../data/reciters";
import { loadSettings } from "../../lib/appStore";
import type { HafsAyah } from "../../lib/mushafText";
import { arabicNumber, surahNameOfNumber } from "../../lib/ayahImage";

/*
 * صفحة الاستماع للآيات المحددة: اختيار القارئ، تشغيل الآية الواحدة أو المقطع
 * كاملًا، وتكرار كل منهما بعدد يختاره المستخدم، مع تشغيل/إيقاف مؤقت/متابعة.
 */

/* كل القراء المتاحين في التطبيق — بما فيهم من يتوفر له ملف السورة كاملة. */
const AYAH_RECITERS = reciters;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function AyahAudioSheet({
  ayahs,
  onClose,
}: {
  ayahs: HafsAyah[];
  onClose: () => void;
}) {
  const [reciterId, setReciterId] = useState(() => {
    const saved = loadSettings().reciter;
    return AYAH_RECITERS.some((reciter) => reciter.id === saved) ? saved : AYAH_RECITERS[0].id;
  });
  const [mode, setMode] = useState<"single" | "group">("single");
  const [singleRepeat, setSingleRepeat] = useState(2);
  const [groupRepeat, setGroupRepeat] = useState(2);
  const surahOnly = reciterIsSurah(reciterId);
  const repeat = mode === "single" ? singleRepeat : groupRepeat;
  const [singleIndex, setSingleIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [round, setRound] = useState(0);
  const [nowAyah, setNowAyah] = useState<HafsAyah | null>(null);
  const [error, setError] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopRef = useRef(true);
  const pausedRef = useRef(false);

  const single = ayahs[singleIndex] ?? ayahs[0];

  const stop = useCallback(() => {
    stopRef.current = true;
    pausedRef.current = false;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
    setPaused(false);
    setNowAyah(null);
    setRound(0);
  }, []);

  useEffect(
    () => () => {
      stopRef.current = true;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
    },
    [],
  );

  const playAyah = (ayah: HafsAyah): Promise<boolean> =>
    new Promise((resolve) => {
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = ayahAudioUrl(reciterId, ayah.global);
      audio.onended = () => resolve(true);
      audio.onerror = () => resolve(false);
      setNowAyah(ayah);
      void audio.play().then(
        () => undefined,
        () => resolve(false),
      );
    });

  const start = async () => {
    if (!ayahs.length) return;
    if (reciterIsSurah(reciterId)) {
      setError("هذا القارئ متوفر بملف السورة كاملة فقط، ولا يمكن تشغيل آية محددة له. اختر قارئًا آخر أو استمع من قائمة السور.");
      return;
    }
    setError("");
    stopRef.current = false;
    pausedRef.current = false;
    setPlaying(true);
    setPaused(false);
    const list = mode === "single" ? [single] : ayahs;
    for (let index = 0; index < repeat; index += 1) {
      if (stopRef.current) return;
      setRound(index + 1);
      for (const ayah of list) {
        while (pausedRef.current && !stopRef.current) await sleep(150);
        if (stopRef.current) return;
        const ok = await playAyah(ayah);
        if (stopRef.current) return;
        if (!ok) {
          setError("تعذّر تشغيل التلاوة. تحقّق من الاتصال بالإنترنت أو اختر قارئًا آخر.");
          setPlaying(false);
          setNowAyah(null);
          return;
        }
      }
    }
    setPlaying(false);
    setPaused(false);
    setNowAyah(null);
    setRound(0);
  };

  const togglePause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      void audio.play().catch(() => undefined);
    } else {
      pausedRef.current = true;
      setPaused(true);
      audio.pause();
    }
  };

  const progressLabel = useMemo(() => {
    if (!nowAyah) return "";
    const label = `${surahNameOfNumber(nowAyah.surah)} — الآية ${arabicNumber(nowAyah.ayah)}`;
    return repeat > 1 ? `${label} • التكرار ${round} من ${repeat}` : label;
  }, [nowAyah, repeat, round]);

  return (
    <div className="mushaf-ayah-sheet-backdrop" onClick={() => { stop(); onClose(); }}>
      <div className="mushaf-ayah-sheet ayah-audio-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mushaf-ayah-sheet-head">
          <h3>الاستماع والتكرار</h3>
          <button type="button" onClick={() => { stop(); onClose(); }} aria-label="إغلاق">
            ×
          </button>
        </div>

        <p className="mushaf-ayah-sheet-sub">
          {mode === "single"
            ? `آية واحدة • ${surahNameOfNumber(single.surah)} — ${arabicNumber(single.ayah)}`
            : `المقطع كاملًا • ${arabicNumber(ayahs.length)} آيات من ${surahNameOfNumber(ayahs[0].surah)}`}
        </p>

        <label className="ayah-audio-field">
          <span>القارئ</span>
          <select
            value={reciterId}
            onChange={(event) => {
              stop();
              setReciterId(event.target.value);
            }}
          >
            {AYAH_RECITERS.map((reciter) => (
              <option key={reciter.id} value={reciter.id}>
                {reciter.name}
              </option>
            ))}
          </select>
        </label>

        <div className="ayah-audio-modes" role="group" aria-label="نوع التكرار">
          <button
            type="button"
            className={mode === "single" ? "is-active" : ""}
            onClick={() => {
              stop();
              setMode("single");
            }}
          >
            تكرار آية واحدة
          </button>
          <button
            type="button"
            className={mode === "group" ? "is-active" : ""}
            onClick={() => {
              stop();
              setMode("group");
            }}
          >
            تكرار المقطع
          </button>
        </div>

        {mode === "single" ? (
          <div className="ayah-audio-single">
            <button
              type="button"
              onClick={() => {
                stop();
                setSingleIndex((value) => Math.max(0, value - 1));
              }}
              disabled={singleIndex === 0}
            >
              الآية السابقة
            </button>
            <span>{`${arabicNumber(singleIndex + 1)} / ${arabicNumber(ayahs.length)}`}</span>
            <button
              type="button"
              onClick={() => {
                stop();
                setSingleIndex((value) => Math.min(ayahs.length - 1, value + 1));
              }}
              disabled={singleIndex >= ayahs.length - 1}
            >
              الآية التالية
            </button>
          </div>
        ) : null}

        <label className="ayah-audio-field">
          <span>تكرار الآية الواحدة</span>
          <select value={singleRepeat} onChange={(event) => setSingleRepeat(Number(event.target.value))}>
            {repeatOptions.map((option) => (
              <option key={option} value={option}>
                {option} مرة
              </option>
            ))}
          </select>
        </label>

        <label className="ayah-audio-field">
          <span>تكرار المقطع كاملًا</span>
          <select value={groupRepeat} onChange={(event) => setGroupRepeat(Number(event.target.value))}>
            {repeatOptions.map((option) => (
              <option key={option} value={option}>
                {option} مرة
              </option>
            ))}
          </select>
        </label>

        {surahOnly ? (
          <p className="mushaf-ayah-sheet-note">هذا القارئ متوفر بملف السورة كاملة فقط؛ للتكرار آيةً آية اختر قارئًا آخر.</p>
        ) : null}

        <div className="ayah-audio-actions">
          {!playing ? (
            <button type="button" className="primary-button" onClick={() => void start()} disabled={surahOnly}>
              تشغيل
            </button>
          ) : (
            <>
              <button type="button" className="primary-button" onClick={togglePause}>
                {paused ? "متابعة" : "إيقاف مؤقت"}
              </button>
              <button type="button" className="ghost-button" onClick={stop}>
                إيقاف
              </button>
            </>
          )}
        </div>

        {progressLabel ? <p className="ayah-audio-now">{progressLabel}</p> : null}
        {error ? <p className="mushaf-ayah-sheet-note">{error}</p> : null}
        <p className="mushaf-ayah-sheet-note">
          الآيات المحددة محفوظة هنا كما اخترتها من المصحف: {ayahs.map((ayah) => arabicNumber(ayah.ayah)).join("، ")}
        </p>
      </div>
    </div>
  );
}
