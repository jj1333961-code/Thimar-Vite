/* فتاوى محفوظة على الجهاز للعمل دون إنترنت: تُخزَّن في IndexedDB (تتجاوز حدّ
   التخزين المحلي الصغير) وتُبنى من نتائج البحث الحيّة عند الطلب. */

export type OfflineFatwa = {
  id: number;
  title: string;
  question: string;
  answer: string;
  category: string;
  mufti: string;
  hay: string;
  at: number;
};

const DB_NAME = "thimar-fatwa";
const DB_VERSION = 1;
const STORE = "fatwas";
/** السقف المستهدف للتحميل: أكثر من عشرة آلاف فتوى. */
export const FATWA_DOWNLOAD_TARGET = 10500;

/** كلمات بحث تغطّي أبواب الفقه لتجميع أكبر عدد من الفتاوى. */
const SEED_QUERIES = [
  "الصلاة", "الوضوء", "الغسل", "التيمم", "الأذان", "الجماعة", "الجمعة", "السفر",
  "الزكاة", "الصدقة", "الوقف", "الوصية", "الميراث", "الصيام", "رمضان", "الاعتكاف",
  "الحج", "العمرة", "الطواف", "الأضحية", "الذبائح", "النكاح", "الطلاق", "الخلع",
  "العدة", "النفقة", "الحضانة", "الرضاع", "البيوع", "الربا", "الرهن", "الشفعة",
  "الإجارة", "الشركة", "المضاربة", "الديون", "القرض", "الكفالة", "الحوالة", "الغصب",
  "الحدود", "القصاص", "الدية", "اللعان", "اليمين", "النذر", "الأيمان", "الجنائز",
  "الطهارة", "النجاسة", "الحيض", "النفاس", "اللباس", "الزينة", "الأطعمة", "الأشربة",
  "التوبة", "الدعاء", "الذكر", "القرآن", "التفسير", "الحديث", "العقيدة", "التوحيد",
  "الملائكة", "الجن", "الشفاعة", "القدر", "البرزخ", "القيامة", "الجنة", "النار",
  "بر الوالدين", "صلة الرحم", "الجار", "الصحبة", "الأخلاق", "الغيبة", "النميمة",
  "الكذب", "الحسد", "الرياء", "الصبر", "الشكر", "التوكل", "الرضا", "الخشوع",
  "المسجد", "القبلة", "السترة", "السجود", "الركوع", "التشهد", "السنن", "النوافل",
  "الوتر", "التراويح", "التهجد", "الاستخارة", "الجنازة", "الشهادة", "الإيمان",
  "الولاء", "البيعة", "الجهاد", "الأمانة", "الشورى", "القضاء", "الشهادة",
];

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("category", "category", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function normalize(text: string): string {
  return text
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function toRecord(item: { id?: number | null; title?: string; question?: string; answer?: string; mufti?: string; category?: string }): OfflineFatwa | null {
  if (!item?.id) return null;
  const title = item.title ?? "";
  const question = item.question ?? "";
  const answer = item.answer ?? "";
  if (!title && !question) return null;
  return {
    id: Number(item.id),
    title,
    question,
    answer,
    category: item.category ?? "",
    mufti: item.mufti ?? "",
    hay: normalize(`${title} ${question} ${answer}`),
    at: Date.now(),
  };
}

/** يحفظ دفعة فتاوى (يتجاهل المكرّر). يعيد عدد المحفوظ فعليًا. */
export async function saveFatwas(
  items: Parameters<typeof toRecord>[0][],
): Promise<number> {
  const database = await openDb();
  if (!database) return 0;
  const records = items.map(toRecord).filter((item): item is OfflineFatwa => Boolean(item));
  if (!records.length) return 0;
  return new Promise((resolve) => {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    let saved = 0;
    for (const record of records) {
      const request = store.put(record);
      request.onsuccess = () => {
        saved += 1;
      };
    }
    transaction.oncomplete = () => resolve(saved);
    transaction.onerror = () => resolve(0);
  });
}

export async function offlineFatwaCount(): Promise<number> {
  const database = await openDb();
  if (!database) return 0;
  return new Promise((resolve) => {
    const request = database.transaction(STORE, "readonly").objectStore(STORE).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(0);
  });
}

export async function clearOfflineFatwas(): Promise<void> {
  const database = await openDb();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const request = database.transaction(STORE, "readwrite").objectStore(STORE).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

/** بحث دون إنترنت في الفتاوى المحفوظة. */
export async function searchOfflineFatwas(
  query: string,
  category: string,
  limit = 60,
): Promise<OfflineFatwa[]> {
  const database = await openDb();
  if (!database) return [];
  const needle = normalize(query);
  return new Promise((resolve) => {
    const results: OfflineFatwa[] = [];
    const store = database.transaction(STORE, "readonly").objectStore(STORE);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      const value = cursor.value as OfflineFatwa;
      const categoryOk = !category || category === "الكل" || value.category === category;
      if (categoryOk && (!needle || value.hay.includes(needle))) results.push(value);
      cursor.continue();
    };
    request.onerror = () => resolve(results);
  });
}

/** أحدث الفتاوى المحفوظة (لعرضها قبل البحث). */
export async function recentOfflineFatwas(limit = 40): Promise<OfflineFatwa[]> {
  return searchOfflineFatwas("", "الكل", limit);
}

type DownloadItem = { id?: number | null; title?: string; question?: string; answer?: string; mufti?: string; category?: string };

/**
 * يحمّل الآلاف من الفتاوى (نصوصها وأجوبتها) إلى الجهاز عبر البحث في أبواب الفقه.
 * يتوقّف عند بلوغ الهدف أو عند طلب الإيقاف، ويبلّغ عن التقدّم.
 */
export async function downloadFatwas(
  onProgress: (saved: number, target: number) => void,
  shouldStop: () => boolean,
): Promise<number> {
  let saved = await offlineFatwaCount();
  onProgress(saved, FATWA_DOWNLOAD_TARGET);

  for (const query of SEED_QUERIES) {
    for (let page = 1; page <= 20; page += 1) {
      if (saved >= FATWA_DOWNLOAD_TARGET || shouldStop()) return saved;
      try {
        const response = await fetch(`/api/fatwa?q=${encodeURIComponent(query)}&page=${page}`);
        if (!response.ok) break;
        const payload = (await response.json()) as { items?: DownloadItem[]; lastPage?: number };
        const items = payload.items ?? [];
        if (!items.length) break;
        const added = await saveFatwas(items);
        saved += added;
        onProgress(saved, FATWA_DOWNLOAD_TARGET);
        if (!added || page >= (payload.lastPage ?? page)) break;
      } catch {
        break;
      }
    }
  }
  return saved;
}
