import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchSurah, fetchTafsir, normalizeArabic, type Ayah } from "../../lib/quran";
import { surahs } from "../../data/surahs";
import { tuhfaSections } from "../../data/tuhfa";
import { tuhfaVerseReciters, tuhfaVerseWindow } from "../../data/tuhfaVerseAudio";
import { buildEmbedUrl, formatClock, tafsirLibraryFor, toSeconds, type TafsirVideo } from "../../data/tafsirVideos";
import { fetchAutoTafsir } from "../../lib/tafsirAuto";
import { ayahAudioUrl, reciters } from "../../data/reciters";
import { checkAiAvailability, aiChat, type AiAvailability } from "../../lib/ai";
import { suggestPlanWithAi, type AiPlanSuggestion } from "../../lib/aiQuestions";
import { compareRecitation, type RecitationComparison } from "../../lib/recitation";
import { createFaceMonitor, type FaceReading } from "../../lib/faceMonitor";
import { recognitionErrorMessage, mediaErrorMessage, cameraErrorMessage } from "../../lib/speech";
import { addPoints } from "../../lib/appStore";
import { playNotificationSound } from "../../lib/sound";
import { celebrate } from "../../lib/celebrate";
import type { Account } from "../../lib/auth";
import { Icon, type IconName } from "./ui";
import OnlineChallenge from "./OnlineChallenge";

type BookKind = "quran" | "tuhfa";

type PlanStep = {
  id: string;
  from: number;
  to: number;
  donePaths: number[];
  mistakes: { ayah: number; word: string }[];
  completed: boolean;
};

type Plan = {
  id: string;
  book: BookKind;
  surah?: number;
  sectionId?: string;
  title: string;
  reciter: string;
  speed: number;
  repeat: number;
  capacity: number;
  memorizedBefore: "no" | "review";
  tajweed: boolean;
  createdAt: number;
  steps: PlanStep[];
};

type Screen = "home" | "quranSetup" | "tuhfaSetup" | "plan" | "map" | "path" | "recordings" | "challenge";

const PATHS: { id: number; label: string; icon: IconName }[] = [
  { id: 0, label: "السماع", icon: "play" },
  { id: 1, label: "القراءة", icon: "mic" },
  { id: 2, label: "التفسير", icon: "book" },
  { id: 3, label: "الكتابة", icon: "file" },
  { id: 4, label: "خلف الشيخ", icon: "refresh" },
  { id: 5, label: "اختبار تجريبي", icon: "clipboard" },
  { id: 6, label: "الأخطاء السابقة", icon: "x" },
  { id: 7, label: "الاختبار النهائي", icon: "camera" },
  { id: 8, label: "النطق", icon: "mic" },
];
const PATH_COUNT = PATHS.length;

/** المسارات الإجبارية: لا تُفتح الخطة التالية إلا بعد إتمامها كلها. */
const REQUIRED_PATHS = [8, 5, 7];


function plansKey(accountId: string) {
  return `thimar.memorize.plans.${accountId}.v1`;
}

function loadPlans(accountId: string): Plan[] {
  try {
    const raw = localStorage.getItem(plansKey(accountId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePlans(accountId: string, plans: Plan[]) {
  try {
    localStorage.setItem(plansKey(accountId), JSON.stringify(plans));
  } catch {
    /* ignore */
  }
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function stripBismillah(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length >= 5 && tokens[0].startsWith("بِسْمِ")) return tokens.slice(4).join(" ");
  return text;
}

type QuizQuestion = { ayah: number; before: string; correct: string; level: number; options: string[] };

/** اختبار تجريبي: تُعرض الآية (أو الكلمات) ويُكملها الطالب، والخيارات كلمة أو أكثر. */
function buildQuiz(ayahs: Ayah[], count = 12): QuizQuestion[] {
  const wordsOf = (a: Ayah) => a.text.split(/\s+/).filter(Boolean);
  const cuts: { ayah: Ayah; idx: number }[] = [];
  ayahs.forEach((a) => {
    const words = wordsOf(a);
    for (let i = 1; i < words.length; i += 1) cuts.push({ ayah: a, idx: i });
  });

  /* عبارات مرشحة بنفس طول الإكمال المطلوب (كلمة أو كلمتان أو ثلاث). */
  const spansOf = (len: number) => {
    const out: string[] = [];
    ayahs.forEach((a) => {
      const words = wordsOf(a);
      for (let i = 0; i + len <= words.length; i += 1) out.push(words.slice(i, i + len).join(" "));
    });
    return out;
  };

  const questions: QuizQuestion[] = [];
  for (const cut of shuffle(cuts)) {
    if (questions.length >= count) break;
    const level = questions.length < Math.floor(count / 3) ? 1 : questions.length < Math.floor((count * 2) / 3) ? 2 : 3;
    const words = wordsOf(cut.ayah);
    const spanLen = Math.min(level, words.length - cut.idx);
    if (spanLen < 1) continue;
    const correct = words.slice(cut.idx, cut.idx + spanLen).join(" ");
    const before = words.slice(0, cut.idx).join(" ");
    const distractors = shuffle([...new Set(spansOf(spanLen))].filter((w) => w !== correct)).slice(0, 3);
    if (distractors.length < 3) continue;
    questions.push({ ayah: cut.ayah.numberInSurah, before, correct, level, options: shuffle([correct, ...distractors]) });
  }
  return questions;
}

export default function MemorizationPathPage({ account }: { account: Account }) {
  const [plans, setPlans] = useState<Plan[]>(() => loadPlans(account.id));
  const [screen, setScreen] = useState<Screen>("home");
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<number | null>(null);

  // Setup
  const [setupSurah, setSetupSurah] = useState(1);
  const [setupStart, setSetupStart] = useState(1);
  const [setupCapacity, setSetupCapacity] = useState(5);
  const [aiPlan, setAiPlan] = useState<AiPlanSuggestion | null>(null);
  const [aiPlanLoading, setAiPlanLoading] = useState(false);
  const [aiPlanError, setAiPlanError] = useState("");
  const aiLevelLabel = (account as unknown as { level?: string }).level ?? "مبتدئ";
  const [setupBefore, setSetupBefore] = useState<"no" | "review">("no");
  const [setupTajweed, setSetupTajweed] = useState(false);
  const [setupReciter, setSetupReciter] = useState(reciters[0]?.id ?? "ar.alafasy");
  const [setupSpeed, setSetupSpeed] = useState(1);
  const [setupRepeat, setSetupRepeat] = useState(3);
  const [setupSection, setSetupSection] = useState(tuhfaSections[0]?.id ?? "");
  const [setupTuhfaStart, setSetupTuhfaStart] = useState(1);
  const [setupTuhfaReciter, setSetupTuhfaReciter] = useState(tuhfaVerseReciters[0]?.id ?? "ghamdi");
  const [setupAyahCount, setSetupAyahCount] = useState(0);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");

  const [stepAyahs, setStepAyahs] = useState<Ayah[]>([]);
  const [ai, setAi] = useState<AiAvailability>({ mode: "off" });
  const requiredPathIds = useMemo(
    () => (account.type === "teacher" || account.type === "guardian" ? [] : REQUIRED_PATHS),
    [account.type],
  );

  // Listening
  const [playing, setPlaying] = useState(false);
  const [listenPos, setListenPos] = useState({ round: 0, ayah: 0 });
  const [listenDone, setListenDone] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [perAyah, setPerAyah] = useState(3);
  const [rounds, setRounds] = useState(3);

  // Speech
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speechError, setSpeechError] = useState("");

  // Reading
  const [readingResult, setReadingResult] = useState<RecitationComparison | null>(null);
  const [advice, setAdvice] = useState("");
  const [adviceLoading, setAdviceLoading] = useState(false);

  // Tafsir
  const [tafsirEntries, setTafsirEntries] = useState<{ ayah: number; text: string }[]>([]);
  const [tafsirLoading, setTafsirLoading] = useState(false);
  const [wordNotes, setWordNotes] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [cropStart, setCropStart] = useState("");
  const [cropEnd, setCropEnd] = useState("");
  const [autoVideo, setAutoVideo] = useState<TafsirVideo | null>(null);
  const [autoNote, setAutoNote] = useState("");

  // Writing
  const [written, setWritten] = useState("");
  const [writeResult, setWriteResult] = useState<{ accuracy: number; missing: string[] } | null>(null);
  const [writeAttempts, setWriteAttempts] = useState(0);

  // Sheikh-follow
  const [sheikhIndex, setSheikhIndex] = useState(0);
  const [sheikhMsg, setSheikhMsg] = useState("");
  const [sheikhDone, setSheikhDone] = useState(false);

  // Quiz
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizRight, setQuizRight] = useState(0);
  const [quizWrong, setQuizWrong] = useState(0);
  const [quizTime, setQuizTime] = useState(180);
  const [quizFinished, setQuizFinished] = useState(false);
  const [quizRunning, setQuizRunning] = useState(false);
  const [quizChoice, setQuizChoice] = useState<string | null>(null);
  const [aiQuizLoading, setAiQuizLoading] = useState(false);
  const [aiQuizNote, setAiQuizNote] = useState("");

  // النطق
  type SayTarget = { prompt: string; answer: string; ayah: number; hint: string };
  const [sayTargets, setSayTargets] = useState<SayTarget[]>([]);
  const [sayIndex, setSayIndex] = useState(0);
  const [sayAttempts, setSayAttempts] = useState(0);
  const [sayRevealed, setSayRevealed] = useState(false);
  const [sayHeard, setSayHeard] = useState("");
  const [sayMsg, setSayMsg] = useState("");
  const [sayDone, setSayDone] = useState(false);
  const [sayAiLoading, setSayAiLoading] = useState(false);

  // Final test
  const [finalPhase, setFinalPhase] = useState<"intro" | "exam" | "result">("intro");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [finalResult, setFinalResult] = useState<RecitationComparison | null>(null);
  const [lookAways, setLookAways] = useState(0);
  const [faceNote, setFaceNote] = useState("");
  const [faceReady, setFaceReady] = useState(false);
  const [faceStatus, setFaceStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [cameraError, setCameraError] = useState("");
  const [finalStarted, setFinalStarted] = useState(false);
  const [finalError, setFinalError] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playTokenRef = useRef(0);
  const recogRef = useRef<{ stop: () => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const quizTimerRef = useRef<number | null>(null);

  useEffect(() => {
    savePlans(account.id, plans);
  }, [plans, account.id]);

  useEffect(() => {
    checkAiAvailability().then(setAi).catch(() => {});
  }, []);

  const activePlan = useMemo(() => plans.find((p) => p.id === activePlanId) ?? null, [plans, activePlanId]);
  const activeStep = useMemo(
    () => activePlan?.steps.find((s) => s.id === activeStepId) ?? null,
    [activePlan, activeStepId],
  );

  useEffect(() => {
    const plan = plans.find((p) => p.id === activePlanId);
    const step = plan?.steps.find((s) => s.id === activeStepId);
    if (!plan || !step) {
      setStepAyahs([]);
      return;
    }
    let cancelled = false;
    loadAyahsForStep(plan, step)
      .then((list) => {
        if (!cancelled) setStepAyahs(list);
      })
      .catch(() => {
        if (!cancelled) setStepAyahs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [plans, activePlanId, activeStepId]);

  // Setup ayah count
  useEffect(() => {
    if (screen !== "quranSetup") return;
    let cancelled = false;
    setSetupLoading(true);
    fetchSurah(setupSurah)
      .then((list) => {
        if (!cancelled) {
          setSetupAyahCount(list.length);
          setSetupStart((s) => Math.min(Math.max(1, s), list.length || 1));
        }
      })
      .catch(() => {
        if (!cancelled) setSetupAyahCount(0);
      })
      .finally(() => {
        if (!cancelled) setSetupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [screen, setupSurah]);

  // صوت عند عرض نتيجة الاختبار
  const quizWasFinishedRef = useRef(false);
  useEffect(() => {
    if (quizFinished && !quizWasFinishedRef.current) playNotificationSound("transition");
    quizWasFinishedRef.current = quizFinished;
  }, [quizFinished]);

  // Quiz timer
  useEffect(() => {
    if (!quizRunning) return;
    quizTimerRef.current = window.setInterval(() => {
      setQuizTime((t) => {
        if (t <= 1) {
          window.clearInterval(quizTimerRef.current ?? undefined);
          setQuizRunning(false);
          setQuizFinished(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => {
      if (quizTimerRef.current) window.clearInterval(quizTimerRef.current);
    };
  }, [quizRunning]);

  // مراقبة الوجه والعين: تحليل فعلي لإطارات الكاميرا (MediaPipe Face Landmarker).
  const monitorRef = useRef<{ detect: (v: HTMLVideoElement) => FaceReading; close: () => void } | null>(null);
  const goodStreakRef = useRef(0);
  const badStreakRef = useRef(0);
  const lastPenaltyRef = useRef(0);

  useEffect(() => {
    if (finalPhase !== "exam") return;
    let cancelled = false;
    let timer = 0;
    setFaceStatus("loading");
    setFaceNote("جارٍ تشغيل مراقبة الوجه والعين…");

    const schedule = () => {
      if (!cancelled) timer = window.setTimeout(loop, 420);
    };

    const loop = () => {
      if (cancelled) return;
      const monitor = monitorRef.current;
      const video = videoRef.current;
      if (!monitor) {
        schedule();
        return;
      }
      if (!video || video.readyState < 2) {
        schedule();
        return;
      }
      try {
        const reading = monitor.detect(video);
        if (!reading.face) {
          badStreakRef.current += 1;
          goodStreakRef.current = 0;
          setFaceReady(false);
          setFaceNote("لا أرى وجهك — اجلس أمام الكاميرا.");
        } else if (!reading.centered) {
          badStreakRef.current += 1;
          goodStreakRef.current = 0;
          setFaceReady(false);
          setFaceNote("وجّه وجهك إلى الشاشة مباشرة.");
        } else if (!reading.eyesOpen) {
          badStreakRef.current += 1;
          goodStreakRef.current = 0;
          setFaceReady(false);
          setFaceNote("افتح عينيك وانظر إلى الشاشة.");
        } else if (!reading.looking) {
          badStreakRef.current += 1;
          goodStreakRef.current = 0;
          setFaceReady(false);
          setFaceNote("نظرك بعيد عن الشاشة — أعِد نظرك إلى النص.");
        } else {
          goodStreakRef.current += 1;
          badStreakRef.current = 0;
          if (goodStreakRef.current >= 2) {
            setFaceReady(true);
            setFaceNote("الوجه واضح والعينان تجاه الشاشة — أنت جاهز.");
          }
        }

        /* تُحتسب النظرة البعيدة فقط بعد استمرارها ~1.7 ثانية وداخل الاختبار. */
        const now = Date.now();
        if (finalStarted && badStreakRef.current >= 4 && now - lastPenaltyRef.current > 2500) {
          badStreakRef.current = 0;
          lastPenaltyRef.current = now;
          setLookAways((n) => n + 1);
          playNotificationSound("error");
        }
      } catch {
        /* إطار غير صالح — نُعيد المحاولة */
      }
      schedule();
    };

    createFaceMonitor()
      .then((monitor) => {
        if (cancelled) {
          monitor.close();
          return;
        }
        monitorRef.current = monitor;
        setFaceStatus("ready");
        loop();
      })
      .catch(() => {
        if (cancelled) return;
        monitorRef.current = null;
        setFaceStatus("failed");
        setFaceReady(false);
        setFaceNote("تعذّر تشغيل مراقبة الوجه. تأكد من الاتصال بالإنترنت ثم أعد المحاولة.");
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      monitorRef.current?.close();
      monitorRef.current = null;
      goodStreakRef.current = 0;
      badStreakRef.current = 0;
    };
  }, [finalPhase, finalStarted]);

  // ربط بثّ الكاميرا بعنصر الفيديو بعد ظهوره في صفحة الاختبار.
  useEffect(() => {
    if (finalPhase !== "exam") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
  }, [finalPhase, finalStarted]);

  useEffect(() => {
    if (finalPhase === "exam" && lookAways >= 5) {
      setFinalError("تجاوزت عدد النظرات المسموح (4 نظرات). سيُعاد الاختبار.");
      setFinalPhase("result");
      setFinalResult({ expectedText: "", transcript: "", accuracy: 0, matched: 0, total: 0, diff: [], missingWords: [], extraWords: [] });
      stopCameraAndMic();
    }
  }, [lookAways, finalPhase]);

  useEffect(() => {
    return () => {
      stopAudio();
      stopRecog();
      stopCameraAndMic();
      if (quizTimerRef.current) window.clearInterval(quizTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAudio() {
    playTokenRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setPlaying(false);
  }

  function stopRecog() {
    try {
      recogRef.current?.stop();
    } catch {
      /* ignore */
    }
    recogRef.current = null;
    setListening(false);
    setInterim("");
  }

  function stopCameraAndMic() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  const playOne = useCallback(
    (ayah: Ayah, rate: number, book: BookKind, reciter: string) =>
      new Promise<void>((resolve) => {
        if (book === "quran") {
          const audio = new Audio(ayahAudioUrl(reciter, ayah.number));
          audio.playbackRate = rate;
          audioRef.current = audio;
          const done = () => {
            audio.onended = null;
            audio.onerror = null;
            resolve();
          };
          audio.onended = done;
          audio.onerror = done;
          audio.play().catch(done);
        } else {
          const rec = tuhfaVerseReciters.find((r) => r.id === reciter);
          if (!rec) {
            resolve();
            return;
          }
          const [start, end] = tuhfaVerseWindow(rec, ayah.numberInSurah);
          const audio = new Audio(rec.url);
          audio.playbackRate = rate;
          audioRef.current = audio;
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            audio.ontimeupdate = null;
            audio.onerror = null;
            audio.pause();
            resolve();
          };
          audio.ontimeupdate = () => {
            if (audio.currentTime >= end) done();
          };
          audio.onerror = done;
          const begin = () => {
            try { audio.currentTime = start; } catch { /* ignore */ }
            audio.play().catch(done);
          };
          if (audio.readyState >= 1) begin();
          else audio.addEventListener("loadedmetadata", begin, { once: true });
        }
      }),
    [],
  );

  const playAll = async (list: Ayah[], repeatPerAyah: number, wholeRounds: number) => {
    if (!activePlan || list.length === 0) return;
    stopAudio();
    const token = ++playTokenRef.current;
    setPlaying(true);
    setListenDone(false);
    try {
      for (let r = 0; r < wholeRounds; r += 1) {
        for (let i = 0; i < list.length; i += 1) {
          if (token !== playTokenRef.current) return;
          setListenPos({ round: r + 1, ayah: i + 1 });
          for (let k = 0; k < repeatPerAyah; k += 1) {
            if (token !== playTokenRef.current) return;
            await playOne(list[i], speed, activePlan.book, activePlan.reciter);
          }
        }
      }
      if (token === playTokenRef.current) setListenDone(true);
    } finally {
      if (token === playTokenRef.current) setPlaying(false);
    }
  };

  const startRecog = (onFinal: (text: string) => void, onEnd?: () => void) => {
    const scope = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        continuous: boolean;
        interimResults: boolean;
        onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
        onerror: ((e: { error?: string }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: unknown;
    };
    const Rec = scope.SpeechRecognition || (scope.webkitSpeechRecognition as typeof scope.SpeechRecognition);
    if (!Rec) {
      setSpeechError("متصفحك لا يدعم تحويل الكلام إلى نص. استخدم الكتابة اليدوية.");
      onEnd?.();
      return null;
    }
    const recognition = new Rec();
    recognition.lang = "ar-SA";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += ` ${result[0]?.transcript ?? ""}`;
        else interimText += ` ${result[0]?.transcript ?? ""}`;
      }
      if (finalText.trim()) onFinal(finalText.trim());
      setInterim(interimText.trim());
    };
    recognition.onerror = (event) => {
      const msg = recognitionErrorMessage(event.error);
      if (msg) setSpeechError(msg);
    };
    recognition.onend = () => {
      setInterim("");
      onEnd?.();
    };
    recogRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setSpeechError("تعذّر بدء التعرف على الصوت.");
    }
    return recognition;
  };

  const expectedText = useMemo(() => stepAyahs.map((a) => a.text).join(" "), [stepAyahs]);
  const surahName = activePlan?.book === "quran" && activePlan.surah ? surahs[activePlan.surah - 1]?.name ?? "" : activePlan?.title ?? "";

  // ربط تلقائي: يجلب فيديو التفسير وتوقيت المقطع من YouTube Data API (عبر الخادم).
  useEffect(() => {
    if (activePath !== 2 || !activePlan || !activeStep) return;
    const from = activeStep.from;
    const to = activeStep.to;
    let cancelled = false;
    setAutoVideo(null);
    setAutoNote("");
    fetchAutoTafsir({
      book: activePlan.book,
      surahName: activePlan.book === "quran" ? surahName : "",
      from,
      to,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.unconfigured) {
          setAutoNote("الربط التلقائي غير مفعّل بعد — أضف مفتاح YOUTUBE_API_KEY في أسرار الموقع.");
          return;
        }
        const auto = res.data;
        if (!auto) return;
        setAutoVideo({
          id: "auto",
          title: auto.title || "تفسير تلقائي",
          channel: auto.channel || "يوتيوب",
          videoId: auto.videoId,
        });
        setSelectedVideoId("auto");
        setCropStart(auto.start > 0 ? formatClock(auto.start) : "");
        setCropEnd(auto.end > 0 ? formatClock(auto.end) : "");
        setAutoNote(
          auto.start > 0
            ? `تم ضبط المقطع تلقائيًا على: ${auto.chapterLabel ?? formatClock(auto.start)}`
            : "تم اختيار الفيديو تلقائيًا — يمكنك اقتصاص المقطع يدويًا.",
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activePath, activePlan?.id, activeStep?.from, activeStep?.to, surahName]);

  function resetPathState() {
    stopAudio();
    stopRecog();
    stopCameraAndMic();
    setTranscript("");
    setInterim("");
    setSpeechError("");
    setReadingResult(null);
    setAdvice("");
    setTafsirEntries([]);
    setWordNotes("");
    setSelectedVideoId(null);
    setCropStart("");
    setCropEnd("");
    setAutoVideo(null);
    setAutoNote("");
    setWritten("");
    setWriteResult(null);
    setWriteAttempts(0);
    setSheikhIndex(0);
    setSheikhMsg("");
    setSheikhDone(false);
    setSayTargets([]);
    setSayIndex(0);
    setSayAttempts(0);
    setSayRevealed(false);
    setSayHeard("");
    setSayMsg("");
    setSayDone(false);
    setQuestions([]);
    setQuizIndex(0);
    setQuizRight(0);
    setQuizWrong(0);
    setQuizTime(180);
    setQuizFinished(false);
    setQuizRunning(false);
    setQuizChoice(null);
    setFinalPhase("intro");
    setFinalStarted(false);
    setFaceReady(false);
    setFaceStatus("loading");
    setFinalTranscript("");
    setFinalResult(null);
    setLookAways(0);
    setFaceNote("");
    setFinalError("");
    setListenDone(false);
    setListenPos({ round: 0, ayah: 0 });
  }

  function openPath(planId: string, stepId: string, pathId: number) {
    resetPathState();
    setActivePlanId(planId);
    setActiveStepId(stepId);
    setActivePath(pathId);
    setSpeed(activePlanMap(planId)?.speed ?? 1);
    setPerAyah(3);
    setRounds(Math.max(3, activePlanMap(planId)?.repeat ?? 3));
    setScreen("path");
  }

  function activePlanMap(planId: string) {
    return plans.find((p) => p.id === planId);
  }

  function updateStep(planId: string, stepId: string, updater: (s: PlanStep) => PlanStep) {
    setPlans((prev) =>
      prev.map((p) =>
        p.id !== planId ? p : { ...p, steps: p.steps.map((s) => (s.id === stepId ? updater(s) : s)) },
      ),
    );
  }

  function completePath(pathId: number) {
    if (!activePlanId || !activeStepId) return;
    let isComplete = false;
    updateStep(activePlanId, activeStepId, (s) => {
      const donePaths = s.donePaths.includes(pathId) ? s.donePaths : [...s.donePaths, pathId];
      /* لا تُفتح الخطة التالية إلا بعد إتمام المسارات الإجبارية كلها. */
      isComplete =
        requiredPathIds.length > 0
          ? requiredPathIds.every((id) => donePaths.includes(id))
          : donePaths.length >= PATH_COUNT;
      return { ...s, donePaths, completed: isComplete };
    });
    // احتفال عند إتمام مسار أو إتمام الخطة كاملة.
    celebrate("path", isComplete ? "أكملت الخطة" : undefined);
    setScreen("map");
  }

  function addMistakes(items: { ayah: number; word: string }[]) {
    if (!activePlanId || !activeStepId || items.length === 0) return;
    updateStep(activePlanId, activeStepId, (s) => {
      const existing = new Set(s.mistakes.map((m) => `${m.ayah}:${m.word}`));
      const merged = [...s.mistakes];
      items.forEach((m) => {
        const key = `${m.ayah}:${m.word}`;
        if (!existing.has(key)) {
          existing.add(key);
          merged.push(m);
        }
      });
      return { ...s, mistakes: merged };
    });
  }

  async function createQuranPlan() {
    setSetupLoading(true);
    setSetupError("");
    try {
      const all = await fetchSurah(setupSurah);
      const total = all.length;
      const start = Math.min(Math.max(1, setupStart), total || 1);
      const cap = Math.max(1, setupCapacity);
      const steps: PlanStep[] = [];
      for (let f = start; f <= total; f += cap) {
        const to = Math.min(total, f + cap - 1);
        steps.push({ id: `st-${f}-${to}-${Date.now()}`, from: f, to, donePaths: [], mistakes: [], completed: false });
      }
      const plan: Plan = {
        id: `plan-${Date.now()}`,
        book: "quran",
        surah: setupSurah,
        title: surahs[setupSurah - 1]?.name ?? `سورة ${setupSurah}`,
        reciter: setupReciter,
        speed: setupSpeed,
        repeat: setupRepeat,
        capacity: cap,
        memorizedBefore: setupBefore,
        tajweed: setupTajweed,
        createdAt: Date.now(),
        steps,
      };
      setPlans((prev) => [plan, ...prev]);
      setActivePlanId(plan.id);
      setScreen("plan");
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "تعذّر تحميل السورة.");
    } finally {
      setSetupLoading(false);
    }
  }

  function createTuhfaPlan() {
    const section = tuhfaSections.find((s) => s.id === setupSection) ?? tuhfaSections[0];
    if (!section) return;
    const cap = Math.max(1, setupCapacity);
    const total = section.verses.length;
    const start = Math.min(Math.max(1, setupTuhfaStart), total || 1);
    const steps: PlanStep[] = [];
    for (let f = start; f <= total; f += cap) {
      const to = Math.min(total, f + cap - 1);
      steps.push({ id: `st-${f}-${to}-${Date.now()}`, from: f, to, donePaths: [], mistakes: [], completed: false });
    }
    const plan: Plan = {
      id: `plan-${Date.now()}`,
      book: "tuhfa",
      sectionId: section.id,
      title: section.title,
      reciter: setupTuhfaReciter,
      speed: setupSpeed,
      repeat: setupRepeat,
      capacity: cap,
      memorizedBefore: setupBefore,
      tajweed: setupTajweed,
      createdAt: Date.now(),
      steps,
    };
    setPlans((prev) => [plan, ...prev]);
    setActivePlanId(plan.id);
    setScreen("plan");
  }

  function deletePlan(planId: string) {
    setPlans((prev) => prev.filter((p) => p.id !== planId));
    if (activePlanId === planId) {
      setActivePlanId(null);
      setScreen("home");
    }
  }

  // ===== Path actions =====

  const analyzeReading = async () => {
    if (!transcript.trim()) {
      setSpeechError("لم يُلتقط أي نص. اقرأ الآيات بصوت واضح.");
      return;
    }
    const res = compareRecitation(expectedText, transcript);
    setReadingResult(res);
    const missing = res.diff.filter((d) => d.status === "missing").map((d) => d.word);
    if (missing.length > 0) {
      addMistakes(missing.map((w) => ({ ayah: stepAyahs[0]?.numberInSurah ?? 0, word: w })));
    }
    const local =
      res.accuracy >= 95
        ? `ما شاء الله، تلاوة متقنة (${res.accuracy}%).`
        : res.accuracy >= 70
          ? `تلاوة جيدة (${res.accuracy}%). ركّز على: ${res.missingWords.slice(0, 6).join("، ")}.`
          : `تحتاج مراجعة (${res.accuracy}%). أعد الاستماع ثم اقرأ بتأنٍّ.`;
    const tajweedNote = activePlan?.tajweed ? " ركّز على التشكيل وأحكام التجويد: المدود والغنن والمخارج." : " ركّز على التشكيل ونطق أواخر الكلمات.";
    setAdvice(local + tajweedNote);
    if (ai.mode !== "off") {
      setAdviceLoading(true);
      try {
        const txt = await aiChat(
          [
            { role: "system", content: "أنت معلم قرآن. أعطِ ملاحظات قصيرة (3-5 أسطر) تشجع الحفظ وتوضح التشكيل وأحكام التجويد عند الحاجة فقط." },
            { role: "user", content: `الآيات: ${expectedText}\nما سمعه النظام: ${transcript}\nنسبة المطابقة: ${res.accuracy}%\nمجوّد: ${activePlan?.tajweed ? "نعم" : "لا"}` },
          ],
          { temperature: 0.3, maxTokens: 300 },
        );
        setAdvice(txt);
      } catch {
        /* keep local */
      } finally {
        setAdviceLoading(false);
      }
    }
  };

  const loadTafsir = async () => {
    setTafsirLoading(true);
    const entries: { ayah: number; text: string }[] = [];
    for (const ayah of stepAyahs) {
      if (activePlan?.book === "tuhfa") {
        entries.push({ ayah: ayah.numberInSurah, text: `شرح مبسط: يُقرأ هذا البيت ضمن باب «${activePlan.title}»؛ ركّز على معنى البيت وتشكيل كلماته.` });
        continue;
      }
      try {
        const t = await fetchTafsir(ayah.surah, ayah.numberInSurah);
        entries.push({ ayah: ayah.numberInSurah, text: t.text });
      } catch {
        entries.push({ ayah: ayah.numberInSurah, text: "تعذّر تحميل تفسير هذه الآية." });
      }
    }
    setTafsirEntries(entries);
    setTafsirLoading(false);
    if (ai.mode !== "off") {
      try {
        const txt = await aiChat(
          [
            { role: "system", content: activePlan?.book === "tuhfa" ? "أنت معلم تحفة الأطفال. اشرح كل بيت شرحًا مبسطًا جدًا (سطران لكل بيت) يعين على الحفظ." : "أنت معلم تفسير. اشرح معاني أصعب 5 كلمات بأسلوب مبسط جدًا للحفظ (نقاط قصيرة)." },
            { role: "user", content: expectedText },
          ],
          { temperature: 0.4, maxTokens: 400 },
        );
        setWordNotes(txt);
      } catch {
        /* ignore */
      }
    }
  };

  const checkWriting = () => {
    const expectedWords = normalizeArabic(expectedText).split(/\s+/).filter(Boolean);
    const writtenWords = normalizeArabic(written).split(/\s+/).filter(Boolean);
    const writtenSet = new Set(writtenWords);
    let matched = 0;
    const missing: string[] = [];
    expectedWords.forEach((w) => {
      if (writtenSet.has(w)) matched += 1;
      else missing.push(w);
    });
    const accuracy = expectedWords.length === 0 ? 0 : Math.round((matched / expectedWords.length) * 100);
    setWriteResult({ accuracy, missing });
    setWriteAttempts((a) => a + 1);
    if (missing.length > 0) addMistakes(missing.map((w) => ({ ayah: stepAyahs[0]?.numberInSurah ?? 0, word: w })));
  };

  const startSheikhAyah = async () => {
    if (!activePlan) return;
    const ayah = stepAyahs[sheikhIndex];
    if (!ayah) return;
    stopRecog();
    setSheikhMsg("");
    setTranscript("");
    await playOne(ayah, 0.9, activePlan.book, activePlan.reciter);
    // then let user recite
    setSheikhMsg("الآن اقرأ الآية بعد الشيخ…");
    const rec = startRecog(
      (text) => {
        setTranscript((prev) => `${prev} ${text}`.trim());
      },
      () => setListening(false),
    );
    if (rec) {
      setListening(true);
    }
  };

  const submitSheikh = () => {
    const ayah = stepAyahs[sheikhIndex];
    if (!ayah) return;
    stopRecog();
    const res = compareRecitation(ayah.text, transcript);
    if (res.accuracy >= 85) {
      setSheikhMsg(`أحسنت! (${res.accuracy}%).`);
      if (sheikhIndex + 1 >= stepAyahs.length) {
        setSheikhDone(true);
      } else {
        setSheikhIndex((i) => i + 1);
        setTranscript("");
      }
    } else {
      const words = ayah.text.split(/\s+/).filter(Boolean);
      const firstMissing = res.diff.findIndex((d) => d.status === "missing");
      const idx = firstMissing >= 0 ? firstMissing : 0;
      const word = words[idx] ?? "";
      const next = words[idx + 1] ?? "";
      addMistakes([{ ayah: ayah.numberInSurah, word }]);
      setSheikhMsg(`خطأ في «${word}». أعد سماع: «${word}${next ? " " + next : ""}» ثم أعد القراءة.`);
      speakWords([word, next]);
      setTranscript("");
    }
  };

  /* ===== مسار النطق: تُعرض كلمة من الآية ويُطلب إكمالها صوتيًا ===== */

  const buildSayTargets = (): SayTarget[] => {
    const list: SayTarget[] = [];
    stepAyahs.forEach((ayah) => {
      const words = ayah.text.split(/\s+/).filter(Boolean);
      if (words.length < 2) return;
      const picks = shuffle(words.map((_, i) => i).filter((i) => i < words.length - 1)).slice(0, 2);
      picks.forEach((idx) => {
        const answerLen = words.length - idx - 1 >= 2 && Math.random() > 0.6 ? 2 : 1;
        list.push({
          prompt: words[idx],
          answer: words.slice(idx + 1, idx + 1 + answerLen).join(" "),
          ayah: ayah.numberInSurah,
          hint: `${words[idx]} …`,
        });
      });
    });
    return shuffle(list).slice(0, 8);
  };

  const sayAyahOf = (target: SayTarget) =>
    stepAyahs.find((a) => a.numberInSurah === target.ayah) ?? stepAyahs[0];

  const playSayAudio = (target: SayTarget) => {
    const ayah = sayAyahOf(target);
    if (!ayah || !activePlan) return;
    stopAudio();
    playOne(ayah, 0.85, activePlan.book, activePlan.reciter);
  };

  const beginSayMic = () => {
    stopRecog();
    setSpeechError("");
    setTranscript("");
    setSayHeard("");
    const rec = startRecog(
      (text) => {
        setSayHeard((prev) => `${prev} ${text}`.trim());
        setTranscript((prev) => `${prev} ${text}`.trim());
      },
      () => setListening(false),
    );
    if (rec) setListening(true);
  };

  /** أسئلة متنوعة بالذكاء الاصطناعي من الآيات، مع بديل محلي دائمًا. */
  const startSayPath = async () => {
    setSayMsg("");
    setSayHeard("");
    setTranscript("");
    setSayAttempts(0);
    setSayRevealed(false);
    setSayDone(false);
    setSayIndex(0);
    let targets = buildSayTargets();
    if (ai.mode !== "off" && expectedText.trim()) {
      setSayAiLoading(true);
      try {
        const raw = await aiChat(
          [
            { role: "system", content: "أنت معلم قرآن. تختار كلمات من النص ليُكملها الطالب صوتيًا. أعد JSON فقط بلا شرح." },
            {
              role: "user",
              content:
                `من هذا النص اختر 6 كلمات مختلفة، ولكل كلمة الكلمة (أو الكلمتين) التي تليها مباشرة في النص.\n` +
                `النص:\n${expectedText}\n` +
                `أعد بالشكل: [{"word":"...","next":"..."}]`,
            },
          ],
          { temperature: 0.5, maxTokens: 700 },
        );
        const from = raw.indexOf("[");
        const to = raw.lastIndexOf("]");
        if (from >= 0 && to > from) {
          const arr = JSON.parse(raw.slice(from, to + 1)) as { word?: string; next?: string }[];
          const aiTargets: SayTarget[] = arr
            .filter((q) => q && q.word && q.next)
            .slice(0, 8)
            .map((q) => ({
              prompt: String(q.word),
              answer: String(q.next),
              ayah: stepAyahs[0]?.numberInSurah ?? 0,
              hint: `${q.word} …`,
            }));
          if (aiTargets.length >= 3) targets = aiTargets;
        }
      } catch {
        /* نبقى على الأسئلة المحلية */
      } finally {
        setSayAiLoading(false);
      }
    }
    setSayTargets(targets);
    if (targets.length === 0) {
      setSayMsg("لا توجد كلمات كافية في هذه الآيات.");
      return;
    }
    beginSayMic();
  };

  const advanceSay = () => {
    setSayAttempts(0);
    setSayRevealed(false);
    setSayHeard("");
    setTranscript("");
    setSayMsg("");
    if (sayIndex + 1 >= sayTargets.length) {
      setSayDone(true);
      stopRecog();
      return;
    }
    setSayIndex((i) => i + 1);
  };

  const checkSay = () => {
    const target = sayTargets[sayIndex];
    if (!target) return;
    const spoken = `${sayHeard} ${interim}`.trim();
    if (!spoken) {
      setSayMsg("لم أسمع شيئًا — افتح الميكروفون وانطق الكلمة المطلوبة.");
      return;
    }
    const res = compareRecitation(target.answer, spoken);
    const ok = res.missingWords.length === 0 && res.accuracy >= 80;
    if (ok) {
      setSayMsg(`أحسنت! نطق صحيح: «${target.answer}».`);
      playNotificationSound("success");
      window.setTimeout(advanceSay, 900);
      return;
    }
    const attempts = sayAttempts + 1;
    setSayAttempts(attempts);
    if (attempts >= 4) {
      setSayRevealed(true);
      setSayMsg(`الكلمة الصحيحة: «${target.answer}». اسمعها ثم أعد نطقها أو انتقل للكلمة التالية.`);
      playSayAudio(target);
    } else {
      setSayMsg("لم تُنطق الكلمة صحيحة تمامًا. أعد المحاولة بصوت واضح (بانتظام دون زيادة أو نقصان).");
    }
  };

  function speakWords(words: string[]) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(words.filter(Boolean).join(" "));
    u.lang = "ar-SA";
    u.rate = 0.8;
    window.speechSynthesis.speak(u);
  }

  const beginQuiz = (qs: QuizQuestion[]) => {
    setQuestions(qs);
    setQuizIndex(0);
    setQuizRight(0);
    setQuizWrong(0);
    setQuizTime(180);
    setQuizFinished(false);
    setQuizChoice(null);
    setQuizRunning(qs.length > 0);
  };

  const startQuiz = () => {
    setAiQuizNote("");
    beginQuiz(buildQuiz(stepAyahs, 12));
  };

  /** أسئلة متدرجة من الذكاء الاصطناعي، مع بديل محلي إذا تعذّر التوليد. */
  const startAiQuiz = async () => {
    if (ai.mode === "off") {
      setAiQuizNote("الذكاء الاصطناعي غير مفعّل من الإعدادات — استخدم الاختبار المحلي.");
      return;
    }
    setAiQuizLoading(true);
    setAiQuizNote("");
    try {
      const raw = await aiChat(
        [
          { role: "system", content: "أنت مصمم أسئلة حفظ قرآن للمتعلّمين. أعد JSON فقط بلا أي شرح أو تنسيق إضافي." },
          {
            role: "user",
            content:
              `ولّد 6 أسئلة اختيار من متعدد متدرجة الصعوبة من النص التالي: سؤالان سهلان (سياق كامل)، سؤالان متوسطان (آخر كلمتين مخفيتان)، سؤالان صعبان (آخر أربع كلمات مخفية).\n` +
              `كل سؤال يحتوي مقطعًا من النص ينتهي بجزء مخفي، والجزء الصحيح (قد يكون كلمة أو كلمتين أو ثلاثًا)، و3 بدائل خاطئة من النص بنفس عدد كلمات الجزء الصحيح.\n` +
              `النص:\n${expectedText}\n` +
              `أعد بالشكل: [{"before":"...","correct":"...","options":["...","...","...","..."]}]`,
          },
        ],
        { temperature: 0.4, maxTokens: 1200 },
      );
      const from = raw.indexOf("[");
      const to = raw.lastIndexOf("]");
      if (from < 0 || to <= from) throw new Error("no-json");
      const arr = JSON.parse(raw.slice(from, to + 1)) as { before?: string; correct?: string; options?: string[] }[];
      const qs: QuizQuestion[] = arr
        .filter((q) => q && q.before && q.correct && Array.isArray(q.options))
        .slice(0, 12)
        .map((q, i) => ({
          ayah: 0,
          before: String(q.before),
          correct: String(q.correct),
          level: i < 2 ? 1 : i < 4 ? 2 : 3,
          options: shuffle([String(q.correct), ...(q.options ?? []).filter((o) => o && o !== q.correct).slice(0, 3)]),
        }));
      if (qs.length === 0) throw new Error("empty");
      beginQuiz(qs);
      setAiQuizNote(`تم توليد ${qs.length} أسئلة متدرجة بالذكاء الاصطناعي.`);
    } catch {
      setAiQuizNote("تعذّر توليد أسئلة الذكاء الاصطناعي الآن — يمكنك استخدام الاختبار المحلي.");
    } finally {
      setAiQuizLoading(false);
    }
  };

  const answerQuiz = (choice: string) => {
    if (quizChoice || quizFinished) return;
    const q = questions[quizIndex];
    if (!q) return;
    setQuizChoice(choice);
    const right = choice === q.correct;
    if (right) setQuizRight((n) => n + 1);
    else {
      setQuizWrong((n) => n + 1);
      addMistakes([{ ayah: q.ayah, word: q.correct }]);
    }
    window.setTimeout(() => {
      const nextWrong = quizWrong + (right ? 0 : 1);
      if (nextWrong >= 3) {
        setQuizRunning(false);
        setQuizFinished(true);
        return;
      }
      if (quizIndex + 1 >= questions.length) {
        setQuizRunning(false);
        setQuizFinished(true);
        return;
      }
      setQuizIndex((i) => i + 1);
      setQuizChoice(null);
    }, 700);
  };

  const startFinalExam = async () => {
    setFinalError("");
    setFinalTranscript("");
    setFinalResult(null);
    setLookAways(0);
    setFaceReady(false);
    setFinalStarted(false);
    setFaceNote("جارٍ تشغيل الكاميرا…");
    stopRecog();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      setCameraError("");
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      setCameraError(cameraErrorMessage(err));
      setFaceNote("تعذّر فتح الكاميرا — لا يبدأ الاختبار قبل تشغيل مراقبة الوجه.");
    }
    setFinalPhase("exam");
  };

  const beginFinalRecitation = () => {
    if (!faceReady || faceStatus !== "ready") {
      setFaceNote("لا يبدأ الاختبار قبل أن يكون وجهك ونظرك إلى الشاشة.");
      return;
    }
    setFinalStarted(true);
    setFinalError("");
    const rec = startRecog(
      (text) => setFinalTranscript((prev) => `${prev} ${text}`.trim()),
      () => setListening(false),
    );
    if (rec) setListening(true);
  };

  const finishFinal = () => {
    stopRecog();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const res = compareRecitation(expectedText, finalTranscript);
    setFinalResult(res);
    setFinalPhase("result");
    playNotificationSound(res.accuracy >= 70 ? "success" : "error");
    if (res.accuracy >= 70) addPoints(account.id, 5);
    if (res.missingWords.length > 0) {
      addMistakes(res.missingWords.slice(0, 10).map((w) => ({ ayah: stepAyahs[0]?.numberInSurah ?? 0, word: w })));
    }
  };

  const retryFinal = async () => {
    setFinalTranscript("");
    setFinalResult(null);
    setFinalError("");
    await startFinalExam();
  };

  // ===== Render helpers =====

  const pageWrap = (children: ReactNode) => (
    <div className="page standalone-page" style={{ paddingBottom: 90 }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "6px 12px" }}>{children}</div>
    </div>
  );

  const goHome = () => {
    stopAudio();
    stopRecog();
    stopCameraAndMic();
    setScreen("home");
    setActivePath(null);
  };

  function renderHome() {
    const cards = [
      { key: "quran" as const, label: "القرآن الكريم", note: "خطة حفظ متدرجة", icon: "book" as IconName },
      { key: "tuhfa" as const, label: "تحفة الأطفال", note: "أبيات وأحكام التجويد", icon: "file" as IconName },
      { key: "challenge" as const, label: "التحدي", note: "اختبر حفظك", icon: "chart" as IconName },
    ];
    return pageWrap(
      <>
        <div className="mem-home">
          <div className="mem-header">
            <h2 className="page-title">الحفظ</h2>
            <p className="page-subtitle">اختر ما تريد حفظه وواصل من حيث توقفت</p>
          </div>
          <div className="mem-tiles">
            {cards.map((c) => (
              <button
                key={c.key}
                type="button"
                className="mem-tile"
                onClick={() =>
                  setScreen(
                    (c.key as string) === "recordings"
                      ? "recordings"
                      : c.key === "quran"
                        ? "quranSetup"
                        : c.key === "challenge"
                          ? "challenge"
                          : "tuhfaSetup",
                  )
                }
              >
                <span className="mem-tile-icon"><Icon name={c.icon} size={24} /></span>
                <strong>{c.label}</strong>
                <span>{c.note}</span>
              </button>
            ))}
          </div>
          <div className="mem-plans">
            <h3 style={{ margin: 0, fontSize: 16 }}>خططك المحفوظة</h3>
            {plans.length > 0 ? (
              plans.slice(0, 4).map((p) => {
                const done = p.steps.filter((s) => s.completed).length;
                const percent = p.steps.length ? Math.round((done / p.steps.length) * 100) : 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="mem-plan-row"
                    onClick={() => {
                      setActivePlanId(p.id);
                      setScreen("plan");
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "block" }}>{p.title} • {p.book === "quran" ? "قرآن" : "تحفة"}</span>
                      <span className="mem-plan-progress"><i style={{ width: `${percent}%` }} /></span>
                    </span>
                    <span className="muted">{done}/{p.steps.length}</span>
                  </button>
                );
              })
            ) : (
              <p className="muted" style={{ margin: 0 }}>لا توجد خطة بعد — اختر «القرآن الكريم» أو «تحفة الأطفال» لبدء خطة حفظ.</p>
            )}
          </div>
        </div>
      </>
    );
  }

  function renderQuranSetup() {
    return pageWrap(
      <div className="page-content">
        <button className="ghost-button" onClick={() => setScreen("home")}>→ رجوع</button>
        <h2 className="page-title">خطة حفظ — القرآن الكريم</h2>
        <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
          <label>
            <span>السورة</span>
            <select className="surah-select" value={setupSurah} onChange={(e) => setSetupSurah(Number(e.target.value))}>
              {surahs.map((s) => (
                <option key={s.n} value={s.n}>{s.n}. {s.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>أول آية تريد حفظها</span>
            <input
              type="number"
              min={1}
              max={setupAyahCount || 1}
              value={setupStart}
              onChange={(e) => setSetupStart(Math.max(1, Number(e.target.value) || 1))}
              className="input-small"
              style={{ marginInlineStart: 8 }}
            />
            {setupLoading ? <span className="muted"> …</span> : <span className="muted"> من {setupAyahCount} آية</span>}
          </label>
          <label>
            <span>مقدار الحفظ في كل خطة (عدد الآيات)</span>
            <input
              type="number"
              min={1}
              max={20}
              value={setupCapacity}
              onChange={(e) => setSetupCapacity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="input-small"
              style={{ marginInlineStart: 8 }}
            />
          </label>
          <div>
            <span>هل حفظتها من قبل؟</span>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button type="button" className={setupBefore === "no" ? "primary-button" : "ghost-button"} onClick={() => setSetupBefore("no")} style={{ borderRadius: 20, padding: "6px 16px" }}>لا</button>
              <button type="button" className={setupBefore === "review" ? "primary-button" : "ghost-button"} onClick={() => setSetupBefore("review")} style={{ borderRadius: 20, padding: "6px 16px" }}>نعم — تحتاج مراجعة</button>
            </div>
          </div>
          <div>
            <span>هل تريدها مجوّدة؟</span>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button type="button" className={setupTajweed ? "primary-button" : "ghost-button"} onClick={() => setSetupTajweed(true)} style={{ borderRadius: 20, padding: "6px 16px" }}>نعم</button>
              <button type="button" className={!setupTajweed ? "primary-button" : "ghost-button"} onClick={() => setSetupTajweed(false)} style={{ borderRadius: 20, padding: "6px 16px" }}>لا</button>
            </div>
          </div>
          <label>
            <span>القارئ</span>
            <select value={setupReciter} onChange={(e) => setSetupReciter(e.target.value)} style={{ marginInlineStart: 8 }}>
              {reciters.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label>
              <span>السرعة</span>
              <select value={setupSpeed} onChange={(e) => setSetupSpeed(Number(e.target.value))} style={{ marginInlineStart: 8 }}>
                <option value={0.5}>0.5×</option>
                <option value={0.75}>0.75×</option>
                <option value={1}>1×</option>
                <option value={1.25}>1.25×</option>
              </select>
            </label>
            <label>
              <span>التكرار</span>
              <select value={setupRepeat} onChange={(e) => setSetupRepeat(Number(e.target.value))} style={{ marginInlineStart: 8 }}>
                {[3, 4, 5, 7, 10].map((n) => (
                  <option key={n} value={n}>{n} مرات</option>
                ))}
              </select>
            </label>
          </div>
          {setupError ? <p className="error-text">{setupError}</p> : null}
          <button
            className="ghost-button"
            disabled={aiPlanLoading}
            onClick={async () => {
              setAiPlanLoading(true);
              setAiPlanError("");
              const suggestion = await suggestPlanWithAi({
                accountId: account.id,
                surah: surahs[setupSurah - 1]?.name ?? `السورة ${setupSurah}`,
                fromAyah: setupStart,
                totalAyahs: setupAyahCount,
                level: aiLevelLabel,
                minutes: 20,
              });
              setAiPlanLoading(false);
              if (!suggestion) {
                setAiPlanError("تعذّر الوصول إلى الذكاء الاصطناعي الآن. يمكنك إنشاء الخطة يدويًا.");
                return;
              }
              setAiPlan(suggestion);
              setSetupCapacity(suggestion.perSession);
            }}
          >
            <Icon name="sparkles" size={16} /> {aiPlanLoading ? "جارٍ اقتراح الخطة…" : "اقترح لي خطة بالذكاء الاصطناعي"}
          </button>
          {aiPlanError ? <p className="error-text">{aiPlanError}</p> : null}
          {aiPlan ? (
            <div style={{ padding: 12, borderRadius: 10, background: "rgba(15,95,78,0.08)" }}>
              <strong>خطة مقترحة:</strong> {aiPlan.summary} (حوالي {aiPlan.days} يومًا)
              <ul style={{ margin: "8px 0 0", paddingInlineStart: 18 }}>
                {aiPlan.tips.map((tip, index) => <li key={index}>{tip}</li>)}
              </ul>
            </div>
          ) : null}
          <button className="primary-button" onClick={createQuranPlan} disabled={setupLoading}>
            <Icon name="play" size={16} /> ابدأ — إنشاء الخطة
          </button>
          <p className="muted">ستُنشأ خطة كاملة من الآية المحددة حتى آخر السورة مقسّمة على مقدار حفظك.</p>
        </div>
      </div>
    );
  }

  function renderTuhfaSetup() {
    return pageWrap(
      <div className="page-content">
        <button className="ghost-button" onClick={() => setScreen("home")}>→ رجوع</button>
        <h2 className="page-title">خطة حفظ — تحفة الأطفال</h2>
        <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
          <label>
            <span>الباب</span>
            <select className="surah-select" value={setupSection} onChange={(e) => setSetupSection(e.target.value)}>
              {tuhfaSections.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </label>
          <label>
            <span>أول بيت تريد حفظه</span>
            <input
              type="number"
              min={1}
              max={(tuhfaSections.find((s) => s.id === setupSection)?.verses.length ?? 1)}
              value={setupTuhfaStart}
              onChange={(e) => setSetupTuhfaStart(Math.max(1, Number(e.target.value) || 1))}
              className="input-small"
              style={{ marginInlineStart: 8 }}
            />
            <span className="muted"> من {tuhfaSections.find((s) => s.id === setupSection)?.verses.length ?? 0} بيت</span>
          </label>
          <label>
            <span>مقدار الحفظ في كل خطة (عدد الأبيات)</span>
            <input type="number" min={1} max={20} value={setupCapacity} onChange={(e) => setSetupCapacity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="input-small" style={{ marginInlineStart: 8 }} />
          </label>
          <div>
            <span>هل حفظتها من قبل؟</span>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button type="button" className={setupBefore === "no" ? "primary-button" : "ghost-button"} onClick={() => setSetupBefore("no")} style={{ borderRadius: 20, padding: "6px 16px" }}>لا</button>
              <button type="button" className={setupBefore === "review" ? "primary-button" : "ghost-button"} onClick={() => setSetupBefore("review")} style={{ borderRadius: 20, padding: "6px 16px" }}>نعم — تحتاج مراجعة</button>
            </div>
          </div>
          <label>
            <span>القارئ</span>
            <select value={setupTuhfaReciter} onChange={(e) => setSetupTuhfaReciter(e.target.value)} style={{ marginInlineStart: 8 }}>
              {tuhfaVerseReciters.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label>
              <span>السرعة</span>
              <select value={setupSpeed} onChange={(e) => setSetupSpeed(Number(e.target.value))} style={{ marginInlineStart: 8 }}>
                <option value={0.5}>0.5×</option>
                <option value={0.75}>0.75×</option>
                <option value={1}>1×</option>
                <option value={1.25}>1.25×</option>
              </select>
            </label>
            <label>
              <span>التكرار</span>
              <select value={setupRepeat} onChange={(e) => setSetupRepeat(Number(e.target.value))} style={{ marginInlineStart: 8 }}>
                {[3, 4, 5, 7, 10].map((n) => (
                  <option key={n} value={n}>{n} مرات</option>
                ))}
              </select>
            </label>
          </div>
          <button className="primary-button" onClick={createTuhfaPlan}>ابدأ — إنشاء الخطة</button>
        </div>
      </div>
    );
  }

  function renderRecordings() {
    const groups = [
      { book: "quran" as const, title: "سجل القرآن الكريم" },
      { book: "tuhfa" as const, title: "سجل تحفة الأطفال" },
    ];
    return pageWrap(
      <div className="page-content">
        <button className="ghost-button" onClick={() => setScreen("home")}>→ رجوع</button>
        <h2 className="page-title">التسجيلات</h2>
        {groups.map((g) => {
          const list = plans.filter((p) => p.book === g.book && p.steps.some((s) => s.donePaths.length > 0 || s.completed));
          return (
            <div key={g.book} style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 16 }}>{g.title}</h3>
              {list.length === 0 ? (
                <p className="muted">لا توجد تسميعات بعد.</p>
              ) : (
                list.map((p) => {
                  const done = p.steps.filter((s) => s.completed).length;
                  const totalPaths = p.steps.reduce((n, s) => n + s.donePaths.length, 0);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setActivePlanId(p.id);
                        setScreen("plan");
                      }}
                      style={{ display: "block", width: "100%", textAlign: "right", padding: "12px", marginBottom: 8, borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer" }}
                    >
                      <div style={{ fontWeight: 700 }}>{p.title}</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        خطط مكتملة {done}/{p.steps.length} • مسارات منجزة {totalPaths}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function renderPlan() {
    if (!activePlan) return renderHome();
    const steps = activePlan.steps;
    const doneSteps = steps.filter((s) => s.completed).length;
    const progress = steps.length ? Math.round((doneSteps / steps.length) * 100) : 0;
    const requiredCount = requiredPathIds.length || PATH_COUNT;
    return pageWrap(
      <div className="page-content">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <button className="ghost-button" onClick={goHome}>→ رجوع</button>
          <span className="muted" style={{ fontSize: 12 }}>
            {activePlan.book === "quran" ? "القرآن الكريم" : "تحفة الأطفال"}
          </span>
        </div>

        <div
          style={{
            marginTop: 10,
            padding: 16,
            borderRadius: 20,
            background: "linear-gradient(135deg, #0f5f4e, #12876f)",
            color: "#fff",
            boxShadow: "0 14px 30px rgba(15, 95, 78, 0.25)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{activePlan.title}</h2>
          <p style={{ margin: "6px 0 12px", fontSize: 13, opacity: 0.9 }}>
            {steps[0]?.from ?? 1} – {steps[steps.length - 1]?.to ?? 0} • {steps.length} خطة فرعية • قارئ{" "}
            {reciters.find((r) => r.id === activePlan.reciter)?.name ?? activePlan.reciter}
          </p>
          <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "#facc15", transition: "width .3s" }} />
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 13, fontWeight: 700 }}>
            {doneSteps} من {steps.length} خطة مكتملة ({progress}%)
          </p>
        </div>

        <p className="muted" style={{ margin: "12px 0 6px", fontSize: 12.5, lineHeight: 1.8 }}>
          تُفتح الخطة التالية بعد إتمام المسارات الإجبارية:{" "}
          {requiredPathIds.length
            ? requiredPathIds.map((id) => PATHS.find((p) => p.id === id)?.label).filter(Boolean).join(" • ")
            : "كل المسارات"}
          .
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {steps.map((s, i) => {
            const locked = account.type !== "admin" && i > 0 && !steps[i - 1].completed;
            const isDone = s.completed;
            const requiredDone = requiredPathIds.filter((id) => s.donePaths.includes(id)).length;
            return (
              <button
                key={s.id}
                type="button"
                disabled={locked}
                onClick={() => {
                  setActiveStepId(s.id);
                  setScreen("map");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  textAlign: "right",
                  padding: "12px 14px",
                  borderRadius: 18,
                  border: isDone
                    ? "2px solid #16a34a"
                    : locked
                      ? "1px dashed #cbd5e1"
                      : "1px solid #0f766e33",
                  background: isDone ? "#f0fdf4" : locked ? "#f8fafc" : "#fff",
                  boxShadow: locked ? "none" : "0 6px 16px rgba(15,95,78,0.08)",
                  cursor: locked ? "not-allowed" : "pointer",
                  opacity: locked ? 0.75 : 1,
                }}
              >
                <span
                  style={{
                    width: 46,
                    height: 46,
                    flex: "none",
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 800,
                    fontSize: 13,
                    color: locked ? "#94a3b8" : "#0f5f4e",
                    background: isDone ? "#dcfce7" : "rgba(15,95,78,0.08)",
                    border: isDone ? "2px solid #16a34a" : "2px solid rgba(15,95,78,0.18)",
                  }}
                >
                  {isDone ? "✓" : i + 1}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 800, fontSize: 15 }}>
                    الخطة {i + 1} — الآيات {s.from}–{s.to}
                  </span>
                  <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 2 }}>
                    {locked
                      ? "مقفلة حتى إتمام الخطة السابقة"
                      : isDone
                        ? "مكتملة — انتقل للخطة التالية"
                        : `المسارات الإجبارية ${requiredDone}/${requiredCount} • الأخطاء ${s.mistakes.length}`}
                  </span>
                </span>
                {locked ? (
                  <span style={{ fontSize: 18, color: "#94a3b8" }}>🔒</span>
                ) : (
                  <span className="quran-hub-chevron">›</span>
                )}
              </button>
            );
          })}
        </div>

        <button className="ghost-button danger" style={{ marginTop: 20 }} onClick={() => deletePlan(activePlan.id)}>
          <Icon name="trash" size={14} /> حذف الخطة
        </button>
      </div>
    );
  }

  function renderMap() {
    if (!activePlan || !activeStep) return renderHome();
    return pageWrap(
      <div className="page-content">
        <button className="ghost-button" onClick={() => setScreen("plan")}>→ رجوع للخطة</button>
        <h2 className="page-title">مسارات الخطة {activeStep.from}–{activeStep.to}</h2>
        <p className="page-subtitle">
          المسارات الإجبارية: <strong>النطق</strong> • <strong>الاختبار التجريبي</strong> • <strong>الاختبار النهائي</strong>.
          إتمامها كلها يفتح الخطة التالية، وبقية المسارات اختيارية (معفى منها حساب المعلم وولي الأمر).
        </p>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
          {PATHS.map((p, idx) => {
            const done = activeStep.donePaths.includes(p.id);
            const required = requiredPathIds.includes(p.id);
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "10px 12px",
                  marginBottom: 8,
                  borderRadius: 16,
                  background: done ? "rgba(34,197,94,0.08)" : "#fff",
                  border: "1px solid var(--border)",
                  boxShadow: "0 4px 12px rgba(15,95,78,0.05)",
                }}
              >
                <button
                  type="button"
                  onClick={() => openPath(activePlan.id, activeStep.id, p.id)}
                  style={{
                    width: 62,
                    height: 62,
                    flex: "none",
                    borderRadius: "50%",
                    border: done ? "3px solid #16a34a" : required ? "3px solid #b45309" : "3px solid #0f766e",
                    background: done ? "#dcfce7" : required ? "#fef3c7" : "#ecfdf5",
                    color: "#0f172a",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                  }}
                >
                  <Icon name={p.icon} size={22} />
                  <span style={{ fontSize: 11, fontWeight: 800 }}>{done ? "✓" : idx + 1}</span>
                </button>
                <div style={{ flex: 1, textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{p.label}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {done ? "مكتمل ✓" : required ? "مطلوب — لا يمكن تخطّيه" : "اختياري — يمكن تخطّيه"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderPath() {
    if (!activePlan || !activeStep || activePath === null) return renderHome();
    const pathInfo = PATHS[activePath];
    return pageWrap(
      <div className="page-content">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button className="ghost-button" onClick={() => { stopAudio(); stopRecog(); setScreen("map"); }}>→ رجوع للمسارات</button>
          <span className="muted" style={{ fontSize: 13 }}>{activePlan.title} • {activeStep.from}–{activeStep.to}</span>
        </div>
        <h2 className="page-title">{pathInfo.label}</h2>
        {renderPathBody(activePath)}
        {!requiredPathIds.includes(activePath) ? (
          <button className="ghost-button" style={{ marginTop: 12 }} onClick={() => completePath(activePath)}>
            تخطّي هذا المسار →
          </button>
        ) : null}
      </div>
    );
  }

  function renderAyahList(list: Ayah[], showText = true, highlight?: RecitationComparison | null) {
    return (
      <div className="ayah-list">
        {list.map((ayah) => {
          const diffFor = highlight ? highlight.diff : null;
          const words = ayah.text.split(/\s+/).filter(Boolean);
          let cursor = 0;
          const play = () => {
            if (!activePlan) return;
            stopAudio();
            playOne(ayah, 1, activePlan.book, activePlan.reciter);
          };
          return (
            <div
              key={ayah.number}
              role="button"
              tabIndex={0}
              onClick={play}
              onKeyDown={(e) => { if (e.key === "Enter") play(); }}
              style={{ display: "flex", gap: 10, alignItems: "flex-start", textAlign: "right", width: "100%", padding: "12px 14px", borderRadius: 16, background: "var(--card)", border: "1px solid var(--border)", cursor: "pointer" }}
            >
              <span className="ayah-number" style={{ flex: "none" }}>{ayah.numberInSurah}</span>
              <p
                className="ayah-text"
                dir="rtl"
                style={{ margin: 0, flex: 1, fontFamily: '"Amiri Quran", "Amiri", "Times New Roman", serif', fontSize: "calc(24px * var(--app-font-scale, 1))", lineHeight: 2.2, whiteSpace: "pre-wrap" }}
              >
                {showText
                  ? words.map((word, wi) => {
                      let status: "matched" | "missing" | null = null;
                      if (diffFor && cursor < diffFor.length) {
                        status = diffFor[cursor].status;
                        cursor += 1;
                      }
                      return (
                        <span
                          key={wi}
                          style={{
                            borderRadius: 5,
                            background: status === "matched" ? "rgba(34,197,94,0.28)" : status === "missing" ? "rgba(239,68,68,0.28)" : "transparent",
                          }}
                        >{word}{wi < words.length - 1 ? " " : ""}</span>
                      );
                    })
                  : "•••••"}
              </p>
              <Icon name="play" size={14} />
            </div>
          );
        })}
      </div>
    );
  }

  function renderPathBody(pathId: number) {
    const list = stepAyahs;

    if (pathId === 0) {
      return (
        <>
          <p className="page-subtitle">استمع للآيات بصوت الشيخ مع ضبط السرعة والتكرار (٣ مرات على الأقل).</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <label>
              <span>السرعة</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ marginInlineStart: 6 }}>
                <option value={0.5}>0.5×</option>
                <option value={0.75}>0.75×</option>
                <option value={1}>1×</option>
                <option value={1.25}>1.25×</option>
              </select>
            </label>
            <label>
              <span>تكرار الآية</span>
              <select value={perAyah} onChange={(e) => setPerAyah(Number(e.target.value))} style={{ marginInlineStart: 6 }}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}×</option>)}
              </select>
            </label>
            <label>
              <span>تكرار الكل</span>
              <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} style={{ marginInlineStart: 6 }}>
                {[3, 4, 5, 7].map((n) => <option key={n} value={n}>{n}×</option>)}
              </select>
            </label>
          </div>
          {renderAyahList(list)}
          <div className="form-actions">
            <button className="primary-button" onClick={() => playAll(list, perAyah, rounds)} disabled={playing}>
              <Icon name="play" size={16} /> استمع للكل
            </button>
            <button className="ghost-button" onClick={stopAudio}>إيقاف</button>
          </div>
          {playing ? <p className="muted">الجولة {listenPos.round} — الآية {listenPos.ayah}</p> : null}
          <button className="success-button" style={{ marginTop: 12 }} onClick={() => completePath(0)} disabled={!listenDone}>
            {listenDone ? "إكمال مسار السماع ✓" : "أكمل استماعًا كاملًا أولًا"}
          </button>
        </>
      );
    }

    if (pathId === 1) {
      return (
        <>
          <p className="page-subtitle">اقرأ الآيات بصوتك مع إظهار النص وتعليم الكلمات المنطوقة، ثم احصل على النتيجة ونصيحة.</p>
          {renderAyahList(list, true, readingResult)}
          <div className="coach-record" style={{ marginTop: 10 }}>
            {listening ? (
              <button className="danger-button" onClick={() => { stopRecog(); setListening(false); }}>
                <span className="recording-dot" /> إيقاف
              </button>
            ) : (
              <button
                className="primary-button"
                onClick={async () => {
                  setSpeechError("");
                  setTranscript("");
                  setReadingResult(null);
                  try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    stream.getTracks().forEach((t) => t.stop());
                  } catch (err) {
                    setSpeechError(mediaErrorMessage(err));
                    return;
                  }
                  const rec = startRecog((text) => setTranscript((prev) => `${prev} ${text}`.trim()), () => setListening(false));
                  if (rec) setListening(true);
                }}
              >
                <Icon name="mic" size={18} /> ابدأ القراءة
              </button>
            )}
            {playing ? <button className="ghost-button" onClick={stopAudio}>إيقاف الصوت</button> : null}
            <button className="ghost-button" onClick={() => playAll(list, 1, 1)}>
              <Icon name="play" size={14} /> سماع الشيخ
            </button>
          </div>
          {interim ? <p className="interim">{interim}</p> : null}
          {transcript ? <p className="muted">ما التقطه النظام: {transcript}</p> : null}
          {speechError ? <p className="error-text">{speechError}</p> : null}
          <div className="coach-actions">
            <button className="primary-button" onClick={analyzeReading} disabled={!transcript.trim()}>
              <Icon name="check" size={16} /> عرض النتيجة
            </button>
            {adviceLoading ? <span className="muted">جارٍ طلب ملاحظات الذكاء الاصطناعي…</span> : null}
          </div>
          {readingResult ? (
            <div className="feedback-box">
              <strong>نسبة المطابقة: {readingResult.accuracy}%</strong>
              <p>{advice}</p>
              {readingResult.missingWords.length > 0 ? (
                <p className="muted">كلمات تحتاج مراجعة: {readingResult.missingWords.slice(0, 8).join("، ")}</p>
              ) : null}
            </div>
          ) : null}
          <button className="success-button" style={{ marginTop: 12 }} onClick={() => completePath(1)} disabled={!readingResult}>
            إكمال مسار القراءة ✓
          </button>
        </>
      );
    }

    if (pathId === 2) {
      return (
        <>
          <p className="page-subtitle">تفسير ومعاني الكلمات لتسهيل الحفظ، مع شرح من يوتيوب إن توفّر.</p>
          <div className="form-actions">
            <button className="primary-button" onClick={loadTafsir} disabled={tafsirLoading}>
              <Icon name="book" size={16} /> {tafsirLoading ? "جارٍ التحميل…" : "تحميل التفسير وشرح الكلمات"}
            </button>
          </div>
          {tafsirEntries.map((entry) => (
            <div key={entry.ayah} className="tafsir-entry">
              <h4>{activePlan?.book === "tuhfa" ? "بيت" : "آية"} {entry.ayah}</h4>
              <p>{entry.text}</p>
            </div>
          ))}
          {wordNotes ? (
            <div className="feedback-box">
              <strong>شرح بعض الكلمات:</strong>
              <p style={{ whiteSpace: "pre-line" }}>{wordNotes}</p>
            </div>
          ) : null}
          {(() => {
            const baseLibrary = tafsirLibraryFor(activePlan?.book ?? "quran", activePlan?.surah);
            const library = autoVideo ? [autoVideo, ...baseLibrary] : baseLibrary;
            const selected = library.find((v) => v.id === selectedVideoId) ?? library[0];
            const src = selected ? buildEmbedUrl(selected, toSeconds(cropStart), toSeconds(cropEnd)) : "";
            return (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>
                  فيديو تفسير {activePlan?.book === "tuhfa" ? "الأبيات" : "الآيات"} — {surahName}
                </div>
                {autoNote ? (
                  <div className="muted" style={{ fontSize: 12, marginBottom: 8, color: "var(--primary)", fontWeight: 700 }}>
                    {autoNote}
                  </div>
                ) : null}
                {selected ? (
                  <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: 16, overflow: "hidden", background: "#000", boxShadow: "0 10px 24px rgba(15,95,78,0.16)" }}>
                    <iframe
                      key={src}
                      title={selected.title}
                      src={src}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  </div>
                ) : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span>بداية المقطع</span>
                    <input value={cropStart} onChange={(e) => setCropStart(e.target.value)} placeholder="1:20" className="input-small" style={{ width: 80 }} />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span>نهاية المقطع</span>
                    <input value={cropEnd} onChange={(e) => setCropEnd(e.target.value)} placeholder="7:05" className="input-small" style={{ width: 80 }} />
                  </label>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {selected && !selected.videoId
                      ? "قائمة تشغيل: يُطبَّق الاقتصاص على بداية المقطع فقط."
                      : "يكفي كتابة الدقيقة:الثانية (مثال 1:20) ليُقتصّ الفيديو على هذا المقطع."}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginTop: 12 }}>
                  {library.map((v) => {
                    const active = v.id === selected?.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVideoId(v.id)}
                        style={{ textAlign: "right", padding: 8, borderRadius: 14, border: active ? "2px solid #0f766e" : "1px solid #e5e7eb", background: active ? "#ecfdf5" : "#fff", cursor: "pointer" }}
                      >
                        {v.videoId ? (
                          <img src={`https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`} alt="" style={{ width: "100%", height: 84, objectFit: "cover", borderRadius: 8 }} />
                        ) : (
                          <div style={{ width: "100%", height: 84, borderRadius: 8, background: "linear-gradient(135deg, #0f766e, #14b8a6)", display: "grid", placeItems: "center", color: "#fff" }}>
                            <Icon name="play" size={26} />
                          </div>
                        )}
                        <div style={{ fontSize: 12, fontWeight: 800, marginTop: 6, lineHeight: 1.35 }}>{v.title}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{v.channel}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <button className="success-button" style={{ marginTop: 12 }} onClick={() => completePath(2)}>
            إكمال مسار التفسير ✓
          </button>
        </>
      );
    }

    if (pathId === 3) {
      const maxAttempts = 3;
      return (
        <>
          <p className="page-subtitle">اكتب الآيات من ذاكرتك دون رؤية النص (٣ محاولات).</p>
          <p className="muted">المحاولة {writeAttempts + 1} من {maxAttempts}</p>
          <div className="ayah-list" style={{ marginBottom: 10 }}>
            {list.map((a) => (
              <div key={a.number} className="ayah-row">
                <span className="ayah-number">{a.numberInSurah}</span>
                <p className="ayah-text" style={{ filter: "blur(7px)", opacity: 0.45, userSelect: "none" }}>{a.text}</p>
              </div>
            ))}
          </div>
          <textarea
            className="coach-textarea"
            value={written}
            onChange={(e) => setWritten(e.target.value)}
            placeholder="اكتب الأبيات هنا… أو اضغط الميكروفون وانطقها"
            rows={5}
            disabled={writeAttempts >= maxAttempts}
          />
          <div className="coach-actions">
            <button className="primary-button" onClick={checkWriting} disabled={!written.trim() || writeAttempts >= maxAttempts}>
              <Icon name="check" size={16} /> تحقق
            </button>
            <button
              className={listening ? "danger-button" : "ghost-button"}
              onClick={async () => {
                if (listening) { stopRecog(); return; }
                try {
                  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                  stream.getTracks().forEach((t) => t.stop());
                } catch (err) {
                  setSpeechError(mediaErrorMessage(err));
                  return;
                }
                const rec = startRecog((text) => setWritten((prev) => `${prev} ${text}`.trim()), () => setListening(false));
                if (rec) setListening(true);
              }}
            >
              <Icon name="mic" size={16} /> {listening ? "إيقاف النطق" : "انطق بدل الكتابة"}
            </button>
            <button className="ghost-button" onClick={() => speakWords([expectedText])}>استمع</button>
          </div>
          {interim ? <p className="interim">{interim}</p> : null}
          {speechError ? <p className="error-text">{speechError}</p> : null}
          {writeResult ? (
            <div className="feedback-box">
              <strong>النتيجة: {writeResult.accuracy}%</strong>
              {writeResult.missing.length > 0 ? <p className="muted">كلمات ناقصة: {writeResult.missing.slice(0, 10).join("، ")}</p> : null}
              {writeResult.accuracy >= 90 ? <p className="success">أحسنت! كتابة متقنة.</p> : null}
            </div>
          ) : null}
          <button className="success-button" style={{ marginTop: 12 }} onClick={() => completePath(3)} disabled={!writeResult}>
            إكمال مسار الكتابة ✓
          </button>
        </>
      );
    }

    if (pathId === 4) {
      const ayah = list[sheikhIndex];
      return (
        <>
          <p className="page-subtitle">يقرأ الشيخ الآية ثم تقرأ أنت. عند الخطأ يُعاد عليك الكلمة ثم الكلمة التي بعدها حتى تنطقها بلا خطأ.</p>
          <div className="ayah-list">
            {ayah ? (
              <div className="ayah-row">
                <span className="ayah-number">{ayah.numberInSurah}</span>
                <p className="ayah-text" style={{ lineHeight: 2 }}>{ayah.text}</p>
              </div>
            ) : null}
          </div>
          <p className="muted">الآية {sheikhIndex + 1} من {list.length}</p>
          <div className="coach-actions">
            <button className="primary-button" onClick={startSheikhAyah} disabled={playing || sheikhDone}>
              <Icon name="play" size={16} /> اسمع الشيخ ثم اقرأ
            </button>
            {listening ? <button className="danger-button" onClick={stopRecog}><span className="recording-dot" /> إيقاف</button> : null}
            <button className="ghost-button" onClick={submitSheikh} disabled={!transcript.trim() || sheikhDone}>تحقق من قراءتي</button>
          </div>
          {interim ? <p className="interim">{interim}</p> : null}
          {transcript ? <p className="muted">ما التقطه النظام: {transcript}</p> : null}
          {sheikhMsg ? <p className="feedback-box">{sheikhMsg}</p> : null}
          {speechError ? <p className="error-text">{speechError}</p> : null}
          {sheikhDone ? <p className="success">أتممت القراءة خلف الشيخ بنجاح.</p> : null}
          <button className="success-button" style={{ marginTop: 12 }} onClick={() => completePath(4)} disabled={!sheikhDone}>
            إكمال مسار خلف الشيخ ✓
          </button>
        </>
      );
    }

    if (pathId === 5) {
      const q = questions[quizIndex];
      const levelLabel = q
        ? q.level === 1
          ? "إكمال كلمة"
          : q.level === 2
            ? "إكمال كلمتين"
            : "إكمال ثلاث كلمات"
        : "";
      return (
        <>
          <p className="page-subtitle">
            تُعرض لك الآية أو الكلمات ويُطلب إكمالها، والخيارات كلمة واحدة أو أكثر من كلمة. الاختبار 12 سؤالًا
            بثلاثة مستويات: إكمال كلمة، ثم كلمتين، ثم ثلاث كلمات. 3 محاولات خطأ كحد أقصى، والوقت 3 دقائق.
          </p>
          {!quizRunning && !quizFinished ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="primary-button" onClick={startQuiz}>ابدأ الاختبار التجريبي</button>
              <button className="ghost-button" onClick={startAiQuiz} disabled={aiQuizLoading}>
                {aiQuizLoading ? "جارٍ توليد الأسئلة…" : "أسئلة متدرجة بالذكاء الاصطناعي"}
              </button>
            </div>
          ) : null}
          {aiQuizNote ? <p className="muted" style={{ marginTop: 6 }}>{aiQuizNote}</p> : null}
          {quizRunning && q ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span>سؤال {quizIndex + 1}/{questions.length}</span>
                <span>أخطاء: {quizWrong}/3</span>
                <span>الوقت: {Math.floor(quizTime / 60)}:{String(quizTime % 60).padStart(2, "0")}</span>
              </div>
              <div className="feedback-box" style={{ fontSize: 18, lineHeight: 2 }}>
                <div className="quiz-level">{levelLabel}</div>
                <div>
                  {q.before}{" "}
                  <strong style={{ color: "var(--primary)" }}>……</strong>
                </div>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={quizChoice === opt ? (opt === q.correct ? "success-button" : "danger-button") : "ghost-button"}
                    onClick={() => answerQuiz(opt)}
                    disabled={!!quizChoice}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {quizFinished ? (
            <div className="feedback-box">
              <strong>النتيجة: {quizRight} من {questions.length}</strong>
              <p className="muted">أخطاء: {quizWrong} — {quizWrong >= 3 ? "تجاوزت حد الأخطاء، أعد المحاولة." : "أكملت الأسئلة."}</p>
              <button className="ghost-button" onClick={startQuiz}>إعادة الاختبار</button>
            </div>
          ) : null}
          <button className="success-button" style={{ marginTop: 12 }} onClick={() => completePath(5)} disabled={!quizFinished}>
            إكمال الاختبار التجريبي ✓
          </button>
        </>
      );
    }

    if (pathId === 6) {
      const mistakes = activeStep?.mistakes ?? [];
      return (
        <>
          <p className="page-subtitle">راجع الأخطاء السابقة من القراءة والاختبار والنطق، وأعد سماعها.</p>
          {mistakes.length === 0 ? (
            <p className="muted">لا توجد أخطاء مسجّلة بعد. أحسنت!</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {mistakes.map((m, i) => (
                <li key={`${m.ayah}-${m.word}-${i}`} style={{ margin: "8px 0", padding: 10, background: "rgba(239,68,68,0.1)", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{m.word} <span className="muted">(آية {m.ayah})</span></span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => {
                      const ayah = stepAyahs.find((a) => a.numberInSurah === m.ayah) ?? stepAyahs[0];
                      if (ayah && activePlan) playOne(ayah, 0.9, activePlan.book, activePlan.reciter).then(() => playOne(ayah, 0.9, activePlan.book, activePlan.reciter));
                    }}
                  >
                    <Icon name="play" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="success-button" style={{ marginTop: 12 }} onClick={() => completePath(6)}>إكمال مسار الأخطاء ✓</button>
        </>
      );
    }

    if (pathId === 8) {
      const target = sayTargets[sayIndex];
      return (
        <>
          <p className="page-subtitle">
            تُعرض لك كلمة من الآية، وعليك إكمالها صوتيًا بالميكروفون. يجب أن تنطقها صحيحة تمامًا دون تغيير
            في حروف الكلمة، وبعد 4 محاولات تُعرض لك الكلمة الصحيحة ويُشغَّل صوتها.
          </p>
          {sayTargets.length === 0 || sayDone ? (
            <div className="form-actions">
              <button className="primary-button" onClick={startSayPath} disabled={sayAiLoading}>
                <Icon name="mic" size={16} /> {sayAiLoading ? "جارٍ تجهيز الأسئلة…" : sayDone ? "إعادة النطق" : "ابدأ النطق"}
              </button>
              {sayDone ? <span className="success">أتممت مسار النطق بنجاح.</span> : null}
            </div>
          ) : null}

          {!sayDone && target ? (
            <>
              <p className="muted">الكلمة {sayIndex + 1} من {sayTargets.length} • المحاولة {sayAttempts + 1} من 4</p>
              <div className="feedback-box" style={{ textAlign: "center" }}>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>أكمل ما بعد هذه الكلمة:</p>
                <p style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 800, color: "var(--primary)" }}>{target.prompt}</p>
                {sayRevealed ? (
                  <p style={{ margin: "8px 0 0", fontSize: 20, fontWeight: 700 }}>الكلمة المطلوبة: «{target.answer}»</p>
                ) : null}
              </div>
              <div className="coach-record">
                {listening ? (
                  <button className="danger-button" onClick={() => { stopRecog(); setListening(false); }}>
                    <span className="recording-dot" /> إيقاف الميكروفون
                  </button>
                ) : (
                  <button className="primary-button" onClick={beginSayMic}>
                    <Icon name="mic" size={16} /> فتح الميكروفون
                  </button>
                )}
                <button className="ghost-button" onClick={checkSay} disabled={!sayHeard.trim() && !interim.trim()}>
                  <Icon name="check" size={16} /> تحقق من النطق
                </button>
                <button className="ghost-button" onClick={() => playSayAudio(target)}>
                  <Icon name="play" size={16} /> اسمع الصوت
                </button>
                {sayRevealed ? (
                  <button className="success-button" onClick={advanceSay}>
                    {sayIndex + 1 >= sayTargets.length ? "إنهاء الكلمات" : "الكلمة التالية"} →
                  </button>
                ) : null}
              </div>
              {interim ? <p className="interim">{interim}</p> : null}
              {sayHeard ? <p className="muted">ما سُمع: {sayHeard}</p> : null}
              {sayMsg ? <p className="feedback-box">{sayMsg}</p> : null}
              {speechError ? <p className="error-text">{speechError}</p> : null}
            </>
          ) : null}
          <button className="success-button" style={{ marginTop: 12 }} onClick={() => completePath(8)} disabled={!sayDone}>
            إكمال مسار النطق ✓
          </button>
        </>
      );
    }

    // pathId === 7 final exam
    return (
      <>
        {finalPhase === "intro" ? (
          <>
            <p className="page-subtitle">الاختبار النهائي — تسميع الآيات أمام الكاميرا.</p>
            <div className="feedback-box" style={{ textAlign: "right" }}>
              <strong>تنبيه قبل البدء</strong>
              <ul style={{ paddingInlineStart: 18, margin: "8px 0" }}>
                <li>ستُفتح الكاميرا لمراقبة الوجه والعين، ويجب أن يكون وجهك متجهًا للشاشة.</li>
                <li>يُسمح بـ 4 نظرات بعيدة قصيرة فقط؛ تجاوزها يُعيد الاختبار.</li>
                <li>لا يمكن الخروج من الاختبار أو إغلاق الصفحة قبل الضغط على «إنهاء».</li>
                <li>سيُسجَّل صوتك ويُطابق مع النطق الصحيح؛ إن زادت الأخطاء عن 30% يُطلب منك إعادة المحاولة.</li>
              </ul>
            </div>
            <div className="form-actions">
              <button className="primary-button" onClick={() => playAll(list, 1, 1)} disabled={playing}>
                <Icon name="play" size={16} /> استمع للآيات أولًا
              </button>
              <button className="ghost-button" onClick={stopAudio}>إيقاف</button>
            </div>
            <button className="primary-button" style={{ marginTop: 12 }} onClick={startFinalExam}>
              <Icon name="camera" size={16} /> بدء الاختبار النهائي
            </button>
          </>
        ) : null}

        {finalPhase === "exam" ? (
          <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#0b1220", color: "#fff", display: "flex", flexDirection: "column", padding: 16, overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <strong>الاختبار النهائي — {activePlan?.title}</strong>
              <span style={{ fontSize: 13 }}>النظرات البعيدة: {lookAways}/4</span>
            </div>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: "100%", maxWidth: 420, height: 220, objectFit: "cover", borderRadius: 14, background: "#000", margin: "12px auto 0", transform: "scaleX(-1)" }}
            />
            <p style={{ fontSize: 13, opacity: 0.85, textAlign: "center", marginTop: 6 }}>
              {faceNote || (finalStarted ? "اقرأ ببطء وبالتشكيل." : "انظر إلى الشاشة حتى تظهر رسالة الجاهزية.")}
            </p>
            {(() => {
              const expectedWordsList = normalizeArabic(expectedText).split(/\s+/).filter(Boolean);
              const saidWords = normalizeArabic(`${finalTranscript} ${interim}`).split(/\s+/).filter(Boolean);
              const matched = new Set<number>();
              let ptr = 0;
              expectedWordsList.forEach((word, idx) => {
                for (let j = ptr; j < saidWords.length; j += 1) {
                  if (saidWords[j] === word) {
                    matched.add(idx);
                    ptr = j + 1;
                    break;
                  }
                }
              });
              return (
                <div style={{ background: "#111827", borderRadius: 14, padding: 12, marginTop: 8 }}>
                  <p style={{ fontSize: 15, margin: 0 }}>تسميع من الحفظ — النص مخفي، وتظهر الكلمات التي تنطقها:</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, direction: "rtl" }}>
                    {expectedWordsList.map((word, idx) =>
                      matched.has(idx) ? (
                        <span key={idx} style={{ background: "rgba(16,185,129,0.18)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.45)", borderRadius: 8, padding: "2px 6px", fontSize: 16 }}>
                          {word}
                        </span>
                      ) : (
                        <span key={idx} style={{ width: 26, height: 22, borderRadius: 6, background: "rgba(255,255,255,0.08)", border: "1px dashed rgba(255,255,255,0.18)" }} />
                      ),
                    )}
                  </div>
                  <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>الكلمات الصحيحة: {matched.size} من {expectedWordsList.length}</p>
                  {interim ? <p style={{ fontSize: 16, color: "#93c5fd", margin: "4px 0 0" }}>{interim}</p> : null}
                  {finalTranscript ? <p style={{ fontSize: 13, opacity: 0.75, margin: "4px 0 0" }}>ما سُمع: {finalTranscript}</p> : null}
                </div>
              );
            })()}
            {finalError ? <p style={{ color: "#fca5a5" }}>{finalError}</p> : null}
            {!finalStarted ? (
              <div style={{ marginTop: 12, textAlign: "center" }}>
                <p style={{ fontWeight: 800, color: faceReady ? "#6ee7b7" : "#fcd34d", marginBottom: 8 }}>
                  {cameraError
                    ? "لا يبدأ الاختبار قبل تشغيل الكاميرا ومراقبة الوجه"
                    : faceReady
                      ? "وجهك ونظرك إلى الشاشة — اضغط على البدء"
                      : faceStatus === "failed"
                        ? "تعذّر تشغيل مراقبة الوجه — لن يبدأ الاختبار قبل عملها"
                        : faceNote || "انتظر حتى يظهر وجهك وتنظر إلى الشاشة"}
                </p>
                {cameraError ? <p style={{ color: "#fca5a5", fontSize: 12.5 }}>{cameraError}</p> : null}
                <button
                  className="primary-button"
                  onClick={beginFinalRecitation}
                  disabled={!faceReady || !!cameraError}
                >
                  البدء
                </button>
                {faceStatus === "failed" || cameraError ? (
                  <button className="ghost-button" style={{ marginInlineStart: 8 }} onClick={retryFinal}>
                    إعادة المحاولة
                  </button>
                ) : null}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
                <button className="danger-button" onClick={finishFinal}>إنهاء والنتيجة</button>
              </div>
            )}
          </div>
        ) : null}

        {finalPhase === "result" && finalResult ? (
          <div className="feedback-box">
            {finalError ? <p className="error-text">{finalError}</p> : null}
            <strong>النتيجة: {finalResult.accuracy}%</strong>
            <p className="muted">نسبة الخطأ: {100 - finalResult.accuracy}% — {finalResult.accuracy >= 70 ? "مقبول ✓" : "أعِد المحاولة (يجب أن تقل الأخطاء عن 30%)."}</p>
            {finalResult.missingWords.length > 0 ? <p className="muted">كلمات تحتاج تصحيحًا: {finalResult.missingWords.slice(0, 10).join("، ")}</p> : null}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="ghost-button" onClick={retryFinal}>إعادة المحاولة</button>
            </div>
          </div>
        ) : null}

        <button className="success-button" style={{ marginTop: 12 }} onClick={() => completePath(7)} disabled={finalPhase !== "result" || (finalResult?.accuracy ?? 0) < 70}>
          إكمال الاختبار النهائي ✓
        </button>
      </>
    );
  }

  function renderChallenge() {
    return (
      <div className="page standalone-page" style={{ paddingBottom: 90 }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "6px 12px" }}>
          <button className="ghost-button" onClick={() => setScreen("home")}>→ رجوع</button>
          <OnlineChallenge account={{ id: account.id, fullName: account.fullName }} />
        </div>
      </div>
    );
  }

  switch (screen) {
    case "home":
      return renderHome();
    case "challenge":
      return renderChallenge();
    case "quranSetup":
      return renderQuranSetup();
    case "tuhfaSetup":
      return renderTuhfaSetup();
    case "recordings":
      return renderRecordings();
    case "plan":
      return renderPlan();
    case "map":
      return renderMap();
    case "path":
      return renderPath();
    default:
      return renderHome();
  }
}

async function loadAyahsForStep(plan: Plan, step: PlanStep): Promise<Ayah[]> {
  if (plan.book === "quran" && plan.surah) {
    const all = await fetchSurah(plan.surah);
    return all.filter((a) => a.numberInSurah >= step.from && a.numberInSurah <= step.to);
  }
  const section = tuhfaSections.find((s) => s.id === plan.sectionId);
  if (!section) return [];
  return section.verses
    .filter((v) => v.n >= step.from && v.n <= step.to)
    .map((v) => ({
      number: v.n,
      text: stripBismillah(`${v.first} ${v.second}`),
      surah: 1,
      surahName: section.title,
      numberInSurah: v.n,
      juz: 0,
    }));
}
