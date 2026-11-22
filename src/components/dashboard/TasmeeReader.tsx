import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSurah, normalizeArabic, type Ayah } from "../../lib/quran";

import { surahs } from "../../data/surahs";
import { ayahAudioUrl, reciters } from "../../data/reciters";
import { Icon } from "./ui";
import { vibrate } from "../../lib/sound";
import { type VoiceInput } from "../../lib/audioInput";
import { matchDistance, wordMatches } from "../../lib/recitationMatch";
import {
  getTilawaPreloadSnapshot,
  loadTilawa,
  prepareMicrophone,
  retryTilawaPreload,
  subscribeTilawaPreload,
  type TilawaSession,
  type Microphone,
} from "../../lib/tilawaRecitation";
import { celebrate } from "../../lib/celebrate";
import { detectDialect, dialectTip, type DialectResult } from "../../lib/dialect";

type Phase = "config" | "reciting" | "result";

type ErrorEntry = { key: string; word: string; expected: string; spoken?: string; globalAyah: number; ayahText?: string };

function stripBismillah(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length >= 5 && tokens[0].startsWith("بِسْمِ")) return tokens.slice(4).join(" ");
  return text;
}

export type TasmeePreset = { surah: number; fromAyah: number; toAyah: number };

export type TasmeeOutcome = {
  surah: number;
  fromAyah: number;
  toAyah: number;
  progress: number;
  correct: number;
  wrong: number;
  cancelled: boolean;
};

export default function TasmeeReader({
  initialPhase,
  onOpenSettings,
  preset,
  onFinished,
}: {
  initialPhase?: "config" | "result";
  onOpenSettings?: () => void;
  preset?: TasmeePreset;
  onFinished?: (outcome: TasmeeOutcome) => void;
} = {}) {
  const [phase, setPhase] = useState<Phase>(initialPhase === "result" ? "result" : "config");
  const [surah, setSurah] = useState(preset?.surah ?? 1);
  const [fromAyah, setFromAyah] = useState(preset?.fromAyah ?? 1);
  const [toAyah, setToAyah] = useState(preset?.toAyah ?? 1);
  const [strictness, setStrictness] = useState<"strict" | "lenient">("strict");
  const [extraErrors, setExtraErrors] = useState(0);
  const errorLimit = (strictness === "strict" ? 3 : 8) + extraErrors;
  const [ayahs, setAyahs] = useState<Ayah[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [wrongKeys, setWrongKeys] = useState<Set<string>>(new Set());
  const [purpleKeys, setPurpleKeys] = useState<Set<string>>(new Set());
  const [yellowKey, setYellowKey] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [dialect, setDialect] = useState<DialectResult | null>(null);
  const dialectSamplesRef = useRef<string[]>([]);
  const [prepMsg, setPrepMsg] = useState("");
  const [reciter, setReciter] = useState(reciters[0]?.id ?? "ar.minshawi");


  const [errorLog, setErrorLog] = useState<ErrorEntry[]>(() => {
    if (initialPhase === "result") {
      try { return JSON.parse(localStorage.getItem("thimar.tasmeeLogs") || "[]"); } catch { return []; }
    }
    return [];
  });
  useEffect(() => {
    try { localStorage.setItem("thimar.tasmeeLogs", JSON.stringify(errorLog)); } catch { /* ignore */ }
  }, [errorLog]);
  const [reciting, setReciting] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [level, setLevel] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [isOffline, setIsOffline] = useState(() => (typeof navigator === "undefined" ? false : !navigator.onLine));
  const voiceRef = useRef<VoiceInput | null>(null);
  const sessionRef = useRef<TilawaSession | null>(null);
  const micRef = useRef<Microphone | null>(null);
  const [modelDownloading, setModelDownloading] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [modelError, setModelError] = useState("");
  const [engineStatus, setEngineStatus] = useState(getTilawaPreloadSnapshot);

  /* حالة المحرك المشترك من الإقلاع: لا نبدأ تجهيزًا جديدًا من هذه الشاشة. */
  useEffect(() => subscribeTilawaPreload(setEngineStatus), []);

  const levelFrameRef = useRef<number | null>(null);
  const [pausedPrompt, setPausedPrompt] = useState(false);
  const [startBoxVisible, setStartBoxVisible] = useState(false);
  const hasSpokenRef = useRef(false);
  const [cancelled, setCancelled] = useState(false);
  const [finished, setFinished] = useState(false);
  const [continuePrompt, setContinuePrompt] = useState(false);
  const [focusedWord, setFocusedWord] = useState<{ word: string; ayah: string } | null>(null);
  const promptShownRef = useRef(false);
  const startedAtRef = useRef(0);
  const consumedRef = useRef(0); // index in expectedWords
  const spokenConsumedRef = useRef(0); // index in spoken tokens processed
  const revealedRef = useRef<Set<string>>(new Set());
  const wrongKeysRef = useRef<Set<string>>(new Set());
  const purpleKeysRef = useRef<Set<string>>(new Set());
  const lockedKeyRef = useRef<string | null>(null);
  const tentativeRef = useRef<{ key: string; attempts: number } | null>(null);
  const expectedWordsRef = useRef<typeof expectedWords>([]);
  const strictnessRef = useRef(strictness);
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const outcomeSentRef = useRef(false);

  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResultTime = useRef<number>(0);

  const selectedAyahs = useMemo(() => {
    const start = Math.min(fromAyah, toAyah);
    const end = Math.max(fromAyah, toAyah);
    return ayahs.filter((a) => a.numberInSurah >= start && a.numberInSurah <= end);
  }, [ayahs, fromAyah, toAyah]);

  const selectedAyahsRef = useRef(selectedAyahs);
  useEffect(() => { selectedAyahsRef.current = selectedAyahs; }, [selectedAyahs]);

  const expectedWords = useMemo(() => {
    const list: { key: string; norm: string; word: string; globalAyah: number }[] = [];
    selectedAyahs.forEach((ayah) => {
      const text = ayah.numberInSurah === 1 && ayah.surah !== 1 && ayah.surah !== 9
        ? stripBismillah(ayah.text)
        : ayah.text;
      text.split(/\s+/).filter(Boolean).forEach((word, index) => {
        list.push({ key: `${ayah.number}:${index}`, norm: normalizeArabic(word), word, globalAyah: ayah.number });
      });
    });
    return list;
  }, [selectedAyahs]);

  useEffect(() => { expectedWordsRef.current = expectedWords; }, [expectedWords]);
  useEffect(() => { revealedRef.current = revealed; }, [revealed]);
  useEffect(() => { wrongKeysRef.current = wrongKeys; }, [wrongKeys]);
  useEffect(() => { purpleKeysRef.current = purpleKeys; }, [purpleKeys]);
  useEffect(() => { strictnessRef.current = strictness; }, [strictness]);

  /* حالة الشبكة: التسميع الكتابي يعمل دون إنترنت. */
  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchSurah(surah, controller.signal)
      .then((data) => {
        setAyahs(data);
        const range = presetRef.current;
        if (range && range.surah === surah) {
          setFromAyah(Math.max(1, Math.min(range.fromAyah, data.length || 1)));
          setToAyah(Math.max(1, Math.min(range.toAyah, data.length || 1)));
        } else {
          setFromAyah(1);
          setToAyah(data.length || 1);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "تعذّر تحميل السورة.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [surah]);


  /* متابعة تلقائية للكلمة الحالية: تُمرَّر الصفحة حتى تبقى الكلمة في وسط الشاشة. */
  useEffect(() => {
    if (!yellowKey) return;
    const element = document.querySelector(`[data-tasmee-key="${yellowKey}"]`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [yellowKey]);

  const beep = (freq = 880, dur = 0.15) => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.2;
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, dur * 1000);
    } catch { /* ignore */ }
  };

  const playWordSpeech = (word: string, rate?: number) => {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "ar-SA";
    utterance.rate = rate ?? Math.min(1, playbackSpeed);
    utterance.pitch = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  /**
   * تصحيح نطقي عند الخطأ: الكلمتان السابقتان بسرعة أعلى قليلًا،
   * ثم الكلمة الخطأ وحدها بسرعة أقل ليتضح موضع الخطأ. لا صوت في الوضع الصامت.
   */
  const speakCorrection = (key: string, word: string) => {
    if (!autoSpeak || !("speechSynthesis" in window)) return;
    const idx = expectedWordsRef.current.findIndex((item) => item.key === key);
    const before = expectedWordsRef.current
      .slice(Math.max(0, idx - 2), Math.max(0, idx))
      .map((item) => item.word)
      .join(" ");
    window.speechSynthesis.cancel();
    if (before) {
      const lead = new SpeechSynthesisUtterance(before);
      lead.lang = "ar-SA";
      lead.rate = Math.min(1.5, Math.max(1.1, playbackSpeed + 0.2));
      window.speechSynthesis.speak(lead);
    }
    const target = new SpeechSynthesisUtterance(word);
    target.lang = "ar-SA";
    target.rate = Math.max(0.45, Math.min(0.7, playbackSpeed - 0.3));
    window.speechSynthesis.speak(target);
  };

  /** فهرس أول كلمة في الآية التي تحتوي الفهرس المعطى (لإعادة الآية دون احتساب خطأ). */
  const ayahStartFor = (index: number) => {
    const ew = expectedWordsRef.current;
    const safe = Math.max(0, Math.min(index, ew.length - 1));
    const target = ew[safe];
    if (!target) return 0;
    let start = safe;
    while (start > 0 && ew[start - 1]?.globalAyah === target.globalAyah) start -= 1;
    return start;
  };

  const keyForWordRef = (ref: { surah: number; ayah: number; word: number } | null | undefined): string | null => {
    if (!ref) return null;
    const ayah = selectedAyahsRef.current.find((a) => a.surah === ref.surah && a.numberInSurah === ref.ayah);
    if (!ayah) return null;
    const index = Math.max(0, ref.word - 1);
    return `${ayah.number}:${index}`;
  };

  const applyRecitedText = (text: string) => {
    hasSpokenRef.current = true;
    setStartBoxVisible(false);
    const spoken = normalizeArabic(text).split(/\s+/).filter(Boolean);
    if (spoken.length === 0) return;
    // حفظ عيّنات الكلام لتحليل اللهجة في نهاية الجلسة.
    if (text.trim()) {
      dialectSamplesRef.current.push(text);
      if (dialectSamplesRef.current.length > 400) dialectSamplesRef.current.shift();
    }
    const ew = expectedWordsRef.current;
    const strict = strictnessRef.current;
    // highlight the word currently being recited
    const currentExpected = ew[consumedRef.current];
    if (currentExpected) setYellowKey(currentExpected.key);
    let startSpoken = spokenConsumedRef.current;
    if (spoken.length < startSpoken) startSpoken = Math.max(0, spoken.length - 1);
    const delta = spoken.slice(startSpoken);
    if (delta.length === 0) return;
    spokenConsumedRef.current = spoken.length;

    /* توقّف القارئ ثم أعاد ما قرأه: نعود معه إلى أول الآية التي يقرأها
       بدل احتساب كلمة من الآية التالية خطأً. */
    if (lastResultTime.current > 0 && Date.now() - lastResultTime.current > 2500) {
      const start = ayahStartFor(consumedRef.current);
      if (start < consumedRef.current) {
        consumedRef.current = start;
        lockedKeyRef.current = null;
        tentativeRef.current = null;
      }
    }

    // الرجوع إلى آية سابقة أو إعادة كلمة: يُتتبَّع ويُعاد من موضعها دون اعتبارها خطأ.
    if (delta.length >= 1) {
      const lookbackStart = Math.max(0, consumedRef.current - (delta.length >= 2 ? 40 : 8));
      for (let start = consumedRef.current - 1; start >= lookbackStart; start -= 1) {
        const word = ew[start];
        if (!word || !revealedRef.current.has(word.key)) continue;
        if (!wordMatches(delta[0], word.norm, strict)) continue;
        let matched = 1;
        for (let k = 1; k < delta.length && start + k < ew.length; k += 1) {
          if (wordMatches(delta[k], ew[start + k].norm, strict)) matched += 1;
          else break;
        }
        if (matched >= Math.min(delta.length, 2)) {
          consumedRef.current = start;
          lockedKeyRef.current = null;
          tentativeRef.current = null;
          break;
        }
      }
    }

    // إعادة نطق كلمات سبق قراءتها → تُعلَّم باللون البنفسجي.
    const previousWords = ew.slice(Math.max(0, consumedRef.current - 14), consumedRef.current);
    const repeatPurple = new Set(purpleKeysRef.current);
    let repeatChanged = false;
    delta.forEach((sw) => {
      if (sw.length < 3) return;
      const hit = previousWords.find((w) => w.norm.length >= 3 && revealedRef.current.has(w.key) && wordMatches(sw, w.norm, "strict"));
      if (hit && !repeatPurple.has(hit.key)) {
        repeatPurple.add(hit.key);
        repeatChanged = true;
      }
    });
    if (repeatChanged) {
      purpleKeysRef.current = repeatPurple;
      setPurpleKeys(repeatPurple);
    }

    // إذا كنا متوقّفين على كلمة خاطئة: جرّب تصحيحها فقط.
    const locked = lockedKeyRef.current;
    if (locked) {
      const lockedWord = ew.find((w) => w.key === locked);
      if (lockedWord) {
        const corrected = delta.some((sw) => wordMatches(sw, lockedWord.norm, strict));
        if (delta.length > 0 && corrected) {
          // تم التصحيح: اجعلها بنفسجية (إعادة نطق).
          lockedKeyRef.current = null;
          tentativeRef.current = null;
          const nextRevealed = new Set(revealedRef.current);
          nextRevealed.add(locked);
          const nextWrong = new Set(wrongKeysRef.current);
          nextWrong.delete(locked);
          const nextPurple = new Set(purpleKeysRef.current);
          nextPurple.add(locked);
          revealedRef.current = nextRevealed;
          wrongKeysRef.current = nextWrong;
          purpleKeysRef.current = nextPurple;
          setRevealed(nextRevealed);
          setWrongKeys(nextWrong);
          setPurpleKeys(nextPurple);
          const idx = ew.findIndex((w) => w.key === locked);
          if (idx >= 0) consumedRef.current = idx + 1;
          beep(880, 0.1);
        } else {
          // فرصة ثانية قبل اعتبارها خطأ (أخطاء المحرّك واللهجة).
          const attempts = tentativeRef.current?.key === locked ? tentativeRef.current.attempts + 1 : 1;
          if (attempts <= 2) {
            tentativeRef.current = { key: locked, attempts };
            beep(520, 0.08);
          } else {
            tentativeRef.current = null;
            lockedKeyRef.current = null;
            const nextWrong = new Set(wrongKeysRef.current);
            nextWrong.add(locked);
            wrongKeysRef.current = nextWrong;
            setWrongKeys(nextWrong);
            setErrorLog((prev) => {
              if (prev.some((e) => e.key === locked)) return prev;
              const entry = ew.find((w) => w.key === locked);
              const ayahText = selectedAyahs.find((a) => a.number === entry?.globalAyah)?.text ?? "";
              return [...prev, {
                key: locked,
                word: entry?.word ?? lockedWord.word,
                expected: lockedWord.norm,
                spoken: delta.join(" "),
                globalAyah: entry?.globalAyah ?? 0,
                ayahText,
              }];
            });
            beep(660, 0.12);
            vibrate([120, 60, 120]);
            const idx = ew.findIndex((w) => w.key === locked);
            if (idx >= 0) consumedRef.current = idx + 1;
          }
        }
      }
      lastResultTime.current = Date.now();
      resetPauseTimer();
      return;
    }

    const nextRevealed = new Set(revealedRef.current);
    const nextWrong = new Set(wrongKeysRef.current);
    const newErrors: ErrorEntry[] = [];
    let si = 0;
    for (let i = consumedRef.current; i < ew.length && si < delta.length; i++) {
      const w = ew[i];
      const windowSlice = delta.slice(si, si + (strict === "lenient" ? 12 : 4));
      let bestIdx = -1;
      let bestDist = Infinity;
      windowSlice.forEach((sw, idx) => {
        const d = matchDistance(sw, w.norm);
        if (d < bestDist) { bestDist = d; bestIdx = idx; }
      });
      if (bestIdx >= 0) {
        const spokenToken = windowSlice[bestIdx];
        if (wordMatches(spokenToken, w.norm, strict)) {
          tentativeRef.current = null;
          const wasRevealed = revealedRef.current.has(w.key);
          nextRevealed.add(w.key);
          if (wasRevealed) {
            const nextPurple = new Set(purpleKeysRef.current);
            nextPurple.add(w.key);
            purpleKeysRef.current = nextPurple;
            setPurpleKeys(nextPurple);
          }
        } else {
          const attempts = tentativeRef.current?.key === w.key ? tentativeRef.current.attempts + 1 : 1;
          if (attempts <= 2) {
            // فرصة ثانية قبل تسجيل الخطأ: كثير من الأخطاء من المحرّك أو اللهجة.
            tentativeRef.current = { key: w.key, attempts };
            lockedKeyRef.current = w.key;
            consumedRef.current = i;
            setYellowKey(w.key);
            beep(520, 0.08);
            break;
          }
          tentativeRef.current = null;
          nextWrong.add(w.key);
          const ayahText = selectedAyahs.find((a) => a.number === w.globalAyah)?.text ?? "";
          newErrors.push({ key: w.key, word: w.word, expected: w.norm, spoken: delta[si + bestIdx], globalAyah: w.globalAyah, ayahText });
          // توقّف عند الخطأ حتى تُقرأ الكلمة صحيحة.
          lockedKeyRef.current = w.key;
        }
        si += bestIdx + 1;
        if (lockedKeyRef.current === w.key && nextWrong.has(w.key) && !nextRevealed.has(w.key)) {
          // لا تنتقل إلى الكلمات التالية.
          consumedRef.current = i; // stay on current
          break;
        } else {
          consumedRef.current = i + 1;
        }
      } else {
        // couldn't match expected word in window; skip spoken word and try again with same expected
        si += 1;
        i -= 1;
      }
    }
    if (newErrors.length > 0) {
      beep(660, 0.12);
      vibrate([120, 60, 120]);
      if (autoSpeak && newErrors[0]) {
        speakCorrection(newErrors[0].key, newErrors[0].word);
      }
      setErrorLog((prev) => {
        const keys = new Set(prev.map((e) => e.key));
        const merged = [...prev];
        newErrors.forEach((e) => { if (!keys.has(e.key)) merged.push(e); });
        return merged;
      });
    }
    if (nextWrong.size > errorLimit && !promptShownRef.current) {
      promptShownRef.current = true;
      setContinuePrompt(true);
      beep(440, 0.25);
    }
    const nextPending = ew.find((w) => !nextRevealed.has(w.key) && !nextWrong.has(w.key));
    revealedRef.current = nextRevealed;
    wrongKeysRef.current = nextWrong;
    setYellowKey(nextPending?.key ?? null);
    setRevealed(nextRevealed);
    setWrongKeys(nextWrong);
    lastResultTime.current = Date.now();
    resetPauseTimer();
  };

  /** إعادة الآية الحالية من أولها بلا احتساب خطأ للكلمة التالية. */
  const repeatAyah = () => {
    const ew = expectedWordsRef.current;
    const start = ayahStartFor(consumedRef.current);
    consumedRef.current = start;
    lockedKeyRef.current = null;
    tentativeRef.current = null;
    setYellowKey(ew[start]?.key ?? null);
    beep(760, 0.08);
    lastResultTime.current = Date.now();
    resetPauseTimer();
  };

  const resetPauseTimer = () => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    if (cancelTimer.current) clearTimeout(cancelTimer.current);
    setPausedPrompt(false);
    /* يظهر السؤال بعد 10 ثوانٍ من التوقف عن القراءة؛ إن لم يُجَب خلال 10 ثوانٍ تُلغى الجلسة. */
    pauseTimer.current = setTimeout(() => {
      setPausedPrompt(true);
      setStartBoxVisible(true);
      cancelTimer.current = setTimeout(() => {
        cancelTasmee();
      }, 10000);
    }, 10000);
  };

  const clearTimers = () => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    if (cancelTimer.current) clearTimeout(cancelTimer.current);
    pauseTimer.current = null;
    cancelTimer.current = null;
  };

  const stopRecitation = () => {
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    recognitionRef.current = null;
    try { void micRef.current?.stop(); } catch { /* ignore */ }
    micRef.current = null;
    try { sessionRef.current?.dispose(); } catch { /* ignore */ }
    sessionRef.current = null;
    if (levelFrameRef.current !== null) {
      cancelAnimationFrame(levelFrameRef.current);
      levelFrameRef.current = null;
    }
    voiceRef.current?.stop();
    voiceRef.current = null;
    setLevel(0);
    setReciting(false);
    setStartBoxVisible(false);
    clearTimers();
    setPausedPrompt(false);
  };

  const saveTasmeeSession = () => {
    try {
      const raw = localStorage.getItem("thimar.tasmeeSessions");
      const sessions = raw ? JSON.parse(raw) : [];
      sessions.unshift({
        at: Date.now(),
        cancelled,
        progress,
        revealed: revealed.size,
        wrong: wrongKeys.size,
        errorLog,
        duration: startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0,
        surahName: selectedAyahs[0]?.surahName ?? "",
        range: `الآيات ${selectedAyahs[0]?.numberInSurah ?? ""}–${selectedAyahs[selectedAyahs.length - 1]?.numberInSurah ?? ""}`,
      });
      localStorage.setItem("thimar.tasmeeSessions", JSON.stringify(sessions.slice(0, 50)));
    } catch { /* ignore */ }
  };
  const reportOutcome = (wasCancelled: boolean) => {
    if (outcomeSentRef.current) return;
    outcomeSentRef.current = true;
    onFinishedRef.current?.({
      surah,
      fromAyah,
      toAyah,
      progress,
      correct: revealed.size,
      wrong: wrongKeys.size,
      cancelled: wasCancelled,
    });
  };

  const cancelTasmee = () => {
    stopRecitation();
    setCancelled(true);
    setFinished(true);
    setDialect(detectDialect(dialectSamplesRef.current));
    saveTasmeeSession();
    setPhase("result");
    reportOutcome(true);
  };

  const finishTasmee = () => {
    stopRecitation();
    setFinished(true);
    setDialect(detectDialect(dialectSamplesRef.current));
    saveTasmeeSession();
    setPhase("result");
    reportOutcome(false);
    // احتفال عند إتمام التسميع بلا أخطاء.
    if (wrongKeys.size === 0 && revealed.size > 0) celebrate("memorize");
  };

  const handleContinueYes = () => {
    setContinuePrompt(false);
    // بعد موافقة القارئ على المتابعة لا نُرسل الرسالة مجددًا.
    promptShownRef.current = true;
    setExtraErrors(wrongKeys.size + 5);
  };

  const handleContinueNo = () => {
    setContinuePrompt(false);
    cancelTasmee();
  };

  const startOfflineVoice = async () => {
    setSpeechError("");
    setModelError("");
    hasSpokenRef.current = false;
    setStartBoxVisible(true);
    // تجهيز الميكروفون داخل إيماءة المستخدم (iOS).
    let prepared: ReturnType<typeof prepareMicrophone> | undefined;
    try {
      prepared = prepareMicrophone();
    } catch {
      setSpeechError("لم يُسمح باستخدام الميكروفون. اسمح بالوصول من إعدادات المتصفح.");
      return;
    }

    setModelDownloading(true);
    setModelProgress(0);
    let tilawa: Awaited<ReturnType<typeof loadTilawa>>;
    try {
      tilawa = await loadTilawa((p) => setModelProgress(p.fraction ?? 0));
    } catch (error) {
      prepared.release();
      setModelDownloading(false);
      const message = error instanceof Error ? error.message : "تعذّر تجهيز التسميع الصوتي.";
      setModelError(message);
      setSpeechError(
        getTilawaPreloadSnapshot().bundled
          ? "تعذّر تجهيز التسميع الصوتي. أعد المحاولة، وإن تكرّر فأعد تثبيت التطبيق."
          : message,
      );
      return;
    }
    setModelDownloading(false);

    const start = Math.min(fromAyah, toAyah);
    const end = Math.max(fromAyah, toAyah);
    const session = tilawa.startMemorization({ surah, fromAyah: start, toAyah: end }, { confirm: { after: "next-word" } });
    sessionRef.current = session;

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "capabilities") {
        /* إمكانات المحرك تفاصيل تقنية داخلية لا تُعرض للمستخدم. */
        return;
      }
      if (event.type === "position") {
        if (!hasSpokenRef.current) {
          hasSpokenRef.current = true;
          setStartBoxVisible(false);
        }
        const obs = event.observed?.[0]?.word;
        const key = keyForWordRef(obs);
        if (key) {
          const already = revealedRef.current.has(key);
          const nextRevealed = new Set(revealedRef.current);
          nextRevealed.add(key);
          revealedRef.current = nextRevealed;
          setRevealed(nextRevealed);
          if (already) {
            const nextPurple = new Set(purpleKeysRef.current);
            nextPurple.add(key);
            purpleKeysRef.current = nextPurple;
            setPurpleKeys(nextPurple);
          }
        }
        const expectedKey = keyForWordRef(event.expected);
        if (expectedKey) setYellowKey(expectedKey);
      } else if (event.type === "checker") {
        if (event.state === "confirmed" && /wrong_word|omitted_word|added_word|skipped_passage/.test(event.errorClass)) {
          const key = keyForWordRef(event.location);
          if (key) {
            const nextWrong = new Set(wrongKeysRef.current);
            nextWrong.add(key);
            wrongKeysRef.current = nextWrong;
            setWrongKeys(nextWrong);
            setErrorLog((prev) => {
              if (prev.some((e) => e.key === key)) return prev;
              const parts = key.split(":");
              const ayahNum = Number(parts[0]);
              const wordIndex = Number(parts[1]);
              const entry = expectedWordsRef.current.find((w) => w.key === key);
              const ayahText = selectedAyahsRef.current.find((a) => a.number === ayahNum)?.text ?? "";
              const words = ayahText.split(/\s+/).filter(Boolean);
              return [...prev, {
                key,
                word: entry?.word ?? words[wordIndex] ?? "",
                expected: entry?.norm ?? words[wordIndex] ?? "",
                spoken: "",
                globalAyah: ayahNum,
                ayahText,
              }];
            });
          }
        }
      }
    });

    try {
      const mic = await tilawa.listen(session, {
        prepared,
        onLevel: (db) => {
          const levelValue = Math.max(0, Math.min(1, (db + 60) / 54));
          setLevel(levelValue);
        },
      });
      micRef.current = mic;
      (session as unknown as { __unsub?: () => void }).__unsub = unsubscribe;
      setReciting(true);
      lastResultTime.current = Date.now();
      resetPauseTimer();
      // keep level ticker via level() fallback not needed
    } catch (error) {
      try { unsubscribe(); } catch { /* ignore */ }
      session.dispose();
      sessionRef.current = null;
      prepared.release();
      setSpeechError(error instanceof Error ? error.message : "تعذّر بدء الاستماع.");
    }
  };

  const toggleRecitation = async () => {
    if (reciting) { stopRecitation(); setStartBoxVisible(false); return; }
    // المحرك (Tilawa) هو المسار الأساسي للتعرف (بدون إنترنت). Web Speech كخيار ثانوي.
    hasSpokenRef.current = false;
    setStartBoxVisible(true);
    await startOfflineVoice();
  };

  const startTasmee = () => {
    startedAtRef.current = Date.now();
    const empty = new Set<string>();
    revealedRef.current = empty;
    wrongKeysRef.current = empty;
    purpleKeysRef.current = empty;
    lockedKeyRef.current = null;
    tentativeRef.current = null;
    setRevealed(empty);
    setWrongKeys(new Set());
    setPurpleKeys(new Set());
    setErrorLog([]);
    setYellowKey(null);
    setCancelled(false);
    setFinished(false);
    setPausedPrompt(false);
    dialectSamplesRef.current = [];
    setDialect(null);
    consumedRef.current = 0;
    spokenConsumedRef.current = 0;
    promptShownRef.current = false;
    clearTimers();
    setPhase("reciting");
    void preloadAyahAudio(selectedAyahs);
  };

  const handlePauseWait = () => {
    setPausedPrompt(false);
    clearTimers();
    pauseTimer.current = setTimeout(() => {
      setPausedPrompt(true);
      cancelTimer.current = setTimeout(() => cancelTasmee(), 10000);
    }, 10000);
  };

  const handlePauseYes = () => {
    // reveal next unrevealed word in yellow
    const next = expectedWords.find((w) => !revealed.has(w.key) && !wrongKeys.has(w.key));
    if (next) setYellowKey(next.key);
    setPausedPrompt(false);
    clearTimers();
    resetPauseTimer();
  };

  const resolveAudioUrl = async (globalAyah: number) => {
    const url = ayahAudioUrl(reciter, globalAyah);
    const cacheName = `thimar-audio-${reciter}`;
    try {
      const cache = await caches.open(cacheName);
      const hit = await cache.match(url);
      if (hit) return URL.createObjectURL(await hit.blob());
      // نحفظ الصوت لأول مرة ليعمل لاحقًا دون إنترنت.
      const res = await fetch(url);
      if (res.ok) {
        await cache.put(url, res.clone());
        return URL.createObjectURL(await res.blob());
      }
    } catch { /* offline */ }
    return url;
  };

  const preloadAyahAudio = async (list: { number: number }[]) => {
    if (!("caches" in window)) return;
    const targets = list.slice(0, 40);
    if (targets.length === 0) return;
    setPrepMsg(`جارٍ تجهيز الصوت للعمل دون إنترنت (0/${targets.length})`);
    try {
      const cache = await caches.open(`thimar-audio-${reciter}`);
      let done = 0;
      for (const ayah of targets) {
        const url = ayahAudioUrl(reciter, ayah.number);
        try {
          if (!(await cache.match(url))) {
            const res = await fetch(url);
            if (res.ok) await cache.put(url, res);
          }
        } catch { /* تجاهل */ }
        done += 1;
        setPrepMsg(`جارٍ تجهيز الصوت للعمل دون إنترنت (${done}/${targets.length})`);
      }
      setPrepMsg(`الصوت جاهز دون إنترنت (${targets.length} آية)`);
      window.setTimeout(() => setPrepMsg(""), 3500);
    } catch {
      setPrepMsg("");
    }
  };
  const playAyahAudio = async (globalAyah: number) => {
    const url = await resolveAudioUrl(globalAyah);
    const audio = new Audio(url);
    audio.playbackRate = playbackSpeed;
    audio.play().catch(() => {});
  };
  const playWordSlice = async (globalAyah: number, wordIndex: number, totalWords: number, count = 1) => {
    const url = await resolveAudioUrl(globalAyah);
    const audio = new Audio(url);
    audio.playbackRate = playbackSpeed;
    const onMeta = () => {
      const dur = audio.duration || 0;
      if (!dur || !isFinite(dur)) { audio.play().catch(() => {}); return; }
      const per = dur / Math.max(1, totalWords);
      const start = Math.max(0, wordIndex * per);
      const len = per * Math.max(1, count);
      audio.currentTime = start;
      audio.play().catch(() => {});
      window.setTimeout(() => { try { audio.pause(); } catch { /* ignore */ } }, Math.max(200, len * 1000));
    };
    if (audio.readyState >= 1) onMeta();
    else audio.addEventListener("loadedmetadata", onMeta, { once: true });
  };

  const progress = expectedWords.length > 0
    ? Math.round(((revealed.size + wrongKeys.size) / expectedWords.length) * 100)
    : 0;

  const allDone = expectedWords.length > 0 && revealed.size + wrongKeys.size >= expectedWords.length;

  useEffect(() => {
    if (phase === "reciting" && allDone && !finished) {
      setStartBoxVisible(true);
      finishTasmee();
    }
  }, [phase, allDone, finished]);

  useEffect(() => {
    if (phase === "reciting" && !reciting && !finished && !hasSpokenRef.current) {
      setStartBoxVisible(true);
    }
  }, [phase, reciting, finished]);

  if (phase === "config") {
    return (
      <div className="page standalone-page mushaf-page tasmee-config-page">
        <div className="page-head standalone-head">
          <div>
            <h2>التسميع</h2>
          </div>
        </div>
        <div className="tasmee-config-fields">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>المستوى</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={strictness === "strict" ? "primary-button" : "ghost-button"}
                onClick={() => setStrictness("strict")}
                style={{ padding: "8px 18px", borderRadius: 10 }}
              >
                مشدد
              </button>
              <button
                type="button"
                className={strictness === "lenient" ? "primary-button" : "ghost-button"}
                onClick={() => setStrictness("lenient")}
                style={{ padding: "8px 18px", borderRadius: 10 }}
              >
                متساهل
              </button>
            </div>
          </div>
          <label>
            <span>السورة</span>
            <select value={surah} onChange={(e) => setSurah(Number(e.target.value))}>
              {surahs.map((s) => (
                <option key={s.n} value={s.n}>{s.n}. {s.name}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", gap: 6 }}>
            <span>من آية</span>
            <input type="number" min={1} max={ayahs.length || 1} value={fromAyah}
              onChange={(e) => setFromAyah(Number(e.target.value))} style={{ width: 50 }} />
            <span>إلى</span>
            <input type="number" min={1} max={ayahs.length || 1} value={toAyah}
              onChange={(e) => setToAyah(Number(e.target.value))} style={{ width: 50 }} />
          </label>
        </div>
        {loading ? <p className="muted">جارٍ تحميل السورة...</p> : null}
        {error ? <p className="game-error">{error}</p> : null}
        <label style={{ display: "block", margin: "8px 0" }}>
          <span>القارئ</span>
          <select value={reciter} onChange={(e) => setReciter(e.target.value)} style={{ marginInlineStart: 8 }}>
            {reciters.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="ghost-button" onClick={onOpenSettings} style={{ marginInlineEnd: 8 }}>
          <Icon name="download" size={16} /> تحميل نطق المصحف من الإعدادات
        </button>
        {engineStatus.state === "ready" ? (
          <p className="muted" style={{ margin: "8px 0", fontSize: 13, color: "#15803d" }}>
            التسميع الصوتي جاهز دون إنترنت ✓
          </p>
        ) : engineStatus.state === "loading" || modelDownloading ? (
          <p className="muted" style={{ margin: "8px 0", fontSize: 13 }}>
            جارٍ تجهيز التسميع الصوتي… {Math.round((engineStatus.state === "loading" ? engineStatus.progress : modelProgress) * 100)}%
          </p>
        ) : null}
        {engineStatus.state === "error" ? (
          <div style={{ margin: "8px 0" }}>
            <small className="game-error">تعذّر تجهيز التسميع الصوتي.</small>{" "}
            <button
              type="button"
              className="ghost-button"
              onClick={() => void (async () => {
                setModelError("");
                setModelDownloading(true);
                setModelProgress(0);
                try {
                  await retryTilawaPreload();
                } catch (e) {
                  setModelError(e instanceof Error ? e.message : "تعذّر التجهيز.");
                } finally {
                  setModelDownloading(false);
                }
              })()}
              disabled={modelDownloading}
            >
              إعادة المحاولة
            </button>
          </div>
        ) : null}
        {modelError ? <small className="game-error">{modelError}</small> : null}
        <button type="button" className="primary-button" onClick={startTasmee} disabled={loading || selectedAyahs.length === 0}>
          <Icon name="play" size={16} /> بدء التسميع
        </button>
      </div>
    );
  }

  if (phase === "reciting") {
    return (
      <div className="tasmee-screen">
        {startBoxVisible ? (
          <div
            style={{
              position: "fixed",
              bottom: 24,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1300,
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "10px 18px",
              borderRadius: 999,
              background: "rgba(15,95,78,0.92)",
              color: "#fff",
              boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
              fontSize: 22,
              fontWeight: 700,
              backdropFilter: "blur(6px)",
            }}
            aria-live="polite"
          >
            <span>⏺️</span>
            <span>⏸️</span>
          </div>
        ) : null}
        <button type="button" className="tasmee-close" onClick={() => { stopRecitation(); setPhase("config"); }} aria-label="إغلاق">×</button>
        <div className="tasmee-topbar">
          <button type="button" className={`chip-toggle ${reciting ? "active" : ""}`} onClick={toggleRecitation}>
            <Icon name="mic" size={16} /> {reciting ? "إيقاف" : "بدء التلاوة"}
          </button>
          {reciting ? (
            <span className="tasmee-level" title="مستوى الصوت بعد عزل الضوضاء وتكبيره">
              <span style={{ width: `${Math.round(level * 100)}%` }} />
            </span>
          ) : null}
          <button
            type="button"
            className={`chip-toggle ${autoSpeak ? "active" : ""}`}
            onClick={() => setAutoSpeak((prev) => !prev)}
            title="نطق الكلمة الصحيحة تلقائيًا عند الخطأ"
          >
            <Icon name="volume" size={16} /> {autoSpeak ? "النطق التلقائي" : "صامت"}
          </button>
          <button
            type="button"
            className="chip-toggle"
            onClick={repeatAyah}
            title="أعد الآية من أولها دون احتساب خطأ للكلمة التالية"
          >
            <Icon name="arrow-right" size={16} /> إعادة الآية
          </button>
          <button
            type="button"
            className={`chip-toggle ${manualOpen ? "active" : ""}`}
            onClick={() => setManualOpen((open) => !open)}
            title="تسميع كتابي أو بإملاء لوحة المفاتيح (يعمل دون إنترنت)"
          >
            <Icon name="file" size={16} /> تسميع كتابي
          </button>
          <button type="button" className="primary-button" onClick={finishTasmee}>إنهاء</button>
          {isOffline ? (
            <span className="tasmee-badge">بدون إنترنت — التسميع الكتابي جاهز</span>
          ) : (
            <span className="tasmee-badge">عزل الضوضاء وتكبير الصوت مفعّل</span>
          )}
          {speechError ? <span className="game-error">{speechError}</span> : null}
          {prepMsg ? <span className="muted" style={{ fontSize: 12 }}>{prepMsg}</span> : null}
        </div>
        {manualOpen ? (
          <div className="error-box" style={{ margin: "8px 0", background: "var(--bg-2)" }}>
            <p style={{ marginTop: 0, marginBottom: 8 }}>
              اكتب ما قرأته (أو استخدم إملاء لوحة المفاتيح)، وسيُقارن بنص المصحف المحلي ويعمل دون إنترنت.
            </p>
            <textarea
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              placeholder="اكتب ما قرأته هنا…"
              style={{ width: "100%", minHeight: 80, padding: 8, borderRadius: 8, fontSize: 16 }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  if (!manualText.trim()) return;
                  applyRecitedText(manualText);
                  setManualText("");
                }}
              >
                تطبيق
              </button>
              <button type="button" className="ghost-button" onClick={() => setManualText("")}>مسح</button>
            </div>
          </div>
        ) : null}
        {pausedPrompt ? (
          <div className="error-box" style={{ margin: "8px 0" }}>
            <p>هل أنت هنا؟</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="ghost-button" onClick={handlePauseWait}>انتظر</button>
              <button type="button" className="primary-button" onClick={handlePauseYes}>نعم</button>
            </div>
          </div>
        ) : null}
        <div
          className="tasmee-reciting-container"
          style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "stretch", paddingBottom: 8, overflowY: "auto" }}
        >
          {selectedAyahs.map((ayah) => {
            return (
            <div key={ayah.number} data-ayah-number={ayah.number} style={{ width: "100%", flex: "0 0 auto" }}>
              {ayah.numberInSurah === 1 ? (
                <>
                  <div style={{ textAlign: "center", margin: "12px 0 4px", fontWeight: 700, color: "#0f5f4e", fontSize: "1.25em" }}>{surahs[ayah.surah - 1]?.name ?? ayah.surahName}</div>
                  {ayah.surah !== 1 && ayah.surah !== 9 ? (
                    <div style={{ textAlign: "center", margin: "0 0 8px", fontWeight: 600, color: "#15803d", fontSize: "1.15em" }}>بسم الله الرحمن الرحيم</div>
                  ) : null}
                </>
              ) : null}
              <span className="mushaf-ayah-number" style={{ marginInlineEnd: 6 }}>{ayah.numberInSurah}</span>
              {(ayah.numberInSurah === 1 && ayah.surah !== 1 && ayah.surah !== 9 ? stripBismillah(ayah.text) : ayah.text).split(/\s+/).filter(Boolean).map((word, index) => {
                const key = `${ayah.number}:${index}`;
                const isRevealed = revealed.has(key);
                const isWrong = wrongKeys.has(key);
                const isPurple = purpleKeys.has(key);
                const isYellow = yellowKey === key;
                const hidden = !isRevealed && !isWrong;
                const bg = isWrong ? "rgba(239,68,68,0.32)" : isPurple ? "rgba(168,85,247,0.32)" : isRevealed ? "rgba(34,197,94,0.28)" : isYellow ? "rgba(250,204,21,0.28)" : "rgba(15,95,78,0.07)";
                const color = hidden ? "transparent" : isRevealed ? "#14532d" : "#111827";
                const ayahText = ayah.text;
                return (
                  <span key={index}
                    data-tasmee-key={key}
                    style={{ background: bg, color, borderRadius: 4, marginInlineEnd: 4, padding: "0 2px", cursor: "pointer" }}
                    onClick={() => {
                      // الضغط على الكلمة الخاطئة في جلسة التسميع: ينطقها وينتقل للكلمة التالية.
                      if (wrongKeysRef.current.has(key)) {
                        playWordSpeech(word);
                        const nextRevealed = new Set(revealedRef.current);
                        nextRevealed.add(key);
                        const nextWrong = new Set(wrongKeysRef.current);
                        nextWrong.delete(key);
                        const nextPurple = new Set(purpleKeysRef.current);
                        nextPurple.add(key);
                        revealedRef.current = nextRevealed;
                        wrongKeysRef.current = nextWrong;
                        purpleKeysRef.current = nextPurple;
                        setRevealed(nextRevealed);
                        setWrongKeys(nextWrong);
                        setPurpleKeys(nextPurple);
                        if (lockedKeyRef.current === key) lockedKeyRef.current = null;
                        const idx = expectedWords.findIndex((x) => x.key === key);
                        if (idx >= 0) consumedRef.current = idx + 1;
                        const nextPending = expectedWords.find((x, i) => i > idx && !nextRevealed.has(x.key) && !nextWrong.has(x.key));
                        setYellowKey(nextPending?.key ?? null);
                        return;
                      }
                      const w = window as unknown as { __tasmeeTap?: { key: string; t: number } };
                      const now = Date.now();
                      if (w.__tasmeeTap && w.__tasmeeTap.key === key && now - w.__tasmeeTap.t < 350) {
                        w.__tasmeeTap = undefined;
                        const newRevealed = new Set(revealedRef.current);
                        newRevealed.add(key);
                        revealedRef.current = newRevealed;
                        setRevealed(newRevealed);
                      } else {
                        w.__tasmeeTap = { key, t: now };
                      }
                    }}
                    onPointerDown={() => {
                      const t = setTimeout(() => setFocusedWord({ word, ayah: ayahText }), 500);
                      (window as unknown as { __lp?: ReturnType<typeof setTimeout> }).__lp = t;
                    }}
                    onPointerUp={() => { const t = (window as unknown as { __lp?: ReturnType<typeof setTimeout> }).__lp; if (t) clearTimeout(t); }}
                    onPointerLeave={() => { const t = (window as unknown as { __lp?: ReturnType<typeof setTimeout> }).__lp; if (t) clearTimeout(t); }}
                  >
                    {word}{" "}
                  </span>
                );
              })}
            </div>
          );
          })}
        </div>
        {focusedWord ? (
          <div style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }} onClick={() => setFocusedWord(null)}>
            <div style={{ background: "var(--card)", padding: 24, borderRadius: 12, maxWidth: 420, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
              <p style={{ fontSize: 28, margin: 0 }}>{focusedWord.word}</p>
              <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>{focusedWord.ayah}</p>
              <button type="button" className="primary-button" style={{ marginTop: 12 }} onClick={() => { playWordSpeech(focusedWord.word); }}>سماع الكلمة</button>
            </div>
          </div>
        ) : null}
        <p className="muted" style={{ marginTop: 8, textAlign: "center" }}>التقدم: {progress}% • أخطاء: {wrongKeys.size}/{errorLimit}</p>
        {continuePrompt ? (
          <div style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }}>
            <div className="error-box" style={{ background: "var(--card)", padding: 24, borderRadius: 12, maxWidth: 400, textAlign: "center" }}>
              <p>تجاوزت حد الأخطاء. هل تريد المتابعة؟</p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
                <button type="button" className="ghost-button" onClick={handleContinueNo}>لا</button>
                <button type="button" className="primary-button" onClick={handleContinueYes}>نعم</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // result
  return (
    <div className="tasmee-result">
      <div className="tasmee-result-inner">
        <h2 style={{ textAlign: "center" }}>نتيجة التسميع</h2>
        <p className="muted" style={{ textAlign: "center" }}>{cancelled ? "تم إلغاء التسميع" : "اكتمل التسميع"}</p>
        <div className="tasmee-stats">
          <div className="tasmee-stat"><span>التقدم</span><strong>{progress}%</strong></div>
          <div className="tasmee-stat"><span>كلمات صحيحة</span><strong>{revealed.size}</strong></div>
          <div className="tasmee-stat"><span>أخطاء</span><strong>{wrongKeys.size}</strong></div>
        </div>
        {cancelled ? <p className="game-error" style={{ textAlign: "center" }}>تم الإلغاء بسبب التأخر أو تجاوز حد الأخطاء.</p> : null}
        {dialect ? (
          <div className="dialect-badge">
            <strong>لهجة التسميع: {dialect.name}</strong>
            <span>{Math.round(dialect.confidence * 100)}% · {dialect.hits} كلمة دالة</span>
            <p>{dialectTip(dialect.id)}</p>
          </div>
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0", justifyContent: "center" }}>
          <span>القارئ</span>
          <select value={reciter} onChange={(e) => setReciter(e.target.value)}>
            {reciters.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div className="tasmee-reciting-container" style={{ marginTop: 12 }}>
          {selectedAyahs.filter((ayah) => {
            const text = ayah.numberInSurah === 1 && ayah.surah !== 1 && ayah.surah !== 9 ? stripBismillah(ayah.text) : ayah.text;
            return text.split(/\s+/).filter(Boolean).some((_, index) => {
              const key = `${ayah.number}:${index}`;
              return revealed.has(key) || wrongKeys.has(key);
            });
          }).map((ayah) => (
            <div key={ayah.number} style={{ marginBottom: 12 }}>
              <span className="mushaf-ayah-number" style={{ marginInlineEnd: 6 }}>{ayah.numberInSurah}</span>
              {(ayah.numberInSurah === 1 && ayah.surah !== 1 && ayah.surah !== 9 ? stripBismillah(ayah.text) : ayah.text).split(/\s+/).filter(Boolean).map((word, index) => {
                const key = `${ayah.number}:${index}`;
                const isWrong = wrongKeys.has(key);
                const isRevealed = revealed.has(key);
                const isPurple = purpleKeys.has(key);
                const bg = isWrong ? "rgba(239,68,68,0.32)" : isPurple ? "rgba(168,85,247,0.32)" : isRevealed ? "rgba(34,197,94,0.28)" : "rgba(0,0,0,0.06)";
                return <span key={index} style={{ background: bg, borderRadius: 4, marginInlineEnd: 4, padding: "0 2px" }}>{word} </span>;
              })}
            </div>
          ))}
        </div>
        {errorLog.length > 0 ? (
          <div>
            <h3>سجل الأخطاء</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {errorLog.map((e) => {
                const words = (e.ayahText || "").split(/\s+/).filter(Boolean);
                const idx = Number(String(e.key).split(":")[1]) || 0;
                const before = words[idx - 1] ?? "";
                const after = words[idx + 1] ?? "";
                return (
                <li key={e.key} style={{ margin: "8px 0", padding: 10, background: "rgba(239,68,68,0.12)", borderRadius: 6 }}>
                  {/* مربع 1: الكلمة الخاطئة مع زر يشغّل مقطع الكلمة فقط. */}
                  <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
                    <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "rgba(255,255,255,0.7)", borderRadius: 8 }}>
                      <span style={{ color: "#991b1b", fontSize: 18, fontWeight: 700 }}>{e.word}</span>
                      <button type="button" className="icon-button" onClick={() => {
                        const total = words.length || 1;
                        playWordSlice(e.globalAyah, idx, total);
                      }} aria-label="سماع الكلمة وحدها" title="سماع الكلمة وحدها">
                        <Icon name="volume" size={16} />
                      </button>
                    </div>
                    {/* مربع 2: الخطأ مع كلمة قبله وكلمة بعده فقط. */}
                    <div style={{ flex: 1, padding: "6px 10px", background: "rgba(255,255,255,0.55)", borderRadius: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontFamily: "Amiri, serif", fontSize: 17 }}>
                      {before ? <span className="muted">{before}</span> : null}
                      <span style={{ background: "rgba(239,68,68,0.35)", borderRadius: 4, padding: "0 3px" }}>{e.word}</span>
                      {after ? <span className="muted">{after}</span> : null}
                      {!before && !after ? <span className="muted">—</span> : null}
                      <button type="button" className="icon-button" onClick={() => {
                        const total = words.length || 1;
                        const from = Math.max(0, idx - 1);
                        const count = Math.min(total, idx + 2) - from;
                        playWordSlice(e.globalAyah, from, total, count);
                      }} aria-label="سماع الكلمة مع ما قبلها وما بعدها" title="سماع الكلمة مع التي قبلها والتي بعدها">
                        <Icon name="volume" size={14} />
                      </button>
                    </div>
                  </div>
                  {e.spoken ? <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>سمعت: «{e.spoken}»</p> : null}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <span className="muted" style={{ fontSize: 12 }}>سرعة القارئ</span>
                    <select value={playbackSpeed} onChange={(ev) => setPlaybackSpeed(Number(ev.target.value))} style={{ padding: "2px 6px", borderRadius: 6, fontSize: 12 }}>
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
                    </select>
                    <button type="button" className="ghost-button" onClick={() => playAyahAudio(e.globalAyah)} style={{ fontSize: 12 }}>
                      الآية كاملة
                    </button>
                  </div>
                </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="muted" style={{ textAlign: "center" }}>لا توجد أخطاء. أحسنت!</p>
        )}
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <button type="button" className="primary-button" onClick={() => setPhase("config")}>رجوع</button>
        </div>
      </div>
    </div>
  );
}
