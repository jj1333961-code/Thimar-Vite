/**
 * بحث الأحاديث عبر الإنترنت في مجموعات كبيرة (أكثر من ١٠٠٠٠ حديث) مع درجة كل حديث.
 * المصدر: fawazahmed0/hadith-api (نصوص الكتب الستة ومسند أحمد والموطأ والدارمي).
 * تُحمَّل كل مجموعة مرة واحدة وتُخزَّن في Cache Storage للاستخدام دون إنترنت بعدها.
 */

export type HadithBook = {
  id: string;
  name: string;
  /** الدرجة الافتراضية عندما لا يذكر المصدر درجة (البخاري ومسلم). */
  defaultGrade: "صحيح" | "حسن" | "غير محدد";
};

export const HADITH_BOOKS: HadithBook[] = [
  { id: "bukhari", name: "صحيح البخاري", defaultGrade: "صحيح" },
  { id: "muslim", name: "صحيح مسلم", defaultGrade: "صحيح" },
  { id: "abudawud", name: "سنن أبي داود", defaultGrade: "غير محدد" },
  { id: "tirmidhi", name: "سنن الترمذي", defaultGrade: "غير محدد" },
  { id: "nasai", name: "سنن النسائي", defaultGrade: "غير محدد" },
  { id: "ibnmajah", name: "سنن ابن ماجه", defaultGrade: "غير محدد" },
  { id: "malik", name: "موطأ مالك", defaultGrade: "غير محدد" },
  { id: "ahmed", name: "مسند أحمد", defaultGrade: "غير محدد" },
  { id: "darimi", name: "سنن الدارمي", defaultGrade: "غير محدد" },
];

export type RemoteHadith = {
  id: string;
  bookId: string;
  bookName: string;
  number: number;
  text: string;
  grade: string;
  gradeKind: "صحيح" | "حسن" | "ضعيف" | "غير محدد";
};

type RawHadith = {
  hadithnumber: number;
  text: string;
  grades?: Array<{ name?: string; grade?: string }>;
};

const CACHE = "thimar-hadith-v1";
const memory = new Map<string, RemoteHadith[]>();

function normalize(value: string): string {
  return value
    .replace(/[\u064B-\u0652\u0670\u0640\u0610-\u061A\u06D6-\u06ED]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0621-\u064A0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function gradeKindOf(raw: string, fallback: HadithBook["defaultGrade"]): RemoteHadith["gradeKind"] {
  const value = raw.toLowerCase();
  if (value.includes("صحيح") || value.includes("sahih")) return "صحيح";
  if (value.includes("حسن") || value.includes("hasan")) return "حسن";
  if (value.includes("ضعيف") || value.includes("daif") || value.includes("da'if")) return "ضعيف";
  return fallback;
}

function editionUrl(bookId: string): string {
  return `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-${bookId}.min.json`;
}

/** يحمّل مجموعة كاملة (مرة واحدة) ويعيد أحاديثها. */
export async function loadHadithBook(
  bookId: string,
  onProgress?: (message: string) => void,
): Promise<RemoteHadith[]> {
  const cached = memory.get(bookId);
  if (cached) return cached;
  const book = HADITH_BOOKS.find((item) => item.id === bookId) ?? HADITH_BOOKS[0];
  const url = editionUrl(book.id);
  onProgress?.(`جارٍ تحميل ${book.name} من الإنترنت…`);

  let payload: { hadiths?: RawHadith[] } | null = null;
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) {
      payload = (await hit.json()) as { hadiths?: RawHadith[] };
    } else {
      const response = await fetch(url);
      if (!response.ok) throw new Error("failed");
      const clone = response.clone();
      payload = (await response.json()) as { hadiths?: RawHadith[] };
      void cache.put(url, clone);
    }
  } catch {
    throw new Error("تعذّر تحميل الأحاديث من الإنترنت. تحقّق من الاتصال ثم أعد المحاولة.");
  }

  const list = (payload?.hadiths ?? []).map((item) => {
    const rawGrade = item.grades?.map((g) => g.grade ?? g.name ?? "").find(Boolean) ?? "";
    return {
      id: `${book.id}-${item.hadithnumber}`,
      bookId: book.id,
      bookName: book.name,
      number: item.hadithnumber,
      text: item.text,
      grade: rawGrade || book.defaultGrade,
      gradeKind: gradeKindOf(rawGrade, book.defaultGrade),
    } as RemoteHadith;
  });
  memory.set(book.id, list);
  onProgress?.(`تم تحميل ${list.length} حديثًا من ${book.name}.`);
  return list;
}

/** بحث بكلمة أو أكثر داخل مجموعة محمّلة. */
export function searchInBook(list: RemoteHadith[], query: string, limit = 60): RemoteHadith[] {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const out: RemoteHadith[] = [];
  for (const hadith of list) {
    const haystack = normalize(hadith.text);
    if (words.every((word) => haystack.includes(word))) {
      out.push(hadith);
      if (out.length >= limit) break;
    }
  }
  return out;
}
