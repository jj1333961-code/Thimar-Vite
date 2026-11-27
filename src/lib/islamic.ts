import { CalculationMethod, Coordinates, PrayerTimes, type CalculationParameters } from "adhan";

export type Hadith = {
  id: string;
  title: string;
  text: string;
  grade: string;
  explanation: string;
  attribution: string;
  reference: string;
  hints: string[];
};

const hadithCategories = ["3", "1", "4"];

export async function fetchRandomHadith(
  signal?: AbortSignal,
  avoidId?: string,
): Promise<Hadith> {
  const category =
    hadithCategories[Math.floor(Math.random() * hadithCategories.length)];
  const page = 1 + Math.floor(Math.random() * 4);
  const listResponse = await fetch(
    `https://hadeethenc.com/api/v1/hadeeths/list/?language=ar&category_id=${category}&page=${page}&per_page=20`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!listResponse.ok) throw new Error("تعذّر تحميل قائمة الأحاديث.");
  const listPayload = (await listResponse.json()) as {
    data?: Array<{ id: string; title: string }>;
  };
  const items = (listPayload.data ?? []).filter((item) => item.id !== avoidId);
  if (items.length === 0) throw new Error("لا توجد أحاديث متاحة حاليًا.");
  const chosen = items[Math.floor(Math.random() * items.length)];

  const detailResponse = await fetch(
    `https://hadeethenc.com/api/v1/hadeeths/one/?language=ar&id=${chosen.id}`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!detailResponse.ok) throw new Error("تعذّر تحميل شرح الحديث.");
  const detail = (await detailResponse.json()) as {
    id: string;
    title: string;
    hadeeth: string;
    grade: string;
    explanation: string;
    attribution: string;
    reference: string;
    hints: string[];
  };

  return {
    id: detail.id,
    title: detail.title,
    text: detail.hadeeth,
    grade: detail.grade,
    explanation: detail.explanation,
    attribution: detail.attribution,
    reference: detail.reference,
    hints: Array.isArray(detail.hints) ? detail.hints : [],
  };
}

export type PrayerName = "الفجر" | "الظهر" | "العصر" | "المغرب" | "العشاء";

export type PrayerTimings = {
  Fajr: string;
  Sunrise: string;
  Dhuhr: string;
  Asr: string;
  Maghrib: string;
  Isha: string;
};

export type PrayerData = {
  timings: PrayerTimings;
  city: string;
  dateLabel: string;
  nextName: PrayerName;
  nextAt: Date;
  minutesLeft: number;
};

export const prayerMethods = [
  { id: 4, name: "أم القرى (السعودية)" },
  { id: 5, name: "الهيئة المصرية العامة للمساحة" },
  { id: 3, name: "رابطة العالم الإسلامي" },
  { id: 2, name: "الجمعية الإسلامية لأمريكا الشمالية" },
  { id: 1, name: "جامعة العلوم الإسلامية بكراتشي" },
];

export const fallbackCities = [
  { id: "makkah", name: "مكة المكرمة", lat: 21.4225, lng: 39.8262 },
  { id: "madinah", name: "المدينة المنورة", lat: 24.4672, lng: 39.6111 },
  { id: "riyadh", name: "الرياض", lat: 24.7136, lng: 46.6753 },
  { id: "jeddah", name: "جدة", lat: 21.4858, lng: 39.1925 },
  { id: "cairo", name: "القاهرة", lat: 30.0444, lng: 31.2357 },
  { id: "amman", name: "عمّان", lat: 31.9539, lng: 35.9106 },
  { id: "dubai", name: "دبي", lat: 25.2048, lng: 55.2708 },
  { id: "kuwait", name: "الكويت", lat: 29.3759, lng: 47.9774 },
  { id: "doha", name: "الدوحة", lat: 25.2854, lng: 51.531 },
];

async function getNetworkCoordinates(): Promise<{ lat: number; lng: number }> {
  const providers = [
    async () => {
      const response = await fetch("https://ipapi.co/json/", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("ipapi failed");
      const data = (await response.json()) as { latitude?: number; longitude?: number };
      if (typeof data.latitude !== "number" || typeof data.longitude !== "number") throw new Error("no coords");
      return { lat: data.latitude, lng: data.longitude };
    },
    async () => {
      const response = await fetch("https://ipwho.is/", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("ipwho failed");
      const data = (await response.json()) as { success?: boolean; latitude?: number; longitude?: number };
      if (!data.success || typeof data.latitude !== "number" || typeof data.longitude !== "number") throw new Error("no coords");
      return { lat: data.latitude, lng: data.longitude };
    },
  ];
  for (const provider of providers) {
    try {
      return await provider();
    } catch {
      // جرّب مزوّد الشبكة التالي.
    }
  }
  throw new Error("تعذّر تحديد الموقع عبر الشبكة.");
}

export async function getCoordinates(timeout = 7000): Promise<{ lat: number; lng: number }> {
  if (navigator.geolocation) {
    try {
      return await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) =>
            resolve({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            }),
          () => reject(new Error("لم نتمكن من تحديد موقعك عبر المتصفح.")),
          { enableHighAccuracy: true, timeout, maximumAge: 0 },
        );
      });
    } catch {
      // الموقع الدقيق غير متاح — نستخدم تحديد الشبكة كبديل.
    }
  }
  return getNetworkCoordinates();
}

function timeToDate(value: string): Date {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/* حساب المواقيت داخل الجهاز عند تعذّر الشبكة — يضمن العمل دون إنترنت. */
const ADHAN_METHODS: Record<number, () => CalculationParameters> = {
  1: () => CalculationMethod.Karachi(),
  2: () => CalculationMethod.NorthAmerica(),
  3: () => CalculationMethod.MuslimWorldLeague(),
  4: () => CalculationMethod.UmmAlQura(),
  5: () => CalculationMethod.Egyptian(),
  7: () => CalculationMethod.Tehran(),
  8: () => CalculationMethod.MuslimWorldLeague(),
  9: () => CalculationMethod.Kuwait(),
  10: () => CalculationMethod.Qatar(),
  11: () => CalculationMethod.Singapore(),
  12: () => CalculationMethod.Turkey(),
  15: () => CalculationMethod.MoonsightingCommittee(),
  16: () => CalculationMethod.Dubai(),
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function computeTimings(lat: number, lng: number, method: number, date: Date): PrayerTimings {
  const factory = ADHAN_METHODS[method] ?? ADHAN_METHODS[3];
  const times = new PrayerTimes(new Coordinates(lat, lng), date, factory());
  const format = (value: Date) => `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
  return {
    Fajr: format(times.fajr),
    Sunrise: format(times.sunrise),
    Dhuhr: format(times.dhuhr),
    Asr: format(times.asr),
    Maghrib: format(times.maghrib),
    Isha: format(times.isha),
  };
}

function buildPrayerData(timings: PrayerTimings, city: string, dateLabel: string): PrayerData {
  const schedule: Array<{ name: PrayerName; value: string }> = [
    { name: "الفجر", value: timings.Fajr },
    { name: "الظهر", value: timings.Dhuhr },
    { name: "العصر", value: timings.Asr },
    { name: "المغرب", value: timings.Maghrib },
    { name: "العشاء", value: timings.Isha },
  ];
  const now = new Date();
  let next = schedule.find((item) => timeToDate(item.value) > now);
  if (!next) {
    const tomorrow = timeToDate(timings.Fajr);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
      timings,
      city,
      dateLabel,
      nextName: "الفجر",
      nextAt: tomorrow,
      minutesLeft: Math.max(1, Math.round((tomorrow.getTime() - now.getTime()) / 60000)),
    };
  }
  const nextAt = timeToDate(next.value);
  return {
    timings,
    city,
    dateLabel,
    nextName: next.name,
    nextAt,
    minutesLeft: Math.max(1, Math.round((nextAt.getTime() - now.getTime()) / 60000)),
  };
}

export async function fetchPrayerTimes(
  lat: number,
  lng: number,
  method: number,
  city: string,
  signal?: AbortSignal,
): Promise<PrayerData> {
  const today = new Date();
  const dateKey = `${String(today.getDate()).padStart(2, "0")}-${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}-${today.getFullYear()}`;
  const url = `https://api.aladhan.com/v1/timings/${dateKey}?latitude=${lat}&longitude=${lng}&method=${method}`;
  const offline = () => buildPrayerData(computeTimings(lat, lng, method, today), city, "حساب محلي — دون إنترنت");
  let response: Response | null = null;
  try {
    response = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (response.ok && typeof caches !== "undefined") {
      try {
        const cache = await caches.open("thimar-prayer-v1");
        cache.put(url, response.clone()).catch(() => {});
      } catch { /* التخزين غير متاح: نكمل بالرد الشبكي */ }
    }
  } catch {
    let cached: Response | undefined;
    if (typeof caches !== "undefined") {
      try {
        const cache = await caches.open("thimar-prayer-v1");
        // مواقيت اليوم نفسه فقط؛ يوم سابق لا يصلح لموعد الصلاة الحالي.
        cached = await cache.match(url);
      } catch { /* لا Cache API: نحسب محليًا */ }
    }
    if (cached) response = cached;
    else return offline();
  }
  if (!response || !response.ok) return offline();
  try {
    const payload = (await response.json()) as {
      data?: {
        timings: PrayerTimings;
        date?: { readable?: string };
      };
    };
    if (!payload.data?.timings) return offline();
    return buildPrayerData(payload.data.timings, city, payload.data.date?.readable ?? "");
  } catch {
    return offline();
  }
}

export type CalendarDay = {
  /** التاريخ الميلادي بصيغة YYYY-MM-DD */
  date: string;
  hijri: string;
  timings: PrayerTimings;
};

/** سجل مواقيت شهر كامل من تقويم الأذان (يُستخدم لعرض السجل السنوي). */
export async function fetchAdhanMonth(
  lat: number,
  lng: number,
  method: number,
  year: number,
  month: number,
  signal?: AbortSignal,
): Promise<CalendarDay[]> {
  const localMonth = () => {
    const total = new Date(year, month, 0).getDate();
    return Array.from({ length: total }, (_, index) => {
      const day = new Date(year, month - 1, index + 1);
      return {
        date: `${year}-${pad2(month)}-${pad2(index + 1)}`,
        hijri: "",
        timings: computeTimings(lat, lng, method, day),
      };
    });
  };
  const url = `https://api.aladhan.com/v1/calendar/${year}/${month}?latitude=${lat}&longitude=${lng}&method=${method}`;
  let response: Response | null = null;
  try {
    response = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (response.ok && typeof caches !== "undefined") {
      try {
        const cache = await caches.open("thimar-prayer-calendar-v1");
        cache.put(url, response.clone()).catch(() => {});
      } catch { /* التخزين غير متاح: نكمل بالرد الشبكي */ }
    }
  } catch {
    let cached: Response | undefined;
    if (typeof caches !== "undefined") {
      try {
        cached = await (await caches.open("thimar-prayer-calendar-v1")).match(url);
      } catch { /* لا Cache API: نحسب محليًا */ }
    }
    if (cached) response = cached;
    else return localMonth();
  }
  if (!response || !response.ok) return localMonth();
  try {
    const payload = (await response.json()) as {
      data?: Array<{
        timings: PrayerTimings;
        date?: { gregorian?: { date?: string }; hijri?: { date?: string } };
      }>;
    };
    const days = payload.data ?? [];
    if (!days.length) return localMonth();
    return days.map((day) => ({
      date: (day.date?.gregorian?.date ?? "").split("-").reverse().join("-"),
      hijri: day.date?.hijri?.date ?? "",
      timings: day.timings,
    }));
  } catch {
    return localMonth();
  }
}

/** اتجاه القبلة بالدرجات من الشمال الحقيقي. */
export function qiblaBearing(lat: number, lng: number): number {
  const kaabaLat = (21.4225 * Math.PI) / 180;
  const kaabaLng = (39.8262 * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const deltaLng = kaabaLng - (lng * Math.PI) / 180;
  const bearing =
    (Math.atan2(
      Math.sin(deltaLng),
      Math.cos(phi) * Math.tan(kaabaLat) - Math.sin(phi) * Math.cos(deltaLng),
    ) *
      180) /
    Math.PI;
  return (bearing + 360) % 360;
}
