/* المصحف الملوّن (أحكام التجويد) — بيانات محمّلة داخل التطبيق.
   المصدر: نسخة التجويد الملوّنة الكاملة للقرآن (quran.com / tajweed markup)
   محفوظة كما هي، مع ترميز مختصر للأحكام لتقليل حجم الملف فقط. */

export type TajweedChapter = {
  surah_number: number;
  name_ar: string;
  name_en: string;
  verses_count: number;
};

export type TajweedData = {
  chapters: TajweedChapter[];
  verses: Record<string, string>;
};

/** صفحات المصحف: لكل صفحة قائمة [رقم السورة، رقم الآية]. */
export type PageMap = Array<Array<[number, number]>>;

/** يزيل رموز الأحكام من نص الآية ويعيد النص القرآني الخام. */
export function tajweedText(encoded: string): string {
  return encoded.replace(/[\u0001][a-z_]+[\u0002]([\s\S]*?)[\u0003]/g, "$1");
}

const base = import.meta.env?.BASE_URL || "/";

let tajweedPromise: Promise<TajweedData> | null = null;
let pagesPromise: Promise<PageMap> | null = null;

export function loadTajweed(): Promise<TajweedData> {
  if (!tajweedPromise) {
    tajweedPromise = (async () => {
      // 1) النسخة المضمَّنة مع التطبيق/الموقع أولًا: لا طلب شبكة ولا انتظار.
      try {
        const res = await fetch(`${base}quran/tajweed.json`, { cache: "force-cache" });
        if (res.ok) return (await res.json()) as TajweedData;
      } catch { /* تجاهل */ }
      // 1b) النسخة المضغوطة للنشر (حد الرفع في الاستضافة): فكّ gzip في المتصفح.
      try {
        const res = await fetch(`${base}quran/tajweed.json.gz`, { cache: "force-cache" });
        if (res.ok && typeof DecompressionStream !== "undefined") {
          const buffer = await res.arrayBuffer();
          const head = new Uint8Array(buffer.slice(0, 2));
          if (head[0] === 0x1f && head[1] === 0x8b) {
            const stream = new Blob([buffer])
              .stream()
              .pipeThrough(new DecompressionStream("gzip"));
            return (await new Response(stream).json()) as TajweedData;
          }
        }
      } catch { /* تجاهل */ }
      // 1c) ملف كبير مستضاف (نسخ نشر قديمة).
      try {
        const res = await fetch(`${base}assets/large/tajweed.json`, { cache: "force-cache" });
        if (res.ok) return (await res.json()) as TajweedData;
      } catch { /* تجاهل */ }
      // 2) ملفات مجزّأة (نسخ نشر قديمة). نجلب حتى توقف JSON (وليس HTML).
      const parts: TajweedData[] = [];
      for (let i = 0; i <= 50; i += 1) {
        const res = await fetch(`${base}quran/data${i}.json`);
        if (!res.ok) break;
        try {
          parts.push((await res.json()) as TajweedData);
        } catch {
          break;
        }
      }
      if (!parts.length) throw new Error("tajweed unavailable");
      return {
        chapters: parts.flatMap((p) => p.chapters).sort((x, y) => x.surah_number - y.surah_number),
        verses: Object.assign({}, ...parts.map((p) => p.verses)),
      };
    })().catch((error) => {
      tajweedPromise = null;
      throw error;
    });
  }
  return tajweedPromise;
}

export function loadPageMap(): Promise<PageMap> {
  if (!pagesPromise) {
    pagesPromise = fetch(`${base}quran/pages.json`, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("pages unavailable");
        return response.json() as Promise<{ v?: number; pages: Array<Array<[number, number, number?, number?]>> }>;
      })
      .catch((error) => {
        pagesPromise = null;
        throw error;
      })
      .then((payload) => payload.pages.map((page) => page.map((row) => [row[0], row[1]] as [number, number])));
  }
  return pagesPromise;
}

export const TOTAL_PAGES = 604;

/** بدايات الأجزاء الثلاثين بالرقم العام للآية (١..٦٢٣٦). */
const JUZ_STARTS = [
  1, 148, 282, 385, 469, 551, 643, 720, 792, 861, 928, 1000, 1068, 1121, 1181, 1242, 1303, 1364,
  1422, 1486, 1545, 1608, 1669, 1736, 1821, 1902, 1986, 2034, 2119, 2203,
];

/** رقم الجزء (١..٣٠) الذي تنتمي إليه الآية. */
export function juzOf(globalAyah: number): number {
  let juz = 1;
  for (let index = 0; index < JUZ_STARTS.length; index += 1) {
    if (globalAyah >= JUZ_STARTS[index]) juz = index + 1;
    else break;
  }
  return juz;
}

/** أرقام الآيات التراكمية: مفتاح "سورة:آية" ← الرقم العام 1..6236. */
export function buildGlobalIndex(chapters: TajweedChapter[]): Record<string, number> {
  const index: Record<string, number> = {};
  let total = 0;
  for (const chapter of chapters) {
    for (let ayah = 1; ayah <= chapter.verses_count; ayah += 1) {
      index[`${chapter.surah_number}:${ayah}`] = total + ayah;
    }
    total += chapter.verses_count;
  }
  return index;
}

/**
 * يحوّل النص المرمّز إلى HTML بسيط: وسوم <span class="tj tj-<rule>"> فقط.
 * لا يحتوي الملف على أي وسوم أخرى، والنص نفسه لم يُعدَّل.
 */
export function tajweedHtml(encoded: string): string {
  return encoded.replace(
    /[\u0001]([a-z_]+)[\u0002]([\s\S]*?)\u0003/g,
    (_match, rule: string, text: string) => `<span class="tj tj-${rule}">${text}</span>`,
  );
}

/** أسماء أحكام التجويد كما تستخدمها نسخة Quranpedia (تُطابق ألوانها الرسمية). */
const QURANPEDIA_RULES: Record<string, string> = {
  ghunnah: "ghn",
  qalaqah: "qlq",
  idgham_ghunnah: "idgh_ghn",
  idgham_wo_ghunnah: "idgh_w_ghn",
  iqlab: "iqlb",
  ikhafa: "ikhf",
  ikhfa_shafawi: "ikhf_shfw",
  idgham_shafawi: "idghm_shfw",
  laam_shamsiyah: "slnt",
  ham_wasl: "ham_wasl",
  madda_necessary: "madda_necessary",
  madda_obligatory: "madda_obligatory",
  madda_permissible: "madda_permissible",
  madda_normal: "madda_normal",
  idgham_mutajanisayn: "idgh_mus",
};

/**
 * HTML نصّ الآية بوسوم <tajweed> تمامًا كما في صفحة Quranpedia، مع نفس أسماء
 * الأحكام التي تعتمدها أوراق تنسيقها، فيتطابق التلوين مع النسخة الأصلية.
 */
export function tajweedMarkup(encoded: string): string {
  return encoded.replace(
    /[\u0001]([a-z_]+)[\u0002]([\s\S]*?)\u0003/g,
    (_match, rule: string, text: string) =>
      `<tajweed class="${QURANPEDIA_RULES[rule] ?? rule}">${text}</tajweed>`,
  );
}

export type TajweedRule = { key: string; label: string; note: string };

export const TAJWEED_RULES: TajweedRule[] = [
  { key: "madda_normal", label: "مد حركتان", note: "مد طبيعي مقداره حركتان" },
  { key: "madda_permissible", label: "مد جوازي ٢–٦", note: "مد جائز من حركتين إلى ست" },
  { key: "madda_obligatory", label: "مد واجب ٤–٥", note: "مد متصل واجب" },
  { key: "madda_necessary", label: "مد لازم ٦", note: "مد لازم ست حركات" },
  { key: "qalaqah", label: "قلقلة", note: "حروف ق ط ب ج د عند السكون" },
  { key: "ghunnah", label: "غنة", note: "النون والميم المشددتان" },
  { key: "ikhafa", label: "إخفاء", note: "النون الساكنة والتنوين" },
  { key: "ikhfa_shafawi", label: "إخفاء شفوي", note: "الميم الساكنة عند الباء" },
  { key: "idgham_ghunnah", label: "إدغام بغنة", note: "في حروف ينمو" },
  { key: "idgham_wo_ghunnah", label: "إدغام بلا غنة", note: "في اللام والراء" },
  { key: "idgham_shafawi", label: "إدغام شفوي", note: "الميم في الميم" },
  { key: "iqlab", label: "إقلاب", note: "النون والتنوين عند الباء" },
  { key: "ham_wasl", label: "همزة وصل", note: "تسقط في الوصل" },
  { key: "laam_shamsiyah", label: "لام شمسية", note: "لا تُنطق ويُشدَّد ما بعدها" },
];
