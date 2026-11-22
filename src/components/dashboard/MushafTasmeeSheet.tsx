import { useEffect, useMemo, useRef, useState } from "react";
import { loadHafsPage, type HafsAyah } from "../../lib/mushafText";
import {
  alignTokens,
  loadSurahAyahs,
  saveTasmeeSession,
  scopeLabel,
  tasmeeWords,
  tokensOf,
  type TasmeeScope,
  type TasmeeSession,
  type TasmeeWord,
  type WordStatus,
} from "../../lib/mushafTasmee";
import { hasSpeechRecognition, recognitionErrorMessage } from "../../lib/speech";
import {
  OfflineAssetsError,
  getTilawaPreloadSnapshot,
  loadOfflineBundle,
  loadTilawa,
  prepareMicrophone,
  retryTilawaPreload,
  subscribeTilawaPreload,
  type Microphone,
  type TilawaSession,
} from "../../lib/tilawaRecitation";
import type { EngineEvent } from "@tilawa/core";
import {
  TASMEE_CAPTURE_MAX_SECONDS,
  TASMEE_ENGINE_MODES,
  TasmeeOrchestrator,
  modeUsesQuranAsr,
  modeUsesTilawa,
  readTasmeeEngineMode,
  startTasmeeMicCapture,
  tasmeeAssessmentAyahs,
  tasmeeMemoryRisk,
  writeTasmeeEngineMode,
  type TasmeeAssessmentRun,
  type TasmeeEngineMode,
  type TasmeeMicCapture,
} from "../../lib/tasmeeEngines";
import { ayahAudioUrl, reciters } from "../../data/reciters";
import { surahs } from "../../data/surahs";
import { arabicNumber, surahNameOfNumber } from "../../lib/ayahImage";

/*
 * جلسة تسميع داخل المصحف: يختار القارئ نطاق التسميع (الصفحة، الآيات المحددة،
 * السورة كاملة) وحدّ الأخطاء، ثم يقرأ. يُستخدم محرك Tilawa المحلي (بدون إنترنت)
 * أولًا، وإن لم يتوفر النموذج يرجع إلى تعرّف المتصفح مع تنبيه واضح.
 *
 * أوضاع العرض:
 * - إخفاء الآيات: تُخفى الآيات وتُكشف كلمةً كلمة أثناء النطق.
 * - عرض الآيات: تظل الآيات ظاهرة كما هي دون اختفاء.
 *
 * أثناء التسميع: مستطيل صغير في الأسفل يحوي ⏺️ (إنهاء) و ⏸️/▶️ (إيقاف/تشغيل
 * الميكروفون مؤقتًا).
 */

type RecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEventLike = { resultIndex: number; results: ArrayLike<RecognitionResultLike> };
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

type WordRef = { surah: number; ayah: number; word: number };
type Phase = "config" | "reciting" | "result";

const QA_KIND_LABELS: Record<string, string> = {
  omission: "حذف كلمة",
  substitution: "استبدال كلمة",
  insertion: "كلمة زائدة",
  repetition: "تكرار",
  reorder: "إعادة ترتيب",
};

const QA_TRANSITION_LABELS: Record<string, string> = {
  jump: "قفز آيات",
  repeat: "تكرار آية",
  backward: "رجوع لآية سابقة",
  sequential: "تسلسل",
};

export default function MushafTasmeeSheet({
  page,
  pageKeys,
  selection,
  onClose,
  inline = false,
  revealVerses = false,
  onRevealVersesChange,
  onAyahsChange,
  onWordsChange,
  onStatusesChange,
  onRevealChange,
  onActiveChange,
}: {
  page: number;
  pageKeys: string[];
  selection: HafsAyah[];
  onClose: () => void;
  inline?: boolean;
  revealVerses?: boolean;
  onRevealVersesChange?: (reveal: boolean) => void;
  onAyahsChange?: (ayahs: HafsAyah[]) => void;
  onWordsChange?: (words: TasmeeWord[]) => void;
  onStatusesChange?: (statuses: WordStatus[], cursor: number) => void;
  onRevealChange?: (reveal: boolean) => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("config");
  const [scope, setScope] = useState<TasmeeScope>(selection.length ? "selection" : "page");
  const [maxErrors, setMaxErrors] = useState<number | "none">(3);
  const [ayahs, setAyahs] = useState<HafsAyah[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [words, setWords] = useState<TasmeeWord[]>([]);
  const [statuses, setStatuses] = useState<WordStatus[]>([]);
  const [preview, setPreview] = useState<WordStatus[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [revealAll, setRevealAll] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<TasmeeSession | null>(null);
  const [reason, setReason] = useState("");
  const [reciterId, setReciterId] = useState("ar.husary");
  const [usingOffline, setUsingOffline] = useState(false);
  const [offlineNote, setOfflineNote] = useState("");
  const [engineLoading, setEngineLoading] = useState(false);
  const [micPaused, setMicPaused] = useState(false);
  const [engineStatus, setEngineStatus] = useState(getTilawaPreloadSnapshot);
  const [engineMode, setEngineMode] = useState<TasmeeEngineMode>(() => readTasmeeEngineMode());
  const [qaPhase, setQaPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [qaRun, setQaRun] = useState<TasmeeAssessmentRun | null>(null);
  const [qaError, setQaError] = useState("");
  const [qaNote, setQaNote] = useState("");
  const orchestratorRef = useRef<TasmeeOrchestrator | null>(null);
  const tapUnsubRef = useRef<(() => void) | null>(null);
  const asrMicRef = useRef<TasmeeMicCapture | null>(null);
  const runAyahsRef = useRef<HafsAyah[]>([]);
  const engineModeRef = useRef(engineMode);
  engineModeRef.current = engineMode;
  const memoryRisk = useMemo(() => tasmeeMemoryRisk(), []);

  const recognitionRef = useRef<RecognitionLike | null>(null);
  const micRef = useRef<Microphone | null>(null);
  const sessionRef = useRef<TilawaSession | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const cursorRef = useRef(0);
  const statusesRef = useRef<WordStatus[]>([]);
  const spokenRef = useRef<Record<number, string>>({});
  const processedRef = useRef(0);
  const finalTextRef = useRef("");
  const startedAtRef = useRef(0);
  const finishedRef = useRef(false);
  const wordsRef = useRef<TasmeeWord[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const maxErrorsRef = useRef<number | "none">(3);
  const supported = useMemo(() => hasSpeechRecognition(), []);
  const surah = selection[0]?.surah ?? ayahs[0]?.surah ?? 1;

  useEffect(() => {
    maxErrorsRef.current = maxErrors;
  }, [maxErrors]);

  /* حالة المحرك المشترك: جاهز/جارٍ/خطأ، دون بدء تجهيز جديد من هذه الشاشة. */
  useEffect(() => subscribeTilawaPreload(setEngineStatus), []);
  useEffect(() => {
    writeTasmeeEngineMode(engineMode);
  }, [engineMode]);

  /* إبلاغ الصفحة الأم بحالة التسميع (للعرض inline على المصحف). */
  useEffect(() => {
    onAyahsChange?.(ayahs);
  }, [ayahs, onAyahsChange]);
  useEffect(() => {
    onWordsChange?.(words);
  }, [words, onWordsChange]);
  useEffect(() => {
    onStatusesChange?.(statuses, cursor);
  }, [statuses, cursor, onStatusesChange]);
  useEffect(() => {
    onRevealChange?.(revealAll);
  }, [revealAll, onRevealChange]);
  useEffect(() => {
    onActiveChange?.(phase === "reciting");
  }, [phase, onActiveChange]);

  /* تحميل آيات النطاق المختار. */
  useEffect(() => {
    if (phase !== "config") return;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    const load = async (): Promise<HafsAyah[]> => {
      if (scope === "selection") return selection;
      if (scope === "surah") return loadSurahAyahs(surah);
      if (pageKeys.length) return loadHafsPage(page);
      return [];
    };
    void load()
      .then((list) => {
        if (cancelled) return;
        setAyahs(list);
        setWords(tasmeeWords(list));
      })
      .catch(() => {
        if (!cancelled) setLoadError("تعذّر تحميل آيات هذا النطاق. تحقّق من الاتصال ثم أعد المحاولة.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, page, pageKeys.length, selection, surah]);

  useEffect(
    () => () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.stop();
        } catch {
          /* تجاهل */
        }
      }
      unsubRef.current?.();
      unsubRef.current = null;
      const mic = micRef.current;
      micRef.current = null;
      if (mic) void mic.stop().catch(() => undefined);
      const asrMic = asrMicRef.current;
      asrMicRef.current = null;
      if (asrMic) void asrMic.stop().catch(() => undefined);
      const active = sessionRef.current;
      sessionRef.current = null;
      if (active) {
        try {
          active.dispose();
        } catch {
          /* تجاهل */
        }
      }
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
    },
    [],
  );

  /* إبقاء الكلمة الحالية في وسط الشاشة. */
  useEffect(() => {
    if (phase !== "reciting") return;
    const list = listRef.current;
    const target = list?.querySelector<HTMLElement>(`[data-word="${Math.min(cursor, words.length - 1)}"]`);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cursor, phase, words.length]);

  const total = words.length;
  const wrongCount = useMemo(() => statuses.filter((status) => status === "bad").length, [statuses]);

  const resetRun = () => {
    const pending = new Array<WordStatus>(words.length).fill("pending");
    statusesRef.current = pending;
    cursorRef.current = 0;
    spokenRef.current = {};
    processedRef.current = 0;
    finalTextRef.current = "";
    finishedRef.current = false;
    setStatuses(pending);
    setPreview(null);
    setCursor(0);
    setInterim("");
    setError("");
    setReason("");
    setSession(null);
    setMicPaused(false);
  };

  const stopRecognition = () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        /* تجاهل */
      }
    }
    recognitionRef.current = null;
    setListening(false);
  };

  const stopEngine = () => {
    tapUnsubRef.current?.();
    tapUnsubRef.current = null;
    const asrMic = asrMicRef.current;
    asrMicRef.current = null;
    if (asrMic) void asrMic.stop().catch(() => undefined);
    stopRecognition();
    unsubRef.current?.();
    unsubRef.current = null;
    const mic = micRef.current;
    micRef.current = null;
    if (mic) void mic.stop().catch(() => undefined);
    const active = sessionRef.current;
    sessionRef.current = null;
    if (active) {
      try {
        active.dispose();
      } catch {
        /* تجاهل */
      }
    }
    setListening(false);
  };

  const finish = (why: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    stopEngine();
    const finalStatuses = statusesRef.current.slice();
    const mistakes = finalStatuses
      .map((status, index) => ({ status, index }))
      .filter((item) => item.status === "bad")
      .map(({ index }) => {
        const word = wordsRef.current[index];
        const spoken = spokenRef.current[index];
        return {
          word: word?.text ?? "",
          spoken: spoken || undefined,
          surah: word?.surah ?? surah,
          ayah: word?.ayah ?? 1,
          global: word?.global ?? 1,
        };
      });
    const correct = finalStatuses.filter((status) => status === "ok").length;
    const sessionData: TasmeeSession = {
      at: Date.now(),
      page,
      scope,
      surah,
      fromAyah: wordsRef.current[0]?.ayah ?? 1,
      toAyah: wordsRef.current[wordsRef.current.length - 1]?.ayah ?? 1,
      accuracy: wordsRef.current.length ? Math.round((correct / wordsRef.current.length) * 100) : 0,
      correct,
      wrong: mistakes.length,
      total: wordsRef.current.length,
      durationSec: Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
      maxErrors: maxErrors === "none" ? null : maxErrors,
      reciterId: "ar.husary",
      mistakes,
    };
    saveTasmeeSession(sessionData);
    setSession(sessionData);
    setStatuses(finalStatuses);
    setPreview(null);
    setReason(why);
    setPhase("result");
    setMicPaused(false);

    /* الوضع المشترك/المستقل: Tilawa أُغلق أعلاه، ثم يُقيَّم التسجيل بـ Quran ASR. */
    const mode = engineModeRef.current;
    const orchestrator = orchestratorRef.current;
    if (modeUsesQuranAsr(mode) && orchestrator) {
      const recording = orchestrator.finishRecording();
      if (recording.durationMs < 300) {
        setQaPhase("error");
        setQaError("التسجيل قصير جدًا لتقييمه. أعد التسميع مع قراءة أوضح.");
      } else {
        setQaNote(
          recording.truncated
            ? `قُصّ التسجيل عند ${arabicNumber(TASMEE_CAPTURE_MAX_SECONDS)} ثانية لحماية الذاكرة.`
            : "",
        );
        void evaluateQuranAsr(orchestrator);
      }
    }
  };

  const evaluateQuranAsr = async (orchestrator: TasmeeOrchestrator) => {
    setQaPhase("loading");
    setQaError("");
    try {
      const run = await orchestrator.assess(tasmeeAssessmentAyahs(runAyahsRef.current));
      setQaRun(run);
      setQaPhase("ready");
    } catch (error) {
      setQaPhase("error");
      setQaError(error instanceof Error ? error.message : "تعذّر تقييم التسميع محليًا.");
    }
  };

  const commitTokens = (tokens: string[]) => {
    if (!tokens.length) return;
    const result = alignTokens(wordsRef.current, statusesRef.current, cursorRef.current, tokens);
    statusesRef.current = result.statuses;
    cursorRef.current = result.cursor;
    Object.entries(result.spoken).forEach(([index, value]) => {
      if (value) spokenRef.current[Number(index)] = value;
    });
    setStatuses(result.statuses);
    setCursor(result.cursor);
    const bad = result.statuses.filter((status) => status === "bad").length;
    if (maxErrorsRef.current !== "none" && bad >= maxErrorsRef.current) {
      finish("توقف التسميع: بلغت الحدّ الذي اخترته للأخطاء.");
    }
  };

  /* يحوّل مرجع كلمة من محرك Tilawa ({surah, ayah, word}) إلى موضعها في قائمة الكلمات. */
  const wordIndexFor = (ref: WordRef): number => {
    let seen = 0;
    for (let index = 0; index < wordsRef.current.length; index += 1) {
      const word = wordsRef.current[index];
      if (word.surah !== ref.surah || word.ayah !== ref.ayah) continue;
      seen += 1;
      if (seen === ref.word) return index;
    }
    return -1;
  };

  const markFromEngine = (ref: WordRef, ok: boolean) => {
    if (!ref) return;
    let index = wordIndexFor(ref);
    if (index < 0) {
      index = wordsRef.current.findIndex(
        (word, at) => word.surah === ref.surah && word.ayah === ref.ayah && statusesRef.current[at] === "pending",
      );
    }
    if (index < 0) return;
    const next = statusesRef.current.slice();
    const already = next[index];
    if (ok) {
      next[index] = "ok";
      setInterim(wordsRef.current[index]?.text ?? "");
    } else if (already !== "bad") {
      next[index] = "bad";
      spokenRef.current[index] = "";
    }
    statusesRef.current = next;
    cursorRef.current = Math.max(cursorRef.current, index + 1);
    setStatuses(next);
    setCursor(cursorRef.current);
    const bad = next.filter((status) => status === "bad").length;
    if (!ok && maxErrorsRef.current !== "none" && bad >= maxErrorsRef.current) {
      finish("توقف التسميع: بلغت الحدّ الذي اخترته للأخطاء.");
    }
  };

  const startWebRecognition = () => {
    const Recognition = getRecognition();
    if (!Recognition) {
      setError("التعرف على الكلام غير مدعوم في هذا المتصفح. يمكنك إنهاء التسميع بحسب ما تلاحظه، أو استخدام متصفح آخر.");
      return;
    }
    setUsingOffline(false);
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = "ar-SA";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let draft = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalTextRef.current = `${finalTextRef.current} ${result[0].transcript}`.trim();
        else draft = `${draft} ${result[0].transcript}`.trim();
      }
      const allTokens = tokensOf(finalTextRef.current);
      if (allTokens.length > processedRef.current) {
        const fresh = allTokens.slice(processedRef.current);
        processedRef.current = allTokens.length;
        commitTokens(fresh);
      }
      setInterim(draft);
      if (draft) {
        const previewTokens = tokensOf(draft);
        if (previewTokens.length) {
          const result = alignTokens(wordsRef.current, statusesRef.current, cursorRef.current, previewTokens);
          setPreview(result.statuses);
        }
      } else {
        setPreview(null);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      setError(recognitionErrorMessage(event.error));
      setListening(false);
    };
    recognition.onend = () => {
      if (finishedRef.current) return;
      setListening(false);
      finish("انتهى الاستماع.");
    };
    try {
      recognition.start();
      setListening(true);
      setMicPaused(false);
    } catch {
      setError("تعذّر بدء التسجيل. حاول مرة أخرى.");
    }
  };

  /* يبدأ الاستماع: محرك Tilawa المحلي أولًا، ثم تعرّف المتصفح عند تعذّره. */
  const beginListening = async () => {
    if (!wordsRef.current.length) return;
    setError("");
    setOfflineNote("");
    let prepared: ReturnType<typeof prepareMicrophone> | undefined;
    try {
      prepared = prepareMicrophone();
    } catch {
      prepared = undefined;
    }
    const mode = engineModeRef.current;
    /*
     * إيقاف الميكروفون مؤقتًا ثم تشغيله لا يبدأ تسجيلًا جديدًا: يُحتفظ بالمنسّق
     * وبالعيّنات المجمّعة، ويُضاف ما يُسجَّل بعد الاستئناف إلى التسجيل نفسه.
     */
    const existing = orchestratorRef.current;
    const orchestrator =
      existing && existing.mode === mode && existing.state === "recording"
        ? existing
        : new TasmeeOrchestrator(mode);
    if (orchestrator !== existing) {
      existing?.reset();
      orchestratorRef.current = orchestrator;
    }
    if (modeUsesQuranAsr(mode)) {
      setQaPhase("idle");
      setQaRun(null);
      setQaError("");
      setQaNote("");
    }
    /* وضع Quran ASR وحده: ميكروفون خام بلا Tilawa نهائيًا. */
    if (mode === "quran-asr") {
      try {
        setEngineLoading(true);
        const capture = await startTasmeeMicCapture((samples) => orchestrator.tap(samples));
        asrMicRef.current = capture;
        setUsingOffline(true);
        setListening(true);
        setMicPaused(false);
      } catch (error) {
        setError(error instanceof Error ? error.message : "تعذّر بدء الميكروفون.");
      } finally {
        setEngineLoading(false);
      }
      return;
    }

    const bundledAssets = (await loadOfflineBundle()) !== null;
    try {
      setEngineLoading(true);
      const tilawa = await loadTilawa();
      const scoped = wordsRef.current;
      const scopeSurahs = Array.from(new Set(scoped.map((word) => word.surah)));
      let active: TilawaSession;
      if (scopeSurahs.length === 1) {
        const ayahNumbers = scoped.filter((word) => word.surah === scopeSurahs[0]).map((word) => word.ayah);
        active = tilawa.startMemorization(
          { surah: scopeSurahs[0], fromAyah: Math.min(...ayahNumbers), toAyah: Math.max(...ayahNumbers) },
          { confirm: { after: "next-word" } },
        );
      } else {
        active = tilawa.startFreeRecitation();
      }
      sessionRef.current = active;
      if (modeUsesQuranAsr(mode)) {
        /* تسجيل واحد: نلتقط نفس الـ16 kHz التي يستقبلها Tilawa، للتقييم بعده. */
        tapUnsubRef.current?.();
        tapUnsubRef.current = active.onAudio((chunk) => orchestrator.tap(chunk, 16000));
      }
      unsubRef.current = active.subscribe((event: EngineEvent) => {
        if (event.type === "position") {
          const observed = event.observed && event.observed[0] ? event.observed[0].word : null;
          if (observed) markFromEngine(observed, true);
        } else if (event.type === "checker" && event.state === "confirmed") {
          if (/wrong_word|omitted_word|added_word|skipped_passage/.test(String(event.errorClass)) && event.location) {
            markFromEngine(event.location, false);
          }
        }
      });
      const mic = await tilawa.listen(active, { prepared, onLevel: () => undefined });
      micRef.current = mic;
      prepared = undefined;
      setUsingOffline(true);
      setListening(true);
      setMicPaused(false);
    } catch (error) {
      try {
        prepared?.release();
      } catch {
        /* تجاهل */
      }
      const previous = sessionRef.current;
      sessionRef.current = null;
      if (previous) {
        try {
          previous.dispose();
        } catch {
          /* تجاهل */
        }
      }
      /*
       * ملفات المحرك المضمَّنة داخل التطبيق إن كانت مفقودة أو تالفة فلا يُنتقل
       * إلى تعرّف سحابي: تُعرض رسالة واضحة فقط (لا جاهزية ولا رفع صوت).
       */
      if (error instanceof OfflineAssetsError || bundledAssets) {
        setError(error instanceof Error ? error.message : "تعذّر تجهيز التسميع الصوتي.");
        return;
      }
      if (!supported) {
        setError("التسميع الصوتي غير جاهز على هذا الجهاز، ولا يتوفر بديل. أعد المحاولة أو أعد تثبيت التطبيق.");
        return;
      }
      setOfflineNote("التسميع الصوتي غير جاهز على هذا الجهاز؛ جارٍ استخدام خيار بديل يتطلب إنترنت.");
      startWebRecognition();
    } finally {
      setEngineLoading(false);
    }
  };

  const start = async () => {
    resetRun();
    setRevealAll(false);
    startedAtRef.current = Date.now();
    wordsRef.current = words;
    runAyahsRef.current = ayahs;
    orchestratorRef.current?.reset();
    orchestratorRef.current = null;
    setQaPhase("idle");
    setQaRun(null);
    setQaError("");
    setQaNote("");
    statusesRef.current = new Array<WordStatus>(words.length).fill("pending");
    setPhase("reciting");
    await beginListening();
  };

  const pauseListening = () => {
    if (finishedRef.current) return;
    stopEngine();
    setMicPaused(true);
  };

  const resumeListening = () => {
    if (finishedRef.current) return;
    setMicPaused(false);
    void beginListening();
  };

  const repeatWord = () => {
    const back = Math.max(0, cursorRef.current - 1);
    const next = statusesRef.current.slice();
    next[back] = "pending";
    delete spokenRef.current[back];
    statusesRef.current = next;
    cursorRef.current = back;
    setStatuses(next);
    setPreview(null);
    setCursor(back);
  };

  const previousAyah = () => {
    const list = statusesRef.current;
    let at = cursorRef.current - 1;
    while (at > 0 && wordsRef.current[at]?.ayah === wordsRef.current[Math.max(0, cursorRef.current - 1)]?.ayah) at -= 1;
    const ayahNo = wordsRef.current[Math.max(0, at)]?.ayah ?? 1;
    let start = Math.max(0, at);
    while (start > 0 && wordsRef.current[start - 1]?.ayah === ayahNo) start -= 1;
    const next = list.slice();
    for (let index = start; index < next.length; index += 1) next[index] = "pending";
    statusesRef.current = next;
    cursorRef.current = start;
    spokenRef.current = {};
    setStatuses(next);
    setPreview(null);
    setCursor(start);
  };

  const playCorrect = (global: number) => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = ayahAudioUrl(reciterId, global);
    audio.currentTime = 0;
    void audio.play().catch(() => setError("تعذّر تشغيل التلاوة. تحقّق من الاتصال."));
  };

  const shown = preview ?? statuses;
  const qaFlagged = qaRun ? qaRun.assessment.items.filter((item) => item.kind !== "match") : [];

  /* أثناء التسميع على المصحف: مستطيل صغير في الأسفل (إنهاء + إيقاف/تشغيل الميكروفون). */
  if (phase === "reciting" && inline) {
    return (
      <div className="tasmee-recorder-wrap" role="group" aria-label="تسميع">
        <div className="tasmee-recorder-bar">
          <button
            type="button"
            className="tasmee-recorder-btn is-stop"
            title="إنهاء التسميع"
            aria-label="إنهاء التسميع"
            onClick={() => finish("أُنهي التسميع يدويًا.")}
          >
            ⏺️
          </button>
          <button
            type="button"
            className={`tasmee-recorder-btn${micPaused ? " is-resume" : ""}`}
            title={micPaused ? "تشغيل الميكروفون" : "إيقاف الميكروفون مؤقتًا"}
            aria-label={micPaused ? "تشغيل الميكروفون" : "إيقاف الميكروفون مؤقتًا"}
            onClick={() => (micPaused ? resumeListening() : pauseListening())}
          >
            {micPaused ? "▶️" : "⏸️"}
          </button>
        </div>
        {engineLoading ? <span className="tasmee-recorder-note">جارٍ تجهيز التسميع الصوتي…</span> : null}
        {usingOffline && !engineLoading ? <span className="tasmee-recorder-note">{micPaused ? "الميكروفون متوقف" : "يعمل دون إنترنت"}</span> : null}
      </div>
    );
  }

  return (
    <div className={phase === "result" ? "mushaf-tasmee-layer" : (inline ? "mushaf-tasmee-inline" : "mushaf-tasmee-layer")} role={phase === "result" ? "dialog" : (inline ? undefined : "dialog")} aria-modal={phase === "result" ? true : (inline ? undefined : true)} aria-label="تسميع المصحف">
      <div className="mushaf-tasmee-panel">
        <div className="mushaf-tasmee-head">
          <h3>{phase === "result" ? "نتيجة التسميع" : "تسميع"}</h3>
          <button type="button" className="mushaf-tasmee-close" onClick={() => { stopEngine(); onClose(); }} aria-label="إغلاق">
            ×
          </button>
        </div>

        {phase === "config" ? (
          <div className="mushaf-tasmee-config">
            <p className="mushaf-tasmee-hint">
              {revealVerses
                ? "اختر نطاق التسميع ثم ابدأ؛ ستظل الآيات ظاهرة كما هي أثناء التسميع."
                : "اختر نطاق التسميع ثم ابدأ؛ ستُخفى الآيات وتُكشف كلمةً كلمة أثناء النطق."}
            </p>
            <div className="mushaf-tasmee-scopes" role="group" aria-label="طريقة التسميع">
              {TASMEE_ENGINE_MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`mushaf-tasmee-scope${engineMode === option.id ? " is-active" : ""}`}
                  onClick={() => setEngineMode(option.id)}
                  title={option.hint}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {engineMode === "combined" && memoryRisk.level !== "ok" ? (
              <p className="mushaf-tasmee-error">{memoryRisk.message}</p>
            ) : null}
            <div className="mushaf-tasmee-scopes" role="group" aria-label="نطاق التسميع">
              {([
                { id: "page", label: `الصفحة ${arabicNumber(page)}`, disabled: false },
                { id: "selection", label: `الآيات المحددة (${arabicNumber(selection.length)})`, disabled: selection.length === 0 },
                { id: "surah", label: `سورة ${surahs[surah - 1]?.name ?? surah}`, disabled: false },
              ] as { id: TasmeeScope; label: string; disabled: boolean }[]).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`mushaf-tasmee-scope${scope === option.id ? " is-active" : ""}`}
                  disabled={option.disabled}
                  onClick={() => setScope(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mushaf-tasmee-scopes" role="group" aria-label="عرض الآيات أثناء التسميع">
              <button
                type="button"
                className={`mushaf-tasmee-scope${!revealVerses ? " is-active" : ""}`}
                onClick={() => onRevealVersesChange?.(false)}
              >
                إخفاء الآيات
              </button>
              <button
                type="button"
                className={`mushaf-tasmee-scope${revealVerses ? " is-active" : ""}`}
                onClick={() => onRevealVersesChange?.(true)}
              >
                عرض الآيات
              </button>
            </div>

            <label className="mushaf-tasmee-field">
              <span>أقصى عدد للأخطاء</span>
              <select
                value={String(maxErrors)}
                onChange={(event) => setMaxErrors(event.target.value === "none" ? "none" : Number(event.target.value))}
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>{`${value} ${value === 1 ? "خطأ" : "أخطاء"}`}</option>
                ))}
                <option value="none">بلا حد</option>
              </select>
            </label>

            <p className="mushaf-tasmee-summary">
              {loading
                ? "جارٍ تحميل الآيات…"
                : `${arabicNumber(words.length)} كلمة • ${arabicNumber(ayahs.length)} آية • ${scopeLabel(scope)}`}
            </p>
            {loadError ? <p className="mushaf-tasmee-error">{loadError}</p> : null}
            <p className="mushaf-tasmee-hint">
              {!modeUsesTilawa(engineMode)
                ? "في هذا الوضع يُسجَّل التسميع كاملًا ثم يُقيَّم محليًا بعد الإنهاء."
                : "التسميع يعمل داخل التطبيق مباشرة؛ يبدأ فورًا دون إنترنت ولا ينزّل أي ملف."}
            </p>
            {engineStatus.state === "loading" ? (
              <p className="mushaf-tasmee-summary">
                {`جارٍ تجهيز التسميع الصوتي… ${arabicNumber(Math.round(engineStatus.progress * 100))}%`}
              </p>
            ) : null}
            {engineStatus.state === "ready" ? (
              <p className="mushaf-tasmee-summary" style={{ color: "#15803d" }}>
                {`التسميع الصوتي جاهز — يبدأ التسميع فورًا.`}
              </p>
            ) : null}
            {engineStatus.state === "error" ? (
              <div>
                <p className="mushaf-tasmee-error">
                  "تعذّر تجهيز التسميع الصوتي. أعد المحاولة، وإن تكرّر فأعد تثبيت التطبيق."
                </p>
                <button type="button" className="ghost-button" onClick={() => void retryTilawaPreload().catch(() => undefined)}>
                  إعادة المحاولة محليًا
                </button>
              </div>
            ) : null}
            {!supported ? (
              <p className="mushaf-tasmee-error">
                "التسميع الصوتي يعمل داخل التطبيق فقط على هذا الجهاز."
              </p>
            ) : null}
            <div className="mushaf-tasmee-actions">
              <button type="button" className="primary-button" onClick={() => void start()} disabled={loading || !words.length}>
                ابدأ
              </button>
              <button type="button" className="ghost-button" onClick={onClose}>إلغاء</button>
            </div>
          </div>
        ) : null}

        {phase === "reciting" ? (
          <>
            <div className="mushaf-tasmee-bar">
              <span>{`${scopeLabel(scope)} • ${arabicNumber(Math.min(cursor, total))} / ${arabicNumber(total)} كلمة`}</span>
              <span className="mushaf-tasmee-listening">{micPaused ? "⏸ متوقف" : listening ? "● يستمع" : "○ متوقف"}</span>
              <span className="mushaf-tasmee-counter">{`أخطاء: ${arabicNumber(wrongCount)}`}</span>
            </div>
            {offlineNote ? <p className="mushaf-tasmee-error">{offlineNote}</p> : null}
            <div className="mushaf-tasmee-words" ref={listRef}>
              {words.map((word, index) => {
                const status = shown[index] ?? "pending";
                const isCurrent = index === cursor && status === "pending";
                const shownText = status === "pending" && revealAll;
                const isNewAyah = index === 0 || words[index - 1]?.ayah !== word.ayah || words[index - 1]?.surah !== word.surah;
                return (
                  <span key={`${word.surah}:${word.ayah}:${index}`} className="mushaf-tasmee-word-wrap">
                    {isNewAyah ? (
                      <span className="mushaf-tasmee-ayah-ref">
                        {`${surahNameOfNumber(word.surah)} ${arabicNumber(word.ayah)}`}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      data-word={index}
                      className={`mushaf-tasmee-word is-${status}${isCurrent ? " is-current" : ""}${shownText ? " is-shown" : ""}`}
                      onClick={() => {
                        if (phase !== "reciting") return;
                        const next = statusesRef.current.slice();
                        next[index] = next[index] === "bad" ? "pending" : "bad";
                        statusesRef.current = next;
                        cursorRef.current = index + 1;
                        setStatuses(next);
                        setCursor(index + 1);
                      }}
                      title={status === "bad" ? "خطأ — اضغط لإلغاء العلامة" : "اضغط لتعليم الخطأ يدويًا"}
                    >
                      {word.text}
                      {status === "ok" ? <span className="mushaf-tasmee-tick" aria-hidden="true">✓</span> : null}
                    </button>
                  </span>
                );
              })}
            </div>
            {interim ? <p className="mushaf-tasmee-live">{`يستمع… ${interim}`}</p> : null}
            {error ? <p className="mushaf-tasmee-error">{error}</p> : null}
            <div className="mushaf-tasmee-actions is-sticky">
              <button type="button" className="ghost-button" onClick={repeatWord}>إعادة الكلمة</button>
              <button type="button" className="ghost-button" onClick={previousAyah}>الآية السابقة</button>
              <button type="button" className="ghost-button" onClick={() => setRevealAll((value) => !value)}>
                {revealAll ? "إخفاء النص" : "كشف النص"}
              </button>
              <button type="button" className="ghost-button" onClick={() => (micPaused ? resumeListening() : pauseListening())}>
                {micPaused ? "▶️ تشغيل الميكروفون" : "⏸️ إيقاف الميكروفون"}
              </button>
              <button type="button" className="primary-button" onClick={() => finish("أُنهي التسميع يدويًا.")}>إنهاء</button>
            </div>
          </>
        ) : null}

        {phase === "result" && session ? (
          <div className="mushaf-tasmee-result">
            <p className="mushaf-tasmee-score">
              {`الأخطاء ${arabicNumber(session.wrong)} من ${arabicNumber(session.total)} كلمة`}
              <strong>{`${arabicNumber(session.accuracy)}%`}</strong>
            </p>
            <p className="mushaf-tasmee-hint">
              {`${scopeLabel(session.scope)} • صفحة ${arabicNumber(session.page)} • ${arabicNumber(session.durationSec)} ثانية`}
            </p>
            {reason ? <p className="mushaf-tasmee-summary">{reason}</p> : null}
            <label className="mushaf-tasmee-field">
              <span>الشيخ لنطق الأخطاء</span>
              <select value={reciterId} onChange={(e) => setReciterId(e.target.value)}>
                {reciters.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>
            <h4>الكلمات التي أخطأ فيها</h4>
            {session.mistakes.length ? (
              <ul className="mushaf-tasmee-mistakes">
                {session.mistakes.map((item, index) => (
                  <li key={`${item.word}-${index}`}>
                    <span className="mushaf-tasmee-mistake-word">{item.word}</span>
                    <span className="mushaf-tasmee-mistake-ref">
                      {`${surahNameOfNumber(item.surah)} ${arabicNumber(item.ayah)}`}
                    </span>
                    {item.spoken ? <span className="mushaf-tasmee-mistake-spoken">{`سمعت: ${item.spoken}`}</span> : null}
                    <button type="button" className="mushaf-tasmee-play" onClick={() => playCorrect(item.global)}>
                      النطق الصحيح
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mushaf-tasmee-summary">لا أخطاء — تسميع متقن ما شاء الله.</p>
            )}
            {modeUsesQuranAsr(engineMode) ? (
              <div className="mushaf-tasmee-qa">
                <h4>تقييم التسجيل</h4>
                {qaPhase === "loading" ? (
                  <p className="mushaf-tasmee-summary">جارٍ تقييم التسجيل محليًا…</p>
                ) : null}
                {qaPhase === "error" ? <p className="mushaf-tasmee-error">{qaError}</p> : null}
                {qaPhase === "ready" && qaRun ? (
                  <>
                    <p className="mushaf-tasmee-summary">
                      {`كلمات منطوقة ${arabicNumber(qaRun.transcription.words.length)} • محاذاة ${arabicNumber(Math.round(qaRun.assessment.accuracy * 100))}% • ثقة ${qaRun.assessment.meanConfidence.toFixed(2)}`}
                    </p>
                    <p className="mushaf-tasmee-hint">
                      {`مؤكد ${arabicNumber(qaRun.assessment.confirmedErrors)} • غير مؤكد ${arabicNumber(qaRun.assessment.uncertain)} • ${arabicNumber(Math.round(qaRun.timing.transcribeMs))} م.ث • نموذج ${arabicNumber(Math.round(qaRun.engine.modelBytes / 1048576))} م.ب`}
                    </p>
                    {qaNote ? <p className="mushaf-tasmee-summary">{qaNote}</p> : null}
                    {qaRun.assessment.transitions.filter((transition) => transition.kind !== "sequential").length ? (
                      <ul className="mushaf-tasmee-mistakes">
                        {qaRun.assessment.transitions
                          .filter((transition) => transition.kind !== "sequential")
                          .map((transition, index) => (
                            <li key={`qa-transition-${index}`}>
                              <span className="mushaf-tasmee-mistake-word">
                                {QA_TRANSITION_LABELS[transition.kind] ?? transition.kind}
                              </span>
                              <span className="mushaf-tasmee-mistake-ref">
                                {`${surahNameOfNumber(transition.from.surah)} ${arabicNumber(transition.from.ayah)} ← ${surahNameOfNumber(transition.to.surah)} ${arabicNumber(transition.to.ayah)}`}
                              </span>
                              <span className="mushaf-tasmee-mistake-spoken">
                                {transition.certain ? "مؤكد" : "غير مؤكد"}
                              </span>
                            </li>
                          ))}
                      </ul>
                    ) : null}
                    {qaFlagged.length ? (
                      <ul className="mushaf-tasmee-mistakes">
                        {qaFlagged.map((item, index) => (
                          <li key={`qa-item-${index}`}>
                            <span className="mushaf-tasmee-mistake-word">
                              {QA_KIND_LABELS[item.kind] ?? item.kind}
                            </span>
                            <span className="mushaf-tasmee-mistake-ref">
                              {item.ref
                                ? `${surahNameOfNumber(item.ref.surah)} ${arabicNumber(item.ref.ayah)} • كلمة ${arabicNumber(item.ref.word)}`
                                : "بلا موضع"}
                            </span>
                            {item.ref ? (
                              <span className="mushaf-tasmee-mistake-word">{item.ref.text}</span>
                            ) : null}
                            {item.spoken ? (
                              <span className="mushaf-tasmee-mistake-spoken">{`سمع: ${item.spoken}`}</span>
                            ) : null}
                            <span className="mushaf-tasmee-mistake-spoken">
                              {item.certain ? "مؤكد" : `غير مؤكد (${item.confidence.toFixed(2)})`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mushaf-tasmee-summary">لا مخالفات في النص المسموع.</p>
                    )}
                    <p className="mushaf-tasmee-live">{qaRun.transcription.text}</p>
                    <p className="mushaf-tasmee-hint">
                      تقييم مستقل عن التتبّع المباشر؛ لا تُدمج نتائجه مع علاماته ولا يُرسل أي صوت خارج الجهاز.
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
            <p className="mushaf-tasmee-saved">حُفظت النتيجة كاملة في أرشيف المصحف.</p>
            <div className="mushaf-tasmee-actions">
              <button type="button" className="primary-button" onClick={() => { orchestratorRef.current?.reset(); orchestratorRef.current = null; setQaPhase("idle"); setQaRun(null); setQaError(""); setQaNote(""); setPhase("config"); resetRun(); }}>
                إعادة التسميع
              </button>
              <button type="button" className="ghost-button" onClick={onClose}>إغلاق</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
