import { surahs } from "../data/surahs";
import { loadHafsPages, loadHafsText } from "./mushafText";

/** معلومات سريعة عن كل آية: صفحتها في المصحف وسورتها ورقمها داخل السورة. */
export type AyahInfo = {
  page: number;
  surah: number;
  ayah: number;
  juz: number;
  text: string;
};

export const SURAH_NAMES = surahs.map((surah) => surah.name);

export function surahNameOf(number: number): string {
  return SURAH_NAMES[number - 1] ?? `سورة ${number}`;
}

let indexPromise: Promise<Map<number, AyahInfo>> | null = null;

/**
 * يبني فهرس الآيات من ملفات المصحف المحلية (pages.json + نص حفص).
 * لا يقرأ ملف التجويد الكبير (٣ م.ب) لأن الفهرس يحتاج النص فقط، فيسرع فتح القرآن.
 */
export function loadQuranIndex(): Promise<Map<number, AyahInfo>> {
  if (!indexPromise) {
    indexPromise = Promise.all([loadHafsPages(), loadHafsText()])
      .then(([pages, texts]) => {
        const map = new Map<number, AyahInfo>();
        pages.forEach((rows, pageIndex) => {
          rows.forEach(([surah, ayah, number, juz]) => {
            map.set(number, {
              page: pageIndex + 1,
              surah,
              ayah,
              juz,
              text: texts[`${surah}:${ayah}`] ?? "",
            });
          });
        });
        return map;
      })
      .catch(() => {
        indexPromise = null;
        return new Map<number, AyahInfo>();
      });
  }
  return indexPromise;
}
