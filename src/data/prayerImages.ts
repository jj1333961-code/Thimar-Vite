/* صور الصلوات الخمس: صورة مستقلة لكل صلاة مع عبارة تحفيزية مطبوعة عليها. */

export type PrayerKey = "Fajr" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";

export const PRAYER_KEYS: PrayerKey[] = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

export const PRAYER_ART: Record<PrayerKey, { image: string; label: string; phrase: string }> = {
  Fajr: {
    image: "/adhan/prayer/fajr.jpg",
    label: "صلاة الفجر",
    phrase: "بورك فيمن بكّر — صلاة الفجر نور يبدأ به يومك",
  },
  Dhuhr: {
    image: "/adhan/prayer/dhuhr.jpg",
    label: "صلاة الظهر",
    phrase: "توقّف عن الدنيا لحظة… لصلاتك سكينة تعيد ترتيب يومك",
  },
  Asr: {
    image: "/adhan/prayer/asr.jpg",
    label: "صلاة العصر",
    phrase: "حافظ على العصر… فهي صلاة من تركها حبط عمله",
  },
  Maghrib: {
    image: "/adhan/prayer/maghrib.jpg",
    label: "صلاة المغرب",
    phrase: "لحظة غروب… ذنوب تغيب مع دعاء المغرب",
  },
  Isha: {
    image: "/adhan/prayer/isha.jpg",
    label: "صلاة العشاء",
    phrase: "اختم يومك بالعشاء… وابدأ ليلك مطمئنًا",
  },
};

/** رابط مطلق للصورة (تحتاجه الإشعارات خارج التطبيق). */
export function prayerImageUrl(key: PrayerKey): string {
  const base = typeof window !== "undefined" ? window.location.origin : "https://thimar.freebuff.page";
  return `${base}${PRAYER_ART[key].image}`;
}
