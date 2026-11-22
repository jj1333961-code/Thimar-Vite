import { normalizeArabic, type Ayah } from "./quran";

export type RecitationWord = {
  word: string;
  status: "matched" | "missing";
};

export type RecitationComparison = {
  expectedText: string;
  transcript: string;
  accuracy: number;
  matched: number;
  total: number;
  diff: RecitationWord[];
  missingWords: string[];
  extraWords: string[];
};

function wordsOf(text: string): string[] {
  return text.split(/\s+/).map((word) => word.trim()).filter(Boolean);
}

/**
 * مقارنة نصية بين الآية المتوقعة وما التقطه التعرف على الكلام.
 * لا تحلّل المخارج أو أحكام التجويد صوتيًا.
 */
export function compareRecitation(
  expectedText: string,
  transcript: string,
): RecitationComparison {
  const expectedWords = wordsOf(expectedText);
  const spokenWords = wordsOf(transcript);
  const expectedNorm = expectedWords.map((word) => normalizeArabic(word));
  const spokenNorm = spokenWords.map((word) => normalizeArabic(word));

  const rows = expectedNorm.length + 1;
  const cols = spokenNorm.length + 1;
  const dp = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] =
        expectedNorm[i - 1] === spokenNorm[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const matchedExpected = new Set<number>();
  const matchedSpoken = new Set<number>();
  let i = expectedNorm.length;
  let j = spokenNorm.length;
  while (i > 0 && j > 0) {
    if (expectedNorm[i - 1] === spokenNorm[j - 1]) {
      matchedExpected.add(i - 1);
      matchedSpoken.add(j - 1);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  const diff: RecitationWord[] = expectedWords.map((word, index) => ({
    word,
    status: matchedExpected.has(index) ? "matched" : "missing",
  }));
  const missingWords = diff
    .filter((item) => item.status === "missing")
    .map((item) => item.word);
  const extraWords = spokenWords.filter((_, index) => !matchedSpoken.has(index));

  const total = expectedWords.length;
  return {
    expectedText,
    transcript,
    accuracy: total === 0 ? 0 : Math.round((matchedExpected.size / total) * 100),
    matched: matchedExpected.size,
    total,
    diff,
    missingWords,
    extraWords,
  };
}

export type RecitationCandidate = {
  ayah: Ayah;
  words: string[];
};

export type IdentifiedRecitation = {
  ayah: Ayah;
  score: number;
  matched: number;
  total: number;
  coverage: number;
  confidence: "high" | "medium" | "low";
  comparison: RecitationComparison;
};

/** يهيّئ مرشحي الآيات مرة واحدة حتى لا نكرر تنظيف النص عند كل محاولة تسميع. */
function normalizeRecitationWord(word: string): string {
  // الرسم العثماني يستخدم الألف الخنجرية، والتعرف الآلي يعيد الألف الطويلة.
  // نطبيع الألفين معًا حتى تُطابق «أعطينك» و«أعطيناك» و«الرحمن» و«الرحمان».
  return normalizeArabic(word)
    .replace(/\u0670/g, "ا")
    .replace(/ا/g, "");
}

function recitationWords(text: string): string[] {
  return text.split(/\s+/).map(normalizeRecitationWord).filter(Boolean);
}

export function buildRecitationCandidates(ayahs: Ayah[]): RecitationCandidate[] {
  return ayahs
    .map((ayah) => ({
      ayah,
      words: recitationWords(ayah.text),
    }))
    .filter((candidate) => candidate.words.length >= 2);
}

function longestCommonSubsequence(first: string[], second: string[]): number {
  if (!first.length || !second.length) return 0;
  let previous = new Array<number>(second.length + 1).fill(0);
  for (let i = 1; i <= first.length; i += 1) {
    const current = new Array<number>(second.length + 1).fill(0);
    for (let j = 1; j <= second.length; j += 1) {
      current[j] =
        first[i - 1] === second[j - 1]
          ? previous[j - 1] + 1
          : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return previous[second.length];
}

function clampScore(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

/**
 * يتعرّف على الآية من التلاوة نفسها، ثم يعيد تقييم النطق من 1 إلى 10.
 * يعتمد على تطابق الكلمات بعد تنظيف التشكيل، ولا يعرض الآية قبل السماع.
 */
export function identifyRecitation(
  transcript: string,
  candidates: RecitationCandidate[],
): IdentifiedRecitation | null {
  const spoken = recitationWords(transcript);
  if (!spoken.length || !candidates.length) return null;

  let best: RecitationCandidate | null = null;
  let bestMatched = 0;
  let bestRank = -1;
  let bestCoverage = 0;
  let bestPrecision = 0;

  for (const candidate of candidates) {
    const matched = longestCommonSubsequence(candidate.words, spoken);
    if (matched < 2) continue;
    const coverage = matched / candidate.words.length;
    const precision = matched / spoken.length;
    const firstWordBonus = candidate.words[0] === spoken[0] ? 0.08 : 0;
    const rank = coverage * 0.72 + precision * 0.2 + firstWordBonus;
    if (rank > bestRank) {
      best = candidate;
      bestMatched = matched;
      bestRank = rank;
      bestCoverage = coverage;
      bestPrecision = precision;
    }
  }

  // لا نعتبر آية واحدة مشتركة تعرفًا ناجحًا؛ نطلب تطابقًا واضحًا من كلمتين على الأقل.
  if (!best || bestMatched < 2 || bestCoverage < 0.34 || bestPrecision < 0.25) return null;

  const extraWords = Math.max(0, spoken.length - bestMatched);
  const score = clampScore(bestCoverage * 10 - Math.min(2.5, (extraWords / Math.max(1, spoken.length)) * 4));
  const confidence: IdentifiedRecitation["confidence"] =
    bestCoverage >= 0.8 && bestPrecision >= 0.7
      ? "high"
      : bestCoverage >= 0.55
        ? "medium"
        : "low";

  return {
    ayah: best.ayah,
    score,
    matched: bestMatched,
    total: best.words.length,
    coverage: bestCoverage,
    confidence,
    comparison: compareRecitation(best.ayah.text, transcript),
  };
}
