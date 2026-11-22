/*
 * طبقة تقييم التسميع الخاصة بثمار — مستقلة عن محرك التعرّف.
 *
 * المحرك (Quran ASR Small أو Tilawa) يعطي كلمات منطوقة مع احتمال كل كلمة.
 * هذه الطبقة تقارنها بنص المصحف المرجعي (رسم عثماني) وتستنتج:
 *   - كلمة ناقصة (omission)
 *   - استبدال خاطئ (substitution)
 *   - كلمة أو آية مكرّرة (repetition)
 *   - ترتيب مقلوب (reorder)
 *   - انتقال خاطئ بين الآيات (verse_transition)
 *   - السورة والآية وموضع الكلمة بدقة
 *
 * ولا تعتمد على النص وحده: كل حكم يُصنَّف «مؤكد» أو «مشكوك فيه» بحسب
 * احتمال الكلمات الصوتية حول الموضع (CTC confidence)، فلا نعلن خطأ حفظ
 * بسبب خطأ تعرّف محتمل.
 */

export type AssessmentRefWord = {
  /** نص الكلمة من المصحف (بتشكيله). */
  text: string;
  /** صورة الكلمة للمقارنة (رسم عثماني بلا تشكيل). */
  normalized: string;
  surah: number;
  ayah: number;
  /** موضع الكلمة داخل الآية، يبدأ من 1. */
  word: number;
  /** الرقم العام للآية في المصحف. */
  global: number;
};

export type AssessmentKind =
  | "match"
  | "substitution"
  | "omission"
  | "insertion"
  | "repetition"
  | "reorder";

export type AssessmentItem = {
  kind: AssessmentKind;
  /** الكلمة المرجعية (تغيب عند الإدراج). */
  ref?: AssessmentRefWord;
  /** ما نُطق فعليًا (يغيب عند الحذف). */
  spoken?: string;
  /** متوسط احتمال الكلمات المنطوقة المرتبطة بالحكم (0..1). */
  confidence: number;
  /** هل الحكم موثوق بما يكفي لإعلانه خطأ؟ */
  certain: boolean;
  startMs?: number;
  endMs?: number;
};

export type VerseTransitionKind = "sequential" | "jump" | "repeat" | "backward";

export type VerseTransition = {
  from: { surah: number; ayah: number };
  to: { surah: number; ayah: number };
  kind: VerseTransitionKind;
  certain: boolean;
};

export type RecitationAssessment = {
  items: AssessmentItem[];
  counts: Record<AssessmentKind, number>;
  /** أخطاء مؤكدة فقط (بحسب ثقة الصوت). */
  confirmedErrors: number;
  /** مشكوك فيها: تحتاج إعادة سماع أو تسجيل أوضح. */
  uncertain: number;
  /** نسبة الكلمات الصحيحة من الكلمات المرجعية المطلوبة. */
  accuracy: number;
  /** نسبة الكلمات المرجعية التي ظهرت في التسجيل. */
  coverage: number;
  surah: number | null;
  ayahFrom: number | null;
  ayahTo: number | null;
  transitions: VerseTransition[];
  repeatedVerses: { surah: number; ayah: number; count: number }[];
  /** متوسط ثقة المحرك على كل الكلمات. */
  meanConfidence: number;
  text: string;
};

/* ------------------------------------------------------------------ */
/* تطبيع النص إلى رسم النموذج العثماني                                 */
/* ------------------------------------------------------------------ */

/* تشكيل وعلامات المصحف: حركات، تنوين، ألف خنجرية، علامات الوقف، تطويل. */
const QURAN_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/**
 * يزيل التشكيل وعلامات المصحف ويوحّد الحروف، فيصير النصان (المصحف والنموذج)
 * قابلين للمقارنة. النموذج يكتب رسمًا عثمانيًا بلا تشكيل، مثل:
 * «ٱلْكِتَٰبُ» ← «الكتب»، و«ٱلسَّمَٰوَٰتِ» ← «السموت»، و«سِنَةٌ» ← «سنه».
 */
export function normalizeQuranAsrText(text: string): string {
  return text
    .normalize("NFC")
    .replace(QURAN_MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/[^\u0621-\u064A]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeQuranAsrWord(word: string): string {
  return normalizeQuranAsrText(word).replace(/ /g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost));
    }
    previous = current;
  }
  return previous[b.length];
}

/** نسبة الاختلاف بين كلمتين (0 = متطابقتان). */
export function wordDifference(a: string, b: string): number {
  if (!a || !b) return 1;
  if (a === b) return 0;
  return levenshtein(a, b) / Math.max(a.length, b.length);
}

/** عتبة القبول: خطأ حرف واحد في الكلمات القصيرة، و25% في الطويلة. */
export function wordsEquivalent(spoken: string, expected: string): boolean {
  const a = normalizeQuranAsrWord(spoken);
  const b = normalizeQuranAsrWord(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  const distance = levenshtein(a, b);
  if (distance <= 1) return true;
  return wordDifference(a, b) <= 0.25;
}

/* ------------------------------------------------------------------ */
/* بناء الكلمات المرجعية                                               */
/* ------------------------------------------------------------------ */

export type AssessmentAyah = {
  surah: number;
  ayah: number;
  global: number;
  text: string;
};

/** يحوّل آيات المصحف إلى كلمات مرجعية مرقّمة (سورة/آية/موضع الكلمة). */
export function buildReferenceWords(ayahs: AssessmentAyah[]): AssessmentRefWord[] {
  const words: AssessmentRefWord[] = [];
  for (const ayah of ayahs) {
    const parts = ayah.text.split(/\s+/).filter(Boolean);
    parts.forEach((text, index) => {
      const normalized = normalizeQuranAsrWord(text);
      if (!normalized) return;
      words.push({
        text,
        normalized,
        surah: ayah.surah,
        ayah: ayah.ayah,
        word: index + 1,
        global: ayah.global,
      });
    });
  }
  return words;
}

/* ------------------------------------------------------------------ */
/* المحاذاة                                                            */
/* ------------------------------------------------------------------ */

type AlignmentOp = "match" | "substitution" | "omission" | "insertion";

type AlignmentCell = { cost: number; op: AlignmentOp };

type SpokenWord = { text: string; startMs?: number; endMs?: number; confidence?: number };

const OMISSION_COST = 1.05;
const INSERTION_COST = 1;

function substitutionCost(spoken: string, expected: string): number {
  const a = normalizeQuranAsrWord(spoken);
  const b = expected;
  if (!a) return 1;
  if (a === b) return 0;
  const distance = levenshtein(a, b);
  const ratio = distance / Math.max(a.length, b.length);
  if (distance <= 1 || ratio <= 0.2) return 0.15; // اختلاف إملائي/تعرّف طفيف
  return Math.min(1, 0.45 + ratio * 0.55);
}

/**
 * محاذاة كلمات منطوقة مع كلمات مرجعية. نطاق محاذاة (band) يُبقي التكلفة
 * خطية تقريبًا في السور الطويلة، مع نافذة واسعة تكفي للتكرار والقفز.
 */
function align(spoken: SpokenWord[], expected: AssessmentRefWord[]): AlignmentCell[] {
  const n = spoken.length;
  const m = expected.length;
  if (n === 0) return expected.map(() => ({ cost: OMISSION_COST, op: "omission" as AlignmentOp }));
  if (m === 0) return spoken.map(() => ({ cost: INSERTION_COST, op: "insertion" as AlignmentOp }));

  const width = Math.max(40, Math.ceil(Math.abs(n - m)) + 24);
  const ratio = m / n;
  let previous = new Float64Array(m + 1);
  let current = new Float64Array(m + 1);
  const pointers: AlignmentOp[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill("match"));
  for (let j = 1; j <= m; j += 1) {
    previous[j] = j * OMISSION_COST;
    pointers[0][j] = "omission";
  }
  for (let i = 1; i <= n; i += 1) {
    const center = i * ratio;
    const lo = Math.max(1, Math.floor(center - width));
    const hi = Math.min(m, Math.ceil(center + width));
    current.fill(Number.POSITIVE_INFINITY);
    current[0] = i * INSERTION_COST;
    pointers[i][0] = "insertion";
    for (let j = lo; j <= hi; j += 1) {
      const cost = substitutionCost(spoken[i - 1].text, expected[j - 1].normalized);
      const diagonal = previous[j - 1] + cost;
      /* الصعود (i-1): كلمة منطوقة بلا نظير مرجعي = إدراج/تكرار. */
      const up = previous[j] + INSERTION_COST;
      /* اليسار (j-1): كلمة مرجعية بلا نطق = حذف/نقص. */
      const left = current[j - 1] + OMISSION_COST;
      let best = diagonal;
      let op: AlignmentOp = cost === 0 ? "match" : "substitution";
      if (up < best) {
        best = up;
        op = "insertion";
      }
      if (left < best) {
        best = left;
        op = "omission";
      }
      current[j] = best;
      pointers[i][j] = op;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  const result: AlignmentCell[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const op = pointers[i][j] as AlignmentOp;
      const cost = op === "match" || op === "substitution"
        ? substitutionCost(spoken[i - 1].text, expected[j - 1].normalized)
        : op === "omission"
          ? OMISSION_COST
          : INSERTION_COST;
      result.push({ cost, op });
      if (op === "omission") j -= 1;
      else if (op === "insertion") i -= 1;
      else {
        i -= 1;
        j -= 1;
      }
    } else if (i > 0) {
      result.push({ cost: INSERTION_COST, op: "insertion" });
      i -= 1;
    } else {
      result.push({ cost: OMISSION_COST, op: "omission" });
      j -= 1;
    }
  }
  /* النتيجة الآن خطوات من النهاية إلى البداية: نعيد ترتيبها مع ربط كل خطوة بموضعيها. */
  result.reverse();
  return result;
}

function stepPositions(ops: AlignmentCell[], n: number, m: number): { i: number | null; j: number | null }[] {
  const positions: { i: number | null; j: number | null }[] = [];
  let i = 0;
  let j = 0;
  for (const step of ops) {
    if (step.op === "insertion") {
      positions.push({ i, j: null });
      i += 1;
    } else if (step.op === "omission") {
      positions.push({ i: null, j });
      j += 1;
    } else {
      positions.push({ i, j });
      i += 1;
      j += 1;
    }
  }
  if (i !== n || j !== m) {
    /* احتياط: نطابق ما تبقّى خطيًا حتى لا يفقد التقييم كلمات. */
    while (i < n) {
      positions.push({ i, j: j < m ? j : null });
      i += 1;
      if (j < m) j += 1;
    }
    while (j < m) {
      positions.push({ i: null, j });
      j += 1;
    }
  }
  return positions;
}

/* ------------------------------------------------------------------ */
/* التقييم                                                             */
/* ------------------------------------------------------------------ */

const CERTAIN_CONFIDENCE = 0.45;
const STRONG_CONFIDENCE = 0.6;

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * يقيّم تسميعًا مقابل كلمات مرجعية.
 *
 * @param reference كلمات المصحف بالترتيب.
 * @param spoken كلمات المحرك (نص + احتمال + زمن).
 */
export function assessRecitation(
  reference: AssessmentRefWord[],
  spoken: SpokenWord[],
): RecitationAssessment {
  const ops = align(spoken, reference);
  const positions = stepPositions(ops, spoken.length, reference.length);

  const items: AssessmentItem[] = [];

  ops.forEach((step, index) => {
    const position = positions[index];
    const spokenWord = position.i === null ? undefined : spoken[position.i];
    const refWord = position.j === null ? undefined : reference[position.j];
    const confidence = spokenWord?.confidence ?? 0;
    if (step.op === "match") {
      items.push({
        kind: "match",
        ref: refWord,
        spoken: spokenWord?.text,
        confidence,
        certain: true,
        startMs: spokenWord?.startMs,
        endMs: spokenWord?.endMs,
      });
      return;
    }
    items.push({
      kind: step.op,
      ref: refWord,
      spoken: spokenWord?.text,
      confidence,
      /* الحذف لا كلمة منطوقة له: الثقة تُقدَّر لاحقًا من الجوار. */
      certain: step.op !== "omission" && confidence >= CERTAIN_CONFIDENCE,
      startMs: spokenWord?.startMs,
      endMs: spokenWord?.endMs,
    });
  });

  /*
   * 0) قلب الترتيب: محاذاة DP لا تستطيع تمثيل تبديل كلمتين بعملية واحدة،
   * فتُظهره استبدالين. نكتشفه هنا: استبدالان متتاليان يصيران مطابقين لو
   * عُكس ترتيبهما.
   */
  for (let index = 0; index + 1 < items.length; index += 1) {
    const first = items[index];
    const second = items[index + 1];
    if (first.kind !== "substitution" || second.kind !== "substitution") continue;
    if (!first.ref || !second.ref || !first.spoken || !second.spoken) continue;
    if (
      wordsEquivalent(first.spoken, second.ref.normalized) &&
      wordsEquivalent(second.spoken, first.ref.normalized)
    ) {
      first.kind = "reorder";
      second.kind = "reorder";
      first.certain = first.confidence >= CERTAIN_CONFIDENCE;
      second.certain = second.confidence >= CERTAIN_CONFIDENCE;
    }
  }

  /* 1) التكرار: كلمة زائدة تشبه كلمة سبق نطقها أو الكلمة المرجعية السابقة. */
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== "insertion" || !item.spoken) continue;
    const normalized = normalizeQuranAsrWord(item.spoken);
    if (!normalized) continue;
    for (let back = index - 1, seen = 0; back >= 0 && seen < 4; back -= 1) {
      const previous = items[back];
      if (previous.kind === "match" || previous.kind === "substitution" || previous.kind === "repetition") {
        seen += 1;
        const previousWord = normalizeQuranAsrWord(previous.spoken ?? previous.ref?.text ?? "");
        if (previousWord && wordsEquivalent(normalized, previousWord)) {
          item.kind = "repetition";
          item.ref = previous.ref;
          item.certain = item.confidence >= CERTAIN_CONFIDENCE;
          break;
        }
      }
    }
  }

  /* 2) إعادة الترتيب: مواضع مرجعية متطابقة تتراجع تراجعًا صغيرًا. */
  const matchedRefs = items.filter((item) => item.kind === "match" && item.ref);
  for (let index = 1; index < matchedRefs.length; index += 1) {
    const currentRef = matchedRefs[index].ref as AssessmentRefWord;
    const previousRef = matchedRefs[index - 1].ref as AssessmentRefWord;
    if (currentRef.global < previousRef.global) {
      const gap = previousRef.word - currentRef.word;
      if (gap > 0 && gap <= 3) {
        matchedRefs[index - 1].kind = "reorder";
        matchedRefs[index].kind = "reorder";
      }
    }
  }

  /* 3) ثقة الحذف من الجوار: لا نتّهم القارئ إن كان المحرك نفسه غير واثق. */
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== "omission") continue;
    const neighbours: number[] = [];
    for (let back = index - 1; back >= 0 && neighbours.length < 3; back -= 1) {
      if (items[back].kind !== "omission") neighbours.push(items[back].confidence);
    }
    for (let ahead = index + 1; ahead < items.length && neighbours.length < 6; ahead += 1) {
      if (items[ahead].kind !== "omission") neighbours.push(items[ahead].confidence);
    }
    const local = mean(neighbours);
    item.confidence = local;
    item.certain = local >= STRONG_CONFIDENCE;
  }

  /* 4) انتقالات الآيات: تسلسل، قفز، رجوع، أو تكرار آية. */
  const transitions: VerseTransition[] = [];
  const verseVisits = new Map<string, number>();
  for (const item of matchedRefs) {
    const ref = item.ref as AssessmentRefWord;
    const key = `${ref.surah}:${ref.ayah}`;
    verseVisits.set(key, (verseVisits.get(key) ?? 0) + 1);
  }
  for (let index = 1; index < matchedRefs.length; index += 1) {
    const previous = matchedRefs[index - 1].ref as AssessmentRefWord;
    const current = matchedRefs[index].ref as AssessmentRefWord;
    if (previous.ayah === current.ayah && previous.surah === current.surah) continue;
    let kind: VerseTransitionKind = "sequential";
    if (current.surah === previous.surah && current.ayah === previous.ayah + 1) kind = "sequential";
    else if (current.surah === previous.surah + 1 && current.ayah === 1) kind = "sequential";
    else if (current.surah === previous.surah && current.ayah === previous.ayah) kind = "repeat";
    else if (
      current.surah < previous.surah ||
      (current.surah === previous.surah && current.ayah < previous.ayah)
    ) {
      kind = "backward";
    } else {
      kind = "jump";
    }
    const confidence = mean([matchedRefs[index - 1].confidence, matchedRefs[index].confidence]);
    transitions.push({
      from: { surah: previous.surah, ayah: previous.ayah },
      to: { surah: current.surah, ayah: current.ayah },
      kind,
      certain: confidence >= CERTAIN_CONFIDENCE,
    });
  }

  const repeatedVerses = Array.from(verseVisits.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [surah, ayah] = key.split(":").map(Number);
      return { surah, ayah, count };
    });

  const counts: Record<AssessmentKind, number> = {
    match: 0,
    substitution: 0,
    omission: 0,
    insertion: 0,
    repetition: 0,
    reorder: 0,
  };
  for (const item of items) counts[item.kind] += 1;

  const confirmedErrors = items.filter(
    (item) => item.kind !== "match" && item.certain,
  ).length + transitions.filter((transition) => transition.kind !== "sequential" && transition.certain).length;
  const uncertain = items.filter((item) => item.kind !== "match" && !item.certain).length;

  const required = reference.length || 1;
  const located = counts.match + counts.substitution + counts.reorder;
  const first = matchedRefs[0]?.ref;
  const last = matchedRefs[matchedRefs.length - 1]?.ref;

  return {
    items,
    counts,
    confirmedErrors,
    uncertain,
    accuracy: Math.max(0, Math.min(1, 1 - (counts.substitution + counts.omission) / required)),
    coverage: located / required,
    surah: first?.surah ?? null,
    ayahFrom: first?.ayah ?? null,
    ayahTo: last?.ayah ?? null,
    transitions,
    repeatedVerses,
    meanConfidence: mean(spoken.map((word) => word.confidence ?? 0)),
    text: spoken.map((word) => word.text).join(" "),
  };
}

/** يبني الكلمات المرجعية من آيات حفص ويقيّم تسميعًا في خطوة واحدة. */
export function assessRecitationAgainstAyahs(
  ayahs: AssessmentAyah[],
  spoken: SpokenWord[],
): RecitationAssessment {
  return assessRecitation(buildReferenceWords(ayahs), spoken);
}
