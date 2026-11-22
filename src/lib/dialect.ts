/**
 * تمييز اللهجة العربية من نص منطوق (نتائج تحويل الكلام إلى نص).
 * يعتمد على كلمات دالة شائعة في كل لهجة بعد تطبيع النص، ويعيد ثقة تقديرية.
 */

export type DialectId = "egy" | "gulf" | "levant" | "hijazi" | "msa";

export type DialectResult = {
  id: DialectId;
  name: string;
  confidence: number;
  hits: number;
  samples: number;
};

export const DIALECT_NAMES: Record<DialectId, string> = {
  egy: "مصرية",
  gulf: "خليجية",
  levant: "شامية",
  hijazi: "حجازية",
  msa: "فصحى",
};

const MARKERS: Record<Exclude<DialectId, "msa">, string[]> = {
  egy: [
    "دلوقتي", "ازاي", "ايه", "ايه", "كده", "مش", "عايز", "عاوزه", "بتاع", "بتاعت",
    "لسه", "خلاص", "يلا", "بص", "طيب", "جامد", "خالص", "علشان", "معلش", "حاجة", "كمان",
  ],
  gulf: [
    "وش", "وشلون", "شلون", "كذا", "كيذا", "الحين", "هالحين", "عشان", "زين", "ابغى",
    "تبغى", "مره", "واجد", "شوي", "اقول", "وشهو", "هذاك", "ترى", "يبيله", "دحين",
  ],
  levant: [
    "شو", "هيك", "منيح", "كتير", "هلق", "هلا", "ليش", "بدي", "بدها", "عنجد",
    "شوي", "هون", "هناك", "كيفك", "شو هاد", "بكرا", "هلقيت", "تاني", "كتير",
  ],
  hijazi: [
    "ايش", "ايش", "دحين", "زي", "عشان", "ابغى", "مرة", "كيف", "حلو", "خلاص",
    "طيب", "بس", "هنا", "كده", "امس", "بكرة", "اللي", "الحي", "جدة", "مكة",
  ],
};

function normalize(text: string): string {
  return text
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0621-\u064A\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * يحلّل مجموعة عيّنات (كل ما سمعه النظام في الجلسة) ويعيد اللهجة الأقرب.
 * كل كلمة دالة تُحسب مرة واحدة لكل عيّنة حتى لا تتضخّم الكلمة المكرّرة.
 */
export function detectDialect(samples: string[]): DialectResult {
  const all = normalize(samples.join(" \n "));
  if (!all) return { id: "msa", name: DIALECT_NAMES.msa, confidence: 0, hits: 0, samples: samples.length };

  const counts: Record<string, number> = { egy: 0, gulf: 0, levant: 0, hijazi: 0 };
  for (const sample of samples) {
    const norm = ` ${normalize(sample)} `;
    (Object.keys(MARKERS) as Exclude<DialectId, "msa">[]).forEach((id) => {
      MARKERS[id].forEach((word) => {
        if (norm.includes(` ${normalize(word)} `)) counts[id] += 1;
      });
    });
  }

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [bestId, bestHits] = ranked[0];
  const totalHits = ranked.reduce((sum, [, n]) => sum + n, 0);
  if (bestHits === 0 || totalHits === 0) {
    return { id: "msa", name: DIALECT_NAMES.msa, confidence: 0.4, hits: 0, samples: samples.length };
  }
  const confidence = Math.min(0.95, 0.45 + (bestHits / Math.max(4, totalHits)) * 0.5);
  return {
    id: bestId as DialectId,
    name: DIALECT_NAMES[bestId as DialectId],
    confidence,
    hits: bestHits,
    samples: samples.length,
  };
}

/** نصوص توجيه قصيرة تُعرض للمستخدم حسب اللهجة المكتشفة. */
export function dialectTip(id: DialectId): string {
  switch (id) {
    case "egy":
      return "لهجتك مصرية — التسميع يتسامح مع نطق «ق/ء» و«ج» المصرية، اقرأ ببطء مع التشكيل.";
    case "gulf":
      return "لهجتك خليجية — التسميع يتسامح مع إبدال «ق» بـ«گ» و«ك» بـ«ch» ما دامت الكلمة واضحة.";
    case "levant":
      return "لهجتك شامية — التسميع يتسامح مع المدّ والإمالة الشامية في أواخر الكلمات.";
    case "hijazi":
      return "لهجتك حجازية — التسميع يتسامح مع النطق الحجازي للهمزات و«ث/ذ».";
    default:
      return "تسميعك بالفصحى — أحسنت، وحافظ على التشكيل وأواخر الكلمات.";
  }
}
