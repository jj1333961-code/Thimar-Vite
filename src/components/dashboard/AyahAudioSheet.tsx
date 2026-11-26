import { useCallback, useEffect, useRef, useState } from "react";
import { ayahAudioUrl, reciters, reciterIsSurah, repeatOptions } from "../../data/reciters";
import { loadSettings } from "../../lib/appStore";
import { ayahKey, loadHafsAyahs, loadHafsPage, loadHafsPages, type HafsAyah } from "../../lib/mushafText";
import { arabicNumber, surahNameOfNumber } from "../../lib/ayahImage";

// MP3Quran timing feed supplies ayah boundaries for catalogued full-surah audio files.
type Scope = "selected" | "page" | "surah";
type TimingReciter = { id: number; name: string; rewaya?: string; folder_url: string; soar_count?: number };
type AyahTiming = { ayah: number; start_time: number; end_time: number };
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
  const [timingReciters, setTimingReciters] = useState<TimingReciter[]>([]);
  const timingCache = useRef(new Map<string, AyahTiming[]>());
  const selectedTimingReciter = timingReciters.find((item) => `timing-${item.id}` === reciterId);
  const [repeat, setRepeat] = useState(2);
  const [scopeAyahs, setScopeAyahs] = useState<HafsAyah[]>(ayahs);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [compact, setCompact] = useState(false);
  const [miniVisible, setMiniVisible] = useState(true);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopResolverRef = useRef<(() => void) | null>(null);
  const stopRef = useRef(true);
  const pausedRef = useRef(false);
  const surahOnly = !selectedTimingReciter && reciterIsSurah(reciterId);

  useEffect(() => {
    let cancelled = false;
    fetch("https://mp3quran.net/api/v3/ayat_timing/reads")
      .then((response) => {
        if (!response.ok) throw new Error("reciters unavailable");
        return response.json();
      })
      .then((payload: unknown) => {
        if (cancelled || !Array.isArray(payload)) return;
        const items = payload.filter((item): item is TimingReciter =>
          !!item && typeof item === "object" &&
          typeof (item as TimingReciter).id === "number" &&
          typeof (item as TimingReciter).name === "string" &&
          typeof (item as TimingReciter).folder_url === "string"
        );
        setTimingReciters(items);
      })
      .catch(() => { /* تبقى قائمة القراء المضمّنة متاحة عند تعذر الشبكة */ });
    return () => { cancelled = true; };
  }, []);

  const setCompactMode = (value: boolean) => {
    setCompact(value);
    setMiniVisible(true);
    onCompactChange?.(value);
  };

  useEffect(() => {
    if (!compact) return;
    let timer = 0;
    const showTemporarily = () => {
      setMiniVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMiniVisible(false), 3600);
    };
    showTemporarily();
    window.addEventListener("pointerdown", showTemporarily, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", showTemporarily);
    };
  }, [compact]);

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
    stopResolverRef.current?.();
    stopResolverRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.onloadedmetadata = null;
      audio.pause();
      audio.currentTime = 0;
    }
    setPaused(false);
  }, []);

  useEffect(() => () => {
    stopRef.current = true;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
  }, []);

  const playAyah = async (ayah: HafsAyah): Promise<boolean> => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    if (!selectedTimingReciter) {
      return new Promise((resolve) => {
        audio.src = ayahAudioUrl(reciterId, ayah.global);
        const finish = (ok: boolean) => {
          stopResolverRef.current = null;
          audio.onended = null;
          audio.onerror = null;
          resolve(ok);
        };
        stopResolverRef.current = () => finish(false);
        audio.onended = () => finish(true);
        audio.onerror = () => finish(false);
        void audio.play().then(() => undefined, () => finish(false));
      });
    }
    const cacheKey = `${selectedTimingReciter.id}:${ayah.surah}`;
    let timings = timingCache.current.get(cacheKey);
    if (!timings) {
      try {
        const response = await fetch(`https://mp3quran.net/api/v3/ayat_timing?surah=${ayah.surah}&read=${selectedTimingReciter.id}`);
        if (!response.ok) return false;
        const payload = await response.json();
        if (!Array.isArray(payload)) return false;
        timings = payload.filter((item): item is AyahTiming =>
          !!item && typeof item.ayah === "number" &&
          typeof item.start_time === "number" && typeof item.end_time === "number"
        );
        timingCache.current.set(cacheKey, timings);
      } catch {
        return false;
      }
    }
    const timing = timings.find((item) => item.ayah === ayah.ayah);
    if (!timing) return false;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        audio.ontimeupdate = null;
        audio.onended = null;
        audio.onerror = null;
        stopResolverRef.current = null;
        resolve(ok);
      };
      stopResolverRef.current = () => finish(false);
      const startAt = timing.start_time / 1000;
      const endAt = timing.end_time / 1000;
      audio.src = `${selectedTimingReciter.folder_url.replace(/^http:/, "https:")}${String(ayah.surah).padStart(3, "0")}.mp3`;
      audio.onloadedmetadata = () => {
        if (stopRef.current) { finish(false); return; }
        audio.currentTime = startAt;
        audio.ontimeupdate = () => {
          if (audio.currentTime >= endAt) {
            audio.pause();
            finish(true);
          }
        };
        void audio.play().catch(() => finish(false));
      };
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.load();
    });
  };

  const start = async () => {
    if (!scopeAyahs.length || scopeLoading) return;
    if (surahOnly) {
      setError("هذا القارئ يوفر ملفات السور كاملة فقط، ولا تتوفر له مقاطع آية بآية. اختر قارئًا يدعم الآيات أو اختر قارئًا آخر من قائمة السور.");
      return;
    }
    setError("");
    stopRef.current = false;
    pausedRef.current = false;
    setPaused(false);
    setCompactMode(true);
    for (let index = 0; index < repeat; index += 1) {
      if (stopRef.current) return;
      for (const ayah of scopeAyahs) {
        while (pausedRef.current && !stopRef.current) await sleep(150);
        if (stopRef.current) return;
        const ok = await playAyah(ayah);
        if (stopRef.current) return;
        if (!ok) {
          setError("تعذّر تشغيل التلاوة. تحقّق من الاتصال بالإنترنت أو اختر قارئًا آخر.");
          setCompactMode(false);
          onClose();
          return;
        }
      }
    }
    setPaused(false);
    setCompactMode(false);
    onClose();
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

  if (compact && !miniVisible) return null;

  if (compact) {
    return (
      <div className="ayah-audio-mini-player" role="status" aria-label="التحكم في التلاوة">
        <button type="button" onClick={stopAndReturnToSettings} aria-label="إيقاف التلاوة وفتح الإعدادات" title="إيقاف">
          ⏺️
        </button>
        <button type="button" onClick={togglePause} aria-label={paused ? "استئناف التلاوة" : "إيقاف مؤقت"} title={paused ? "استئناف" : "إيقاف مؤقت"}>
          {paused ? "▶️" : "⏸️"}
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
            <optgroup label="القراء المضمّنون">
              {AYAH_RECITERS.map((reciter) => <option key={reciter.id} value={reciter.id}>{reciter.name}</option>)}
            </optgroup>
            {timingReciters.length ? (
              <optgroup label="كتالوج القراء المتاحين عبر MP3Quran">
                {timingReciters.map((reciter) => (
                  <option key={reciter.id} value={`timing-${reciter.id}`}>
                    {reciter.name}{reciter.rewaya ? ` — ${reciter.rewaya}` : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
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
