import { normalizeArabic } from "./quran";

export type MatchLevel = "strict" | "lenient";

// توحيد الحروف التي يخلط فيها الناطقون واللهجات ومحرّك التعرف الصوتي.
const DIALECT_MAP: Record<string, string> = {
  "ث": "س",
  "ص": "س",
  "ذ": "ز",
  "ظ": "ز",
  "ض": "ز",
  "ط": "ت",
  "ح": "ه",
  "ة": "ه",
  "ء": "ا",
  "ئ": "ا",
  "ؤ": "ا",
  "ى": "ي",
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ٱ": "ا",
  "ق": "ك",
};

/** صورة قريبة من النطق: بلا تشكيل ولا همزات، مع توحيد حروف اللهجات. */
export function canonicalWord(word: string): string {
  const base = normalizeArabic(word);
  let mapped = "";
  for (const char of base) mapped += DIALECT_MAP[char] ?? char;
  return mapped.replace(/^ال/, "").replace(/(.)\1+/g, "$1");
}

/** صورة أكثر تسامحًا: بلا حروف المد أيضًا (تتغيّر بحسب اللهجة والسرعة). */
export function lazyWord(word: string): string {
  return canonicalWord(word).replace(/[اوي]/g, "").replace(/(.)\1+/g, "$1");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** أقل فرق ممكن بين نطق المستخدم والكلمة المتوقعة (مع مراعاة اللهجة). */
export function matchDistance(spoken: string, expected: string): number {
  const a = canonicalWord(spoken);
  const b = canonicalWord(expected);
  if (!a || !b) return 99;
  if (a === b) return 0;
  const direct = levenshtein(a, b);
  const relaxed = levenshtein(lazyWord(spoken), lazyWord(expected));
  return Math.min(direct, relaxed + 1);
}

/** عدد الحروف المسموح باختلافها بحسب الطول والمستوى. */
export function allowedFor(expected: string, level: MatchLevel): number {
  const length = Math.max(canonicalWord(expected).length, 1);
  if (level === "strict") return Math.floor(length * 0.2);
  if (length <= 4) return 1;
  if (length <= 7) return 2;
  return Math.max(2, Math.floor(length * 0.45));
}

/** مطابقة كلمة منطوقة بكلمة متوقعة بتسامح يراعي اللهجة وأخطاء المحرّك. */
export function wordMatches(spoken: string, expected: string, level: MatchLevel): boolean {
  if (!spoken || !expected) return false;
  if (normalizeArabic(spoken) === normalizeArabic(expected)) return true;
  // اختلاف حروف المدّ (قال/قال، الرحمن/الرحمان) لا يُعدّ خطأً في الكلمات الطويلة.
  if (Math.min(canonicalWord(spoken).length, canonicalWord(expected).length) >= 4 && lazyWord(spoken) === lazyWord(expected)) return true;
  if (matchDistance(spoken, expected) <= allowedFor(expected, level)) return true;
  const a = canonicalWord(spoken);
  const b = canonicalWord(expected);
  if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}
