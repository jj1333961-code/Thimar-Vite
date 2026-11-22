import { useEffect, useRef, useState } from "react";
import { fetchJuzs, fetchTafsir, type Ayah } from "../../lib/quran";
import type { Account } from "../../lib/auth";
import { surahs } from "../../data/surahs";
import { juzRangeLabel, surahsForJuzs } from "../../data/juzSurahs";
import { loadGameProgress, saveGameProgress, saveRecitationAttempt, type GameProgress } from "../../lib/appStore";
import {
  buildRecitationCandidates,
  compareRecitation,
  identifyRecitation,
  type RecitationCandidate,
} from "../../lib/recitation";
import { hasSpeechRecognition, recognitionErrorMessage } from "../../lib/speech";
import { celebrate } from "../../lib/celebrate";
import { Icon, EmptyState, SectionCard } from "./ui";
import { playNotificationSound } from "../../lib/sound";
import AyahOrderGame from "./AyahOrderGame";
import WordOrderBoard from "./WordOrderBoard";

type LevelId = "a1" | "a2" | "a3" | "a4" | "a5" | "a6" | "a7" | "a8" | "a9" | "a10" | "a11" | "a12";
type QuestionKind = "surah" | "complete" | "juz" | "tafsir" | "recite" | "truefalse" | "order";
type QuestionScope = { juzs: number[]; surahs: number[] };
type Phase = "menu" | "typeLevels" | "setup" | "playing" | "result";

type LevelConfig = {
  id: LevelId;
  name: string;
  subtitle: string;
  lives: number;
  count: number;
  seconds: number;
  minWords: number;
  bonus: number;
};

type Question = {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  answer: string;
  hint?: string;
  /** كلمات السؤال مبعثرة لسؤال «ترتيب الكلمات». */
  words?: string[];
  ayah: Ayah;
  /** آخر آية في المقطع المطلوب تسميعه (لسؤال «اقرأ من … إلى …»). */
  endAyah?: Ayah;
  /** آيات المقطع المتتالي المطلوب تسميعه. */
  span?: Ayah[];
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const scope = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}


const LEVELS: LevelConfig[] = [
  { id: "a1", name: "البداية", subtitle: "آيات قصيرة وتعرف السورة", lives: 4, count: 8, seconds: 35, minWords: 3, bonus: 40 },
  { id: "a2", name: "الانطلاق", subtitle: "أكمل الآية وحدد موضعها", lives: 4, count: 10, seconds: 30, minWords: 4, bonus: 55 },
  { id: "a3", name: "التقدّم", subtitle: "أسئلة أطول ووقت أقل", lives: 3, count: 12, seconds: 25, minWords: 5, bonus: 75 },
  { id: "a4", name: "الإتقان", subtitle: "تركيز على الجزء والسورة", lives: 2, count: 12, seconds: 20, minWords: 6, bonus: 100 },
  { id: "a5", name: "التحدّي", subtitle: "فرصة واحدة فقط", lives: 1, count: 14, seconds: 15, minWords: 7, bonus: 140 },
  { id: "a6", name: "الأسطورة", subtitle: "بدون أي فرصة للخطأ", lives: 0, count: 16, seconds: 12, minWords: 8, bonus: 200 },
  { id: "a7", name: "الاختبار الخاص", subtitle: "أسئلة عميقة مدعومة بالذكاء الاصطناعي", lives: 0, count: 20, seconds: 10, minWords: 9, bonus: 300 },
  { id: "a8", name: "الماهر", subtitle: "أسئلة مركّبة ووقت ضيق", lives: 2, count: 16, seconds: 14, minWords: 7, bonus: 160 },
  { id: "a9", name: "الخبير", subtitle: "أسئلة طويلة مع تقييم نطق", lives: 2, count: 18, seconds: 12, minWords: 8, bonus: 200 },
  { id: "a10", name: "الحافظ", subtitle: "اختبار شامل بدون تلميحات", lives: 1, count: 20, seconds: 11, minWords: 9, bonus: 260 },
  { id: "a11", name: "المتقن", subtitle: "تحدي متقدم مع AI", lives: 1, count: 22, seconds: 10, minWords: 10, bonus: 320 },
  { id: "a12", name: "الماستر", subtitle: "الاختبار النهائي", lives: 0, count: 25, seconds: 9, minWords: 11, bonus: 400 },
];

const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((level) => [level.id, level])) as Record<LevelId, LevelConfig>;

const ALL_KINDS: QuestionKind[] = ["surah", "complete", "juz", "truefalse", "recite", "order"];

/** السور القصيرة (≤ ٩ آيات) يمكن طلب تسميعها كاملة. */
const SHORT_SURAHS: Record<number, number> = {
  1: 7, 94: 8, 95: 8, 97: 5, 98: 8, 99: 8, 102: 8, 103: 3, 104: 9,
  105: 5, 106: 4, 107: 7, 108: 3, 109: 6, 110: 3, 111: 5, 112: 4, 113: 5, 114: 6,
};

const KIND_LABELS: Record<QuestionKind, string> = {
  surah: "تخمين السورة",
  complete: "أكمل الآية",
  juz: "تحديد الجزء",
  tafsir: "تفسير الآيات",
  recite: "تسميع صوتي",
  truefalse: "صح أو خطأ",
  order: "ترتيب الكلمات",
};

const KIND_ICONS: Record<QuestionKind, "book" | "sparkles" | "chart" | "trend" | "mic" | "check"> = {
  surah: "book",
  complete: "sparkles",
  juz: "chart",
  tafsir: "trend",
  recite: "mic",
  truefalse: "check",
  order: "sparkles",
};

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function uniqueOptions(correct: string, wrong: string[], maxDistractors = 3): string[] {
  const distractors = Array.from(new Set(wrong.filter((item) => item && item !== correct))).slice(0, maxDistractors);
  return shuffle([correct, ...distractors]);
}

function shortText(text: string, words = 4): string {
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.slice(0, words).join(" ");
}

function tailText(text: string, words = 4): string {
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.slice(Math.max(0, parts.length - words)).join(" ");
}

function clipText(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean;
}

function historyLabel(mode: string): string {
  const raw = mode.replace("level-", "");
  const [kind, levelId] = raw.includes(":") ? raw.split(":") : ["", raw];
  const levelName = LEVEL_BY_ID[levelId as LevelId]?.name ?? raw;
  return kind ? `${KIND_LABELS[kind as QuestionKind]} • ${levelName}` : levelName;
}

function livesLabel(lives: number) {
  if (lives === 0) return "بدون أخطاء";
  if (lives === 1) return "محاولة واحدة";
  if (lives === 2) return "محاولتان";
  return `${lives} محاولات`;
}

function gameSeenKey(studentId: string) {
  return `thimar.games.seen.${studentId}.v1`;
}

function loadSeenQuestionKeys(studentId: string): Set<string> {
  try {
    const raw = localStorage.getItem(gameSeenKey(studentId));
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function rememberQuestionKeys(studentId: string, questions: Question[]): void {
  try {
    const keys = [...loadSeenQuestionKeys(studentId), ...questions.map((question) => `${question.kind}:${question.ayah.number}`)];
    localStorage.setItem(gameSeenKey(studentId), JSON.stringify([...new Set(keys)].slice(-5000)));
  } catch {
    // تجاهل امتلاء التخزين.
  }
}

function buildQuestions(
  level: LevelConfig,
  pool: Ayah[],
  scope: QuestionScope,
  seen: Set<string> = new Set(),
  allowedKinds?: QuestionKind[],
  tafsirByAyah: Map<number, string> = new Map(),
): Question[] {
  if (pool.length === 0) return [];
  const minWords = level.minWords;
  const filtered = pool.filter((ayah) => ayah.text.split(/\s+/).length >= minWords);
  const source = filtered.length >= Math.min(level.count, 5) ? filtered : pool;
  const allKinds: QuestionKind[] = ALL_KINDS;
  const kindsPool: QuestionKind[] = allowedKinds && allowedKinds.length ? allowedKinds : allKinds;
  const unseenSource = source.filter((ayah) => kindsPool.some((kind) => !seen.has(`${kind}:${ayah.number}`)));
  const candidatePool = unseenSource.length >= Math.min(level.count, source.length) ? unseenSource : source;
  const candidates = shuffle(candidatePool).slice(0, Math.min(level.count, candidatePool.length));
  const kinds: QuestionKind[] = kindsPool;

  const built: Question[] = candidates.map((ayah, index) => {
    let kind = kinds[index % kinds.length];
    const words = ayah.text.split(/\s+/);

    if (kind === "complete" && words.length < 4) kind = "surah";
    if (kind === "tafsir" && words.length < 3) kind = "surah";
    if (kind === "recite" && words.length < 3) kind = "surah";
    if (kind === "juz" && scope.juzs.length < 2) kind = "surah";
    if (kind === "tafsir" && !tafsirByAyah.get(ayah.number)) kind = "surah";

    if (kind === "complete") {
      const split = Math.max(2, Math.floor(words.length * 0.58));
      const stem = words.slice(0, split).join(" ");
      const tail = words.slice(split).join(" ");
      const wrongTails = pool
        .filter((item) => item.number !== ayah.number)
        .map((item) => {
          const itemWords = item.text.split(/\s+/);
          return itemWords.slice(Math.max(2, Math.floor(itemWords.length * 0.58))).join(" ");
        })
        .filter(Boolean);
      return {
        id: `${level.id}-${index}-${ayah.number}`,
        kind,
        prompt: `${stem} …`,
        options: uniqueOptions(tail, shuffle(wrongTails)),
        answer: tail,
        hint: `الآية ${ayah.numberInSurah} من ${ayah.surahName}`,
        ayah,
      };
    }

    if (kind === "order") {
      // سؤال «ترتيب الكلمات»: كلمات آية أو آيتين متتاليتين تُعرض مبعثرة.
      let orderWords = ayah.text.split(/\s+/).filter(Boolean);
      const second = pool.find(
        (item) => item.surah === ayah.surah && item.numberInSurah === ayah.numberInSurah + 1,
      );
      const secondWords = second ? second.text.split(/\s+/).filter(Boolean) : [];
      const twoAyat = Boolean(second) && orderWords.length <= 12 && orderWords.length + secondWords.length <= 24;
      if (twoAyat) orderWords = [...orderWords, ...secondWords];
      return {
        id: `${level.id}-${index}-${ayah.number}`,
        kind,
        prompt: twoAyat
          ? `رتّب الكلمات لتكوين الآيتين ${ayah.numberInSurah} و${ayah.numberInSurah + 1} من سورة ${ayah.surahName}.`
          : `رتّب الكلمات لتكوين الآية ${ayah.numberInSurah} من سورة ${ayah.surahName}.`,
        options: [],
        answer: orderWords.join(" "),
        words: shuffle(orderWords),
        hint: "اضغط الكلمات بالترتيب من اليمين إلى اليسار.",
        ayah,
      };
    }

    if (kind === "juz") {
      const correct = `الجزء ${ayah.juz}`;
      // الخيارات كلها من الأجزاء التي اختارها المستخدم فقط، لا من خارج نطاقه.
      const wrong = shuffle(
        scope.juzs
          .filter((value) => value !== ayah.juz)
          .map((value) => `الجزء ${value}`),
      );
      return {
        id: `${level.id}-${index}-${ayah.number}`,
        kind,
        prompt: ayah.text,
        options: uniqueOptions(correct, wrong),
        answer: correct,
        hint: `من سورة ${ayah.surahName}`,
        ayah,
      };
    }

    if (kind === "tafsir") {
      const ownTafsir = tafsirByAyah.get(ayah.number) ?? "";
      const correct = clipText(ownTafsir);
      const wrong = shuffle(
        pool
          .filter((item) => item.number !== ayah.number)
          .map((item) => clipText(tafsirByAyah.get(item.number) ?? "")),
      ).filter(Boolean);
      return {
        id: `${level.id}-${index}-${ayah.number}`,
        kind,
        prompt: `ما تفسير قوله تعالى:\n«${ayah.text}»`,
        options: uniqueOptions(correct, wrong),
        answer: correct,
        hint: "من التفسير الميسر",
        ayah,
      };
    }

    if (kind === "recite") {
      // سورة قصيرة كاملة: «اقرأ سورة كذا».
      const totalAyahs = SHORT_SURAHS[ayah.surah];
      const surahPool = pool
        .filter((item) => item.surah === ayah.surah)
        .sort((a, b) => a.numberInSurah - b.numberInSurah);
      if (totalAyahs && surahPool.length >= totalAyahs) {
        const whole = surahPool.slice(0, totalAyahs);
        return {
          id: `${level.id}-${index}-${ayah.number}`,
          kind,
          prompt: `اقرأ سورة ${ayah.surahName} كاملة`,
          options: [],
          answer: whole.map((item) => item.text).join(" "),
          hint: `${totalAyahs} آيات`,
          ayah: whole[0],
          endAyah: whole[whole.length - 1],
          span: whole,
        };
      }
      // كلما ارتفع المستوى طلبنا مقطعًا أطول من الآيات المتتالية.
      const levelIndex = Math.max(0, LEVELS.findIndex((item) => item.id === level.id));
      const spanLength = Math.min(4, 1 + Math.floor(levelIndex / 3));
      const startIndex = pool.indexOf(ayah);
      const span: Ayah[] = [ayah];
      for (let step = 1; step < spanLength; step += 1) {
        const next = pool[startIndex + step];
        if (!next || next.surah !== ayah.surah) break;
        span.push(next);
      }
      const endAyah = span[span.length - 1];
      const fromText = shortText(ayah.text, 4);
      const toText = tailText(endAyah.text, 4);
      return {
        id: `${level.id}-${index}-${ayah.number}`,
        kind,
        prompt: span.length > 1
          ? `اقرأ من قوله تعالى: «${fromText} …» إلى قوله: «… ${toText}»`
          : `اقرأ من قوله تعالى: «${fromText} …» إلى آخر الآية`,
        options: [],
        answer: span.map((item) => item.text).join(" "),
        hint: span.length > 1 ? `${span.length} آيات متتالية للتسميع` : undefined,
        ayah,
        endAyah,
        span,
      };
    }

    if (kind === "truefalse") {
      const scopeNames = scope.surahs
        .map((number) => surahs[number - 1]?.name)
        .filter((name): name is string => Boolean(name) && name !== ayah.surahName);
      const randomWrong = shuffle(scopeNames)[0] ?? shuffle(surahs.filter((item) => item.name !== ayah.surahName))[0]?.name ?? "سورة أخرى";
      const claimed = Math.random() < 0.5 ? ayah.surahName : randomWrong;
      const isTrue = claimed === ayah.surahName;
      return {
        id: `${level.id}-${index}-${ayah.number}`,
        kind,
        prompt: `هل هذه الآية من سورة ${claimed}؟\n«${ayah.text}»`,
        options: ["صح", "خطأ"],
        answer: isTrue ? "صح" : "خطأ",
        hint: `الآية ${ayah.numberInSurah}`,
        ayah,
      };
    }

    const correct = ayah.surahName;
    // الخيارات الخاطئة من سور النطاق المحدد نفسه.
    const scopeNames = scope.surahs
      .map((number) => surahs[number - 1]?.name)
      .filter((name): name is string => Boolean(name) && name !== correct);
    const wrong = scopeNames.length >= 2
      ? shuffle(scopeNames)
      : shuffle(surahs.filter((surah) => surah.name !== correct).map((surah) => surah.name));
    return {
      id: `${level.id}-${index}-${ayah.number}`,
      kind: "surah",
      prompt: ayah.text,
      options: uniqueOptions(correct, wrong),
      answer: correct,
      hint: `تبدأ بـ «${words[0]}»`,
      ayah,
    };
  });
  const fresh = built.filter((question) => !seen.has(`${question.kind}:${question.ayah.number}`));
  return fresh.length > 0 ? fresh : built;
}

export default function GamesPage({ account }: { account: Account }) {
  const [phase, setPhase] = useState<Phase>("menu");
  const [progress, setProgress] = useState<GameProgress>(() => loadGameProgress(account.id));
  const [activeLevel, setActiveLevel] = useState<LevelConfig | null>(null);
  // نطاق واحد مشترك لكل الأنواع المحددة: الإجابات لا تخرج أبدًا عن الأجزاء المختارة.
  const [scope, setScope] = useState<{ juzs: number[]; surahs: number[] }>(() => ({ juzs: [30], surahs: surahsForJuzs([30]) }));
  const [selectedTypeKind, setSelectedTypeKind] = useState<QuestionKind | null>(null);
  const [allowedKinds, setAllowedKinds] = useState<QuestionKind[]>(ALL_KINDS);
  const [generalKinds, setGeneralKinds] = useState<QuestionKind[]>(ALL_KINDS);
  const [orderGameOpen, setOrderGameOpen] = useState(false);
  const [aiOpponent, setAiOpponent] = useState(false);
  const [aiScore, setAiScore] = useState(0);
  const [aiStreak, setAiStreak] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [livesLeft, setLivesLeft] = useState(0);
  const [failed, setFailed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(20);
  const [resultPassed, setResultPassed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const livesRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [recitationScore, setRecitationScore] = useState<number | null>(null);
  const [recitationDetails, setRecitationDetails] = useState<{ matched: number; total: number } | null>(null);
  const [recitationError, setRecitationError] = useState("");
  const [identifiedAyah, setIdentifiedAyah] = useState<Ayah | null>(null);
  const [manualText, setManualText] = useState("");
  const [recitationCandidates, setRecitationCandidates] = useState<RecitationCandidate[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const recognitionErroredRef = useRef(false);
  const recognitionSessionRef = useRef(0);
  const recitationFinishedRef = useRef(false);

  useEffect(() => {
    setProgress(loadGameProgress(account.id));
  }, [account.id]);

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    if (revealed && recognitionRef.current) recognitionRef.current.stop();
  }, [revealed]);

  const resetRecitation = () => {
    recognitionSessionRef.current += 1;
    recognitionErroredRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      // تجاهل محاولة إيقاف تعرف لم يبدأ.
    }
    recognitionRef.current = null;
    transcriptRef.current = "";
    recognitionErroredRef.current = false;
    recitationFinishedRef.current = false;
    setRecording(false);
    setTranscript("");
    setRecitationScore(null);
    setRecitationDetails(null);
    setRecitationError("");
    setIdentifiedAyah(null);
    setManualText("");
  };

  const cleared = progress.levelCleared ?? {};
  // لكل نوع اختبار مستوياته المستقلة: تقدم النوع يُخزَّن بمفتاح مسبوق باسمه، والمسار العام بلا بادئة.
  const scopeKeyOf = (level: LevelConfig) => (selectedTypeKind ? `${selectedTypeKind}:${level.id}` : level.id);
  const starsKeyOf = (level: LevelConfig) => `level-${scopeKeyOf(level)}`;
  const clearedCount = LEVELS.filter((level) => cleared[level.id]).length;
  const clearedInScope = LEVELS.filter((level) => cleared[scopeKeyOf(level)]).length;
  const currentLevel = LEVELS.find((level) => !cleared[scopeKeyOf(level)]) ?? LEVELS[LEVELS.length - 1];
  const isUnlocked = (levelIndex: number) =>
    levelIndex === 0 || Boolean(cleared[scopeKeyOf(LEVELS[levelIndex - 1])]);

  const activeRange = scope;
  const activeJuzSurahs = surahsForJuzs(activeRange.juzs);

  useEffect(() => {
    if (phase !== "playing" || revealed || failed) return;
    const seconds = activeLevel?.seconds ?? 20;
    setTimeLeft(seconds);
    const timer = window.setInterval(() => {
      setTimeLeft((previous) => Math.max(0, previous - 1));
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, activeLevel?.id, revealed, failed]);

  useEffect(() => {
    if (phase !== "playing" || revealed || failed || timeLeft > 0) return;
    setRevealed(true);
    setSelected(null);
    loseLife();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, phase, revealed, failed]);

  const loseLife = () => {
    livesRef.current -= 1;
    setLivesLeft(Math.max(0, livesRef.current));
    setStreak(0);
    if (livesRef.current <= 0) setFailed(true);
  };

  const resetRun = (level: LevelConfig) => {
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setIndex(0);
    setSelected(null);
    setRevealed(false);
    setFailed(false);
    resetRecitation();
    setTimeLeft(level.seconds);
    livesRef.current = level.lives;
    setLivesLeft(level.lives);
    setAiScore(0);
    setAiStreak(0);
  };

  const openLevel = (level: LevelConfig) => {
    setActiveLevel(level);
    setError("");
    if (selectedTypeKind) {
      setAllowedKinds([selectedTypeKind]);
    } else {
      setAllowedKinds(generalKinds.length ? generalKinds : ALL_KINDS);
    }
    setPhase("setup");
  };

  const toggleJuz = (juz: number) => {
    setError("");
    setScope((prev) => {
      let nextJuzs: number[];
      if (prev.juzs.includes(juz)) {
        if (prev.juzs.length === 1) return prev;
        nextJuzs = prev.juzs.filter((item) => item !== juz);
      } else {
        if (prev.juzs.length >= 4) {
          setError("يمكن اختيار ٤ أجزاء كحد أقصى.");
          return prev;
        }
        nextJuzs = [...prev.juzs, juz].sort((a, b) => a - b);
      }
      return { juzs: nextJuzs, surahs: surahsForJuzs(nextJuzs) };
    });
  };

  const toggleSurah = (surah: number) => {
    setScope((prev) => ({
      ...prev,
      surahs: prev.surahs.includes(surah)
        ? prev.surahs.filter((item) => item !== surah)
        : [...prev.surahs, surah],
    }));
  };

  const setActiveSurahs = (nextSurahs: number[]) => {
    setScope((prev) => ({ ...prev, surahs: nextSurahs }));
  };

  const startGame = async () => {
    if (!activeLevel) return;
    if (allowedKinds.length === 0) {
      setError("اختر نوع سؤال واحدًا على الأقل.");
      return;
    }
    if (scope.juzs.length === 0 || scope.surahs.length === 0) {
      setError("حدّد الأجزاء والسور التي تريد الامتحان فيها.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const seen = loadSeenQuestionKeys(account.id);
      // نطاق واحد لكل الأنواع: نجلب الآيات من الأجزاء المختارة مرة واحدة.
      const juzData = await fetchJuzs(scope.juzs);
      const union = juzData.filter((ayah) => scope.surahs.includes(ayah.surah));
      if (union.length < 4) {
        setError("الآيات المتاحة في النطاقات المحددة قليلة. وسّع نطاق نوع واحد على الأقل.");
        return;
      }
      // أسئلة التفسير تحتاج نصوص التفسير للآيات داخل النطاق المحدد فقط.
      const tafsirByAyah = new Map<number, string>();
      if (allowedKinds.includes("tafsir")) {
        const tafsirPool = union;
        const sample = shuffle(tafsirPool).slice(0, 14);
        await Promise.all(
          sample.map(async (ayah) => {
            try {
              const entry = await fetchTafsir(ayah.surah, ayah.numberInSurah);
              if (entry.text) tafsirByAyah.set(ayah.number, entry.text);
            } catch {
              // آية بلا تفسير: تُستبعد من أسئلة التفسير فقط.
            }
          }),
        );
      }
      const perKind = Math.max(1, Math.ceil(activeLevel.count / allowedKinds.length));
      const built = allowedKinds.flatMap((kind) => {
        if (union.length === 0) return [];
        return buildQuestions({ ...activeLevel, count: perKind + 2 }, union, scope, seen, [kind], tafsirByAyah);
      });
      // دمج أسئلة الذكاء الاصطناعي مع الأسئلة المبنية، ثم إزالة التكرار داخل الجولة.
      const aiKinds = allowedKinds.filter((kind) => kind !== "recite" && kind !== "order");
      const aiQuestions = aiKinds.length
        ? await Promise.race([
            generateAiQuestions(union, activeLevel.count, aiKinds, scope),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 9000)),
          ])
        : null;
      const usedAyahs = new Set<number>();
      const picked: Question[] = [];
      const take = (question: Question | undefined) => {
        if (!question || usedAyahs.has(question.ayah.number)) return false;
        usedAyahs.add(question.ayah.number);
        picked.push(question);
        return true;
      };
      // نضمن سؤالًا واحدًا على الأقل من كل نوع مطلوب قبل بقية الأسئلة.
      allowedKinds.forEach((kind) => {
        take(built.find((question) => question.kind === kind) ?? aiQuestions?.find((question) => question.kind === kind));
      });
      for (const question of shuffle([...(aiQuestions ?? []), ...built])) {
        if (picked.length >= activeLevel.count) break;
        take(question);
      }
      const finalQuestions = picked.slice(0, activeLevel.count);
      if (finalQuestions.length === 0) {
        setError("لم نتمكن من بناء أسئلة من هذه النطاقات. جرّب نطاقًا أوسع.");
        return;
      }
      rememberQuestionKeys(account.id, finalQuestions);
      resetRun(activeLevel);
      setRecitationCandidates(buildRecitationCandidates(union));
      setQuestions(finalQuestions);
      setPhase("playing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تحميل الآيات. تحقق من الإنترنت.");
    } finally {
      setLoading(false);
    }
  };

  function buildAvoidHint(): string {
  try {
    const raw = localStorage.getItem("thimar.ai.memory.v1");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { prompts?: string[] } | string[];
    const prompts = Array.isArray(parsed) ? parsed : parsed.prompts ?? [];
    const list = prompts.filter((item) => typeof item === "string").slice(0, 20);
    return list.length ? `\nلا تكرر أيًا من هذه الأسئلة التي ظهرت للمستخدم سابقًا:\n- ${list.join("\n- ")}` : "";
  } catch {
    return "";
  }
}

function rememberAiPrompts(prompts: string[]): void {
  try {
    const raw = localStorage.getItem("thimar.ai.memory.v1");
    const parsed = raw ? (JSON.parse(raw) as { prompts?: string[] } | string[]) : [];
    const previous = Array.isArray(parsed) ? parsed : parsed.prompts ?? [];
    const merged = [...new Set([...prompts, ...previous])].slice(0, 120);
    localStorage.setItem("thimar.ai.memory.v1", JSON.stringify({ prompts: merged, at: Date.now() }));
  } catch { /* ignore */ }
}

  async function generateAiQuestions(
    pool: Ayah[],
    count: number,
    kinds: QuestionKind[],
    scope: QuestionScope,
  ): Promise<Question[] | null> {
    try {
      const sample = shuffle(pool).slice(0, Math.min(20, pool.length));
      const byNumber = new Map(sample.map((ayah) => [ayah.number, ayah]));
      const context = sample
        .map((a) => `${a.number}|${a.surahName}|${a.numberInSurah}|ج${a.juz}|${a.text}`)
        .join("\n");
      const scopeText = kinds
        .map((kind) => {
          const names = scope.surahs
            .map((number) => surahs[number - 1]?.name)
            .filter(Boolean)
            .slice(0, 45)
            .join("، ");
          return `${kind} => الأجزاء: ${scope.juzs.join(",")} | السور: ${names}`;
        })
        .join("\n");
      const prompt = `أنت مولّد أسئلة قرآنية ذكي لتطبيق عربي للطلاب. اعتمد على الآيات المرفقة فقط، ولا تخرج عن سورها وأجزائها، ولا تكرر الآية مرتين.
مستوى الطالب الحالي: ${activeLevel?.name ?? "متوسط"} (${activeLevel?.id?.toUpperCase() ?? "A1"}) — الوقت لكل سؤال ${activeLevel?.seconds ?? 20} ثانية، فاجعل الصعوبة مناسبة لهذا المستوى ولا تضع أسئلة تقليدية أو ضعيفة.
نوّع الصياغة وابتعد عن التكرار، واجعل الخيارات الخاطئة قريبة ومقنعة.${buildAvoidHint()}
أنشئ ${count} سؤالًا من الأنواع التالية فقط: ${kinds.join(", ")}.
قواعد الخيارات: 4 خيارات لكل سؤال ما عدا صح/خطأ فخياران، والخيارات الخاطئة يجب أن تكون من داخل النطاق المحدد (سور أو أجزاء النطاق نفسه) لا من خارجه، والإجابة الصحيحة خيار واحد فقط ومكتوبة حرفيًا كما في الخيارات.
- complete: اذكر أول الآية مع نقاط مكان الباقي واطلب إكمالها.
- surah: اذكر الآية واطلب اسم السورة التي وردت فيها.
- juz: اذكر الآية واطلب رقم الجزء، وخيارات الأجزاء من الأجزاء المذكورة في النطاق فقط.
- truefalse: خياران «صح» و«خطأ» فقط، مع نسب الآية لسورة صحيحة أو خاطئة.
- tafsir: اذكر الآية واطلب تفسيرها الميسر، والخيارات الأخرى تفسيرات مختصرة لآيات أخرى في النطاق.
أرجع JSON فقط بدون شرح بالصيغة:
[{"kind":"...","ayah":<رقم الآية العام>,"prompt":"...","options":["..."],"answer":"...","hint":"..."}]

النطاقات المحددة:
${scopeText}

الآيات:
${context}`;
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }) });
      if (!res.ok) return null;
      const data = await res.json();
      const content = (data?.choices?.[0]?.message?.content ?? data?.content ?? "") as string;
      const match = content.match(/\[[\s\S]*\]/);
      if (!match) return null;
      const arr: unknown = JSON.parse(match[0]);
      if (!Array.isArray(arr)) return null;
      const built: Question[] = [];
      arr.slice(0, count * 2).forEach((raw, position) => {
        const q = raw as Record<string, unknown>;
        const kind = String(q.kind ?? "") as QuestionKind;
        if (!kinds.includes(kind)) return;
        const ayah = byNumber.get(Number(q.ayah));
        if (!ayah) return;
        const options = Array.isArray(q.options)
          ? (q.options as unknown[]).map((option) => String(option).trim()).filter(Boolean)
          : [];
        const answer = String(q.answer ?? "").trim();
        const text = String(q.prompt ?? "").trim();
        if (!text || options.length < 2 || !options.includes(answer)) return;
        built.push({
          id: `ai-${Date.now()}-${position}`,
          kind,
          prompt: text,
          options: kind === "truefalse" ? ["صح", "خطأ"] : options.slice(0, 4),
          answer: kind === "truefalse" ? (answer === "صح" ? "صح" : "خطأ") : answer,
          hint: q.hint ? String(q.hint) : undefined,
          ayah,
        });
      });
      if (built.length > 0) rememberAiPrompts(built.map((question) => question.prompt.trim()));
      return built;
    } catch {
      return null;
    }
  }

  const current = questions[index];

  const applyOutcome = (correct: boolean) => {
    if (!current) return;
    // AI opponent answer
    if (aiOpponent) {
      // AI accuracy based on level: higher levels = lower AI accuracy
      const accuracy = Math.max(0.3, 1 - (LEVELS.indexOf(activeLevel!) / LEVELS.length) * 0.5);
      const aiCorrect = Math.random() < accuracy;
      if (aiCorrect) {
        const gained = 10 + aiStreak * 2 + Math.ceil(timeLeft / 2);
        setAiScore((s) => s + gained);
        setAiStreak((s) => s + 1);
      } else {
        setAiStreak(0);
      }
    }
    if (correct) {
      const gained = 10 + streak * 2 + Math.ceil(timeLeft / 2);
      setScore((value) => value + gained);
      setStreak((value) => {
        const next = value + 1;
        setBestStreak((best) => Math.max(best, next));
        return next;
      });
    } else {
      loseLife();
    }
  };

  const answer = (option: string) => {
    if (!current || revealed || failed) return;
    setSelected(option);
    setRevealed(true);
    applyOutcome(option === current.answer);
  };

  const answerOrder = (correct: boolean, arranged: string[]) => {
    if (!current || revealed || failed) return;
    setSelected(arranged.join(" "));
    setRevealed(true);
    applyOutcome(correct);
  };

  const finishRecitation = (spoken: string) => {
    if (!current || recitationFinishedRef.current) return;
    if (!spoken.trim()) {
      setRecitationError("لم نسمع تسميعًا واضحًا. اضغط زر التسجيل وحاول مرة أخرى.");
      return;
    }
    // سؤال «اقرأ من … إلى …»: نقارن التلاوة بالمقطع كاملًا لا بآية واحدة.
    if (current.span && current.span.length > 1) {
      const comparison = compareRecitation(current.answer, spoken);
      const coverage = comparison.total ? comparison.matched / comparison.total : 0;
      const score = Math.max(1, Math.min(10, Math.round(coverage * 10)));
      const levelIndex = activeLevel ? Math.max(0, LEVELS.findIndex((item) => item.id === activeLevel.id)) : 0;
      const passMark = levelIndex >= 9 ? 8 : levelIndex >= 5 ? 7 : 6;
      recitationFinishedRef.current = true;
      setIdentifiedAyah(current.ayah);
      setRecitationScore(score);
      setRecitationDetails({ matched: comparison.matched, total: comparison.total });
      saveRecitationAttempt(account.id, {
        id: `${Date.now()}-${current.ayah.number}-${Math.round(Math.random() * 9999)}`,
        at: Date.now(),
        surah: current.ayah.surah,
        surahName: current.ayah.surahName,
        ayah: current.ayah.numberInSurah,
        ayahNumber: current.ayah.number,
        score,
        matched: comparison.matched,
        total: comparison.total,
        confidence: coverage >= 0.8 ? "high" : coverage >= 0.55 ? "medium" : "low",
        transcript: spoken.slice(0, 500),
        expectedText: current.answer,
        level: activeLevel?.id,
        source: "games",
      });
      setRevealed(true);
      if (score >= passMark) {
        const gained = Math.round(score * 2.2) + streak * 2 + Math.ceil(timeLeft / 3);
        setScore((value) => value + gained);
        setSelected(current.answer);
        setStreak((value) => {
          const next = value + 1;
          setBestStreak((best) => Math.max(best, next));
          return next;
        });
      } else {
        setSelected(null);
        loseLife();
      }
      return;
    }
    const candidates = recitationCandidates.length
      ? recitationCandidates
      : buildRecitationCandidates([current.ayah]);
    const match = identifyRecitation(spoken, candidates);
    if (!match) {
      recitationFinishedRef.current = false;
      setRecitationError(
        "لم نتمكن من التعرف على آية من النطاق المحدد. اقرأ آية واضحة من السور المختارة ثم أعد التسجيل.",
      );
      return;
    }
    recitationFinishedRef.current = true;
    setIdentifiedAyah(match.ayah);
    setRecitationScore(match.score);
    setRecitationDetails({ matched: match.matched, total: match.total });
    saveRecitationAttempt(account.id, {
      id: `${Date.now()}-${match.ayah.number}-${Math.round(Math.random() * 9999)}`,
      at: Date.now(),
      surah: match.ayah.surah,
      surahName: match.ayah.surahName,
      ayah: match.ayah.numberInSurah,
      ayahNumber: match.ayah.number,
      score: match.score,
      matched: match.matched,
      total: match.total,
      confidence: match.confidence,
      transcript: spoken.slice(0, 500),
      expectedText: match.ayah.text,
      level: activeLevel?.id,
      source: "games",
    });
    setRevealed(true);
    if (match.score >= 6) {
      const gained = Math.round(match.score * 2.2) + streak * 2 + Math.ceil(timeLeft / 3);
      setScore((value) => value + gained);
      setSelected(match.ayah.text);
      setStreak((value) => {
        const next = value + 1;
        setBestStreak((best) => Math.max(best, next));
        return next;
      });
    } else {
      setSelected(null);
      loseLife();
    }
  };

  const toggleRecitation = () => {
    if (!current || revealed || failed) return;
    if (!hasSpeechRecognition()) {
      setRecitationError("الإدخال الصوتي غير مدعوم في هذا المتصفح. جرّب Chrome أو Edge على جهاز به ميكروفون.");
      return;
    }
    if (recording) {
      try {
        recognitionRef.current?.stop();
      } catch {
        setRecording(false);
      }
      return;
    }
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    const recognition = new Recognition();
    const session = recognitionSessionRef.current + 1;
    recognitionSessionRef.current = session;
    recognition.lang = "ar-SA";
    recognition.continuous = true;
    recognition.interimResults = true;
    transcriptRef.current = "";
    recognitionErroredRef.current = false;
    recitationFinishedRef.current = false;
    setTranscript("");
    setRecitationScore(null);
    setRecitationDetails(null);
    setRecitationError("");
    setIdentifiedAyah(null);
    setManualText("");
    recognition.onresult = (event) => {
      if (session !== recognitionSessionRef.current || recitationFinishedRef.current) return;
      let text = "";
      for (let i = 0; i < event.results.length; i += 1) {
        text += `${event.results[i][0]?.transcript ?? ""} `;
      }
      transcriptRef.current = text.trim();
      setTranscript(text.trim());
    };
    recognition.onerror = (event) => {
      if (session !== recognitionSessionRef.current) return;
      recognitionErroredRef.current = true;
      recognitionRef.current = null;
      const message = recognitionErrorMessage(event.error);
      if (message) setRecitationError(message);
      setRecording(false);
    };
    recognition.onend = () => {
      if (session !== recognitionSessionRef.current) return;
      setRecording(false);
      recognitionRef.current = null;
      if (recognitionErroredRef.current || recitationFinishedRef.current) return;
      const text = transcriptRef.current.trim();
      if (text) finishRecitation(text);
      else setRecitationError("لم نسمع تسميعًا واضحًا. اضغط زر التسجيل وحاول مرة أخرى.");
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setRecording(true);
    } catch {
      setRecording(false);
      setRecitationError("تعذّر بدء التسجيل. اسمح بالميكروفون من إعدادات المتصفح.");
    }
  };

  const nextQuestion = () => {
    if (failed) {
      finishGame(false);
      return;
    }
    if (index + 1 >= questions.length) {
      finishGame(true);
      return;
    }
    // إعادة المؤقّت قبل الانتقال حتى لا يُحتسب السؤال الجديد منتهيًا في أول رسم.
    if (activeLevel) setTimeLeft(activeLevel.seconds);
    setIndex((value) => value + 1);
    setSelected(null);
    setRevealed(false);
    resetRecitation();
  };

  const finishGame = (passed: boolean) => {
    if (!activeLevel) return;
    // احتفال عند الفوز في التحدي/المستوى.
    if (passed) celebrate("challenge");
    const stars = passed
      ? activeLevel.lives === 0 || livesLeft >= Math.ceil(activeLevel.lives / 2)
        ? 3
        : livesLeft > 0
          ? 2
          : 1
      : 0;
    const bonus = passed ? activeLevel.bonus + activeLevel.count * 5 : 0;
    const runKey = scopeKeyOf(activeLevel);
    const runStarsKey = starsKeyOf(activeLevel);
    const nextProgress: GameProgress = {
      ...progress,
      points: progress.points + score + bonus,
      bestStreak: Math.max(progress.bestStreak, bestStreak, streak),
      levelCleared: {
        ...(progress.levelCleared ?? {}),
        ...(passed ? { [runKey]: true } : {}),
      },
      stars: {
        ...progress.stars,
        [runStarsKey]: Math.max(progress.stars[runStarsKey] ?? 0, stars),
      },
      history: [
        {
          mode: `level-${runKey}`,
          level: activeLevel.id,
          points: score + bonus,
          stars,
          at: Date.now(),
        },
        ...progress.history,
      ].slice(0, 30),
    };
    setProgress(nextProgress);
    saveGameProgress(account.id, nextProgress);
    setResultPassed(passed);
    playNotificationSound(passed ? "success" : "error");
    setPhase("result");
  };

  const restart = () => {
    if (!activeLevel) return;
    setPhase("setup");
  };

  if (orderGameOpen) return <AyahOrderGame onExit={() => setOrderGameOpen(false)} />;

  if (phase === "menu") {
    return (
      <div className="page games-page">
        <div className="games-hero">
          <div>
            <span className="games-hero-kicker">الألغاز والاختبارات</span>
            <h2>رحلة الألغاز A1–A12</h2>
            <p>رتّب الكلمات، أكمل الآيات، واجمع النجوم. كل مستوى يفتح ما بعده.</p>
          </div>
          <div
            className="games-hero-ring"
            style={{ ["--p" as string]: `${Math.round((clearedCount / LEVELS.length) * 360)}deg` }}
            aria-label={`أكملت ${clearedCount} من ${LEVELS.length} مستوى`}
          >
            <strong>{clearedCount}/{LEVELS.length}</strong>
            <span>مستوى مكتمل</span>
          </div>
        </div>

        <div className="games-stats">
          <div className="stat-mini"><span>النقاط</span><strong>{progress.points}</strong></div>
          <div className="stat-mini"><span>أفضل سلسلة</span><strong>{progress.bestStreak}</strong></div>
          <div className="stat-mini"><span>المستويات</span><strong>{clearedCount}/12</strong></div>
          <div className="stat-mini"><span>الجولات</span><strong>{progress.history.length}</strong></div>
        </div>

        <SectionCard title="مسار المستويات العامة" subtitle={`أكملت ${clearedCount} من ١٢ مستويًا`}>
          <div className="question-kinds-grid" role="group" aria-label="أنواع الأسئلة في المسار العام">
            {ALL_KINDS.map((kind) => {
              const picked = generalKinds.includes(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={picked}
                  className={`question-kind-chip kind-${kind} ${picked ? "active" : ""}`}
                  onClick={() =>
                    setGeneralKinds((previous) => {
                      if (previous.includes(kind)) {
                        if (previous.length === 1) return previous;
                        return previous.filter((item) => item !== kind);
                      }
                      return [...previous, kind];
                    })
                  }
                >
                  <Icon name={KIND_ICONS[kind]} size={16} />
                  <span>{KIND_LABELS[kind]}</span>
                </button>
              );
            })}
          </div>
          <p className="muted">
            الأنواع المختارة: {generalKinds.map((kind) => KIND_LABELS[kind]).join("، ")} — يمكنك اختيار أكثر من نوع.
          </p>
          <div className="level-path">
            {LEVELS.map((level, levelIndex) => {
              const unlocked = isUnlocked(levelIndex);
              const done = Boolean(cleared[scopeKeyOf(level)]);
              const stars = progress.stars[starsKeyOf(level)] ?? 0;
              return (
                <button
                  key={level.id}
                  type="button"
                  className={`level-card ${unlocked ? "" : "locked"} ${done ? "cleared" : ""} ${level.id === currentLevel.id ? "current" : ""}`}
                  onClick={() => {
                    if (!unlocked) return;
                    setSelectedTypeKind(null);
                    openLevel(level);
                  }}
                  disabled={!unlocked}
                >
                  <div className="level-card-top">
                    <span className={`level-badge level-${level.id}`}>{level.id.toUpperCase()}</span>
                    {done ? <Icon name="check" size={18} /> : unlocked ? <Icon name="play" size={18} /> : <Icon name="lock" size={18} />}
                  </div>
                  <strong>{level.name}</strong>
                  <span className="level-subtitle">{level.subtitle}</span>
                  <div className="level-meta">
                    <span>{livesLabel(level.lives)}</span>
                    <span>{level.count} سؤال</span>
                    <span>{level.seconds}ث</span>
                  </div>
                  <div className="level-stars">
                    {"★".repeat(stars)}
                    {"☆".repeat(3 - stars)}
                  </div>
                  {!unlocked ? <small className="level-lock-note">أكمل {LEVELS[levelIndex - 1].id.toUpperCase()} أولًا</small> : null}
                </button>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="أنواع الأسئلة" subtitle="كل نوع مسار مستقل بنوع واحد فقط">
          <p className="muted">
            هذه المسارات مستقلة عن المسار العام، وكل مسار مخصّص لنوع واحد فقط من الأسئلة. اضغط على النوع
            لتفتح مستوياته الخاصة به.
          </p>
          <div className="question-kinds-grid">
            {ALL_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`question-kind-chip kind-${kind} ${selectedTypeKind === kind ? "active" : ""}`}
                onClick={() => {
                  setSelectedTypeKind(kind);
                  setAllowedKinds([kind]);
                  setPhase("typeLevels");
                }}
              >
                <Icon name={KIND_ICONS[kind]} size={16} />
                <span>{KIND_LABELS[kind]}</span>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="ترتيب الكلمات" subtitle="لغز جديد بالذكاء الاصطناعي">
          <p className="muted">تُعرض كلمات آية أو آيتين مبعثرة، ورتّبها كما في المصحف. ست جولات متدرجة.</p>
          <button type="button" className="primary-button" onClick={() => setOrderGameOpen(true)}>
            <Icon name="sparkles" size={16} /> ابدأ لغز ترتيب الكلمات
          </button>
        </SectionCard>

        <SectionCard title="سجل الجولات" subtitle="آخر ما لعبت">
          {progress.history.length ? (
            <div className="history-list">
              {progress.history.slice(0, 6).map((item, historyIndex) => (
                <div key={historyIndex} className="history-row">
                  <span>{historyLabel(item.mode)}</span>
                  <span>{item.points} نقطة</span>
                  <span>{"★".repeat(item.stars)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">لم تلعب جولة بعد — ابدأ من المسار أعلاه.</p>
          )}
        </SectionCard>
      </div>
    );
  }

  if (phase === "typeLevels" && selectedTypeKind) {
    return (
      <div className="page games-page">
        <div className="page-head">
          <div>
            <h2>{KIND_LABELS[selectedTypeKind]} — ١٢ مستوى</h2>
            <p className="muted">اختبارات من نوع «{KIND_LABELS[selectedTypeKind]}» فقط. اجتز كل مستوى بالترتيب.</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setPhase("menu")}>رجوع</button>
        </div>
        <SectionCard title="مسار المستويات" subtitle={`أكملت ${clearedInScope} من ١٢ مستويًا في «${KIND_LABELS[selectedTypeKind]}»`}>
          <div className="level-path">
            {LEVELS.map((level, levelIndex) => {
              const unlocked = isUnlocked(levelIndex);
              const done = Boolean(cleared[scopeKeyOf(level)]);
              const stars = progress.stars[starsKeyOf(level)] ?? 0;
              return (
                <button
                  key={level.id}
                  type="button"
                  className={`level-card ${unlocked ? "" : "locked"} ${done ? "cleared" : ""} ${level.id === currentLevel.id ? "current" : ""}`}
                  onClick={() => {
                    if (!unlocked) return;
                    setActiveLevel(level);
                    setError("");
                    setAllowedKinds([selectedTypeKind]);
                    setPhase("setup");
                  }}
                  disabled={!unlocked}
                >
                  <div className="level-card-top">
                    <span className={`level-badge level-${level.id}`}>{level.id.toUpperCase()}</span>
                    {done ? <Icon name="check" size={18} /> : unlocked ? <Icon name="play" size={18} /> : <Icon name="lock" size={18} />}
                  </div>
                  <strong>{level.name}</strong>
                  <span className="level-subtitle">{level.subtitle}</span>
                  <div className="level-meta">
                    <span>{livesLabel(level.lives)}</span>
                    <span>{level.count} سؤال</span>
                    <span>{level.seconds}ث</span>
                  </div>
                  <div className="level-stars">
                    {"★".repeat(stars)}
                    {"☆".repeat(3 - stars)}
                  </div>
                  {!unlocked ? <small className="level-lock-note">أكمل {LEVELS[levelIndex - 1].id.toUpperCase()} أولًا</small> : null}
                </button>
              );
            })}
          </div>
        </SectionCard>
      </div>
    );
  }

  if (phase === "setup" && activeLevel) {
    return (
      <div className="page games-page">
        <div className="page-head">
          <div>
            <h2>{activeLevel.id.toUpperCase()} — {activeLevel.name}</h2>
            <p className="muted">اختر الأجزاء والسور التي تريد أن تمتحن عليها.</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setPhase(selectedTypeKind ? "typeLevels" : "menu")}>رجوع</button>
        </div>

        <div className="game-setup-grid">
          <SectionCard title="نطاق الامتحان">
            <div className="setup-block">
              <h4>نوع الأسئلة</h4>
              <p className="muted" style={{ margin: 0 }}>
                {selectedTypeKind
                  ? `مسار «${KIND_LABELS[selectedTypeKind]}» — أسئلة من هذا النوع فقط.`
                  : "المسار العام — أسئلة مختلطة من جميع الأنواع، ولا يتأثر بصندوق أنواع الأسئلة."}
              </p>
            </div>

            <div className="setup-block">
              <h4>الأجزاء <span className="muted">(حتى ٤ — تنطبق على كل الأنواع المحددة)</span></h4>
              <div className="juz-grid">
                {Array.from({ length: 30 }, (_, value) => value + 1).map((juz) => (
                  <button
                    key={juz}
                    type="button"
                    className={`juz-chip ${activeRange.juzs.includes(juz) ? "active" : ""}`}
                    onClick={() => toggleJuz(juz)}
                  >
                    {juz}
                  </button>
                ))}
              </div>
            </div>

            <div className="setup-block">
              <div className="setup-block-head">
                <h4>السور <span className="muted">({activeRange.surahs.length} محددة)</span></h4>
                <div className="form-actions">
                  <button type="button" className="chip-toggle" onClick={() => setActiveSurahs(activeJuzSurahs)}>تحديد الكل</button>
                  <button type="button" className="chip-toggle" onClick={() => setActiveSurahs([])}>مسح</button>
                </div>
              </div>
              <div className="surah-grid">
                {activeJuzSurahs.map((surahNumber) => {
                  const name = surahs[surahNumber - 1]?.name ?? `سورة ${surahNumber}`;
                  return (
                    <button
                      key={surahNumber}
                      type="button"
                      className={`surah-chip ${activeRange.surahs.includes(surahNumber) ? "active" : ""}`}
                      onClick={() => toggleSurah(surahNumber)}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="setup-block">
              <h4>ملخص النطاق</h4>
              <p className="muted" style={{ margin: 0 }}>
                الأجزاء: {scope.juzs.map(juzRangeLabel).join("، ")} — {scope.surahs.length} سورة.
                الأنواع المحددة: {allowedKinds.map((kind) => KIND_LABELS[kind]).join("، ") || "لا شيء"}.
              </p>
            </div>
          </SectionCard>

          <SectionCard title="ملخص الجولة" subtitle={`${allowedKinds.length} نوع — نطاق واحد`}>
            <div className="scope-summary">
              <div><span>المستوى</span><strong>{activeLevel.id.toUpperCase()}</strong></div>
              <div><span>الأسئلة</span><strong>{activeLevel.count}</strong></div>
              <div><span>الوقت/سؤال</span><strong>{activeLevel.seconds}ث</strong></div>
              <div><span>المحاولات</span><strong>{livesLabel(activeLevel.lives)}</strong></div>
            </div>
            <p className="muted">
              {activeLevel.lives === 0
                ? "المستوى الأخير: أي إجابة خاطئة أو انتهاء وقت تنهي المحاولة فورًا."
                : `لديك ${livesLabel(activeLevel.lives)}. كل خطأ أو انتهاء وقت يستهلك محاولة.`}
            </p>
            {error ? <p className="game-error">{error}</p> : null}
            <div className="setup-block">
              <h4>المنافس</h4>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={aiOpponent} onChange={(e) => setAiOpponent(e.target.checked)} />
                <span>لعب ضد ذكاء اصطناعي (AI)</span>
              </label>
              <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {aiOpponent ? "سيجيب الذكاء الاصطناعي على كل سؤال (AI Opponent)." : "اللعب فردي (بدون منافس)."}
              </p>
            </div>
            <button type="button" className="primary-button game-start" onClick={startGame} disabled={loading || allowedKinds.length === 0}>
              <Icon name="play" size={18} /> {loading ? "جارٍ تحميل الآيات…" : "ابدأ الامتحان"}
            </button>
          </SectionCard>
        </div>
      </div>
    );
  }

  if (phase === "result" && activeLevel) {
    const totalStars = progress.stars[starsKeyOf(activeLevel)] ?? 0;
    const nextLevel = LEVELS[LEVELS.indexOf(activeLevel) + 1];
    return (
      <div className="page games-page">
        <div className={`result-card ${resultPassed ? "pass" : "fail"}`}>
          <Icon name={resultPassed ? "sparkles" : "refresh"} size={48} />
          <h2>{resultPassed ? `اجتزت ${activeLevel.id.toUpperCase()}!` : `لم تجتز ${activeLevel.id.toUpperCase()}`}</h2>
          <div className="result-score">{score + (resultPassed ? activeLevel.bonus + activeLevel.count * 5 : 0)} نقطة</div>
          <div className="result-stars">{"★".repeat(totalStars)}{"☆".repeat(3 - totalStars)}</div>
          <p className="muted">
            {resultPassed
              ? nextLevel
                ? `فتحت المستوى ${nextLevel.id.toUpperCase()}. هل أنت مستعد للتحدي التالي؟`
                : "أكملت جميع المستويات! أنت أسطورة ثمار."
              : activeLevel.lives === 0
                ? "المستوى الأخير لا يسمح بأي خطأ. راجع الآيات ثم أعد المحاولة."
                : `استهلكت كل المحاولات. راجع الأسئلة وأعد المحاولة.`}
          </p>
          <div className="form-actions">
            {resultPassed && nextLevel ? (
              <button type="button" className="primary-button" onClick={() => openLevel(nextLevel)}>
                المستوى التالي {nextLevel.id.toUpperCase()}
              </button>
            ) : null}
            <button type="button" className="ghost-button" onClick={restart}>إعادة المحاولة</button>
            <button type="button" className="ghost-button" onClick={() => setPhase(selectedTypeKind ? "typeLevels" : "menu")}>القائمة</button>
          </div>
        </div>
      </div>
    );
  }

  if (!current || !activeLevel) {
    return (
      <div className="page games-page">
        <EmptyState title="لا توجد أسئلة" body="عد إلى القائمة واختر نطاقًا آخر." />
        <button type="button" className="ghost-button" onClick={() => setPhase(selectedTypeKind ? "typeLevels" : "menu")}>القائمة</button>
      </div>
    );
  }

  const remainingHearts = Math.max(0, livesLeft);
  const totalHearts = activeLevel.lives;
  const recognitionSupported = hasSpeechRecognition();
  // كلما ارتفع المستوى ارتفعت درجة النجاح المطلوبة في التسميع أيضًا.
  const levelOrder = Math.max(0, LEVELS.findIndex((item) => item.id === activeLevel.id));
  const recitationPassMark = levelOrder >= 9 ? 8 : levelOrder >= 5 ? 7 : 6;

  return (
    <div className="page games-page">
      <div className="game-topbar">
        <button type="button" className="ghost-button" onClick={() => { setSelectedTypeKind(null); setPhase("menu"); }}>خروج</button>
        <div className="game-progress">{activeLevel.id.toUpperCase()} • {index + 1}/{questions.length}</div>
        <div className={`timer ${timeLeft <= 5 ? "danger" : ""}`}>{timeLeft}ث</div>
      </div>

      <div className="game-hud">
        <span className={`kind-badge kind-${current.kind}`}><Icon name={KIND_ICONS[current.kind]} size={14} /> {KIND_LABELS[current.kind]}</span>
        <span className="hud-score">النقاط: {score}</span>
        {aiOpponent ? <span className="hud-score" style={{ color: "#8b5cf6" }}>AI: {aiScore}</span> : null}
        <span className="hud-lives">
          {totalHearts === 0 ? (
            <>بدون أخطاء <small>(أي خطأ ينهي)</small></>
          ) : (
            <>المحاولات: {"❤".repeat(remainingHearts)}{"♡".repeat(totalHearts - remainingHearts)}</>
          )}
        </span>
      </div>

      <div className="question-card">
        <p className="question-prompt">{current.prompt}</p>
        {current.kind === "recite" && !revealed ? (
          <div className="recite-blind-note">
            <Icon name="mic" size={17} />
            <span>
              {current.endAyah && current.endAyah.number !== current.ayah.number
                ? "سمّع المقطع المطلوب كاملًا بصوت واضح. لن نعرض الآيات قبل التسجيل؛ سنطابق تلاوتك بالمقطع ثم نقيّم النطق."
                : "سمّع الآية المطلوبة بصوت واضح. لن نعرض الآية قبل التسجيل؛ سنطابق تلاوتك بها ثم نقيّم النطق."}
            </span>
          </div>
        ) : null}
        {current.kind === "recite" && revealed && identifiedAyah ? (
          <div className="recite-identified">
            <span>المقطع المطلوب تسميعه:</span>
            <strong>
              سورة {identifiedAyah.surahName} • {current.endAyah && current.endAyah.number !== current.ayah.number
                ? `من الآية ${identifiedAyah.numberInSurah} إلى الآية ${current.endAyah.numberInSurah}`
                : `الآية ${identifiedAyah.numberInSurah}`}
            </strong>
            <p>{current.answer}</p>
          </div>
        ) : null}
        {current.kind !== "recite" && current.hint && !revealed ? <small className="hint">{current.hint}</small> : null}
        {current.kind === "recite" ? (
          <div className="recite-panel">
            <div className="recite-actions">
              <button
                type="button"
                className={recording ? "danger-button" : "primary-button"}
                onClick={toggleRecitation}
                disabled={!recognitionSupported || revealed || failed}
              >
                <Icon name={recording ? "pause" : "mic"} size={17} />
                {recording ? "إيقاف التسجيل وتحليل الصوت" : "بدء التسميع الصوتي"}
              </button>
              {recording ? <span className="recording-dot" aria-label="جارٍ التسجيل" /> : null}
              {!recognitionSupported ? (
                <p className="recitation-error" role="alert">
                  هذا المتصفح لا يدعم تحويل الكلام إلى نص. استخدم Chrome أو Edge على جهاز به ميكروفون.
                </p>
              ) : null}
            </div>
            {transcript ? (
              <div className="recite-transcript">
                <span>النص الذي فُهم من صوتك:</span>
                <p>{transcript}</p>
              </div>
            ) : null}
            {recitationError ? <p className="recitation-error" role="alert">{recitationError}</p> : null}
            <details className="recite-manual">
              <summary>أو اكتب التلاوة يدويًا</summary>
              <textarea
                value={manualText}
                onChange={(event) => setManualText(event.target.value)}
                placeholder="اكتب الآية كما تسمّعها هنا…"
                aria-label="كتابة التلاوة يدويًا"
              />
              <button
                type="button"
                className="ghost-button"
                onClick={() => finishRecitation(manualText)}
                disabled={!manualText.trim() || revealed || failed}
              >
                <Icon name="check" size={15} /> تحليل النص
              </button>
            </details>
            {recitationScore !== null ? (
              <div className={`recite-score ${recitationScore >= recitationPassMark ? "pass" : "fail"}`}>
                <strong>{recitationScore} / 10</strong>
                <span>
                  {recitationDetails ? `تطابق ${recitationDetails.matched} من ${recitationDetails.total} كلمة. ` : ""}
                  {recitationScore >= recitationPassMark + 2
                    ? "نطق ممتاز، ما شاء الله."
                    : recitationScore >= recitationPassMark
                      ? "نطق مقبول. راجع الكلمات غير الواضحة لتحصل على أعلى درجة."
                      : `يحتاج النطق إلى مراجعة وتمهّل. المطلوب ${recitationPassMark}/10 على الأقل في هذا المستوى.`}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        {current.kind === "order" && !revealed && current.words?.length ? (
          <WordOrderBoard
            key={current.id}
            words={current.words}
            answer={current.answer.split(/\s+/).filter(Boolean)}
            onCheck={answerOrder}
            disabled={failed}
            resetKey={current.id}
          />
        ) : null}
        {current.kind === "order" && revealed ? (
          <p className="word-order-reveal">{selected}</p>
        ) : null}
        <div className="options-grid" hidden={current.kind === "recite" || current.kind === "order"}>
          {current.options.map((option) => {
            let className = "option-button";
            if (revealed) {
              if (option === current.answer) className += " correct";
              else if (option === selected) className += " wrong";
            }
            return (
              <button
                key={option}
                type="button"
                className={className}
                onClick={() => answer(option)}
                disabled={revealed || failed}
              >
                {option}
              </button>
            );
          })}
        </div>
        {revealed ? (
          <div className="feedback-row">
            <span className={current.kind === "recite" ? (recitationScore !== null && recitationScore >= recitationPassMark ? "success" : "danger") : selected === current.answer ? "success" : "danger"}>
              {current.kind === "order" && selected === current.answer ? "أحسنت! الترتيب صحيح." : current.kind === "order" && selected ? "الترتيب غير صحيح. الترتيب الصحيح:" : null}
              {current.kind === "recite"
                ? recitationScore !== null
                  ? recitationScore >= recitationPassMark
                    ? `تسميع مقبول: ${recitationScore}/10.`
                    : `تسميع غير مكتمل: ${recitationScore}/10 (المطلوب ${recitationPassMark}). أعد المحاولة في الجولة القادمة.`
                  : "انتهى وقت السؤال قبل إكمال التسميع."
                : selected === current.answer
                  ? "أحسنت! إجابة صحيحة."
                  : `الإجابة الصحيحة: ${current.answer}`}
            </span>
            <button type="button" className="primary-button" onClick={nextQuestion}>
              {failed ? "النتيجة" : index + 1 >= questions.length ? "إنهاء المستوى" : "التالي"}
            </button>
          </div>
        ) : null}
        {failed ? <p className="game-error">{activeLevel.lives === 0 ? "انتهت المحاولة: المستوى الأخير لا يسمح بأي خطأ. اضغط «النتيجة»." : "انتهت المحاولات في هذا المستوى. اضغط «النتيجة» لمراجعة المحاولة."}</p> : null}
      </div>

      <div className="game-status">
        <span>السلسلة: {streak}</span>
        <span>أفضل سلسلة: {bestStreak}</span>
        <span>{activeLevel.lives === 0 ? "التحدي: بلا أخطاء" : `المحاولات المتبقية: ${remainingHearts}`}</span>
      </div>
    </div>
  );
}
