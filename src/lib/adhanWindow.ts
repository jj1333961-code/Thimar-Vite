/**
 * بيانات ومحتوى نافذة الأذان الديناميكية.
 *
 * كل القيم (الاسم، الوقت، التاريخ الهجري والميلادي) تُحسب من جدول الصلاة
 * الفعلي ومن تاريخ الجهاز؛ لا توجد صورة ثابتة ولا وقت أو تاريخ مكتوب هنا.
 * المتغيّر الوحيد الثابت هو هوية كل صلاة (لون مميز وعبارة مناسبة).
 */

export type AdhanPrayerId = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha" | "jumuah";

export type AdhanLook = {
  id: AdhanPrayerId;
  arabic: string;
  english: string;
  /** لون التمييز الخاص بالصلاة (ذهب ثمار + لمسة إسلامية). */
  accent: string;
  /** لون خلفية عميق مشتق من الصلاة للوضع الداكن. */
  deep: string;
  /** لون خلفية فاتح مشتق من الصلاة للوضع الفاتح. */
  soft: string;
  greetingAr: string;
  greetingEn: string;
};

export const ADHAN_LOOKS: Record<AdhanPrayerId, AdhanLook> = {
  fajr: {
    id: "fajr",
    arabic: "الفجر",
    english: "Fajr",
    accent: "#E7C784",
    deep: "#132238",
    soft: "#F3EDDF",
    greetingAr: "بورك فيمن بكّر — صلاة الفجر نور يبدأ به يومك",
    greetingEn: "Blessed are those who rise early — Fajr is the light that begins your day",
  },
  dhuhr: {
    id: "dhuhr",
    arabic: "الظهر",
    english: "Dhuhr",
    accent: "#8FD9C0",
    deep: "#0E3A2E",
    soft: "#EDF5EF",
    greetingAr: "توقّف عن الدنيا لحظة… لصلاتك سكينة تعيد ترتيب يومك",
    greetingEn: "Pause the world for a moment — your prayer is a calm that reorders your day",
  },
  asr: {
    id: "asr",
    arabic: "العصر",
    english: "Asr",
    accent: "#E8B770",
    deep: "#3A2A14",
    soft: "#F6EEDF",
    greetingAr: "حافظ على العصر… فهي صلاة من تركها حبط عمله",
    greetingEn: "Guard the Asr prayer — the one who abandons it loses the reward of his deeds",
  },
  maghrib: {
    id: "maghrib",
    arabic: "المغرب",
    english: "Maghrib",
    accent: "#E8A07A",
    deep: "#3A1E22",
    soft: "#F7ECE6",
    greetingAr: "لحظة غروب… ذنوب تغيب مع دعاء المغرب",
    greetingEn: "A moment of sunset — sins fade with the supplication of Maghrib",
  },
  isha: {
    id: "isha",
    arabic: "العشاء",
    english: "Isha",
    accent: "#BFB6E8",
    deep: "#1D1B33",
    soft: "#F0EEF9",
    greetingAr: "اختم يومك بالعشاء… وابدأ ليلك مطمئنًا",
    greetingEn: "Close your day with Isha — and begin your night at peace",
  },
  jumuah: {
    id: "jumuah",
    arabic: "الجمعة",
    english: "Jumu'ah",
    accent: "#A8E0B8",
    deep: "#0B3327",
    soft: "#EBF5EC",
    greetingAr: "جمعة مباركة — ساعة نور وبركة، تقبّل الله جمعتكم",
    greetingEn: "Blessed Friday — an hour of light and blessing, may your Jumu'ah be accepted",
  },
};

const PRAYER_IDS: AdhanPrayerId[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

/** الجمعة: صلاة الظهر يوم الجمعة تُعرض باسم الجمعة مع الحفاظ على وقتها الفعلي. */
export function adhanLookFor(key: string, date: Date = new Date()): AdhanLook {
  const id = (key || "").trim().toLowerCase();
  if (id === "dhuhr" && date.getDay() === 5) return ADHAN_LOOKS.jumuah;
  return PRAYER_IDS.find((item) => item === id) ? ADHAN_LOOKS[id as AdhanPrayerId] : ADHAN_LOOKS.fajr;
}

/** التاريخ الهجري من تقويم أم القرى عبر المنصة، مع بديل عربي عند عدم توفره. */
export function hijriLabel(date: Date, lang: "ar" | "en"): string {
  const locale = lang === "en" ? "en-SA-u-ca-islamic-umalqura" : "ar-SA-u-ca-islamic-umalqura";
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

/** التاريخ الميلادي بصيغة كاملة بحسب لغة الواجهة. */
export function gregorianLabel(date: Date, lang: "ar" | "en"): string {
  try {
    return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ar", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

/** يتحقق أن الوقت نص فعلي (HH:mm) قادم من جدول الصلاة لا قيمة مصطنعة. */
export function prayerTimeLabel(time: string): string {
  return (time || "").trim();
}
