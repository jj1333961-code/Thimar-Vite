/*
 * كتالوج القراء: القراء المضمّنون في التطبيق يعملون دون اتصال، ويُضاف إليهم
 * كتالوج MP3Quran (‏mp3quran.net/api/v3) عند توفر الإنترنت. القائمة المحمّلة
 * تُحفظ محليًا لتبقى متاحة عند انقطاع الاتصال أو بطئه.
 *
 * قراء MP3Quran يتوفرون بملف السورة كاملة فقط؛ القراء المضمّنون بعضهم صوت
 * آية بآية وبعضهم ملف سورة. لا ندّعي أن القائمة تضم كل قراء العالم.
 */

import { reciters as bundledReciters, registerReciterServers, type Reciter } from "../data/reciters";

export type CatalogSource = "bundled" | "cache" | "network";

export type ReciterCatalog = {
  reciters: Reciter[];
  source: CatalogSource;
  /** عدد القراء المتاحين للتلاوة (المضمّنون + المحمّلون). */
  total: number;
  error: string;
};

const CACHE_KEY = "thimar.reciters.catalog.v1";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const API_URL = "https://mp3quran.net/api/v3/reciters?language=ar";

type ApiMoshaf = {
  id?: number;
  name?: string;
  server?: string;
  surah_total?: number;
};

type ApiReciter = {
  id?: number;
  name?: string;
  moshaf?: ApiMoshaf[];
};

type CachedEntry = { id: string; name: string; server: string };

type Cached = { at: number; items: CachedEntry[] };

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(items: CachedEntry[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), items } satisfies Cached));
  } catch {
    /* التخزين غير متاح — تبقى القائمة في الذاكرة */
  }
}

function normalizeName(name: string): string {
  return name
    .replace(/[\u0617-\u061A\u064B-\u0652\u0670\u06D6-\u06ED]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

/** يستخرج من رد MP3Quran قائمة قراء بسورة كاملة لكل قارئ. */
function mapApi(payload: unknown): CachedEntry[] {
  const list = (payload as { reciters?: ApiReciter[] })?.reciters;
  if (!Array.isArray(list)) return [];
  const entries: CachedEntry[] = [];
  const seen = new Set<string>();
  for (const reciter of list) {
    const name = String(reciter?.name ?? "").trim();
    if (!name) continue;
    const moshaf = (reciter.moshaf ?? [])
      .filter((item) => {
        const server = String(item?.server ?? "");
        return /^https:\/\//.test(server) && Number(item?.surah_total ?? 0) >= 114;
      })
      .sort((first, second) => Number(second.surah_total ?? 0) - Number(first.surah_total ?? 0))[0];
    if (!moshaf?.server) continue;
    const id = `mp3quran.${reciter.id ?? normalizeName(name)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, name, server: String(moshaf.server) });
  }
  return entries;
}

function merge(entries: CachedEntry[]): Reciter[] {
  const known = new Set(bundledReciters.map((reciter) => normalizeName(reciter.name)));
  const servers: [string, string][] = [];
  const dynamic: Reciter[] = [];
  for (const entry of entries) {
    const key = normalizeName(entry.name);
    if (!key || known.has(key)) continue;
    known.add(key);
    servers.push([entry.id, entry.server]);
    dynamic.push({ id: entry.id, name: entry.name, mode: "surah", server: entry.server });
  }
  registerReciterServers(servers);
  return [...bundledReciters, ...dynamic];
}

function result(list: Reciter[], source: CatalogSource, error = ""): ReciterCatalog {
  return { reciters: list, source, total: list.length, error };
}

let pending: Promise<ReciterCatalog> | null = null;

async function fetchCatalog(): Promise<ReciterCatalog> {
  const cached = readCache();
  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const items = mapApi(await response.json());
    if (!items.length) throw new Error("empty catalog");
    writeCache(items);
    return result(merge(items), "network");
  } catch (error) {
    if (cached?.items?.length) {
      return result(merge(cached.items), "cache", "تعذّر تحديث قائمة القراء؛ تُعرض القائمة المحفوظة على جهازك.");
    }
    return result(
      [...bundledReciters],
      "bundled",
      "تعذّر تحميل قائمة القراء الكاملة (لا اتصال بالإنترنت)؛ تُعرض القراء المضمّنون في التطبيق.",
    );
  }
}

/** تحميل كتالوج القراء مرة واحدة لكل جلسة، مع إمكانية إعادة المحاولة. */
export function loadReciterCatalog(): Promise<ReciterCatalog> {
  if (!pending) pending = fetchCatalog();
  return pending;
}

/** حذف كاش الجلسة لإعادة المحاولة عند عودة الاتصال. */
export function refreshReciterCatalog(): Promise<ReciterCatalog> {
  pending = fetchCatalog();
  return pending;
}

/** القراء المتاحون فورًا دون انتظار الشبكة. */
export function readCachedReciters(): Reciter[] {
  const cached = readCache();
  if (!cached?.items?.length) return [...bundledReciters];
  const age = Date.now() - Number(cached.at ?? 0);
  if (age > CACHE_TTL) return [...bundledReciters];
  return merge(cached.items);
}
