/*
 * تسميع المصحف: تحويل الآيات إلى كلمات مفردة، ومحاذاة ما ينطقه القارئ معها
 * لتحديد الكلمات التي نطقها (✓) والتي أخطأ فيها (✗)، وحفظ نتيجة الجلسة
 * في الأرشيف المحلي.
 */

import { loadHafsAyahs, type HafsAyah } from "./mushafText";
import { loadTajweed } from "./tajweed";
import { wordMatches } from "./recitationMatch";
import { cloud } from "./cloud";
import { getRememberedAccountId } from "./rememberedDevice.mjs";

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
  /** UUID ثابت لمنع تكرار رفع الجلسة. */
  syncId?: string;
};

const STORE_KEY = "thimar.mushafTasmee.v1";
const MAX_SESSIONS = 40;
const PENDING_SYNC_KEY = "thimar.mushafTasmee.pending.v1";

type PendingTasmeeSync = { accountId: string; session: TasmeeSession & { syncId: string } };
let tasmeeSyncRunning = false;

function createTasmeeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createTasmeeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function readPendingTasmeeSync(): PendingTasmeeSync[] {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => item?.accountId && item?.session?.syncId) : [];
  } catch {
    return [];
  }
}

function writePendingTasmeeSync(items: PendingTasmeeSync[]): void {
  try { localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(items)); } catch { /* يبقى الأرشيف المحلي محفوظًا */ }
}

/** يرفع نتائج Android فقط عبر تفويض الجهاز؛ لا يُرسل أي ملف أو تسجيل صوتي. */
export async function syncPendingTasmeeSessions(): Promise<void> {
  if (tasmeeSyncRunning || typeof window === "undefined" || !navigator.onLine) return;
  const native = window.ThimarNative;
  if (!native) return;
  const deviceId = native.deviceId?.();
  if (!deviceId) return;
  const pending = readPendingTasmeeSync();
  tasmeeSyncRunning = true;
  try {
    for (const item of pending) {
      const activeAccountId = native.accountId?.() || getRememberedAccountId();
      if (!activeAccountId || activeAccountId !== item.accountId) continue;
      let secret = "";
      try { secret = localStorage.getItem(`thimar.deviceSecret.${item.accountId}`) || ""; } catch { /* storage unavailable */ }
      if (!secret) continue;
      try {
        const { error } = await cloud.rpc("thimar_save_tasmee_session", {
          p_account_id: item.accountId,
          p_device_id: deviceId,
          p_device_secret: secret,
          p_request_nonce: createTasmeeNonce(),
          p_session_id: item.session.syncId,
          p_session: {
            at: item.session.at,
            page: item.session.page,
            scope: item.session.scope,
            surah: item.session.surah,
            fromAyah: item.session.fromAyah,
            toAyah: item.session.toAyah,
            accuracy: item.session.accuracy,
            correct: item.session.correct,
            wrong: item.session.wrong,
            total: item.session.total,
            durationSec: item.session.durationSec,
            maxErrors: item.session.maxErrors,
            reciterId: item.session.reciterId,
            mistakes: item.session.mistakes,
          },
        });
        if (error) throw error;
        const current = readPendingTasmeeSync().filter((entry) => entry.session.syncId !== item.session.syncId);
        writePendingTasmeeSync(current);
      } catch {
        // تبقى الجلسة في صندوق الصادر لإعادة المحاولة عند الاتصال التالي.
        break;
      }
    }

    // استرجاع أرشيف الطالب على جهازه بعد التحقق من تفويض الجهاز نفسه.
    const activeAccountId = native.accountId?.() || getRememberedAccountId();
    if (activeAccountId) {
      let secret = "";
      try { secret = localStorage.getItem(`thimar.deviceSecret.${activeAccountId}`) || ""; } catch { /* storage unavailable */ }
      if (secret) {
        try {
          const { data, error } = await cloud.rpc("thimar_list_own_tasmee_sessions", {
            p_account_id: activeAccountId,
            p_device_id: deviceId,
            p_device_secret: secret,
            p_request_nonce: createTasmeeNonce(),
          });
          if (error) throw error;
          if (Array.isArray(data)) {
            const local = loadTasmeeSessions();
            const byId = new Map<string, TasmeeSession>();
            for (const session of local) if (session.syncId) byId.set(session.syncId, session);
            for (const raw of data as Array<TasmeeSession & { syncId: string }>) {
              if (raw?.syncId && typeof raw.at === "number") byId.set(raw.syncId, raw);
            }
            const merged = Array.from(byId.values()).sort((a, b) => b.at - a.at).slice(0, MAX_SESSIONS);
            try {
              localStorage.setItem(STORE_KEY, JSON.stringify(merged));
              window.dispatchEvent(new Event("thimar:tasmee-sync"));
            } catch { /* لا يؤثر على الجلسة الحالية */ }
          }
        } catch {
          // لا نمنع استخدام الأرشيف المحلي عند تعذر استرجاع السحابة.
        }
      }
    }
  } finally {
    tasmeeSyncRunning = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void syncPendingTasmeeSessions(); });
  window.addEventListener("focus", () => { void syncPendingTasmeeSessions(); });
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncPendingTasmeeSessions();
  });
  // إعادة المحاولة أثناء بقاء التطبيق مفتوحًا؛ لا يُرسل شيء دون اتصال أو دون تفويض.
  window.setInterval(() => { void syncPendingTasmeeSessions(); }, 30_000);
  void syncPendingTasmeeSessions();
}

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
  const removed = loadTasmeeSessions().filter((session) => session.at === at);
  const removedIds = new Set(removed.map((session) => session.syncId).filter(Boolean));
  writePendingTasmeeSync(readPendingTasmeeSync().filter((item) => !removedIds.has(item.session.syncId)));
  const next = loadTasmeeSessions().filter((session) => session.at !== at);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* تجاهل */
  }
  return next;
}

export function clearTasmeeSessions(): void {
  writePendingTasmeeSync([]);
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* تجاهل */
  }
}

export function saveTasmeeSession(session: TasmeeSession): TasmeeSession[] {
  const saved: TasmeeSession & { syncId: string } = { ...session, syncId: session.syncId || createTasmeeId() };
  const next = [saved, ...loadTasmeeSessions()].slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* التخزين غير متاح */
  }

  // اربط النتيجة بحساب الطالب الحالي وقت إنشاء الجلسة، ولا تغيّر مالكها لاحقًا.
  const accountId = (typeof window !== "undefined" ? window.ThimarNative?.accountId?.() : null) || getRememberedAccountId();
  if (accountId) {
    const pending = readPendingTasmeeSync();
    if (!pending.some((item) => item.session.syncId === saved.syncId)) {
      pending.push({ accountId, session: saved });
      writePendingTasmeeSync(pending);
    }
    void syncPendingTasmeeSessions();
  }
  return next;
}
