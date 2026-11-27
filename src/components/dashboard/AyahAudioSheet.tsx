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
/* سرعات التلاوة المتاحة — ١× هي الأصلية. */
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

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
  /* ‎0 = تكرار مستمر حتى يوقفه المستخدم. */
  const [repeat, setRepeat] = useState(2);
  /* تكرار كل آية على حِدة داخل الفقرة (1 = بلا تكرار). */
  const [ayahRepeat, setAyahRepeat] = useState(1);
  const [rate, setRate] = useState(1);
  const [scopeAyahs, setScopeAyahs] = useState<HafsAyah[]>(ayahs);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [compact, setCompact] = useState(false);
  const [miniVisible, setMiniVisible] = useState(true);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rateRef = useRef(1);
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

  /*
   * لمس صفحة المصحف يبدّل ظهور الشريط المصغّر. نعتمد على نقرة كاملة (ضغط + إفلات
   * دون سحب) حتى لا يُخفي سحبُ الصفحة الشريطَ أثناء تقليب الصفحات.
   */
  useEffect(() => {
    if (!compact) return;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let active = false;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".ayah-audio-mini-player")) {
        active = false;
        return;
      }
      active = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
    };
    const onMove = (event: PointerEvent) => {
      if (!active) return;
      if (Math.abs(event.clientX - startX) > 10 || Math.abs(event.clientY - startY) > 10) moved = true;
    };
    const onUp = () => {
      if (!active) return;
      active = false;
      if (!moved) setMiniVisible((visible) => !visible);
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
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

  /*
   * سرعة التلاوة: تُطبَّق على المشغّل الحالي فورًا (حتى أثناء التشغيل) وعلى كل
   * مقطع يُشغَّل لاحقًا. تثبيت النغمة مفعّل حتى لا يتغيّر صوت القارئ.
   */
  useEffect(() => {
    rateRef.current = rate;
    const audio = audioRef.current;
    if (audio && audio.playbackRate !== rate) {
      audio.playbackRate = rate;
    }
  }, [rate]);

  const applyRate = (audio: HTMLAudioElement) => {
    try {
      audio.defaultPlaybackRate = rateRef.current;
      audio.playbackRate = rateRef.current;
      // الحفاظ على نغمة القارئ عند تغيير السرعة في المتصفحات التي تدعمها.
      (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    } catch {
      /* بعض المتصفحات القديمة لا تدعم تغيير السرعة */
    }
  };

  const playAyah = async (ayah: HafsAyah): Promise<boolean> => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    applyRate(audio);
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
        applyRate(audio);
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
    // ‎repeat === 0 يعني تكرارًا مستمرًا حتى الإيقاف.
    const passes = repeat > 0 ? repeat : Number.POSITIVE_INFINITY;
    // تكرار الفقرة يقرأ المجموعة كاملة، وتكرار الآية يعيد كل آية وحدها.
    const perAyah = Math.max(1, Math.round(ayahRepeat) || 1);
    for (let index = 0; index < passes; index += 1) {
      if (stopRef.current) return;
      for (const ayah of scopeAyahs) {
        for (let ayahPass = 0; ayahPass < perAyah; ayahPass += 1) {
          while (pausedRef.current && !stopRef.current) await sleep(150);
          if (stopRef.current) return;
          const ok = await playAyah(ayah);
          if (stopRef.current) return;
          if (!ok) {
            /* نعود إلى نافذة الإعدادات (لا نغلقها) حتى تظهر الرسالة ويبقى التحديد والإعدادات. */
            stopRef.current = true;
            setError("تعذّر تشغيل التلاوة. تحقّق من الاتصال بالإنترنت أو اختر قارئًا آخر.");
            setCompactMode(false);
            return;
          }
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
        <div className="ayah-audio-field ayah-audio-repeat-field">
          <span>تكرار الفقرة</span>
          <div className="ayah-audio-repeat-controls">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              step={1}
              className="ayah-audio-repeat-input"
              aria-label="عدد مرات تكرار الآيات المحددة"
              value={repeat > 0 ? repeat : 1}
              disabled={repeat === 0}
              onChange={(event) => {
                const value = Number(event.target.value);
                setRepeat(Number.isFinite(value) && value > 0 ? Math.min(100, Math.round(value)) : 1);
              }}
            />
            <span className="ayah-audio-repeat-unit">مرة</span>
            <label className="ayah-audio-repeat-endless">
              <input
                type="checkbox"
                checked={repeat === 0}
                onChange={(event) => setRepeat(event.target.checked ? 0 : 2)}
              />
              <span>مستمر</span>
            </label>
          </div>
        </div>
        <div className="ayah-audio-repeat-presets" role="group" aria-label="اختيارات سريعة لعدد التكرار">
          {repeatOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={repeat === option ? "is-active" : undefined}
              onClick={() => setRepeat(option)}
            >
              {arabicNumber(option)}
            </button>
          ))}
        </div>
        <div className="ayah-audio-field ayah-audio-repeat-field ayah-audio-ayah-repeat">
          <span>تكرار الآية</span>
          <div className="ayah-audio-repeat-controls">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              step={1}
              className="ayah-audio-repeat-input"
              aria-label="عدد مرات تكرار كل آية"
              value={ayahRepeat}
              onChange={(event) => {
                const value = Number(event.target.value);
                setAyahRepeat(Number.isFinite(value) && value > 0 ? Math.min(20, Math.round(value)) : 1);
              }}
            />
            <span className="ayah-audio-repeat-unit">مرة لكل آية</span>
          </div>
        </div>
        <div className="ayah-audio-repeat-presets ayah-audio-ayah-presets" role="group" aria-label="اختيارات سريعة لتكرار كل آية">
          {[1, 2, 3, 5, 7].map((option) => (
            <button
              key={option}
              type="button"
              className={ayahRepeat === option ? "is-active" : undefined}
              onClick={() => setAyahRepeat(option)}
            >
              {arabicNumber(option)}
            </button>
          ))}
        </div>
        <p className="mushaf-ayah-sheet-note ayah-audio-hint">
          {ayahRepeat > 1 && repeat > 0
            ? `تُقرأ كل آية ${arabicNumber(ayahRepeat)} مرات على حِدة، ثم تُكرَّر ${scope === "selected" ? "الآيات المحددة" : scope === "page" ? "الصفحة" : "السورة"} كاملة ${arabicNumber(repeat)} ${repeat === 1 ? "مرة" : repeat === 2 ? "مرتين" : "مرات"}.`
            : ayahRepeat > 1
              ? `تُقرأ كل آية ${arabicNumber(ayahRepeat)} مرات على حِدة قبل الانتقال إلى الآية التالية، ثم يتكرر المقطع بلا توقف.`
              : repeat > 0
                ? `تُكرَّر ${scope === "selected" ? "الآيات المحددة" : scope === "page" ? "الصفحة" : "السورة"} ${arabicNumber(repeat)} ${repeat === 1 ? "مرة" : repeat === 2 ? "مرتين" : "مرات"} ثم يتوقف المشغّل.`
                : "يتكرر المقطع بلا توقف حتى تضغط زر الإيقاف في الشريط المصغّر."}
        </p>
        <label className="ayah-audio-field">
          <span>سرعة القارئ</span>
          <select value={rate} onChange={(event) => setRate(Number(event.target.value))}>
            {PLAYBACK_RATES.map((option) => (
              <option key={option} value={option}>
                {option === 1 ? "السرعة الأصلية (١×)" : `${arabicNumber(option)}×`}
              </option>
            ))}
          </select>
        </label>
        {rate !== 1 ? (
          <button type="button" className="ghost-button ayah-audio-rate-reset" onClick={() => setRate(1)}>
            إعادة السرعة الأصلية
          </button>
        ) : null}
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
