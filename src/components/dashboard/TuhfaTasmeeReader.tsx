import { useEffect, useMemo, useRef, useState } from "react";
import { tuhfaSections, tuhfaAllVerses } from "../../data/tuhfa";
import { tuhfaVerseReciters, tuhfaVerseWindow } from "../../data/tuhfaVerseAudio";

import { normalizeArabic } from "../../lib/quran";
import { hasSpeechRecognition, recognitionErrorMessage } from "../../lib/speech";
import { Icon } from "./ui";
import { vibrate } from "../../lib/sound";
import { matchDistance, wordMatches } from "../../lib/recitationMatch";
import { startVoiceInput, type VoiceInput } from "../../lib/audioInput";
import { celebrate } from "../../lib/celebrate";
import { detectDialect, dialectTip, type DialectResult } from "../../lib/dialect";
import { loadSettings } from "../../lib/appStore";
import { useKeepScreenAwake } from "../../lib/useKeepScreenAwake";

type Phase = "config" | "reciting" | "result";

type ErrorEntry = {
  key: string;
  word: string;
  expected: string;
  spoken?: string;
  globalAyah: number;
  ayahText?: string;
  sectionId: string;
  verseNumber: number;
};

export default function TuhfaTasmeeReader({ initialPhase, onOpenSettings }: { initialPhase?: "config" | "result"; onOpenSettings?: () => void } = {}) {
  const [keepScreenAwake] = useState(() => loadSettings().keepScreenAwake);
  useKeepScreenAwake(keepScreenAwake);
  const [phase, setPhase] = useState<Phase>(initialPhase === "result" ? "result" : "config");
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [fromVerse, setFromVerse] = useState(1);
  const [toVerse, setToVerse] = useState(1);
  const [strictness, setStrictness] = useState<"strict" | "lenient">("strict");
  const [extraErrors, setExtraErrors] = useState(0);
  const errorLimit = (strictness === "strict" ? 3 : 8) + extraErrors;
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
  const [reciter, setReciter] = useState("ghamdi");


  const [errorLog, setErrorLog] = useState<ErrorEntry[]>(() => {
    if (initialPhase === "result") {
      try { return JSON.parse(localStorage.getItem("thimar.tuhfaLogs") || "[]"); } catch { return []; }
    }
    return [];
  });
  useEffect(() => {
    try { localStorage.setItem("thimar.tuhfaLogs", JSON.stringify(errorLog)); } catch { /* ignore */ }
  }, [errorLog]);
  const [reciting, setReciting] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [level, setLevel] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [isOffline, setIsOffline] = useState(() => (typeof navigator === "undefined" ? false : !navigator.onLine));
  const voiceRef = useRef<VoiceInput | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const [pausedPrompt, setPausedPrompt] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [finished, setFinished] = useState(false);
  const [continuePrompt, setContinuePrompt] = useState(false);
  const [focusedWord, setFocusedWord] = useState<{ word: string; sectionId: string; verseNumber: number } | null>(null);
  const promptShownRef = useRef(false);
  const startedAtRef = useRef(0);
  const consumedRef = useRef(0);
  const spokenConsumedRef = useRef(0);
  const revealedRef = useRef<Set<string>>(new Set());
  const wrongKeysRef = useRef<Set<string>>(new Set());
  const purpleKeysRef = useRef<Set<string>>(new Set());
  const tentativeRef = useRef<{ key: string; attempts: number } | null>(null);
  const expectedWordsRef = useRef<typeof expectedWords>([]);
  const strictnessRef = useRef(strictness);

  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResultTime = useRef<number>(0);

  const selectedVerses = useMemo(() => {
    const start = Math.min(fromVerse, toVerse);
    const end = Math.max(fromVerse, toVerse);
    return tuhfaAllVerses.filter((v) => v.n >= start && v.n <= end);
  }, [fromVerse, toVerse]);

  const expectedWords = useMemo(() => {
    const list: { key: string; norm: string; word: string; sectionId: string; verseNumber: number }[] = [];
    selectedVerses.forEach((verse) => {
      const text = `${verse.first} ${verse.second}`.trim();
      const tokens = text.split(/\s+/).filter(Boolean);
      tokens.forEach((word, index) => {
        list.push({ key: `${verse.n}:${index}`, norm: normalizeArabic(word), word, sectionId: "", verseNumber: verse.n });
      });
    });
    return list;
  }, [selectedVerses]);

  /* تمرير تلقائي إلى الكلمة الحالية حتى لا تضيع في الأبيات الطويلة. */
  useEffect(() => {
    if (!yellowKey) return;
    const element = document.querySelector(`[data-tasmee-key="${yellowKey}"]`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [yellowKey]);

  useEffect(() => { expectedWordsRef.current = expectedWords; }, [expectedWords]);
  useEffect(() => { revealedRef.current = revealed; }, [revealed]);
  useEffect(() => { wrongKeysRef.current = wrongKeys; }, [wrongKeys]);
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
    // No API fetch needed - verses are pre-loaded from tuhfa data
    setFromVerse(1);
    setToVerse(selectedVerses.length || 1);
    if (!controller.signal.aborted) setLoading(false);
    return () => controller.abort();
  }, [selectedVerses]);

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
    utterance.rate = rate ?? playbackSpeed;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  /** الكلمتان قبل الخطأ أسرع قليلًا ثم الكلمة الخطأ وحدها أبطأ — بلا صوت في الوضع الصامت. */
  const speakCorrection = (key: string, word: string) => {
    if (!autoSpeak || !("speechSynthesis" in window)) return;
    const idx = expectedWords.findIndex((item) => item.key === key);
    const before = expectedWords
      .slice(Math.max(0, idx - 2), Math.max(0, idx))
      .map((item) => item.word)
      .join(" ");
    window.speechSynthesis.cancel();
    if (before) {
      const lead = new SpeechSynthesisUtterance(before);
      lead.lang = "ar-SA";
      lead.rate = Math.min(1.5, playbackSpeed + 0.2);
      window.speechSynthesis.speak(lead);
    }
    const target = new SpeechSynthesisUtterance(word);
    target.lang = "ar-SA";
    target.rate = Math.max(0.45, playbackSpeed - 0.3);
    window.speechSynthesis.speak(target);
  };

  /** فهرس أول كلمة في البيت الذي يحتوي الفهرس المعطى (لإعادة البيت دون احتساب خطأ). */
  const verseStartFor = (index: number) => {
    const ew = expectedWordsRef.current;
    const safe = Math.max(0, Math.min(index, ew.length - 1));
    const target = ew[safe];
    if (!target) return 0;
    let start = safe;
    while (start > 0 && ew[start - 1]?.verseNumber === target.verseNumber) start -= 1;
    return start;
  };

  const applyRecitedText = (text: string) => {
    const spoken = normalizeArabic(text).split(/\s+/).filter(Boolean);
    if (spoken.length === 0) return;
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

    /* توقّف القارئ ثم أعاد ما قرأه: نعود معه إلى أول البيت الذي يقرأه
       بدل احتساب كلمة من البيت التالي خطأً. */
    if (lastResultTime.current > 0 && Date.now() - lastResultTime.current > 2500) {
      const start = verseStartFor(consumedRef.current);
      if (start < consumedRef.current) {
        consumedRef.current = start;
        tentativeRef.current = null;
      }
    }

    // الرجوع إلى بيت سابق أو إعادة كلمة: يُتتبَّع ويُعاد من موضعه دون اعتباره خطأ.
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

    const nextRevealed = new Set(revealedRef.current);
    const nextWrong = new Set(wrongKeysRef.current);
    const newErrors: ErrorEntry[] = [];
    let si = 0;
    for (let i = consumedRef.current; i < ew.length && si < delta.length; i++) {
      const w = ew[i];
      const windowSlice = delta.slice(si, si + (strict === "lenient" ? 9 : 4));
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
            consumedRef.current = i;
            setYellowKey(w.key);
            beep(520, 0.08);
            break;
          }
          tentativeRef.current = null;
          nextWrong.add(w.key);
          const verse = selectedVerses.find((v) => v.n === w.verseNumber);
          const ayahText = verse ? `${verse.first} ${verse.second}` : "";
          newErrors.push({ key: w.key, word: w.word, expected: w.norm, spoken: delta[si + bestIdx], globalAyah: w.verseNumber, ayahText, sectionId: w.sectionId, verseNumber: w.verseNumber });
        }
        si += bestIdx + 1;
        consumedRef.current = i + 1;
      } else {
        // couldn't match expected word in window; skip spoken word and try again with same expected
        si += 1;
        i -= 1;
      }
    }
    if (newErrors.length > 0) {
      beep(660, 0.12);
      vibrate([120, 60, 120]);
      if (autoSpeak && newErrors[0]) speakCorrection(newErrors[0].key, newErrors[0].word);
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

  /** إعادة البيت الحالي من أوله بلا احتساب خطأ للكلمة التالية. */
  const repeatVerse = () => {
    const ew = expectedWordsRef.current;
    const start = verseStartFor(consumedRef.current);
    consumedRef.current = start;
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
    pauseTimer.current = setTimeout(() => {
      setPausedPrompt(true);
      cancelTimer.current = setTimeout(() => {
        cancelTasmee();
      }, 30000);
    }, 20000);
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
    if (levelFrameRef.current !== null) {
      cancelAnimationFrame(levelFrameRef.current);
      levelFrameRef.current = null;
    }
    voiceRef.current?.stop();
    voiceRef.current = null;
    setLevel(0);
    setReciting(false);
    clearTimers();
    setPausedPrompt(false);
  };

  /* مغادرة الصفحة تُغلق الميكروفون فورًا: لا يبقى مفتوحًا بلا حاجة. */
  useEffect(() => {
    return () => {
      stopRecitation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleRecitation = async () => {
    if (reciting) { stopRecitation(); return; }
    if (!hasSpeechRecognition()) {
      setSpeechError("التلاوة المباشرة تحتاج متصفحًا يدعم تحويل الكلام إلى نص (Chrome أو Edge).");
      return;
    }
    setSpeechError("");
    /* ميكروفون معزول الضوضاء ومكبَّر الصوت قبل بدء التعرف على الكلام. */
    try {
      voiceRef.current?.stop();
      const voice = await startVoiceInput();
      voiceRef.current = voice;
      setLevel(0);
      const tick = () => {
        setLevel(voice.level());
        levelFrameRef.current = requestAnimationFrame(tick);
      };
      levelFrameRef.current = requestAnimationFrame(tick);
    } catch {
      setSpeechError("لم يُسمح باستخدام الميكروفون. اسمح بالوصول من إعدادات المتصفح.");
      return;
    }
    const scope = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string; continuous: boolean; interimResults: boolean;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> > }) => void) | null;
        onerror: ((e: { error?: string }) => void) | null;
        onend: (() => void) | null;
        start: () => void; stop: () => void;
      };
      webkitSpeechRecognition?: new () => never;
    };
    const Recognition = scope.SpeechRecognition || (scope.webkitSpeechRecognition as unknown as typeof scope.SpeechRecognition);
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "ar-SA";
    recognition.continuous = true;
    recognition.interimResults = true;
    try { (recognition as unknown as { maxAlternatives?: number }).maxAlternatives = 3; } catch { /* ignore */ }
    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i += 1) {
        text += `${event.results[i][0]?.transcript ?? ""} `;
      }
      applyRecitedText(text);
    };
    recognition.onerror = (event) => {
      const message = recognitionErrorMessage(event.error);
      if (message) setSpeechError(message);
    };
    recognition.onend = () => {
      if (reciting) {
        try { recognition.start(); } catch { setReciting(false); }
      }
    };
    try {
      recognition.start();
      recognitionRef.current = recognition;
      setReciting(true);
      lastResultTime.current = Date.now();
      resetPauseTimer();
    } catch {
      setSpeechError("تعذّر بدء الاستماع.");
    }
  };

  const saveTuhfaSession = () => {
    try {
      const raw = localStorage.getItem("thimar.tuhfaLogs");
      const sessions = raw ? JSON.parse(raw) : [];
      sessions.unshift({
        at: Date.now(),
        cancelled,
        progress,
        revealed: revealed.size,
        wrong: wrongKeys.size,
        errorLog,
        duration: startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0,
        surahName: "تحفة الأطفال",
        range: `الأبيات ${selectedVerses[0]?.n ?? ""}–${selectedVerses[selectedVerses.length - 1]?.n ?? ""}`,
      });
      localStorage.setItem("thimar.tuhfaLogs", JSON.stringify(sessions.slice(0, 50)));
    } catch { /* ignore */ }
  };
  const cancelTasmee = () => {
    setDialect(detectDialect(dialectSamplesRef.current));
    stopRecitation();
    setCancelled(true);
    setFinished(true);
    saveTuhfaSession();
    setPhase("result");
  };

  const finishTasmee = () => {
    stopRecitation();
    setFinished(true);
    setDialect(detectDialect(dialectSamplesRef.current));
    saveTuhfaSession();
    // احتفال عند إتمام تسميع التحفة بلا أخطاء.
    if (wrongKeys.size === 0 && revealed.size > 0) celebrate("memorize");
    setPhase("result");
  };

  const handleContinueYes = () => {
    setContinuePrompt(false);
    promptShownRef.current = true;
    setExtraErrors(wrongKeys.size + 5);
  };

  const handleContinueNo = () => {
    setContinuePrompt(false);
    cancelTasmee();
  };

  const startTasmee = () => {
    startedAtRef.current = Date.now();
    dialectSamplesRef.current = [];
    setDialect(null);
    const empty = new Set<string>();
    revealedRef.current = empty;
    wrongKeysRef.current = empty;
    purpleKeysRef.current = empty;
    tentativeRef.current = null;
    setRevealed(empty);
    setWrongKeys(new Set());
    setPurpleKeys(new Set());
    setErrorLog([]);
    setYellowKey(null);
    setCancelled(false);
    setFinished(false);
    setPausedPrompt(false);
    consumedRef.current = 0;
    spokenConsumedRef.current = 0;
    promptShownRef.current = false;
    clearTimers();
    setPhase("reciting");
    void preloadVerseAudio();
  };

  const handlePauseWait = () => {
    setPausedPrompt(false);
    clearTimers();
    pauseTimer.current = setTimeout(() => {
      setPausedPrompt(true);
      cancelTimer.current = setTimeout(() => cancelTasmee(), 15000);
    }, 20000);
  };

  const handlePauseYes = () => {
    // reveal next unrevealed word in yellow
    const next = expectedWords.find((w) => !revealed.has(w.key) && !wrongKeys.has(w.key));
    if (next) setYellowKey(next.key);
    setPausedPrompt(false);
    clearTimers();
    resetPauseTimer();
  };

  const resolveAudioUrl = async (reciterId: string) => {
    const reciterData = tuhfaVerseReciters.find((r) => r.id === reciterId);
    if (!reciterData) return "";
    const url = reciterData.url;
    try {
      const cache = await caches.open("thimar-tuhfa-audio-v1");
      const hit = await cache.match(url);
      if (hit) return URL.createObjectURL(await hit.blob());
      const res = await fetch(url);
      if (res.ok) {
        await cache.put(url, res.clone());
        return URL.createObjectURL(await res.blob());
      }
    } catch { /* offline */ }
    return url;
  };

  /** يحفظ ملف صوت التحفة كاملًا ليعمل التسميع دون إنترنت. */
  const preloadVerseAudio = async () => {
    if (!("caches" in window)) return;
    const reciterData = tuhfaVerseReciters.find((r) => r.id === reciter);
    if (!reciterData) return;
    try {
      const cache = await caches.open("thimar-tuhfa-audio-v1");
      if (await cache.match(reciterData.url)) return;
      const res = await fetch(reciterData.url);
      if (res.ok) await cache.put(reciterData.url, res);
    } catch { /* تجاهل */ }
  };

  const playAyahAudio = async (verseNumber: number) => {
    const reciterData = tuhfaVerseReciters.find((r) => r.id === reciter);
    if (!reciterData) return;
    const [start] = tuhfaVerseWindow(reciterData, verseNumber);
    const url = await resolveAudioUrl(reciter);
    if (!url) return;
    const audio = new Audio(url);
    audio.currentTime = start;
    audio.playbackRate = playbackSpeed;
    audio.play().catch(() => {});
  };

  const playWordSlice = async (_verseNumber: number, wordIndex: number, totalWords: number, count = 1, rate?: number) => {
    const reciterData = tuhfaVerseReciters.find((r) => r.id === reciter);
    if (!reciterData) return;
    const url = await resolveAudioUrl(reciter);
    if (!url) return;
    const audio = new Audio(url);
    audio.playbackRate = rate ?? playbackSpeed;
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
      finishTasmee();
    }
  }, [phase, allDone, finished]);

  if (phase === "config") {
    return (
      <div className="page standalone-page tuhfa-page tasmee-config-page">
        <div className="page-head standalone-head">
          <div>
            <h2>التسميع - تحفة الأطفال</h2>
            <p className="muted">حدد السورة والأبيات، ثم اضغط بدء</p>
          </div>
        </div>
        <div style={{ padding: 16, background: "var(--card)", borderRadius: 12, margin: "16px 0" }}>
          <label>
            <span>القسم</span>
            <select value={selectedSection ?? ""} onChange={(e) => setSelectedSection(e.target.value || null)}>
              <option value="">اختر قسم...</option>
              {tuhfaSections.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", gap: 6 }}>
            <span>من البيت</span>
            <input type="number" min={1} max={selectedVerses?.length || 1} value={fromVerse}
              onChange={(e) => setFromVerse(Number(e.target.value))} style={{ width: 50 }} />
            <span>إلى</span>
            <input type="number" min={1} max={selectedVerses?.length || 1} value={toVerse}
              onChange={(e) => setToVerse(Number(e.target.value))} style={{ width: 50 }} />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <span>المستوى</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={strictness === "strict" ? "primary-button" : "ghost-button"}
                onClick={() => setStrictness("strict")}
                style={{ padding: "8px 18px", borderRadius: 10 }}
                title="مطابقة حرفية دقيقة لكل كلمة"
              >
                مشدّد
              </button>
              <button
                type="button"
                className={strictness === "lenient" ? "primary-button" : "ghost-button"}
                onClick={() => setStrictness("lenient")}
                style={{ padding: "8px 18px", borderRadius: 10 }}
                title="يقبل أخطاء بسيطة في الحروف"
              >
                متساهل
              </button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.9 }}>
            المشدّد أدقّ والمتساهل أوسع، وكلاهما يتسامح مع اختلاف اللهجات وأخطاء التقاط الصوت، ويمنحك محاولة
            ثانية قبل عدّ الكلمة خطأ. الكلمة البنفسجية = كلمة أعدت نطقها بعد قراءتها. محرّك التعرف الصوتي يعيد
            النص بلا تشكيل، لذا لا يمكن التحقق الآلي من الحركات نفسها. إذا توقفتَ وأعدت ما قرأته يعود
            التسميع معك إلى أول البيت دون احتساب خطأ للكلمة التالية، ويمكنك التسميع دون إنترنت عبر
            «التسميع الكتابي».
          </p>
          {loading ? <p className="muted">جارٍ التحميل...</p> : null}
          {error ? <p className="game-error">{error}</p> : null}
          <button type="button" className="ghost-button" onClick={onOpenSettings} style={{ marginInlineEnd: 8 }}>
            <Icon name="download" size={16} /> تحميل نطق تحفة الأطفال من الإعدادات
          </button>
          <button type="button" className="primary-button" onClick={startTasmee} disabled={loading || selectedVerses.length === 0}>
            <Icon name="play" size={16} /> بدء التسميع
          </button>
          <p className="muted" style={{ marginTop: 8, textAlign: "right" }}>
            {selectedVerses?.length} بيت • {expectedWords.length} كلمة
          </p>
        </div>
      </div>
    );
  }

  if (phase === "reciting") {
    return (
      <div className="tasmee-screen">
        <button type="button" className="tasmee-close" onClick={() => { stopRecitation(); setPhase("config"); }} aria-label="إغلاق">×</button>
        <div className="tasmee-topbar">
          <button type="button" className={`chip-toggle ${reciting ? "active" : ""}`} onClick={toggleRecitation}>
            <Icon name="mic" size={16} /> {reciting ? "إيقاف" : "بدء التلاوة"}
          </button>
          <button
            type="button"
            className={`chip-toggle ${autoSpeak ? "active" : ""}`}
            onClick={() => setAutoSpeak((prev) => !prev)}
            title="نطق الكلمة الصحيحة تلقائيًا عند الخطأ"
          >
            <Icon name="volume" size={16} /> {autoSpeak ? "النطق التلقائي" : "صامت"}
          </button>
          {reciting ? (
            <span className="tasmee-level" title="مستوى الصوت بعد عزل الضوضاء وتكبيره">
              <span style={{ width: `${Math.round(level * 100)}%` }} />
            </span>
          ) : null}
          <button
            type="button"
            className="chip-toggle"
            onClick={repeatVerse}
            title="أعد البيت من أوله دون احتساب خطأ للكلمة التالية"
          >
            <Icon name="arrow-right" size={16} /> إعادة البيت
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
        </div>
        {manualOpen ? (
          <div className="error-box" style={{ margin: "8px 0", background: "var(--bg-2)" }}>
            <p style={{ marginTop: 0, marginBottom: 8 }}>
              اكتب ما قرأته (أو استخدم إملاء لوحة المفاتيح)، وسيُقارن بأبيات التحفة المحلية ويعمل دون إنترنت.
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
        <div className="tasmee-reciting-container">
          {selectedVerses.map((ayah) => {
            return (
              <div key={ayah.n} style={{ marginBottom: 16 }}>
                <span className="mushaf-ayah-number" style={{ marginInlineEnd: 6 }}>{ayah.n}</span>
                {(ayah.first + " " + ayah.second).split(/\s+/).filter(Boolean).map((word, index) => {
                  const key = `${ayah.n}:${index}`;
                  const isRevealed = revealed.has(key);
                  const isWrong = wrongKeys.has(key);
                  const isPurple = purpleKeys.has(key);
                  const isYellow = yellowKey === key;
                  const hidden = !isRevealed && !isWrong;
                  const bg = isWrong ? "rgba(239,68,68,0.32)" : isPurple ? "rgba(168,85,247,0.32)" : isRevealed ? "rgba(34,197,94,0.28)" : isYellow ? "rgba(250,204,21,0.28)" : "rgba(15,95,78,0.07)";
                  const color = hidden ? "transparent" : isRevealed ? "#14532d" : "#111827";
                  return (
                    <span key={index}
                      data-tasmee-key={key}
                      style={{ background: bg, color, borderRadius: 4, marginInlineEnd: 4, padding: "0 2px", cursor: "pointer" }}
                      onClick={() => {
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
                        const t = setTimeout(() => setFocusedWord({ word, sectionId: "", verseNumber: ayah.n }), 500);
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
              <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>{focusedWord.word}</p>
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
        {dialect ? (
          <div className="dialect-badge">
            <strong>لهجة التسميع: {dialect.name}</strong>
            <span>{Math.round(dialect.confidence * 100)}% · {dialect.hits} كلمة دالة</span>
            <p>{dialectTip(dialect.id)}</p>
          </div>
        ) : null}
        <div className="tasmee-stats">
          <div className="tasmee-stat"><span>التقدم</span><strong>{progress}%</strong></div>
          <div className="tasmee-stat"><span>كلمات صحيحة</span><strong>{revealed.size}</strong></div>
          <div className="tasmee-stat"><span>أخطاء</span><strong>{wrongKeys.size}</strong></div>
        </div>
        {cancelled ? <p className="game-error" style={{ textAlign: "center" }}>تم الإلغاء بسبب التأخر أو تجاوز حد الأخطاء.</p> : null}
        <div className="playback-controls">
          <label>
            <span>القارئ</span>
            <select value={reciter} onChange={(e) => setReciter(e.target.value)}>
              {tuhfaVerseReciters.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>سرعة السماع: {playbackSpeed.toFixed(2)}×</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
            />
          </label>
          <div className="speed-presets">
            {[0.6, 0.8, 1, 1.2].map((rate) => (
              <button
                key={rate}
                type="button"
                className={`chip-toggle ${Math.abs(playbackSpeed - rate) < 0.03 ? "active" : ""}`}
                onClick={() => setPlaybackSpeed(rate)}
              >
                {rate}×
              </button>
            ))}
          </div>
        </div>
        <div className="tasmee-reciting-container" style={{ marginTop: 12 }}>
          {selectedVerses.filter((ayah) => {
            const text = `${ayah.first} ${ayah.second}`;
            return text.split(/\s+/).filter(Boolean).some((_, index) => {
              const key = `${ayah.n}:${index}`;
              return revealed.has(key) || wrongKeys.has(key);
            });
          }).map((ayah) => (
            <div key={ayah.n} style={{ marginBottom: 12 }}>
              <span className="mushaf-ayah-number" style={{ marginInlineEnd: 6 }}>{ayah.n}</span>
              {(ayah.first + " " + ayah.second).split(/\s+/).filter(Boolean).map((word, index) => {
                const key = `${ayah.n}:${index}`;
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
            <h3>سجل الأخطاء (صوت {reciter})</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {errorLog.map((e) => {
                const words = (e.ayahText || "").split(/\s+/).filter(Boolean);
                const idx = Number(String(e.key).split(":")[1]) || 0;
                const before = words[idx - 1] ?? "";
                const after = words[idx + 1] ?? "";
                return (
                <li key={e.key} style={{ margin: "8px 0", padding: 10, background: "rgba(239,68,68,0.12)", borderRadius: 6 }}>
                  <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
                    <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "rgba(255,255,255,0.7)", borderRadius: 8 }}>
                      <span style={{ color: "#991b1b", fontSize: 18, fontWeight: 700 }}>{e.word}</span>
                      <button type="button" className="icon-button" onClick={() => playWordSlice(e.verseNumber, idx, words.length || 1, 1, Math.max(0.5, playbackSpeed - 0.25))} aria-label="سماع الكلمة وحدها" title="سماع الكلمة وحدها (أبطأ قليلًا)">
                        <Icon name="volume" size={16} />
                      </button>
                    </div>
                    <div style={{ flex: 1, padding: "6px 10px", background: "rgba(255,255,255,0.55)", borderRadius: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontFamily: "Amiri, serif", fontSize: 17 }}>
                      {before ? <span className="muted">{before}</span> : null}
                      <span style={{ background: "rgba(239,68,68,0.35)", borderRadius: 4, padding: "0 3px" }}>{e.word}</span>
                      {after ? <span className="muted">{after}</span> : null}
                      {!before && !after ? <span className="muted">—</span> : null}
                      <button type="button" className="icon-button" onClick={() => {
                        const total = words.length || 1;
                        const from = Math.max(0, idx - 1);
                        const count = Math.min(total, idx + 2) - from;
                        playWordSlice(e.verseNumber, from, total, count);
                      }} aria-label="سماع الكلمة مع ما قبلها وما بعدها" title="سماع الكلمة مع التي قبلها والتي بعدها">
                        <Icon name="volume" size={14} />
                      </button>
                    </div>
                  </div>
                  {e.spoken ? <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>سمعت: «{e.spoken}»</p> : null}
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    <button type="button" className="ghost-button" style={{ fontSize: 12 }} onClick={() => playWordSlice(e.verseNumber, Math.max(0, idx - 1), words.length || 1, 1)}>
                      مع ما قبلها
                    </button>
                    <button type="button" className="ghost-button" style={{ fontSize: 12 }} onClick={() => playWordSlice(e.verseNumber, idx, words.length || 1, 2)}>
                      مع ما بعدها
                    </button>
                    <button type="button" className="ghost-button" style={{ fontSize: 12 }} onClick={() => playAyahAudio(e.verseNumber)}>
                      البيت كاملًا
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