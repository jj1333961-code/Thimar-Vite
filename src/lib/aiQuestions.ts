import { aiChat } from "./ai";

export type AiQuestion = {
  kind: string;
  prompt: string;
  options: string[];
  answer: string;
  hint?: string;
  /** رقم الآية العام إن أمكن ربط السؤال بآية من السياق. */
  ayah?: number;
};

const MEMORY_KEY = "thimar.ai.memory.v1";
const MEMORY_LIMIT = 120;

type Memory = { prompts: string[]; at: number };

function memoryStorageKey(accountId?: string) {
  return accountId ? `${MEMORY_KEY}.${accountId}` : MEMORY_KEY;
}

/** الأسئلة التي ظهرت للمستخدم مؤخرًا، لتجنّب تكرارها. */
export function loadQuestionMemory(accountId?: string): string[] {
  try {
    const raw = localStorage.getItem(memoryStorageKey(accountId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Memory | string[];
    const prompts = Array.isArray(parsed) ? parsed : parsed.prompts;
    return Array.isArray(prompts) ? prompts.filter((item) => typeof item === "string").slice(0, MEMORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberQuestions(prompts: string[], accountId?: string): void {
  try {
    const merged = [...new Set([...prompts, ...loadQuestionMemory(accountId)])].slice(0, MEMORY_LIMIT);
    const payload: Memory = { prompts: merged, at: Date.now() };
    localStorage.setItem(memoryStorageKey(accountId), JSON.stringify(payload));
  } catch {
    // التخزين ممتلئ أو محجوب: نتجاهل.
  }
}

export function questionFingerprint(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim().slice(0, 90);
}

export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function extractJsonArray(content: string): unknown[] | null {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * يطلب من الذكاء الاصطناعي مجموعة أسئلة متنوعة بمستوى مناسب، متجنّبًا ما ظهر سابقًا.
 * يعيد [] عند تعذّر الاتصال حتى يستخدم التطبيق بنكه المحلي دون أن يتعطّل.
 */
export async function generateQuestionsWithAi(options: {
  accountId?: string;
  count: number;
  kinds: string[];
  context: string;
  level?: string;
  difficulty?: "easy" | "normal" | "hard";
  scopeText?: string;
  extraNotes?: string;
  kindsGuide?: string;
}): Promise<AiQuestion[]> {
  const {
    accountId,
    count,
    kinds,
    context,
    level = "متوسط",
    difficulty = "normal",
    scopeText = "",
    kindsGuide = "",
  } = options;
  if (count <= 0 || kinds.length === 0 || !context.trim()) return [];
  const avoid = [...new Set([...loadQuestionMemory(accountId), ...(options.extraNotes ? [] : [])])].slice(0, 30);
  const avoidText = avoid.length ? `\nلا تعد أي سؤال من هذه الأسئلة السابقة:\n- ${avoid.join("\n- ")}` : "";

  const prompt = `أنت مولّد أسئلة قرآنية ذكي لتطبيق «ثمار» التعليمي. مهمتك اختيار وتأليف أسئلة ${kinds.length ? kinds.join(", ") : "متنوعة"} للمستخدم.
مستوى المستخدم: ${level}. درجة الصعوبة المطلوبة اليوم: ${difficulty === "hard" ? "متقدم ومتنوع" : difficulty === "easy" ? "سهل ومشجّع" : "متوسط متدرّج"}.
عدد الأسئلة: ${count}.
قواعد إلزامية:
- لا تكرر سؤالًا ولا آية مرتين داخل المجموعة.
- ابتعد عن الأسئلة التقليدية الضعيفة، ونوّع الصياغة (إكمال، استخراج حكم، ربط بالمعنى، ترتيب، تمييز خطأ شائع).
- اعتمد على الآيات المرفقة فقط، ولا تخرج عن نطاقها.
- لكل سؤال 4 خيارات (إلا صح/خطأ فخياران)، وخيار واحد صحيح مكتوب حرفيًا كما في الخيارات، والباقي خاطئ لكنه قريب ومقنع.
- اجعل اللغة عربية فصحى واضحة مناسبة للطالب.${avoidText}
${scopeText}${kindsGuide}
أرجع JSON فقط بهذه الصيغة:
[{"kind":"...","ayah":<رقم الآية العام من القائمة أو 0>,"prompt":"...","options":["..."],"answer":"...","hint":"..."}]

الآيات:
${context}`;

  try {
    const content = await aiChat([{ role: "user", content: prompt }], {
      temperature: 0.85,
      maxTokens: Math.min(1200, 240 + count * 90),
    });
    const arr = extractJsonArray(content);
    if (!arr) return [];
    const questions: AiQuestion[] = [];
    for (const raw of arr) {
      const item = raw as Record<string, unknown>;
      const promptText = String(item.prompt ?? "").trim();
      const kind = String(item.kind ?? kinds[0] ?? "general").trim();
      const options = Array.isArray(item.options)
        ? (item.options as unknown[]).map((option) => String(option).trim()).filter(Boolean)
        : [];
      const answer = String(item.answer ?? "").trim();
      if (!promptText || options.length < 2 || !options.includes(answer)) continue;
      if (questions.some((question) => questionFingerprint(question.prompt) === questionFingerprint(promptText))) continue;
      questions.push({
        kind,
        prompt: promptText,
        options: [...new Set(options)].slice(0, 4),
        answer,
        hint: item.hint ? String(item.hint) : undefined,
        ayah: Number(item.ayah) > 0 ? Number(item.ayah) : undefined,
      });
      if (questions.length >= count) break;
    }
    if (questions.length > 0) rememberQuestions(questions.map((question) => questionFingerprint(question.prompt)), accountId);
    return questions;
  } catch {
    return [];
  }
}

export type AiPlanSuggestion = {
  perSession: number;
  days: number;
  summary: string;
  tips: string[];
};

/** خطة حفظ مرنة يقترحها الذكاء الاصطناعي بحسب المستوى والوقت المتاح. */
export async function suggestPlanWithAi(input: {
  accountId?: string;
  surah: string;
  fromAyah: number;
  totalAyahs: number;
  level?: string;
  minutes: number;
}): Promise<AiPlanSuggestion | null> {
  const { surah, fromAyah, totalAyahs, level = "مبتدئ", minutes } = input;
  const remaining = Math.max(1, totalAyahs - fromAyah + 1);
  const prompt = `أنت مدرّب حفظ قرآن. اقترح خطة حفظ عملية ومرنة.
السورة: ${surah} | الآية الأولى: ${fromAyah} | الآيات المتبقية: ${remaining} | مستوى المستخدم: ${level} | الوقت اليومي: ${minutes} دقيقة.
اجعل الجرعة اليومية مناسبة للمستوى والوقت، وحدد عدد الأيام، واكتب جملة تحفيزية قصيرة وثلاث نصائح عملية (تكرار، مراجعة، ربط).
أرجع JSON فقط: {"perSession":<عدد الآيات في الجلسة>,"days":<عدد الأيام>,"summary":"...","tips":["...","...","..."]}`;
  try {
    const content = await aiChat([{ role: "user", content: prompt }], { temperature: 0.6, maxTokens: 400 });
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    const perSession = Math.max(1, Math.min(20, Math.round(Number(parsed.perSession) || 3)));
    const days = Math.max(1, Math.min(400, Math.round(Number(parsed.days) || Math.ceil(remaining / perSession))));
    const tips = Array.isArray(parsed.tips) ? (parsed.tips as unknown[]).map((tip) => String(tip)).filter(Boolean).slice(0, 4) : [];
    return {
      perSession,
      days,
      summary: String(parsed.summary ?? "").trim() || `خطة على ${days} يومًا بمقدار ${perSession} آية يوميًا.`,
      tips,
    };
  } catch {
    return null;
  }
}
