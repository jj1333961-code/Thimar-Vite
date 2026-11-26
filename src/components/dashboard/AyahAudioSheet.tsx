import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ayahAudioUrl, reciters, reciterIsSurah, repeatOptions } from "../../data/reciters";
import { loadSettings } from "../../lib/appStore";
import { ayahKey, loadHafsAyahs, loadHafsPage, loadHafsPages, type HafsAyah } from "../../lib/mushafText";
import { arabicNumber, surahNameOfNumber } from "../../lib/ayahImage";

type Scope = "selected" | "page" | "surah";
const AYAH_RECITERS = reciters;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function AyahAudioSheet({
  ayahs,
  page,
  onClose,
  onCompactChange,
}: {
  ayahs: HafsAyah[];
  page: number;
  onClose: () => void;
  onCompactChange?: (compact: boolean) => void;
}) {
  const [reciterId, setReciterId] = useState(() => {
    const saved = loadSettings().reciter;
    return AYAH_RECITERS.some((reciter) => reciter.id === saved) ? saved : AYAH_RECITERS[0].id;
  });
  const [scope, setScope] = useState<Scope>("selected");
  const [repeat, setRepeat] = useState(2);
  const [scopeAyahs, setScopeAyahs] = useState<HafsAyah[]>(ayahs);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [compact, setCompact] = useState(false);
  const [round, setRound] = useState(0);
  const [nowAyah, setNowAyah] = useState<HafsAyah | null>(null);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopRef = useRef(true);
  const pausedRef = useRef(false);
  const surahOnly = reciterIsSurah(reciterId);

  const setCompactMode = (value: boolean) => {
    setCompact(value);
    onCompactChange?.(value);
  };

  useEffect(() => {
    let cancelled = false;
    setScopeLoading(true);
    const load = async () => {
      if (scope === "selected") return ayahs;
      if (scope === "page") return loadHafsPage(page);
      const pages = await loadHafsPages();
      const keys = pages.flat().filter((row) => row[0] === ayahs[0]?.surah).map((row) => ayahKey(row[0], row[1]));
      return loadHafsAyahs(keys);
    };
    load().then((items) => {
      if (!cancelled) {
        setScopeAyahs(items);
        setScopeLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setScopeAyahs(scope === "selected" ? ayahs : []);
        setScopeLoading(false);
        setError("تعذّر تحميل نطاق الآيات المطلوب.");
      }
    });
    return () => { cancelled = true; };
  }, [scope, ayahs, page]);

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

  useEffect(() => () => {
    stopRef.current = true;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
  }, []);

  const playAyah = (ayah: HafsAyah): Promise<boolean> =>
    new Promise((resolve) => {
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = ayahAudioUrl(reciterId, ayah.global);
      audio.onended = () => resolve(true);
      audio.onerror = () => resolve(false);
      setNowAyah(ayah);
      void audio.play().then(() => undefined, () => resolve(false));
    });

  const start = async () => {
    if (!scopeAyahs.length || scopeLoading) return;
    if (surahOnly) {
      setError("هذا القارئ يوفر ملفات السور كاملة فقط، ولا تتوفر له مقاطع آية بآية. اختر قارئًا يدعم الآيات أو اختر قارئًا آخر من قائمة السور.");
      return;
    }
    setError("");
    stopRef.current = false;
    pausedRef.current = false;
    setPlaying(true);
    setPaused(false);
    setCompactMode(true);
    for (let index = 0; index < repeat; index += 1) {
      if (stopRef.current) return;
      setRound(index + 1);
      for (const ayah of scopeAyahs) {
        while (pausedRef.current && !stopRef.current) await sleep(150);
        if (stopRef.current) return;
        const ok = await playAyah(ayah);
        if (stopRef.current) return;
        if (!ok) {
          setError("تعذّر تشغيل التلاوة. تحقّق من الاتصال بالإنترنت أو اختر قارئًا آخر.");
          setPlaying(false);
          setNowAyah(null);
          setCompactMode(false);
          return;
        }
      }
    }
    setPlaying(false);
    setPaused(false);
    setNowAyah(null);
    setRound(0);
    setCompactMode(false);
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

  const stopAndReturnToSettings = () => {
    stop();
    setCompactMode(false);
  };

  const progressLabel = useMemo(() => {
    if (!nowAyah) return "جارٍ تجهيز التلاوة…";
    const label = `${surahNameOfNumber(nowAyah.surah)} — الآية ${arabicNumber(nowAyah.ayah)}`;
    return repeat > 1 ? `${label} • الجولة ${arabicNumber(round)} من ${arabicNumber(repeat)}` : label;
  }, [nowAyah, repeat, round]);

  if (compact) {
    return (
      <div className="ayah-audio-mini-player" role="status" aria-live="polite">
        <span className="ayah-audio-mini-now">{progressLabel}</span>
        <button type="button" onClick={togglePause} aria-label={paused ? "استئناف التلاوة" : "إيقاف مؤقت"} title={paused ? "استئناف" : "إيقاف مؤقت"}>
          {paused ? "▶️" : "⏸️"}
        </button>
        <button type="button" onClick={stopAndReturnToSettings} aria-label="إيقاف التلاوة وفتح الإعدادات" title="إيقاف">
          ⏺️
        </button>
      </div>
    );
  }

  return (
    <div className="mushaf-ayah-sheet-backdrop" onClick={() => { stop(); onClose(); }}>
      <div className="mushaf-ayah-sheet ayah-audio-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mushaf-ayah-sheet-head">
          <h3>الاستماع والتكرار</h3>
          <button type="button" onClick={() => { stop(); onClose(); }} aria-label="إغلاق">×</button>
        </div>
        <p className="mushaf-ayah-sheet-sub">
          {scope === "selected" ? `الآيات المحددة • ${arabicNumber(ayahs.length)} آيات` : scope === "page" ? `صفحة المصحف • ${arabicNumber(page)}` : `سورة ${surahNameOfNumber(ayahs[0]?.surah ?? 1)} كاملة`}
        </p>
        <label className="ayah-audio-field">
          <span>نطاق التشغيل</span>
          <select value={scope} onChange={(event) => { stop(); setScope(event.target.value as Scope); }}>
            <option value="selected">الآيات المحددة</option>
            <option value="page">الصفحة الحالية</option>
            <option value="surah">السورة كاملة (سورة أول آية محددة)</option>
          </select>
        </label>
        <label className="ayah-audio-field">
          <span>القارئ</span>
          <select value={reciterId} onChange={(event) => { stop(); setReciterId(event.target.value); }}>
            {AYAH_RECITERS.map((reciter) => <option key={reciter.id} value={reciter.id}>{reciter.name}</option>)}
          </select>
        </label>
        <label className="ayah-audio-field">
          <span>عدد مرات التكرار</span>
          <select value={repeat} onChange={(event) => setRepeat(Number(event.target.value))}>
            {repeatOptions.map((option) => <option key={option} value={option}>{arabicNumber(option)} مرة</option>)}
          </select>
        </label>
        {surahOnly ? <p className="mushaf-ayah-sheet-note">هذا القارئ متاح بتسجيل السورة كاملة فقط؛ تشغيل نطاق آيات محدد يحتاج قارئًا يدعم ملفات الآيات.</p> : null}
        {scopeLoading ? <p className="mushaf-ayah-sheet-note">جارٍ تجهيز الآيات…</p> : null}
        <div className="ayah-audio-actions">
          <button type="button" className="primary-button" onClick={() => void start()} disabled={surahOnly || scopeLoading || !scopeAyahs.length}>
            تشغيل
          </button>
        </div>
        {error ? <p className="mushaf-ayah-sheet-note">{error}</p> : null}
      </div>
    </div>
  );
}
