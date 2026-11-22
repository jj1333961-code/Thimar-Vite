import { surahs } from "../data/surahs";
import { loadTajweed, tajweedText } from "./tajweed";

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

type Row = [number, number, number, number];

let indexPromise: Promise<Map<number, AyahInfo>> | null = null;

/** يبني فهرس الآيات من ملف المصحف المحلي (يعمل دون إنترنت). */
export function loadQuranIndex(): Promise<Map<number, AyahInfo>> {
  if (!indexPromise) {
    indexPromise = Promise.all([
      fetch("/quran/pages.json").then((response) => (response.ok ? response.json() : Promise.reject(new Error("no quran data")))),
      loadTajweed().catch(() => null),
    ])
      .then(([payload, tajweed]: [{ pages?: Row[][] }, Awaited<ReturnType<typeof loadTajweed>> | null]) => {
        const map = new Map<number, AyahInfo>();
        (payload.pages ?? []).forEach((rows, pageIndex) => {
          rows.forEach(([surah, ayah, number, juz]) => {
            const encoded = tajweed?.verses[`${surah}:${ayah}`] ?? "";
            map.set(number, { page: pageIndex + 1, surah, ayah, juz, text: tajweedText(encoded) });
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
