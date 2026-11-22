/*
 * تسميع المصحف: تحويل الآيات إلى كلمات مفردة، ومحاذاة ما ينطقه القارئ معها
 * لتحديد الكلمات التي نطقها (✓) والتي أخطأ فيها (✗)، وحفظ نتيجة الجلسة
 * في الأرشيف المحلي.
 */

import { loadHafsAyahs, type HafsAyah } from "./mushafText";
import { loadTajweed } from "./tajweed";
import { wordMatches } from "./recitationMatch";

export type TasmeeScope = "page" | "selection" | "surah";

export type WordStatus = "pending" | "ok" | "bad";

export type TasmeeWord = {
  text: string;
  surah: number;
  ayah: number;
  global: number;
  page: number;
  /** رقم الآية داخل السورة. */
  index: number;
};

export type TasmeeSession = {
  at: number;
  page: number;
  scope: TasmeeScope;
  surah: number;
  fromAyah: number;
  toAyah: number;
  accuracy: number;
  correct: number;
  wrong: number;
  total: number;
  durationSec: number;
  /** null = بلا حد للأخطاء. */
  maxErrors: number | null;
  reciterId: string;
  mistakes: { word: string; spoken?: string; surah: number; ayah: number; global: number }[];
};

const STORE_KEY = "thimar.mushafTasmee.v1";
const MAX_SESSIONS = 40;

/** كلمات الآيات بالترتيب مع مرجع كل كلمة إلى آيتها. */
export function tasmeeWords(ayahs: HafsAyah[]): TasmeeWord[] {
  const words: TasmeeWord[] = [];
  for (const ayah of ayahs) {
    for (const raw of ayah.text.split(/\s+/)) {
      const text = raw.trim();
      if (!text) continue;
      words.push({
        text,
        surah: ayah.surah,
        ayah: ayah.ayah,
        global: ayah.global,
        page: ayah.page,
        index: ayah.ayah,
      });
    }
  }
  return words;
}

export function tokensOf(text: string): string[] {
  return text.split(/\s+/).map((word) => word.trim()).filter(Boolean);
}

/**
 * يحاذي كلمات جديدة مع الكلمات المتوقعة بدءًا من موضع المؤشر.
 * يتسامح مع لهجات النطق وأخطاء محرّك التعرف، ويتيح تجاوز كلمة أو كلمتين
 * حتى يجد الكلمة التالية المطابقة فيسجّل الفرق خطأً.
 */
export function alignTokens(
  words: TasmeeWord[],
  statuses: WordStatus[],
  cursor: number,
  tokens: string[],
  lookAhead = 3,
): { cursor: number; statuses: WordStatus[]; spoken: Record<number, string> } {
  const next = statuses.slice();
  const spoken: Record<number, string> = {};
  let at = cursor;
  for (const token of tokens) {
    if (at >= words.length) break;
    let matchedAt = -1;
    const limit = Math.min(words.length, at + lookAhead + 1);
    for (let look = at; look < limit; look += 1) {
      if (wordMatches(token, words[look].text, "lenient")) {
        matchedAt = look;
        break;
      }
    }
    if (matchedAt >= 0) {
      for (let skip = at; skip < matchedAt; skip += 1) {
        if (next[skip] !== "ok") {
          next[skip] = "bad";
          spoken[skip] = "";
        }
      }
      next[matchedAt] = "ok";
      at = matchedAt + 1;
    } else {
      next[at] = "bad";
      spoken[at] = token;
      at += 1;
    }
  }
  return { cursor: at, statuses: next, spoken };
}

export function ayahsOfScope(
  scope: TasmeeScope,
  options: { page?: number; pageAyahs?: HafsAyah[]; selection?: HafsAyah[]; surah?: number },
): Promise<HafsAyah[]> {
  if (scope === "selection" && options.selection?.length) return Promise.resolve(options.selection);
  if (scope === "surah" && options.surah) return loadSurahAyahs(options.surah);
  if (options.pageAyahs?.length) return Promise.resolve(options.pageAyahs);
  return options.page ? loadHafsPageAyahs(options.page) : Promise.resolve([]);
}

async function loadHafsPageAyahs(page: number): Promise<HafsAyah[]> {
  const { loadHafsPage } = await import("./mushafText");
  return loadHafsPage(page);
}

/** آيات سورة كاملة من النص المحلي (بلا إنترنت). */
export async function loadSurahAyahs(surah: number): Promise<HafsAyah[]> {
  const data = await loadTajweed();
  const count = data.chapters[surah - 1]?.verses_count ?? 0;
  if (!count) return [];
  const keys: string[] = [];
  for (let ayah = 1; ayah <= count; ayah += 1) keys.push(`${surah}:${ayah}`);
  return loadHafsAyahs(keys);
}

export function scopeLabel(scope: TasmeeScope): string {
  if (scope === "selection") return "الآيات المحددة";
  if (scope === "surah") return "السورة كاملة";
  return "الصفحة";
}

export function loadTasmeeSessions(): TasmeeSession[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is TasmeeSession => !!item && typeof item === "object" && "at" in item);
  } catch {
    return [];
  }
}

export function deleteTasmeeSession(at: number): TasmeeSession[] {
  const next = loadTasmeeSessions().filter((session) => session.at !== at);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* تجاهل */
  }
  return next;
}

export function clearTasmeeSessions(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* تجاهل */
  }
}

export function saveTasmeeSession(session: TasmeeSession): TasmeeSession[] {
  const next = [session, ...loadTasmeeSessions()].slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* التخزين غير متاح */
  }
  return next;
}
