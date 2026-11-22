import { useEffect, useRef, useState } from "react";
import { fetchJuzs, type Ayah } from "../../lib/quran";
import { surahs } from "../../data/surahs";
import { getSupabase } from "../../lib/supabase";
import { quickMatch, type QuickMatchHandle, type MatchResult } from "../../lib/matchmaking";
import { EmptyState, SectionCard } from "./ui";
import { addPoints } from "../../lib/appStore";
import { playNotificationSound } from "../../lib/sound";
import { generateQuestionsWithAi } from "../../lib/aiQuestions";
import WordOrderBoard from "./WordOrderBoard";

type Phase =
  | "menu"
  | "create"
  | "join"
  | "searching"
  | "lobby"
  | "playing"
  | "result"
  | "localSetup"
  | "localPlay"
  | "localResult";

type LocalKind = "mixed" | "surah" | "complete" | "juz" | "truefalse" | "order";

const LOCAL_KINDS: { id: LocalKind; label: string }[] = [
  { id: "surah", label: "تخمين السورة" },
  { id: "complete", label: "أكمل الآية" },
  { id: "juz", label: "تحديد الجزء" },
  { id: "truefalse", label: "صح أو خطأ" },
  { id: "order", label: "ترتيب الكلمات" },
];

const BOT_NAME = "رفيق الذكاء";

type Player = { name: string; score: number; joinedAt: number };

type Question = {
  id: string;
  prompt: string;
  options: string[];
  answer: string;
  ayah: Ayah;
  timeLimit: number;
  kind?: string;
  /** كلمات السؤال مبعثرة في سؤال «ترتيب الكلمات». */
  words?: string[];
};

function makeCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function buildQuestion(pool: Ayah[], timeLimit = 20, testType = "mixed"): Question | null {
  if (pool.length === 0) return null;
  const ayah = pool[Math.floor(Math.random() * pool.length)];
  const words = ayah.text.split(/\s+/);
  const kindPool =
    testType === "mixed" ? ["surah", "complete", "juz", "truefalse"] :
    testType === "surah" ? ["surah"] :
    testType === "complete" ? ["complete"] :
    testType === "juz" ? ["juz"] :
    testType === "truefalse" ? ["truefalse"] : ["surah"];
  const kind = kindPool[Math.floor(Math.random() * kindPool.length)];
  if (kind === "complete" && words.length >= 5) {
    const cut = Math.max(2, Math.floor(words.length / 2));
    const tail = words.slice(cut).join(" ");
    const wrongTails = pool
      .filter((a) => a.number !== ayah.number)
      .map((a) => a.text.split(/\s+/).slice(Math.max(2, Math.floor(a.text.split(/\s+/).length / 2))).join(" "))
      .filter(Boolean);
    const distractors = Array.from(new Set(wrongTails.filter((t) => t !== tail))).slice(0, 3);
    if (distractors.length < 3) {
      // fall through to surah
    } else {
      return {
        id: `q-${ayah.number}`,
        prompt: `${words.slice(0, cut).join(" ")} …`,
        options: shuffle([tail, ...distractors]),
        answer: tail,
        ayah,
        timeLimit: timeLimit,
      };
    }
  }
  if (kind === "juz") {
    const correct = `الجزء ${ayah.juz}`;
    const wrong = Array.from({ length: 30 }, (_, v) => v + 1)
      .filter((v) => v !== ayah.juz)
      .map((v) => `الجزء ${v}`);
    const distractors = shuffle(wrong).slice(0, 3);
    return {
      id: `q-${ayah.number}`,
      prompt: ayah.text,
      options: shuffle([correct, ...distractors]),
      answer: correct,
      ayah,
              timeLimit: timeLimit,
    };
  }
  if (kind === "truefalse") {
    const other = surahs.filter((s) => s.name !== ayah.surahName)[Math.floor(Math.random() * 20)]?.name ?? "سورة أخرى";
    const claimed = Math.random() < 0.5 ? ayah.surahName : other;
    const isTrue = claimed === ayah.surahName;
    return {
      id: `q-${ayah.number}`,
      prompt: `هل هذه الآية من سورة ${claimed}؟\n«${ayah.text}»`,
      options: ["صح", "خطأ"],
      answer: isTrue ? "صح" : "خطأ",
      ayah,
              timeLimit: timeLimit,
    };
  }
  const correct = ayah.surahName;
  const wrong = shuffle(surahs.filter((s) => s.name !== correct).map((s) => s.name)).slice(0, 3);
  return {
    id: `q-${ayah.number}`,
    prompt: ayah.text,
    options: shuffle([correct, ...wrong]),
    answer: correct,
    ayah,
            timeLimit: timeLimit,
  };
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

/** أسئلة تحدي وجهاً لوجه: كل الخيارات والإجابات من الأجزاء المختارة فقط. */
function buildLocalQuestions(
  pool: Ayah[],
  kinds: LocalKind[],
  count: number,
  timeLimit: number,
): Question[] {
  if (pool.length === 0) return [];
  const chosen = kinds.length ? kinds : (["mixed"] as LocalKind[]);
  const source = shuffle(pool).slice(0, Math.min(count * 3, pool.length));
  const questions: Question[] = [];
  source.forEach((ayah, index) => {
    if (questions.length >= count) return;
    const words = ayah.text.split(/\s+/);
    let kind = chosen[index % chosen.length];
    if (kind === "mixed") {
      kind = (["surah", "complete", "juz", "truefalse", "order"] as LocalKind[])[index % 5];
    }
    if (kind === "complete" && words.length < 5) kind = "surah";
    if (kind === "juz" && pool.length < 4) kind = "surah";

    if (kind === "order") {
      // كلمات آية أو آيتين متتاليتين من النطاق نفسه.
      let orderWords = words.filter(Boolean);
      const next = pool.find(
        (item) => item.surah === ayah.surah && item.numberInSurah === ayah.numberInSurah + 1,
      );
      const nextWords = next ? next.text.split(/\s+/).filter(Boolean) : [];
      if (next && orderWords.length <= 12 && orderWords.length + nextWords.length <= 24) {
        orderWords = [...orderWords, ...nextWords];
      }
      questions.push({
        id: `local-${index}-${ayah.number}`,
        kind: "order",
        prompt: `رتّب الكلمات لتكوين ${next && orderWords.length > words.length ? "الآيتين" : "الآية"} من سورة ${ayah.surahName}.`,
        options: [],
        answer: orderWords.join(" "),
        words: shuffle(orderWords),
        ayah,
        timeLimit,
      });
      return;
    }

    if (kind === "complete") {
      const cut = Math.max(2, Math.floor(words.length / 2));
      const tail = words.slice(cut).join(" ");
      const wrong = shuffle(
        pool
          .filter((item) => item.number !== ayah.number)
          .map((item) => {
            const w = item.text.split(/\s+/);
            return w.slice(Math.max(2, Math.floor(w.length / 2))).join(" ");
          })
          .filter((t) => t && t !== tail),
      );
      const options = Array.from(new Set([tail, ...wrong])).slice(0, 4);
      if (options.length < 2) return;
      questions.push({
        id: `local-${index}-${ayah.number}`,
        prompt: `${words.slice(0, cut).join(" ")} …`,
        options: shuffle(options),
        answer: tail,
        ayah,
        timeLimit,
      });
      return;
    }

    if (kind === "juz") {
      const correct = `الجزء ${ayah.juz}`;
      const wrong = Array.from(new Set(pool.map((item) => item.juz)))
        .filter((j) => j !== ayah.juz)
        .map((j) => `الجزء ${j}`);
      const options = Array.from(new Set([correct, ...shuffle(wrong)])).slice(0, 4);
      if (options.length < 2) return;
      questions.push({ id: `local-${index}-${ayah.number}`, prompt: ayah.text, options: shuffle(options), answer: correct, ayah, timeLimit });
      return;
    }

    if (kind === "truefalse") {
      const others = Array.from(new Set(pool.map((a) => a.surahName))).filter((n) => n !== ayah.surahName);
      const other = others[0] ?? "سورة أخرى";
      const claimed = Math.random() < 0.5 ? ayah.surahName : other;
      questions.push({
        id: `local-${index}-${ayah.number}`,
        prompt: `هل هذه الآية من سورة ${claimed}؟\n«${ayah.text}»`,
        options: ["صح", "خطأ"],
        answer: claimed === ayah.surahName ? "صح" : "خطأ",
        ayah,
        timeLimit,
      });
      return;
    }

    const correct = ayah.surahName;
    const wrong = Array.from(new Set(pool.map((a) => a.surahName))).filter((n) => n !== correct);
    const options = Array.from(new Set([correct, ...shuffle(wrong)])).slice(0, 4);
    if (options.length < 2) return;
    questions.push({ id: `local-${index}-${ayah.number}`, prompt: ayah.text, options: shuffle(options), answer: correct, ayah, timeLimit });
  });
  return questions;
}

export default function OnlineChallenge({ account }: { account: { id: string; fullName: string } }) {
  const [phase, setPhase] = useState<Phase>("menu");
  const [name, setName] = useState(account.fullName);
  const [juzs, setJuzs] = useState<number[]>([29, 30]);
  const [questionTime, setQuestionTime] = useState(20);
  const [questionCount, setQuestionCount] = useState(5);
  const [testType, setTestType] = useState("mixed");
  const [quickConfigOpen, setQuickConfigOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [sharedJuzs, setSharedJuzs] = useState<number[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [, setLockedBy] = useState<string | null>(null);
  const [myAnswer, setMyAnswer] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [onlineAnswered, setOnlineAnswered] = useState<string[]>([]);
  const [onlineRevealed, setOnlineRevealed] = useState(false);
  const [pool, setPool] = useState<Ayah[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(5);
  const [error, setError] = useState("");
  const [reviewLog, setReviewLog] = useState<Array<{ q: string; answer: string; name: string; choice: string; correct: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [searchLeft, setSearchLeft] = useState(12);
  const [searchNote, setSearchNote] = useState("");
  const [isBotMatch, setIsBotMatch] = useState(false);
  const searchRef = useRef<QuickMatchHandle | null>(null);
  const questionsAskedRef = useRef(0);
  const botTimerRef = useRef<number | null>(null);
  const channelRef = useRef<ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null>(null);
  const timerRef = useRef<number | null>(null);
  const answeredRef = useRef(false);

  // ---- تحدي وجهاً لوجه على نفس الجهاز ----
  const [localNames, setLocalNames] = useState<string[]>([account.fullName, "الخصم"]);
  const [localPlayerCount, setLocalPlayerCount] = useState(2);
  const [localJuzs, setLocalJuzs] = useState<number[]>([30]);
  const [localKinds, setLocalKinds] = useState<LocalKind[]>(["surah", "complete", "juz", "truefalse"]);
  const [localQuestionTime, setLocalQuestionTime] = useState(20);
  const [localCount, setLocalCount] = useState(6);
  const [localQuestions, setLocalQuestions] = useState<Question[]>([]);
  const [localIndex, setLocalIndex] = useState(0);
  const [localAnswers, setLocalAnswers] = useState<Array<string | null>>([null, null]);
  const [localScores, setLocalScores] = useState<number[]>([0, 0]);
  const [localRevealed, setLocalRevealed] = useState(false);
  const [localLog, setLocalLog] = useState<Array<{ prompt: string; answer: string; choices: string[]; correct: boolean[] }>>([]);
  const [localError, setLocalError] = useState("");
  const [localLoading, setLocalLoading] = useState(false);
  const answersRef = useRef<Array<string | null>>([]);
  const revealedRef = useRef(false);
  const turnRef = useRef<number>(0);
  const [localTurn, setLocalTurn] = useState<number>(0);
  const [localTimes, setLocalTimes] = useState<number[]>([]);
  const phaseRef = useRef<Phase>("menu");
  phaseRef.current = phase;

  const toggleJuz = (j: number) => {
    setJuzs((prev) => {
      if (prev.includes(j)) return prev.length === 1 ? prev : prev.filter((x) => x !== j);
      return [...prev, j].sort((a, b) => a - b);
    });
  };
  const selectAllJuzs = () => setJuzs(Array.from({ length: 30 }, (_, v) => v + 1));

  const broadcast = (event: string, payload: unknown) => {
    const sb = getSupabase();
    if (sb && channelRef.current) {
      channelRef.current.send({ type: "broadcast", event, payload });
    }
    // fallback: localStorage event
    try {
      localStorage.setItem("thimar.challenge.broadcast", JSON.stringify({ code: roomCode, event, payload, at: Date.now() }));
    } catch { /* ignore */ }
  };

  const broadcastTo = (code: string, event: string, payload: unknown) => {
    try {
      channelRef.current?.send({ type: "broadcast", event, payload });
    } catch { /* ignore */ }
    try {
      localStorage.setItem("thimar.challenge.broadcast", JSON.stringify({ code, event, payload, at: Date.now() }));
    } catch { /* ignore */ }
  };

  const startBotMatch = async () => {
    setIsBotMatch(true);
    setTotalQuestions(questionCount);
    questionsAskedRef.current = 0;
    setRoomCode("");
    setPlayers([
      { name, score: 0, joinedAt: Date.now() },
      { name: BOT_NAME, score: 0, joinedAt: Date.now() },
    ]);
    setSharedJuzs(juzs);
    setError("");
    setPhase("playing");
    setLoading(true);
    try {
      const data = await fetchJuzs(juzs);
      setPool(data);
      const q = buildQuestion(data, questionTime, testType);
      if (q) {
        setCurrentQuestion(q);
        setLockedBy(null);
        setMyAnswer(null);
        answeredRef.current = false;
        setTimeLeft(q.timeLimit);
      }
    } catch {
      setError("تعذّر تحميل الآيات للمباراة الوهمية.");
    } finally {
      setLoading(false);
    }
  };

  const beginHumanGame = async (code: string, sj: number[]) => {
    setTotalQuestions(questionCount);
    questionsAskedRef.current = 0;
    setLoading(true);
    try {
      const data = await fetchJuzs(sj);
      setPool(data);
    } catch {
      setError("تعذّر تحميل الآيات.");
    } finally {
      setLoading(false);
    }
    broadcastTo(code, "start", { sharedJuzs: sj });
    setSharedJuzs(sj);
    setPhase("playing");
    window.setTimeout(() => sendNextQuestion(sj), 500);
  };

  const handleMatched = (result: MatchResult) => {
    searchRef.current = null;
    if (result.kind === "bot") {
      setSearchNote("لم نجد خصمًا الآن، بدأت مباراة وهمية مع الذكاء الاصطناعي.");
      startBotMatch();
      return;
    }
    setIsBotMatch(false);
    setRoomCode(result.roomCode);
    setPlayers([
      { name, score: 0, joinedAt: Date.now() },
      { name: result.opponentName, score: 0, joinedAt: Date.now() + 1 },
    ]);
    setSharedJuzs(result.juzs);
    setSearchNote("");
    setError("");
    subscribe(result.roomCode, name);
    setPhase("lobby");
    if (result.isHost) {
      window.setTimeout(() => beginHumanGame(result.roomCode, result.juzs), 1200);
    }
  };

  const startQuickMatch = () => {
    setError("");
    setSearchNote("");
    setSearchLeft(12);
    setPhase("searching");
    searchRef.current = quickMatch({
      playerId: account.id,
      name,
      juzs,
      timeoutMs: 12000,
      onWaiting: (seconds) => setSearchLeft(seconds),
      onPaired: handleMatched,
    });
  };

  const cancelSearch = () => {
    searchRef.current?.cancel();
    searchRef.current = null;
    setPhase("menu");
  };

  // Bot opponent answers on its own during a bot match.
  useEffect(() => {
    if (!isBotMatch || phase !== "playing" || !currentQuestion) return;
    if (botTimerRef.current) window.clearTimeout(botTimerRef.current);
    const delay = 3000 + Math.random() * 5000;
    botTimerRef.current = window.setTimeout(() => {
      const accuracy = 0.55;
      const correct = Math.random() < accuracy;
      setPlayers((prev) =>
        prev.map((p) =>
          p.name === BOT_NAME ? { ...p, score: p.score + (correct ? 1 : 0) } : p,
        ),
      );
    }, delay);
    return () => {
      if (botTimerRef.current) window.clearTimeout(botTimerRef.current);
    };
  }, [isBotMatch, phase, currentQuestion?.id]);

  const createRoom = async () => {
    if (juzs.length > 7) { setError("حد أقصى ٧ أجزاء."); return; }
    setLoading(true); setError("");
    const newCode = makeCode();
    const sb = getSupabase();
    if (sb) {
      try {
        await sb.from("thimar_challenge_rooms").insert({ code: newCode, host_name: name, juzs, status: "waiting" });
      } catch { /* ignore */ }
    }
    setRoomCode(newCode);
    setPlayers([{ name, score: 0, joinedAt: Date.now() }]);
    setPhase("lobby");
    setTimeout(() => broadcast("host", { name }), 400);
    setLoading(false);
    // subscribe
    subscribe(newCode, name);
  };

  const joinRoom = async () => {
    if (!joinCode.trim()) { setError("أدخل رمز الغرفة."); return; }
    setLoading(true); setError("");
    const sb = getSupabase();
    const code = joinCode.trim().toUpperCase();
    if (sb) {
      try {
        const { data } = await sb.from("thimar_challenge_rooms").select("*").eq("code", code).single();
        if (data) {
          setJuzs(data.juzs ?? []);
        }
      } catch { /* ignore */ }
    }
    setRoomCode(code);
    setPhase("lobby");
    setLoading(false);
    subscribe(code, name);
    // announce join
    setTimeout(() => broadcast("join", { name }), 300);
  };

  const subscribe = (roomCodeVal: string, myName: string) => {
    const sb = getSupabase();
    if (sb) {
      const ch = sb.channel(`challenge:${roomCodeVal}`, { config: { broadcast: { self: true } } });
      ch.on("broadcast", { event: "action" }, ({ payload }) => {
        handleAction(payload as { type: string; [k: string]: unknown }, myName);
      });
      ch.subscribe();
      channelRef.current = ch;
    }
  };

  const handleAction = (action: { type: string; [k: string]: unknown }, myName: string) => {
    if (action.type === "join") {
      const pname = String(action.name ?? "");
      setPlayers((prev) => {
        if (prev.some((p) => p.name === pname)) return prev;
        return [...prev, { name: pname, score: 0, joinedAt: Date.now() }];
      });
    } else if (action.type === "host") {
      const pname = String(action.name ?? "");
      setPlayers((prev) => {
        if (prev.some((p) => p.name === pname)) return prev;
        return [...prev, { name: pname, score: 0, joinedAt: Date.now() }];
      });
    } else if (action.type === "start") {
      const sj = (action.sharedJuzs as number[]) ?? [];
      setSharedJuzs(sj);
      setPhase("playing");
    } else if (action.type === "question") {
      const q = action.question as Question;
      setCurrentQuestion(q);
      setLockedBy(null);
      setMyAnswer(null);
      setOnlineAnswered([]);
      setOnlineRevealed(false);
      answeredRef.current = false;
      setTimeLeft(q.timeLimit);
    } else if (action.type === "press") {
      const pname = String(action.name ?? "");
      setLockedBy((prev) => (prev ? prev : pname));
    } else if (action.type === "answer") {
      const pname = String(action.name ?? "");
      const correct = Boolean(action.correct);
      setPlayers((prev) => prev.map((p) => p.name === pname ? { ...p, score: p.score + (correct ? 1 : -1) } : p));
      setReviewLog((prev) => [
        ...prev,
        {
          q: String(action.prompt ?? ""),
          answer: String(action.answer ?? ""),
          name: pname,
          choice: String(action.choice ?? "—"),
          correct,
        },
      ]);
      if (pname === myName) {
        setMyAnswer(correct ? "correct" : "wrong");
      }
      setOnlineAnswered((prev) => {
        const next = prev.includes(pname) ? prev : [...prev, pname];
        if (next.length >= players.length) setOnlineRevealed(true);
        return next;
      });
    } else if (action.type === "timesup") {
      setLockedBy((prev) => (prev ? prev : "__timeout__"));
      setOnlineRevealed(true);
    }
  };

  // listen to localStorage fallback
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== "thimar.challenge.broadcast") return;
      try {
        const data = JSON.parse(e.newValue || "{}");
        if (data.code !== roomCode) return;
        handleAction({ type: data.event, ...(data.payload as object) }, name);
      } catch { /* ignore */ }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [roomCode, name]);

  useEffect(() => {
    return () => {
      searchRef.current?.cancel();
      searchRef.current = null;
      if (botTimerRef.current) window.clearTimeout(botTimerRef.current);
    };
  }, []);

  // timer
  useEffect(() => {
    if (phase !== "playing" || !currentQuestion) return;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          broadcast("timesup", {});
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [phase, currentQuestion?.id]);

  const startChallenge = async () => {
    // compute shared juzs: intersection of all players' juzs. For simplicity, use host juzs.
    // Need each player's juzs; here we only have host's. We'll require host to choose juzs common.
    // Shared = juzs (host) intersected with... we don't have others'. Use host selection as the pool.
    const sj = juzs;
    if (sj.length === 0) { setError("اختر جزءًا واحدًا على الأقل."); return; }
    setSharedJuzs(sj);
    setLoading(true);
    try {
      const data = await fetchJuzs(sj);
      setPool(data);
    } catch {
      setError("تعذّر تحميل الآيات.");
    } finally {
      setLoading(false);
    }
    broadcast("start", { sharedJuzs: sj });
    setPhase("playing");
    // send first question after short delay
    setTimeout(() => sendNextQuestion(sj), 500);
  };

  const sendNextQuestion = async (sj: number[]) => {
    questionsAskedRef.current += 1;
    // check if finished
    // (handled after showing question)
    let p = pool;
    if (p.length === 0) {
      try { p = await fetchJuzs(sj); setPool(p); } catch { return; }
    }
    const q = buildQuestion(p, questionTime, testType);
    if (!q) return;
    setCurrentQuestion(q);
    setLockedBy(null);
    setMyAnswer(null);
    setOnlineAnswered([]);
    setOnlineRevealed(false);
    answeredRef.current = false;
    setTimeLeft(q.timeLimit);
    broadcast("question", { question: q });
  };

  const submitAnswer = (option: string) => {
    if (!currentQuestion || myAnswer) return;
    const correct = option === currentQuestion.answer;
    broadcast("answer", {
      name,
      correct,
      choice: option,
      prompt: currentQuestion.prompt,
      answer: currentQuestion.answer,
    });
    setPlayers((prev) => prev.map((p) => p.name === name ? { ...p, score: p.score + (correct ? 1 : -1) } : p));
    setReviewLog((prev) => [
      ...prev,
      { q: currentQuestion.prompt, answer: currentQuestion.answer, name, choice: option, correct },
    ]);
    setMyAnswer(correct ? "correct" : "wrong");
    answeredRef.current = true;
    // كل لاعب يجيب على نفس السؤال دون سباق؛ الإجابة الصحيحة تُعرض بعد إجابة الجميع.
    setOnlineAnswered((prev) => {
      const next = prev.includes(name) ? prev : [...prev, name];
      if (next.length >= players.length) setOnlineRevealed(true);
      return next;
    });
  };

  // ينقل السؤال تلقائيًا بعد كشف الإجابة لجميع اللاعبين (المضيف فقط).
  useEffect(() => {
    if (phase !== "playing" || !onlineRevealed) return;
    const isHost = players[0]?.name === name;
    if (!isHost) return;
    const timer = window.setTimeout(() => {
      if (questionsAskedRef.current >= totalQuestions) endChallenge();
      else sendNextQuestion(sharedJuzs);
    }, 2500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, onlineRevealed]);

  const endChallenge = () => {
    if (channelRef.current) {
      const sb = getSupabase();
      sb?.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    playNotificationSound("transition");
    setPhase("result");
  };

  const toggleLocalJuz = (juz: number) => {
    setLocalError("");
    setLocalJuzs((prev) => {
      if (prev.includes(juz)) return prev.length === 1 ? prev : prev.filter((x) => x !== juz);
      return [...prev, juz].sort((a, b) => a - b);
    });
  };
  const selectAllLocalJuzs = () => setLocalJuzs(Array.from({ length: 30 }, (_, v) => v + 1));

  const startLocalMatch = async () => {
    if (localKinds.length === 0) {
      setLocalError("اختر نوع سؤال واحدًا على الأقل.");
      return;
    }
    setLocalLoading(true);
    setLocalError("");
    try {
      const data = await fetchJuzs(localJuzs);
      const localBuilt = buildLocalQuestions(data, localKinds, localCount, localQuestionTime);
      // الذكاء الاصطناعي يختار أسئلة متنوعة غير مكررة، والمحلي يكمّل عند تعذّره.
      const byNumber = new Map(data.map((ayah) => [ayah.number, ayah]));
      const aiGenerated = await Promise.race([
        generateQuestionsWithAi({
        accountId: account.id,
        count: localCount,
        kinds: localKinds.filter((kind) => kind !== "mixed") as string[],
        context: data
          .slice(0, 40)
          .map((ayah) => `${ayah.number}|${ayah.surahName}|${ayah.numberInSurah}|ج${ayah.juz}|${ayah.text}`)
          .join("\n"),
        level: `لاعبون: ${localPlayerCount}`,
        extraNotes: "",
        kindsGuide:
          "\n- surah: اذكر الآية واطلب اسم السورة.\n- complete: اذكر أول الآية واطلب إكمالها.\n- juz: اذكر الآية واطلب رقم الجزء.\n- truefalse: خياران صح/خطأ بنسبة صحيحة أو خاطئة.",
        }),
        new Promise<Awaited<ReturnType<typeof generateQuestionsWithAi>>>((resolve) => setTimeout(() => resolve([]), 9000)),
      ]);
      const aiBuilt: Question[] = aiGenerated
        .map((item, position) => {
          const ayah = byNumber.get(item.ayah ?? 0) ?? data[position % data.length];
          if (!ayah) return null;
          return {
            id: `ai-local-${position}-${ayah.number}`,
            prompt: item.prompt,
            options: item.options,
            answer: item.answer,
            ayah,
            timeLimit: localQuestionTime,
          } satisfies Question;
        })
        .filter((question): question is Question => Boolean(question));
      const usedPrompts = new Set(aiBuilt.map((question) => question.prompt.trim()));
      const built = [...aiBuilt, ...localBuilt.filter((question) => !usedPrompts.has(question.prompt.trim()))].slice(0, localCount);
      if (built.length === 0) {
        setLocalError("الآيات المتاحة في هذه الأجزاء قليلة. جرّب أجزاء أخرى.");
        return;
      }
      const emptyAnswers = Array.from({ length: localPlayerCount }, () => null as string | null);
      answersRef.current = emptyAnswers;
      revealedRef.current = false;
      turnRef.current = 0;
      setLocalTurn(0);
      setLocalTimes(Array.from({ length: localPlayerCount }, () => localQuestionTime));
      setLocalQuestions(built);
      setLocalIndex(0);
      setLocalAnswers(emptyAnswers);
      setLocalScores(Array.from({ length: localPlayerCount }, () => 0));
      setLocalLog([]);
      setLocalRevealed(false);
      setPhase("localPlay");
    } catch {
      setLocalError("تعذّر تحميل الآيات. تحقق من الإنترنت.");
    } finally {
      setLocalLoading(false);
    }
  };

  const revealLocal = () => {
    if (revealedRef.current) return;
    const q = localQuestions[localIndex];
    if (!q) return;
    revealedRef.current = true;
    const choices = [...answersRef.current];
    const correct = choices.map((choice) => choice === q.answer);
    setLocalScores((prev) => prev.map((value, position) => value + (correct[position] ? 1 : 0)));
    setLocalLog((prev) => [
      ...prev,
      { prompt: q.prompt, answer: q.answer, choices: choices.map((choice) => choice ?? "لم يجب"), correct },
    ]);
    setLocalRevealed(true);
    window.setTimeout(() => {
      if (phaseRef.current !== "localPlay") return;
      if (localIndex + 1 >= localQuestions.length) {
        setPhase("localResult");
        return;
      }
      const emptyAnswers = Array.from({ length: localPlayerCount }, () => null as string | null);
      answersRef.current = emptyAnswers;
      revealedRef.current = false;
      turnRef.current = 0;
      setLocalTurn(0);
      setLocalTimes(Array.from({ length: localPlayerCount }, () => localQuestionTime));
      setLocalAnswers(emptyAnswers);
      setLocalRevealed(false);
      setLocalIndex((i) => i + 1);
    }, 2000);
  };

  const answerLocal = (playerIndex: number, option: string) => {
    if (revealedRef.current || answersRef.current[playerIndex]) return;
    if (playerIndex !== turnRef.current) return; // دور لاعب واحد فقط
    answersRef.current[playerIndex] = option;
    setLocalAnswers([...answersRef.current]);
    if (playerIndex + 1 < localPlayerCount) {
      turnRef.current = playerIndex + 1;
      setLocalTurn(playerIndex + 1);
    } else {
      revealLocal();
    }
  };

  const endLocalMatch = () => {
    const q = localQuestions[localIndex];
    if (q && !revealedRef.current) {
      revealedRef.current = true;
      const choices = [...answersRef.current];
      if (choices.every((choice) => !choice)) {
        setPhase("localResult");
        return;
      }
      const correct = choices.map((choice) => choice === q.answer);
      setLocalScores((prev) => prev.map((value, position) => value + (correct[position] ? 1 : 0)));
      setLocalLog((prev) => [
        ...prev,
        { prompt: q.prompt, answer: q.answer, choices: choices.map((choice) => choice ?? "لم يجب"), correct },
      ]);
    }
    setPhase("localResult");
  };

  // وقت منفصل لكل لاعب: يجري فقط لصاحب الدور.
  useEffect(() => {
    if (phase !== "localPlay" || localRevealed) return;
    const timer = window.setInterval(() => {
      setLocalTimes((prev) => {
        const next = [...prev];
        next[turnRef.current] = Math.max(0, (next[turnRef.current] ?? 0) - 1);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, localIndex, localRevealed, localTurn]);

  // انتهاء وقت صاحب الدور: ينقل الدور أو يكشف الإجابة.
  useEffect(() => {
    if (phase !== "localPlay" || localRevealed) return;
    if ((localTimes[localTurn] ?? 0) > 0) return;
    if (localTurn + 1 < localPlayerCount) {
      turnRef.current = localTurn + 1;
      setLocalTurn(localTurn + 1);
    } else {
      revealLocal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTimes, localTurn, phase, localRevealed, localPlayerCount]);

  const awardedRef = useRef(false);

  // نقاط وصوت عند عرض نتيجة التحدي وجهاً لوجه.
  useEffect(() => {
    if (phase !== "localResult" || awardedRef.current) return;
    awardedRef.current = true;
    const myScore = localScores[0] ?? 0;
    const best = localScores.reduce((max, value) => Math.max(max, value), 0);
    const win = myScore >= best;
    addPoints(account.id, win ? 5 : 2);
    playNotificationSound(win ? "success" : "info");
  }, [phase, localScores]);

  // نقاط وصوت عند نتيجة التحدي الأونلاين.
  useEffect(() => {
    if (phase !== "result" || awardedRef.current) return;
    awardedRef.current = true;
    const mine = players.find((player) => player.name === name)?.score ?? 0;
    const best = players.reduce((max, player) => Math.max(max, player.score), 0);
    addPoints(account.id, mine > 0 && mine >= best ? 5 : 2);
  }, [phase, players]);

  if (phase === "menu") {
    return (
      <div className="page challenge-page">
        <div className="challenge-hero">
          <h2>تحدّي</h2>
          <p>تحدَّ صديقك على نفس الجهاز أو أونلاين. اختر الأجزاء وأنواع الأسئلة والوقت، والفائز من يجمع أعلى نقاط.</p>
        </div>
        <div className="challenge-modes">
          <button type="button" className="challenge-mode is-primary" onClick={() => setPhase("localSetup")}>
            <span className="challenge-mode-icon">👥</span>
            <strong>وجهاً لوجه</strong>
            <span>لاعبان إلى ستة على نفس الجهاز، دور لكل لاعب.</span>
          </button>
          <button type="button" className="challenge-mode" onClick={() => setQuickConfigOpen(true)}>
            <span className="challenge-mode-icon">⚡</span>
            <strong>بحث سريع</strong>
            <span>خصم عشوائي خلال ١٢ ثانية، وإن لم يوجد تبدأ مباراة مع الذكاء.</span>
          </button>
          <button type="button" className="challenge-mode" onClick={() => setPhase("create")}>
            <span className="challenge-mode-icon">🔗</span>
            <strong>إنشاء غرفة</strong>
            <span>شارك رمز الغرفة مع صديق واللعب معًا.</span>
          </button>
          <button type="button" className="challenge-mode" onClick={() => setPhase("join")}>
            <span className="challenge-mode-icon">🚪</span>
            <strong>الانضمام برمز</strong>
            <span>لديك رمز غرفة من صديق؟ انضمّ مباشرة.</span>
          </button>
        </div>
        <p className="challenge-note">
          نقاط التحدي تُضاف إلى رصيدك في التطبيق، وتشمل أسئلة «ترتيب الكلمات» في التحدي وجهاً لوجه.
        </p>
        {quickConfigOpen ? (
          <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="challenge-modal">
              <h3>إعدادات التحدي (أونلاين)</h3>
              <p className="muted">سيُطبَّق في الاختبار مع زميلك:</p>
              <ul style={{ paddingInlineStart: 18 }}>
                <li>الأجزاء المختارة (جزء واحد يكفي)</li>
                <li>عدد الأسئلة ({questionCount})</li>
                <li>مدة كل سؤال ({questionTime} ث)</li>
                <li>نوع الاختبار: {testType === "mixed" ? "مختلط" : testType === "surah" ? "سورة الآية" : testType === "complete" ? "إكمال" : testType === "juz" ? "جزء الآية" : "صح/خطأ"}</li>
                <li>النقاط: +1 للصحيح، -1 للخطأ</li>
                <li>السؤال يُقفل لمن يضغط أولاً</li>
              </ul>
              <div className="setup-block">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h4>الأجزاء (يمكن اختيار الكل)</h4>
                  <button type="button" className="chip-toggle" onClick={selectAllJuzs}>تحديد الكل</button>
                </div>
                <div className="juz-grid">
                  {Array.from({ length: 30 }, (_, v) => v + 1).map((j) => (
                    <button key={j} type="button" className={`juz-chip ${juzs.includes(j) ? "active" : ""}`} onClick={() => toggleJuz(j)}>{j}</button>
                  ))}
                </div>
              </div>
              <label style={{ display: "block", marginTop: 8 }}>
                <span>عدد الأسئلة</span>
                <select value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))}>
                  {[3, 5, 7, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label style={{ display: "block", marginTop: 8 }}>
                <span>مدة كل سؤال (ث)</span>
                <select value={questionTime} onChange={(e) => setQuestionTime(Number(e.target.value))}>
                  {[10, 15, 20, 25, 30].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label style={{ display: "block", marginTop: 8 }}>
                <span>نوع الاختبار</span>
                <select value={testType} onChange={(e) => setTestType(e.target.value)}>
                  <option value="mixed">مختلط</option>
                  <option value="surah">سورة الآية</option>
                  <option value="complete">إكمال الآية</option>
                  <option value="juz">جزء الآية</option>
                  <option value="truefalse">صح/خطأ</option>
                </select>
              </label>
              <div className="form-actions" style={{ marginTop: 12 }}>
                <button type="button" className="ghost-button" onClick={() => setQuickConfigOpen(false)}>إلغاء</button>
                <button type="button" className="primary-button" onClick={() => { setQuickConfigOpen(false); setShowInfo(true); }}>متابعة</button>
              </div>
            </div>
          </div>
        ) : null}
        {showInfo ? (
          <div style={{ position: "fixed", inset: 0, zIndex: 1001, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="challenge-modal">
              <h3>قبل البدء — ماذا ستفعل؟</h3>
              <ol style={{ paddingInlineStart: 18 }}>
                <li>سيُبحث عن لاعب آخر (12 ث). إن لم يوجد، تلعب مع AI.</li>
                <li>أسئلة من الآيات في الأجزاء المختارة.</li>
                <li>اضغط "جاهز" (press) أولاً لقفل السؤال، ثم اختر الإجابة.</li>
                <li>كل سؤال has a time limit; بعد انتهاء الوقت ينتقل للسؤال التالي.</li>
                <li>الفائز من يحصل على أعلى نقاط.</li>
              </ol>
              <p className="muted">إذا كانت هذه أول مرة، جرّب مع AI أولاً.</p>
              <div className="form-actions" style={{ marginTop: 12 }}>
                <button type="button" className="ghost-button" onClick={() => setShowInfo(false)}>رجوع</button>
                <button type="button" className="primary-button" onClick={() => { setShowInfo(false); startQuickMatch(); }}>ابدأ البحث</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (phase === "searching") {
    return (
      <div className="page">
        <div className="page-head"><h2>جارٍ البحث عن خصم…</h2></div>
        <SectionCard title="المطابقة الفورية">
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div className="recording-dot" aria-hidden="true" />
            <p style={{ fontSize: 40, margin: "8px 0" }}>{searchLeft}</p>
            <p className="muted">
              ننتظر لاعبًا آخر. إن انتهى العداد ستبدأ مباراة وهمية مع الذكاء الاصطناعي
              تلقائيًا.
            </p>
          </div>
          <div className="form-actions">
            <button type="button" className="ghost-button" onClick={cancelSearch}>إلغاء البحث</button>
          </div>
        </SectionCard>
      </div>
    );
  }

  if (phase === "create") {
    return (
      <div className="page">
        <div className="page-head"><h2>إنشاء غرفة</h2><button type="button" className="ghost-button" onClick={() => setPhase("menu")}>رجوع</button></div>
        <SectionCard title="الإعداد">
          <label><span>اسمك</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="setup-block">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4>الأجزاء (يمكن اختيار الكل)</h4>
              <button type="button" className="chip-toggle" onClick={selectAllJuzs}>تحديد الكل</button>
            </div>
            <div className="juz-grid">
              {Array.from({ length: 30 }, (_, v) => v + 1).map((j) => (
                <button key={j} type="button" className={`juz-chip ${juzs.includes(j) ? "active" : ""}`} onClick={() => toggleJuz(j)}>{j}</button>
              ))}
            </div>
          </div>
          <label style={{ display: "block", marginTop: 8 }}>
            <span>عدد الأسئلة</span>
            <select value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))}>
              {[3, 5, 7, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label style={{ display: "block", marginTop: 8 }}>
            <span>مدة كل سؤال (ث)</span>
            <select value={questionTime} onChange={(e) => setQuestionTime(Number(e.target.value))}>
              {[10, 15, 20, 25, 30].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={{ display: "block", marginTop: 8 }}>
            <span>نوع الاختبار</span>
            <select value={testType} onChange={(e) => setTestType(e.target.value)}>
              <option value="mixed">مختلط</option>
              <option value="surah">سورة الآية</option>
              <option value="complete">إكمال الآية</option>
              <option value="juz">جزء الآية</option>
              <option value="truefalse">صح/خطأ</option>
            </select>
          </label>
          {error ? <p className="game-error">{error}</p> : null}
          <button type="button" className="primary-button" onClick={createRoom} disabled={loading}>{loading ? "جارٍ…" : "إنشاء"}</button>
        </SectionCard>
      </div>
    );
  }

  if (phase === "join") {
    return (
      <div className="page">
        <div className="page-head"><h2>الانضمام لغرفة</h2><button type="button" className="ghost-button" onClick={() => setPhase("menu")}>رجوع</button></div>
        <SectionCard title="الانضمام">
          <label><span>اسمك</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label><span>رمز الغرفة</span><input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="ABC123" /></label>
          {error ? <p className="game-error">{error}</p> : null}
          <button type="button" className="primary-button" onClick={joinRoom} disabled={loading}>{loading ? "جارٍ…" : "انضمام"}</button>
        </SectionCard>
      </div>
    );
  }

  if (phase === "lobby") {
    const isHost = players.length > 0 && players[0].name === name;
    return (
      <div className="page">
        <div className="page-head"><h2>غرفة {roomCode}</h2><button type="button" className="ghost-button" onClick={() => setPhase("menu")}>خروج</button></div>
        <SectionCard title="اللاعبون" subtitle={`${players.length} مشارك`}>
          <div className="connection-list">
            {players.map((p) => (
              <div key={p.name} className="connection-row"><span>{p.name}</span><span className="status-ok">متصل</span></div>
            ))}
          </div>
          {searchNote ? <p className="success">{searchNote}</p> : null}
          <p className="muted">شارك الرمز {roomCode} مع صديقك. عندما ينضم، ابدأ التحدّي.</p>
          {isHost ? (
            <button type="button" className="primary-button" onClick={startChallenge} disabled={players.length < 2 || loading}>
              {loading ? "جارٍ…" : "بدء التحدّي"}
            </button>
          ) : (
            <p className="muted">في انتظار المضيف لبدء التحدّي…</p>
          )}
        </SectionCard>
      </div>
    );
  }

  if (phase === "playing" && currentQuestion) {
    return (
      <div className="page">
        <div className="game-topbar">
          <div className="game-progress">التحدّي • {timeLeft}ث • أجاب {onlineAnswered.length}/{players.length}</div>
        </div>
        <div className="question-card">
          <p className="question-prompt" style={{ whiteSpace: "pre-line" }}>{currentQuestion.prompt}</p>
          <p className="muted">كل لاعب يجيب على نفس السؤال في وقت واحد — لا سباق ولا حاجة للاستعجال. تُعرض الإجابة الصحيحة بعد إجابة الجميع.</p>
          {!myAnswer ? (
            <div className="options-grid">
              {currentQuestion.options.map((opt) => (
                <button key={opt} type="button" className="option-button" onClick={() => submitAnswer(opt)}>{opt}</button>
              ))}
            </div>
          ) : null}
          {myAnswer ? <p className={myAnswer === "correct" ? "success" : "danger"}>{myAnswer === "correct" ? "إجابة صحيحة! +1" : "إجابة خاطئة! −1"}</p> : null}
          {onlineRevealed ? (
            <p className="success" style={{ fontWeight: 800, marginTop: 10 }}>الإجابة الصحيحة: {currentQuestion.answer}</p>
          ) : null}
        </div>
        <SectionCard title="لوحة المتصدرين">
          <div className="leaderboard">
            {[...players].sort((a, b) => b.score - a.score).map((p) => (
              <div key={p.name} className="connection-row"><span>{p.name}</span><strong>{p.score}</strong></div>
            ))}
          </div>
        </SectionCard>
        <div className="form-actions">
          <button type="button" className="ghost-button" onClick={endChallenge}>إنهاء</button>
          <button type="button" className="primary-button" onClick={() => sendNextQuestion(sharedJuzs)}>سؤال جديد</button>
        </div>
      </div>
    );
  }

  if (phase === "result") {
    return (
      <div className="page">
        <SectionCard title="النتائج">
          <div className="leaderboard">
            {[...players].sort((a, b) => b.score - a.score).map((p, i) => (
              <div key={p.name} className="connection-row"><span>{i + 1}. {p.name}</span><strong>{p.score}</strong></div>
            ))}
          </div>
          {reviewLog.length ? (
            <>
              <h4 style={{ marginTop: 16 }}>إجابات اللاعبين</h4>
              <div style={{ display: "grid", gap: 10 }}>
                {reviewLog.map((row, i) => (
                  <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                    <p className="muted" style={{ margin: 0, whiteSpace: "pre-line" }}>{row.q}</p>
                    <p style={{ margin: "6px 0", color: "var(--primary)", fontWeight: 700 }}>الصحيح: {row.answer}</p>
                    <p style={{ margin: 0, fontSize: 13 }}>{row.name}: {row.choice} {row.correct ? "✓" : "✗"}</p>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <button type="button" className="primary-button" onClick={() => setPhase("menu")}>القائمة</button>
        </SectionCard>
      </div>
    );
  }

  if (phase === "localSetup") {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h2>تحدي وجهاً لوجه</h2>
            <p className="muted">من لاعبين إلى ستة على نفس الجهاز. يجيب كل لاعب في دوره، ولا يرى إجابة غيره حتى يجيب الجميع ثم تُعرض الإجابة الصحيحة.</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setPhase("menu")}>رجوع</button>
        </div>
        <SectionCard title="إعداد التحدي">
          <label style={{ display: "block", marginBottom: 10 }}>
            <span>عدد اللاعبين</span>
            <select
              value={localPlayerCount}
              onChange={(e) => {
                const count = Number(e.target.value);
                setLocalPlayerCount(count);
                setLocalNames((prev) => {
                  const next = [...prev];
                  while (next.length < count) next.push(`لاعب ${next.length + 1}`);
                  return next.slice(0, count);
                });
              }}
            >
              {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} لاعبين</option>)}
            </select>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {localNames.map((playerName, position) => (
              <label key={position}>
                <span>اسم اللاعب {position + 1}</span>
                <input
                  value={playerName}
                  onChange={(e) => setLocalNames((prev) => prev.map((value, index) => (index === position ? e.target.value : value)))}
                />
              </label>
            ))}
          </div>
          <div className="setup-block">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4>الأجزاء <span className="muted">({localJuzs.length} محددة — يمكن اختيار الكل)</span></h4>
              <button type="button" className="chip-toggle" onClick={selectAllLocalJuzs}>تحديد الكل</button>
            </div>
            <div className="juz-grid">
              {Array.from({ length: 30 }, (_, v) => v + 1).map((juz) => (
                <button key={juz} type="button" className={`juz-chip ${localJuzs.includes(juz) ? "active" : ""}`} onClick={() => toggleLocalJuz(juz)}>{juz}</button>
              ))}
            </div>
          </div>
          <div className="setup-block">
            <h4>أنواع الأسئلة <span className="muted">({localKinds.length} محددة)</span></h4>
            <p className="muted" style={{ marginBottom: 8 }}>اضغط على النوع لتحديده (أخضر)، واضغط مرة أخرى لإلغاء التحديد. الإجابات كلها من الأجزاء المختارة فقط.</p>
            <div className="question-kinds-grid">
              {LOCAL_KINDS.map((kind) => (
                <button
                  key={kind.id}
                  type="button"
                  className={`question-kind-chip ${localKinds.includes(kind.id) ? "active" : ""}`}
                  onClick={() => setLocalKinds((prev) => (prev.includes(kind.id) ? prev.filter((x) => x !== kind.id) : [...prev, kind.id]))}
                >
                  {kind.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <label>
              <span>عدد الأسئلة</span>
              <select value={localCount} onChange={(e) => setLocalCount(Number(e.target.value))}>
                {[4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label>
              <span>وقت كل سؤال (ث)</span>
              <select value={localQuestionTime} onChange={(e) => setLocalQuestionTime(Number(e.target.value))}>
                {[10, 15, 20, 25, 30, 45].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          {localError ? <p className="game-error">{localError}</p> : null}
          <button type="button" className="primary-button" style={{ marginTop: 12 }} onClick={startLocalMatch} disabled={localLoading}>
            {localLoading ? "جارٍ التحضير…" : "ابدأ التحدي"}
          </button>
        </SectionCard>
      </div>
    );
  }

  if (phase === "localPlay" && localQuestions[localIndex]) {
    const q = localQuestions[localIndex];
    const players = localNames.slice(0, localPlayerCount).map((playerName, index) => ({
      index,
      name: playerName || `اللاعب ${index + 1}`,
      score: localScores[index] ?? 0,
    }));
    return (
      <div className="page">
        <div className="game-topbar">
          <div className="game-progress">
            تحدي • سؤال {localIndex + 1}/{localQuestions.length} • دور: {players[localTurn]?.name ?? "—"} • {localTimes[localTurn] ?? 0}ث
          </div>
        </div>
        <div className="question-card" style={{ textAlign: "center" }}>
          <p className="question-prompt" style={{ whiteSpace: "pre-line" }}>{q.prompt}</p>
          {localRevealed ? (
            <p className="success" style={{ fontWeight: 800 }}>الإجابة الصحيحة: {q.answer}</p>
          ) : null}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {players.map((player) => {
            const chosen = localAnswers[player.index];
            const isTurn = localTurn === player.index && !localRevealed && !chosen;
            const dimmed = !isTurn && !chosen && !localRevealed;
            return (
              <div
                key={player.index}
                className="question-card"
                style={{
                  borderTop: `4px solid ${isTurn ? "var(--success)" : "var(--primary)"}`,
                  opacity: dimmed ? 0.45 : 1,
                  boxShadow: isTurn ? "0 0 0 2px color-mix(in srgb, var(--success) 40%, transparent)" : undefined,
                  transition: "opacity 0.2s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong>{player.name}</strong>
                  <span className="muted">{player.score} نقطة • {localTimes[player.index] ?? 0}ث</span>
                </div>
                <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                  {localRevealed ? (chosen ? "إجابته" : "لم يجب") : isTurn ? "دورك الآن — اختر إجابة" : chosen ? "تمّت إجابته — انتهى دوره" : "بانتظار دوره"}
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  {q.words?.length && !localRevealed ? (
                    isTurn ? (
                      <WordOrderBoard
                        key={`${localIndex}-${player.index}`}
                        words={q.words}
                        answer={q.answer.split(/\s+/).filter(Boolean)}
                        onCheck={(_correct, arranged) => answerLocal(player.index, arranged.join(" "))}
                        disabled={localRevealed}
                        resetKey={localIndex}
                      />
                    ) : (
                      <p className="muted">بانتظار دوره…</p>
                    )
                  ) : null}
                  {q.options.map((option) => {
                    // لا نكشف اختيار أي لاعب قبل أن يجيب الجميع.
                    const isChosen = localRevealed && chosen === option;
                    const isAnswer = localRevealed && option === q.answer;
                    const isWrong = localRevealed && isChosen && option !== q.answer;
                    return (
                      <button
                        key={option}
                        type="button"
                        className={isAnswer ? "success-button" : isWrong ? "danger-button" : isChosen ? "primary-button" : "ghost-button"}
                        style={{ textAlign: "center" }}
                        onClick={() => answerLocal(player.index, option)}
                        disabled={Boolean(chosen) || localRevealed || player.index !== localTurn}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="form-actions" style={{ marginTop: 12 }}>
          {!localRevealed ? (
            <button type="button" className="ghost-button" onClick={revealLocal}>
              اكشف الإجابة وانتقل
            </button>
          ) : null}
          <button type="button" className="danger-button" onClick={endLocalMatch}>
            إنهاء التحدي وعرض النتيجة
          </button>
        </div>
      </div>
    );
  }

  if (phase === "localResult") {
    const ranked = localNames
      .slice(0, localPlayerCount)
      .map((playerName, index) => ({ name: playerName || `اللاعب ${index + 1}`, score: localScores[index] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const topScore = ranked[0]?.score ?? 0;
    const winners = ranked.filter((player) => player.score === topScore);
    return (
      <div className="page">
        <SectionCard title="نتيجة التحدي">
          <div className="leaderboard">
            {ranked.map((player, position) => (
              <div key={`${player.name}-${position}`} className="connection-row">
                <span>{position + 1}. {player.name}</span><strong>{player.score}</strong>
              </div>
            ))}
          </div>
          <p className="success" style={{ fontWeight: 800, marginTop: 8 }}>
            {winners.length > 1 ? `تعادل بين ${winners.map((player) => player.name).join("، ")}!` : `${winners[0]?.name ?? "—"} فاز!`}
          </p>
          <h4 style={{ marginTop: 16 }}>مراجعة إجابات اللاعبين</h4>
          <div style={{ display: "grid", gap: 10 }}>
            {localLog.map((row, i) => (
              <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                <p className="muted" style={{ margin: 0, whiteSpace: "pre-line" }}>{i + 1}. {row.prompt}</p>
                <p style={{ margin: "6px 0", color: "var(--primary)", fontWeight: 700 }}>الصحيح: {row.answer}</p>
                <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
                  {row.choices.map((choice, playerIndex) => (
                    <span key={playerIndex}>
                      {localNames[playerIndex] || `اللاعب ${playerIndex + 1}`}: {choice} {row.correct[playerIndex] ? "✓" : "✗"}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button type="button" className="primary-button" onClick={() => setPhase("localSetup")}>تحدٍ جديد</button>
            <button type="button" className="ghost-button" onClick={() => setPhase("menu")}>القائمة</button>
          </div>
        </SectionCard>
      </div>
    );
  }

  return <EmptyState title="جارٍ التحميل…" body="" />;
}