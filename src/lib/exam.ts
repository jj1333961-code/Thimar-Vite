import { surahs } from "../data/surahs";
import type { Ayah } from "./quran";
import { normalizeArabic, wordsOf } from "./quran";

export type ExamKind = "student" | "teacher";

export type ChoiceQuestion = {
  type: "choice";
  id: string;
  prompt: string;
  text?: string;
  options: string[];
  answer: number;
  topic: string;
};

export type OrderQuestion = {
  type: "order";
  id: string;
  prompt: string;
  words: string[];
  answer: string[];
  topic: string;
};

export type Question = ChoiceQuestion | OrderQuestion;

export type ExamAnswer = number | string[] | null;

export type ExamResult = {
  id: string;
  accountId: string;
  kind: ExamKind;
  score: number;
  total: number;
  percent: number;
  level: string;
  suggestedLevel: string;
  takenAt: number;
};

const RESULTS_KEY = "thimar.exams.v1";
const SEEN_KEY = "thimar.exams.seen.v1";

function seenStorageKey(accountId?: string) {
  return accountId ? `${SEEN_KEY}.${accountId}` : SEEN_KEY;
}

export function loadSeenAyahs(accountId?: string): Set<number> {
  try {
    const raw = localStorage.getItem(seenStorageKey(accountId));
    const parsed = raw ? (JSON.parse(raw) as number[]) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function rememberSeenAyahs(questions: Question[], accountId?: string): void {
  try {
    const numbers = questions
      .map((question) => Number(question.id.split(":")[1]))
      .filter((value) => Number.isFinite(value) && value > 0);
    const merged = [...loadSeenAyahs(accountId), ...numbers].slice(-4000);
    localStorage.setItem(seenStorageKey(accountId), JSON.stringify(merged));
  } catch {
    // تجاهل امتلاء التخزين.
  }
}

export const LEVELS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12"];

export function examConfig(kind: ExamKind, level: string) {
  if (kind === "teacher") {
    return { count: 12, seconds: 12 * 40 };
  }
  const number = Number(level.replace("A", "")) || 1;
  // Higher levels: more questions, stricter time per question.
  const count = Math.min(12, 6 + Math.floor(number / 2));
  const perQuestion = Math.max(30, 60 - number * 2);
  return { count, seconds: count * perQuestion };
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function distinctOptions(
  correct: string,
  pool: string[],
  count: number,
): string[] | null {
  const seen = new Set([normalizeArabic(correct)]);
  const picks: string[] = [];
  for (const candidate of shuffle(pool)) {
    const key = normalizeArabic(candidate);
    if (!candidate || seen.has(key)) continue;
    seen.add(key);
    picks.push(candidate);
    if (picks.length === count) break;
  }
  if (picks.length < count) return null;
  const options = shuffle([correct, ...picks]);
  return options;
}

function choiceQuestion(
  id: string,
  prompt: string,
  text: string | undefined,
  correct: string,
  distractors: string[],
  topic: string,
): ChoiceQuestion | null {
  const options = distinctOptions(correct, distractors, 3);
  if (!options) return null;
  return {
    type: "choice",
    id,
    prompt,
    text,
    options,
    answer: options.indexOf(correct),
    topic,
  };
}

const teacherKnowledge: Array<Omit<ChoiceQuestion, "id" | "type">> = [
  {
    prompt: "كم عدد القراءات المتواترة؟",
    options: ["عشر قراءات", "سبع قراءات", "أربع عشرة قراءة", "خمس قراءات"],
    answer: 0,
    topic: "القراءات",
  },
  {
    prompt: "من الإمام الذي روى عنه حفص؟",
    options: ["عاصم الكوفي", "نافع المدني", "ابن كثير المكي", "أبو عمرو البصري"],
    answer: 0,
    topic: "القراءات",
  },
  {
    prompt: "من الراوي الذي يروي عن نافع المدني؟",
    options: ["ورش", "شعبة", "قنبل", "خلاد"],
    answer: 0,
    topic: "القراءات",
  },
  {
    prompt: "كم عدد أجزاء القرآن الكريم؟",
    options: ["ثلاثون جزءًا", "عشرون جزءًا", "ستون جزءًا", "أربعون جزءًا"],
    answer: 0,
    topic: "علوم القرآن",
  },
  {
    prompt: "في أي سورة آية الكرسي؟",
    options: ["البقرة", "آل عمران", "النساء", "الأنعام"],
    answer: 0,
    topic: "علوم القرآن",
  },
  {
    prompt: "كم عدد سور القرآن الكريم؟",
    options: ["١١٤ سورة", "١٠٤ سور", "١٢٠ سورة", "١٠٠ سورة"],
    answer: 0,
    topic: "علوم القرآن",
  },
];

function buildTeacherKnowledge(count: number): ChoiceQuestion[] {
  return shuffle(teacherKnowledge)
    .slice(0, count)
    .map((question, index) => ({
      ...question,
      type: "choice" as const,
      id: `knowledge:${index}:${question.topic}`,
      options: [...question.options],
    }));
}

function questionTypes(level: string): string[] {
  const number = Number(level.replace("A", "")) || 1;
  if (number <= 2) return ["surah", "tf", "order", "complete"];
  if (number <= 4) return ["surah", "complete", "order", "next", "tf"];
  if (number <= 7) return ["complete", "next", "surah", "order", "tf", "complete"];
  if (number <= 9) return ["complete", "next", "next", "order", "complete", "complete"];
  return ["complete", "next", "next", "complete", "complete", "order"];
}

function buildQuestion(
  type: string,
  ayah: Ayah,
  pool: Ayah[],
  byKey: Map<string, Ayah>,
  idSuffix: string,
): Question | null {
  const words = wordsOf(ayah.text);
  if (words.length < 3) return null;

  if (type === "surah") {
    const fallbackNames = surahs
      .map((item) => item.name)
      .filter((name) => name !== ayah.surahName);
    const distractors = shuffle([
      ...new Set(pool.map((item) => item.surahName).filter((name) => name !== ayah.surahName)),
      ...fallbackNames,
    ]).slice(0, 3);
    if (distractors.length < 3) return null;
    return choiceQuestion(
      `surah:${ayah.number}:${idSuffix}`,
      "من أي سورة هذه الآية؟",
      ayah.text,
      ayah.surahName,
      distractors,
      "معرفة السورة",
    );
  }

  if (type === "tf") {
    const useWrong = Math.random() < 0.5;
    const otherNames = shuffle([
      ...new Set(pool.map((item) => item.surahName).filter((name) => name !== ayah.surahName)),
    ]);
    if (otherNames.length === 0) return null;
    const claimed = useWrong && otherNames.length > 0 ? otherNames[0] : ayah.surahName;
    const options = useWrong
      ? ["نعم، من هذه السورة", "لا، ليست منها"]
      : ["نعم، من هذه السورة", "لا، ليست منها"];
    return {
      type: "choice",
      id: `tf:${ayah.number}:${idSuffix}`,
      prompt: `هل هذه الآية من سورة ${claimed}؟`,
      text: ayah.text,
      options,
      answer: useWrong ? 1 : 0,
      topic: "دقة النسبة",
    };
  }

  if (type === "next") {
    const next = byKey.get(`${ayah.surah}:${ayah.numberInSurah + 1}`);
    if (!next) return null;
    const nextWords = wordsOf(next.text);
    if (nextWords.length > 14) return null;
    const distractors = shuffle(
      pool
        .filter((item) => item.number !== next.number && item.number !== ayah.number)
        .filter((item) => {
          const length = wordsOf(item.text).length;
          return length >= Math.max(2, nextWords.length - 5) && length <= nextWords.length + 6;
        })
        .map((item) => item.text),
    ).slice(0, 3);
    if (distractors.length < 3) return null;
    return choiceQuestion(
      `next:${ayah.number}:${idSuffix}`,
      "ما الآية التي تلي هذه الآية؟",
      ayah.text,
      next.text,
      distractors,
      "ترتيب الآيات",
    );
  }

  if (type === "complete") {
    if (words.length < 5) return null;
    const cut = Math.max(2, Math.floor(words.length / 2));
    const rest = words.slice(cut);
    if (rest.length < 2) return null;
    const correct = rest.join(" ");
    const distractors = shuffle(
      pool
        .filter((item) => item.number !== ayah.number)
        .map((item) => {
          const itemWords = wordsOf(item.text);
          if (itemWords.length < 4) return "";
          const itemCut = Math.max(2, Math.floor(itemWords.length / 2));
          return itemWords.slice(itemCut).join(" ");
        })
        .filter(Boolean),
    ).slice(0, 3);
    if (distractors.length < 3) return null;
    return choiceQuestion(
      `complete:${ayah.number}:${idSuffix}`,
      "أكمل الآية:",
      `${words.slice(0, cut).join(" ")} …`,
      correct,
      distractors,
      "إكمال الآيات",
    );
  }

  if (type === "order") {
    if (words.length < 4) return null;
    const picked = words.slice(0, Math.min(6, words.length));
    const answer = picked;
    return {
      type: "order",
      id: `order:${ayah.number}:${idSuffix}`,
      prompt: "رتّب الكلمات الأولى من الآية بالترتيب الصحيح:",
      words: shuffle(answer),
      answer,
      topic: "ترتيب الكلمات",
    };
  }

  return null;
}

export function buildExam(
  ayahs: Ayah[],
  level: string,
  kind: ExamKind,
  count: number,
  seen: Set<number> = new Set(),
): Question[] {
  const number = Number(level.replace("A", "")) || 1;
  // Higher levels use longer ayahs.
  const minWords = number <= 3 ? 3 : number <= 7 ? 5 : 8;
  const maxWords = number <= 3 ? 12 : number <= 7 ? 20 : 40;
  const clean = ayahs.filter((ayah) => {
    const w = wordsOf(ayah.text).length;
    return w >= minWords && w <= maxWords;
  });
  const moderate = clean.filter((ayah) => wordsOf(ayah.text).length <= maxWords);
  const basePool = moderate.length > 24 ? moderate : clean.length > 0 ? clean : ayahs.filter((a) => wordsOf(a.text).length >= 3);
  const unseen = basePool.filter((ayah) => !seen.has(ayah.number));
  const pool = unseen.length >= count * 4 ? unseen : basePool;
  const byKey = new Map(
    pool.map((ayah) => [`${ayah.surah}:${ayah.numberInSurah}`, ayah]),
  );

  const types = shuffle(questionTypes(level));
  const questions: Question[] = [];
  const usedAyahs = new Set<number>();
  const usedIds = new Set<string>();

  if (kind === "teacher") {
    const knowledge = buildTeacherKnowledge(3);
    for (const question of knowledge) {
      questions.push(question);
      usedIds.add(question.id);
    }
  }

  let attempts = 0;
  while (questions.length < count && attempts < count * 60 && pool.length > 0) {
    attempts += 1;
    const ayah = pool[Math.floor(Math.random() * pool.length)];
    if (usedAyahs.has(ayah.number)) continue;
    // نبدّل نوع السؤال مع كل محاولة حتى لا نعلق على نوع غير قابل للتوليد
    // في نطاق ضيق (مثل سورة واحدة أو جزء قصير).
    const type = types[attempts % types.length];
    const question = buildQuestion(type, ayah, pool, byKey, String(questions.length));
    if (!question || usedIds.has(question.id)) continue;
    usedIds.add(question.id);
    usedAyahs.add(ayah.number);
    questions.push(question);
  }

  return questions;
}

export function isCorrect(question: Question, answer: ExamAnswer): boolean {
  if (answer === null || answer === undefined) return false;
  if (question.type === "choice") {
    return typeof answer === "number" && answer === question.answer;
  }
  if (!Array.isArray(answer)) return false;
  if (answer.length !== question.answer.length) return false;
  return question.answer.every((word, index) => word === answer[index]);
}

export function scoreExam(questions: Question[], answers: Record<string, ExamAnswer>) {
  const score = questions.reduce(
    (total, question) => total + (isCorrect(question, answers[question.id] ?? null) ? 1 : 0),
    0,
  );
  const percent = questions.length === 0 ? 0 : Math.round((score / questions.length) * 100);
  return { score, total: questions.length, percent };
}

export function suggestedLevel(current: string, percent: number): string {
  const index = Math.max(0, LEVELS.indexOf(current));
  if (percent >= 85) return LEVELS[Math.min(index + 1, LEVELS.length - 1)];
  if (percent < 45) return LEVELS[Math.max(index - 1, 0)];
  return LEVELS[index];
}

export function loadExamResults(): ExamResult[] {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ExamResult[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveExamResult(
  input: Omit<ExamResult, "id" | "takenAt">,
): ExamResult {
  const result: ExamResult = {
    ...input,
    id: `exam-${Math.random().toString(36).slice(2, 10)}`,
    takenAt: Date.now(),
  };
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify([result, ...loadExamResults()].slice(0, 100)));
  } catch {
    // تجاهل امتلاء التخزين.
  }
  return result;
}

export function latestExamFor(
  accountId: string,
  kind: ExamKind,
): ExamResult | undefined {
  return loadExamResults().find(
    (result) => result.accountId === accountId && result.kind === kind,
  );
}

export function answerLabel(question: Question, answer: ExamAnswer): string {
  if (question.type === "order") {
    return Array.isArray(answer) && answer.length > 0 ? answer.join(" ") : "بدون إجابة";
  }
  if (typeof answer !== "number") return "بدون إجابة";
  return question.options[answer] ?? "بدون إجابة";
}

export function correctAnswerLabel(question: Question): string {
  if (question.type === "order") return question.answer.join(" ");
  return question.options[question.answer] ?? "";
}
