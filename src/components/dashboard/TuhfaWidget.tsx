import { useEffect, useMemo, useRef, useState } from "react";
import { tuhfaAudioBase, tuhfaSections } from "../../data/tuhfa";
import { tuhfaVerseReciters, tuhfaVerseWindow, type TuhfaVerseReciter } from "../../data/tuhfaVerseAudio";
import { normalizeArabic } from "../../lib/quran";
import { getArabicVoice, hasSpeechSynthesis } from "../../lib/speech";
import { Icon } from "./ui";

export default function TuhfaWidget() {
  const [open, setOpen] = useState<string>(tuhfaSections[0]?.id ?? "");
  const [viewMode, setViewMode] = useState<"full" | "sections">("full");
  const [showDisplay, setShowDisplay] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<{ sectionId: string; verse: number }[]>([]);
  const [sequencePlaying, setSequencePlaying] = useState(false);
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [repeat, setRepeat] = useState(2);
  const [focus, setFocus] = useState<{ sectionId: string; verse: number } | null>(null);
  const [status, setStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState("");
  const [reciterId, setReciterId] = useState<string>(tuhfaVerseReciters[0]?.id ?? "");
  const [audioProgress, setAudioProgress] = useState<{
    loading: boolean;
    percent: number;
    remaining: string;
    playbackRemaining: string;
  }>({ loading: false, percent: 0, remaining: "", playbackRemaining: "" });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const repeatLeftRef = useRef(2);
  const repeatRef = useRef(repeat);
  const loadStartedAtRef = useRef(0);
  const reciter: TuhfaVerseReciter = tuhfaVerseReciters.find((entry) => entry.id === reciterId) ?? tuhfaVerseReciters[0];

  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);

  useEffect(() => {
    const loadVoices = () => {
      const arabic = window.speechSynthesis?.getVoices?.().filter((voice) => voice.lang.toLowerCase().startsWith("ar")) ?? [];
      setVoices(arabic);
      setVoiceUri((current) => current || arabic[0]?.voiceURI || "");
    };
    loadVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices);
  }, []);

  const updateAudioProgress = (audio: HTMLAudioElement) => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    let bufferedEnd = 0;
    for (let i = 0; i < audio.buffered.length; i += 1) {
      bufferedEnd = Math.max(bufferedEnd, audio.buffered.end(i));
    }
    const percent = duration > 0 ? Math.min(100, Math.round((bufferedEnd / duration) * 100)) : 0;
    const elapsed = loadStartedAtRef.current ? (Date.now() - loadStartedAtRef.current) / 1000 : 0;
    const remaining = percent > 2 && percent < 99 && elapsed > 1
      ? `يتبقى نحو ${Math.max(1, Math.round(elapsed * ((100 - percent) / percent)))} ثانية للتحميل`
      : percent >= 99
        ? "اكتمل تحميل الصوت"
        : "جارٍ حساب وقت التحميل…";
    const playbackRemaining = duration > 0 && Number.isFinite(audio.currentTime)
      ? `متبقي من المقطع ${Math.max(0, Math.round(duration - audio.currentTime))} ثانية`
      : "";
    setAudioProgress({ loading: percent < 99, percent, remaining, playbackRemaining });
  };

  const speakVerse = (text: string) => {
    if (!hasSpeechSynthesis()) {
      setStatus("النطق الصوتي غير مدعوم في هذا المتصفح. يمكنك قراءة البيت نصيًا.");
      return;
    }
    audioRef.current?.pause();
    setPlaying(null);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ar-SA";
    utterance.rate = 0.82;
    utterance.pitch = 1;
    const voice = voices.find((item) => item.voiceURI === voiceUri) ?? getArabicVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = () => setStatus("تم نطق البيت.");
    utterance.onerror = () => setStatus("تعذّر نطق البيت. تأكد من وجود صوت عربي على الجهاز.");
    window.speechSynthesis.speak(utterance);
    setStatus("جارٍ نطق البيت…");
  };

  // ─── قائمة تشغيل الأبيات المتتالية (الضغط المطول) بصوت القارئ الحقيقي ───
  const speechSessionRef = useRef(0);
  const verseAudioRef = useRef<HTMLAudioElement | null>(null);
  const verseAudioStopRef = useRef<(() => void) | null>(null);

  const stopVerseAudio = () => {
    verseAudioStopRef.current?.();
    verseAudioStopRef.current = null;
    verseAudioRef.current?.pause();
  };

  /** يوقف قائمة التشغيل ويُنهي جلسة النطق الحالية حتى لا يتسرب صوت بعدها. */
  const haltPlaylist = (message?: string) => {
    speechSessionRef.current += 1;
    stopVerseAudio();
    window.speechSynthesis?.cancel?.();
    setSequencePlaying(false);
    if (message) setStatus(message);
  };

  /** يشغّل بيتًا واحدًا من تسجيل القارئ عبر قصّ المقطع بين بداية البيت ونهايته. */
  const playVerseSegment = (
    targetReciter: TuhfaVerseReciter,
    verseNumber: number,
    onDone: () => void,
    onFail: () => void,
  ) => {
    if (!verseAudioRef.current) verseAudioRef.current = new Audio();
    const audio = verseAudioRef.current;
    stopVerseAudio();
    window.speechSynthesis?.cancel?.();
    if (audio.src !== targetReciter.url) {
      audio.src = targetReciter.url;
      audio.preload = "auto";
    }
    const [start, end] = tuhfaVerseWindow(targetReciter, verseNumber);
    let finished = false;

    const cleanup = () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadedmetadata", begin);
      if (verseAudioStopRef.current === stop) verseAudioStopRef.current = null;
    };
    const settle = (callback: () => void) => {
      if (finished) return;
      finished = true;
      audio.pause();
      cleanup();
      callback();
    };
    const onTime = () => {
      if (audio.currentTime >= end - 0.03) settle(onDone);
    };
    const onError = () => settle(onFail);
    const stop = () => {
      finished = true;
      cleanup();
    };
    const begin = () => {
      if (finished) return;
      try {
        audio.currentTime = start;
      } catch {
        // بعض المتصفحات ترفض التحديد قبل اكتمال التحميل؛ نكمل من موضع البداية.
      }
      audio.play().catch(onError);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("error", onError);
    verseAudioStopRef.current = stop;
    if (audio.readyState >= 1) begin();
    else audio.addEventListener("loadedmetadata", begin, { once: true });
  };
  const speakWithCallback = (text: string, onDone: () => void) => {
    if (!hasSpeechSynthesis()) {
      setStatus("النطق الصوتي غير مدعوم في هذا المتصفح.");
      onDone();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ar-SA";
    utterance.rate = 0.82;
    const voice = voices.find((item) => item.voiceURI === voiceUri) ?? getArabicVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = () => onDone();
    utterance.onerror = () => onDone();
    window.speechSynthesis.speak(utterance);
  };

  const playPlaylist = (list: { sectionId: string; verse: number }[], index = 0, repsLeft = repeatRef.current) => {
    const session = speechSessionRef.current;
    if (index >= list.length) {
      setSequencePlaying(false);
      setStatus("انتهت قائمة التشغيل.");
      return;
    }
    if (session !== speechSessionRef.current) return;
    const item = list[index];
    const section = tuhfaSections.find((entry) => entry.id === item.sectionId);
    const verse = section?.verses.find((entry) => entry.n === item.verse);
    if (!verse) {
      playPlaylist(list, index + 1, repsLeft);
      return;
    }
    setFocus({ sectionId: item.sectionId, verse: item.verse });
    setStatus(`تشغيل البيت ${item.verse} بصوت ${reciter.name} (تكرار متبقٍ ${repsLeft})…`);
    const advance = () => {
      if (session !== speechSessionRef.current) return;
      if (repeatRef.current === 0) playPlaylist(list, index, 0);
      else if (repsLeft > 1) playPlaylist(list, index, repsLeft - 1);
      else playPlaylist(list, index + 1, repeatRef.current);
    };
    playVerseSegment(reciter, item.verse, advance, () => {
      setStatus("تعذّر تحميل صوت القارئ لهذا البيت، جرى الرجوع إلى النطق الآلي.");
      speakWithCallback(`${verse.first} ${verse.second}`, advance);
    });
  };

  const startPlaylist = (list: { sectionId: string; verse: number }[]) => {
    if (list.length === 0) return;
    speechSessionRef.current += 1;
    audioRef.current?.pause();
    setPlaying(null);
    stopVerseAudio();
    window.speechSynthesis?.cancel?.();
    setSequencePlaying(true);
    playPlaylist(list, 0, repeatRef.current);
  };

  const stopPlaylist = () => {
    haltPlaylist("تم إيقاف قائمة التشغيل.");
  };

  const addToPlaylist = (sectionId: string, verseN: number) => {
    setPlaylist((previous) => {
      if (previous.some((item) => item.sectionId === sectionId && item.verse === verseN)) return previous;
      if (previous.length > 0) {
        const last = previous[previous.length - 1];
        if (last.sectionId !== sectionId || verseN !== last.verse + 1) {
          setStatus("يشترط أن تكون الأبيات المضافة متتالية مع آخر بيت محدد.");
          return previous;
        }
      }
      setStatus(`أُضيف البيت ${verseN}. اضغط مطولًا على البيت التالي لإضافته.`);
      return [...previous, { sectionId, verse: verseN }];
    });
  };

  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const onVersePointerDown = (sectionId: string, verseN: number) => {
    longPressFiredRef.current = false;
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      addToPlaylist(sectionId, verseN);
    }, 500);
  };
  const onVersePointerUp = (sectionId: string, verse: { n: number; first: string; second: string }) => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    if (longPressFiredRef.current) return;
    toggleVerse(sectionId, verse.n);
    speakVerse(`${verse.first} ${verse.second}`);
  };
  const onVersePointerCancel = () => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
  };

  // تنظيف كامل عند مغادرة المكوّن: الجلسة، صوت القائمة، الصوت العام، النطق، ومؤقت الضغط المطول.
  useEffect(() => () => {
    speechSessionRef.current += 1;
    verseAudioStopRef.current?.();
    verseAudioStopRef.current = null;
    verseAudioRef.current?.pause();
    audioRef.current?.pause();
    window.speechSynthesis?.cancel?.();
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const searchMatches = useMemo(() => {
    const query = normalizeArabic(searchQuery);
    if (!query) return [];
    return tuhfaSections.flatMap((section) =>
      section.verses
        .filter((verse) => normalizeArabic(`${verse.first} ${verse.second}`).includes(query))
        .map((verse) => ({ section, verse })),
    );
  }, [searchQuery]);

  const sectionMatches = useMemo(() => {
    const query = normalizeArabic(searchQuery);
    if (!query) return [];
    return tuhfaSections.filter((section) => normalizeArabic(section.title).includes(query));
  }, [searchQuery]);

  const openSearchMatch = (section: (typeof tuhfaSections)[number], verse: (typeof tuhfaSections)[number]["verses"][number]) => {
    haltPlaylist();
    setViewMode("sections");
    setOpen(section.id);
    setFocus({ sectionId: section.id, verse: verse.n });
    speakVerse(`${verse.first} ${verse.second}`);
    window.setTimeout(() => {
      document.getElementById(`tuhfa-verse-${section.id}-${verse.n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  };

  const openSection = (section: (typeof tuhfaSections)[number]) => {
    haltPlaylist();
    setViewMode("sections");
    setOpen(section.id);
    setFocus(null);
    setStatus(`تم فتح قسم «${section.title}». اضغط أي بيت لنطقه.`);
    window.setTimeout(() => {
      document.getElementById(`tuhfa-section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  const stopAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(null);
    setAudioProgress((previous) => ({ ...previous, loading: false, remaining: "تم إيقاف الصوت" }));
  };

  const playUrl = (url: string, id: string) => {
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    if (playing === id) {
      stopAudio();
      return;
    }
    // تشغيل صوت المتن أو القسم يوقف أي قائمة تشغيل جارية حتى لا يتداخل صوتان.
    haltPlaylist();
    audio.pause();
    audio.src = url;
    audio.preload = "auto";
    loadStartedAtRef.current = Date.now();
    setAudioProgress({ loading: true, percent: 0, remaining: "بدأ تحميل الصوت…", playbackRemaining: "" });
    repeatLeftRef.current = repeatRef.current;
    audio.onloadedmetadata = () => updateAudioProgress(audio);
    audio.onprogress = () => updateAudioProgress(audio);
    audio.oncanplay = () => updateAudioProgress(audio);
    audio.onwaiting = () => setAudioProgress((previous) => ({ ...previous, loading: true, remaining: "جارٍ التحميل…" }));
    audio.ontimeupdate = () => updateAudioProgress(audio);
    audio.play().catch(() => setStatus("تعذّر تشغيل صوت تحفة الأطفال. تحقق من الاتصال بالإنترنت."));
    setPlaying(id);
    audio.onended = () => {
      const forever = repeatRef.current === 0;
      if (forever || repeatLeftRef.current > 1) {
        if (!forever) repeatLeftRef.current -= 1;
        audio.currentTime = 0;
        audio.play().catch(() => setPlaying(null));
        return;
      }
      repeatLeftRef.current = repeatRef.current;
      setPlaying(null);
      setAudioProgress((previous) => ({ ...previous, loading: false }));
    };
  };

  const play = (section: (typeof tuhfaSections)[number]) => {
    playUrl(tuhfaAudioBase + encodeURIComponent(section.audioFile), section.id);
  };

  const playFullMatn = () => {
    playUrl(reciter.url, `full-${reciter.id}`);
  };

  const toggleVerse = (sectionId: string, verse: number) => {
    setSelected((previous) => {
      const current = new Set(previous[sectionId] ?? []);
      if (current.has(verse)) current.delete(verse);
      else current.add(verse);
      return { ...previous, [sectionId]: [...current].sort((a, b) => a - b) };
    });
  };

  const selectAll = (sectionId: string, count: number) => {
    setSelected((previous) => ({
      ...previous,
      [sectionId]: Array.from({ length: count }, (_, index) => index + 1),
    }));
  };

  const clearSelection = (sectionId: string) => {
    setSelected((previous) => ({ ...previous, [sectionId]: [] }));
  };

  const downloadSection = async (section: (typeof tuhfaSections)[number]) => {
    const url = tuhfaAudioBase + encodeURIComponent(section.audioFile);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("fetch failed");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${section.title}.mp3`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
      setStatus(`تم تنزيل صوت «${section.title}».`);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
      setStatus("فُتح رابط الصوت في تبويب جديد لتنزيله يدويًا.");
    }
  };

  const focusSelected = (sectionId: string) => {
    const list = selected[sectionId] ?? [];
    if (!list.length) {
      setStatus("اختر بيتًا واحدًا أو أكثر أولًا.");
      return;
    }
    setFocus({ sectionId, verse: list[0] });
    setStatus(`تم تحديد ${list.length} بيت/أبيات للتكرار ${repeat === 0 ? "بلا توقف" : `${repeat}×`} في العرض.`);
  };

  const repeatLabel = useMemo(() => (repeat === 0 ? "تكرار بلا توقف" : `تكرار العرض: ${repeat}×`), [repeat]);

  return (
    <div className={`tuhfa-widget ${viewMode === "full" ? "view-full" : "view-sections"} ${showDisplay ? "display-mode" : ""}`}>
      {showDisplay ? (
        <button type="button" className="display-back" onClick={() => setShowDisplay(false)}>
          ← رجوع للإعدادات
        </button>
      ) : null}
      <div className="widget-head">
        <h4>تحفة الأطفال (التجويد)</h4>
        <span className="badge badge-info">{tuhfaSections.reduce((sum, section) => sum + section.verses.length, 0)} بيت</span>
      </div>

      <div className="tuhfa-toolbar">
        <button
          type="button"
          className={`chip-toggle ${viewMode === "full" ? "active" : ""}`}
          onClick={() => {
            haltPlaylist();
            setViewMode(viewMode === "full" ? "sections" : "full");
          }}
        >
          <Icon name="book" size={16} /> {viewMode === "full" ? "النظم كاملًا" : "عرض الأقسام"}
        </button>
        <label>
          <span>تكرار الصوت والأبيات</span>
          <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
            <option value={0}>∞ بلا توقف</option>
            {[1, 2, 3, 5, 7, 10].map((value) => (
              <option key={value} value={value}>{value}×</option>
            ))}
          </select>
        </label>
        <label>
          <span>صوت نطق الأبيات</span>
          <select value={voiceUri} onChange={(e) => setVoiceUri(e.target.value)} disabled={!voices.length}>
            {voices.length ? voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>
            )) : <option value="">صوت النظام الافتراضي</option>}
          </select>
        </label>
        <label>
          <span>القارئ (المتن والأبيات)</span>
          <select
            value={reciter.id}
            onChange={(event) => {
              setReciterId(event.target.value);
              if (playing?.startsWith("full-")) stopAudio();
              haltPlaylist();
            }}
          >
            {tuhfaVerseReciters.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`chip-toggle ${playing?.startsWith("full-") ? "active" : ""}`}
          onClick={playFullMatn}
        >
          <Icon name={playing?.startsWith("full-") ? "pause" : "play"} size={16} />
          {playing?.startsWith("full-") ? "إيقاف المتن" : "استماع للمتن كاملًا"}
        </button>
        <button type="button" className="primary-button display-enter" onClick={() => setShowDisplay(true)}>
          دخول إلى الأبيات
        </button>
        <span className="muted">اختر ∞ للتكرار بلا توقف، ويمكنك تنزيل صوت القسم كاملًا أو تحديد أبيات للقراءة.</span>
      </div>

      <div className="tuhfa-playlist" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }}>
        <span className="muted" style={{ fontSize: 13 }}>القارئ: {reciter.name}</span>
        <strong style={{ fontSize: 13 }}>قائمة التشغيل:</strong>
        {playlist.length === 0 ? (
          <span className="muted">اضغط مطولًا على بيت لإضافته، ثم أضف ما يليه بالترتيب.</span>
        ) : (
          playlist.map((item, index) => (
            <span key={`${item.sectionId}-${item.verse}`} className="repeat-pill">
              {index + 1}. {item.verse}
            </span>
          ))
        )}
        <button
          type="button"
          className="chip-toggle"
          onClick={() => startPlaylist(playlist)}
          disabled={playlist.length === 0 || sequencePlaying}
        >
          <Icon name="play" size={14} /> تشغيل القائمة
        </button>
        {sequencePlaying ? (
          <button type="button" className="chip-toggle" onClick={stopPlaylist}>إيقاف</button>
        ) : null}
        <button
          type="button"
          className="ghost-button"
          onClick={() => {
            setPlaylist([]);
            stopPlaylist();
          }}
          disabled={playlist.length === 0}
        >
          مسح
        </button>
      </div>

      <div className="tuhfa-search-bar">
        <Icon name="search" size={17} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="ابحث في تحفة الأطفال عن كلمة أو حرف أو بيت…"
          aria-label="البحث في تحفة الأطفال"
        />
        {searchQuery.trim() ? <span className="muted">{searchMatches.length + sectionMatches.length} نتيجة</span> : null}
      </div>

      {playing || audioProgress.loading || audioProgress.percent > 0 ? (
        <div className="audio-download-card" aria-live="polite">
          <div className="audio-download-head">
            <span>{playing?.startsWith("full-") ? "يتحمّل المتن كاملًا" : playing ? "يتحمّل صوت القسم" : "تم إيقاف الصوت"}</span>
            <strong>{audioProgress.percent}%</strong>
          </div>
          <div className="audio-download-track">
            <span style={{ width: `${audioProgress.percent}%` }} />
          </div>
          <span className="muted">
            {audioProgress.remaining}{audioProgress.playbackRemaining ? ` • ${audioProgress.playbackRemaining}` : ""}
          </span>
        </div>
      ) : null}

      {searchQuery.trim() ? (
        <div className="tuhfa-search-panel">
          {searchMatches.length + sectionMatches.length === 0 ? (
            <p className="muted">لا توجد أبيات أو أقسام تحتوي على «{searchQuery.trim()}».</p>
          ) : (
            <>
              {sectionMatches.map((section) => (
                <button
                  key={`section-${section.id}`}
                  type="button"
                  className="tuhfa-search-result"
                  onClick={() => openSection(section)}
                >
                  <span className="tuhfa-search-ref">قسم • {section.title}</span>
                  <span className="muted">{section.verses.length} بيتًا — اضغط لفتح القسم.</span>
                </button>
              ))}
              {searchMatches.map(({ section, verse }) => (
                <button
                  key={`${section.id}-${verse.n}`}
                  type="button"
                  className="tuhfa-search-result"
                  onClick={() => openSearchMatch(section, verse)}
                >
                  <span className="tuhfa-search-ref">{section.title} • البيت {verse.n}</span>
                  <span>{verse.first}</span>
                  <span>{verse.second}</span>
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}

      {status ? <p className="muted tuhfa-status">{status}</p> : null}

      {viewMode === "full" ? (
        <div className="tuhfa-full">
          {tuhfaSections.map((section) => (
            <section key={section.id} className="tuhfa-full-section">
              <div className="tuhfa-full-head">
                <h5>{section.title}</h5>
                <div className="accordion-head-actions">
                  <button type="button" className="icon-button" onClick={() => play(section)} aria-label="تشغيل صوت القسم">
                    <Icon name={playing === section.id ? "pause" : "play"} size={16} />
                  </button>
                  <button type="button" className="icon-button" onClick={() => downloadSection(section)} aria-label="تنزيل صوت القسم">
                    <Icon name="download" size={16} />
                  </button>
                </div>
              </div>
              <div className="tuhfa-full-verses">
                {section.verses.map((verse) => {
                  const isSelected = (selected[section.id] ?? []).includes(verse.n);
                  return (
                    <button
                      key={verse.n}
                      type="button"
                      className={`tuhfa-full-verse ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        toggleVerse(section.id, verse.n);
                        speakVerse(`${verse.first} ${verse.second}`);
                      }}
                    >
                      <span className="tuhfa-full-num">{verse.n}</span>
                      <span className="tuhfa-hemistich">{verse.first}</span>
                      <span className="tuhfa-hemistich">{verse.second}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          <p className="muted tuhfa-note">اضغط بيتًا لنطقه تلقائيًا وتحديده. يمكنك أيضًا تشغيل صوت القسم كاملًا، ويتكرر بعدد التكرار المحدد.</p>
        </div>
      ) : null}

      {viewMode === "sections" ? <div className="accordion">
        {tuhfaSections.map((section) => {
          const sectionSelected = selected[section.id] ?? [];
          return (
            <div key={section.id} id={`tuhfa-section-${section.id}`} className={`accordion-item ${open === section.id ? "open" : ""}`}>
              <div className="accordion-head-row">
                <button type="button" className="accordion-head" onClick={() => {
                  haltPlaylist();
                  setOpen(open === section.id ? "" : section.id);
                }}>
                  <span>{section.title}</span>
                  <span className="verse-count">{section.verses.length} بيت</span>
                </button>
                <div className="accordion-head-actions">
                  <button type="button" className="icon-button" onClick={() => play(section)} aria-label="تشغيل صوت القسم">
                    <Icon name={playing === section.id ? "pause" : "play"} size={16} />
                  </button>
                  <button type="button" className="icon-button" onClick={() => downloadSection(section)} aria-label="تنزيل صوت القسم">
                    <Icon name="download" size={16} />
                  </button>
                </div>
              </div>
              {open === section.id ? (
                <div className="accordion-body">
                  <div className="tuhfa-section-actions">
                    <button type="button" className="chip-toggle" onClick={() => selectAll(section.id, section.verses.length)}>تحديد الكل</button>
                    <button type="button" className="chip-toggle" onClick={() => clearSelection(section.id)}>مسح التحديد</button>
                    <button type="button" className="primary-button" onClick={() => focusSelected(section.id)}>{repeatLabel}</button>
                    <span className="muted">المحدد: {sectionSelected.length}</span>
                  </div>
                  {section.verses.map((verse) => {
                    const isSelected = sectionSelected.includes(verse.n);
                    const isFocus = focus?.sectionId === section.id && focus.verse === verse.n;
                    return (
                      <div key={verse.n} id={`tuhfa-verse-${section.id}-${verse.n}`} className={`verse-row ${isSelected ? "selected" : ""} ${isFocus ? "active" : ""}`}>
                        <button type="button" className={`verse-select ${isSelected ? "active" : ""}`} onClick={() => {
                          toggleVerse(section.id, verse.n);
                          speakVerse(`${verse.first} ${verse.second}`);
                        }} aria-label={`تحديد ونطق البيت ${verse.n}`}>
                          {isSelected ? <Icon name="check" size={14} /> : verse.n}
                        </button>
                        <div
                          className="verse-text"
                          onPointerDown={() => onVersePointerDown(section.id, verse.n)}
                          onPointerUp={() => onVersePointerUp(section.id, verse)}
                          onPointerLeave={onVersePointerCancel}
                          onPointerCancel={onVersePointerCancel}
                          title="اضغط للاستماع، واضغط مطولًا لإضافة البيت لقائمة التشغيل"
                        >
                          <p>{verse.first}</p>
                          <p>{verse.second}</p>
                        </div>
                        {isSelected ? <span className="repeat-pill">×{repeat}</span> : null}
                      </div>
                    );
                  })}
                  <p className="muted tuhfa-note">اضغط البيت لنطقه، أو اضغط مطولًا لإضافته إلى قائمة تشغيل متتالية (٥٠٠ مللي ثانية). ملف الصوت الكامل للقسم متاح، ويمكن تكراره أكثر من مرة من شريط التكرار أعلاه.</p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div> : null}
      <audio ref={audioRef} preload="none" />
    </div>
  );
}
