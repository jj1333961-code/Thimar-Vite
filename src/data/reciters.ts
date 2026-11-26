export type Reciter = {
  id: string;
  name: string;
  /** «ayah» صوت آية بآية، «surah» ملف السورة كاملة. */
  mode?: "ayah" | "surah";
  /** خادم MP3Quran لملفات السور (للقراء المضافين من الكتالوج). */
  server?: string;
};

/** القراء المضمّنون مع التطبيق — يعملون دون اتصال. */
export const reciters: Reciter[] = [
  { id: "ar.alafasy", name: "مشاري العفاسي" },
  { id: "ar.yasseraldossari", name: "ياسر الدوسري", mode: "surah" },
  { id: "ar.hassansaleh", name: "حسن صالح", mode: "surah" },
  { id: "mp3quran.mansouralsalmi", name: "منصور السالمي", mode: "surah" },
  { id: "ar.abdulbasitmurattal", name: "عبد الباسط عبد الصمد (مرتل)" },
  { id: "ar.husary", name: "محمود خليل الحصري" },
  { id: "ar.minshawi", name: "محمد صديق المنشاوي" },
  { id: "ar.mahermuaiqly", name: "ماهر المعيقلي" },
  { id: "ar.abdurrahmaansudais", name: "عبد الرحمن السديس" },
  { id: "ar.shaatree", name: "أبو بكر الشاطري" },
  { id: "ar.hudhaify", name: "علي الحذيفي" },
  { id: "ar.muhammadayyoub", name: "محمد أيوب" },
  { id: "ar.ahmedajamy", name: "أحمد بن علي العجمي" },
];

export const repeatOptions = [1, 2, 3, 5, 7, 10];

const RECITER_QUALITY: Record<string, number> = {
  "ar.minshawi": 128,
  "ar.muhammadayyoub": 128,
  "ar.abdulbasitmurattal": 64,
  "ar.abdurrahmaansudais": 64,
};

/* خوادم MP3Quran للقراء المحمّلين من الكتالوج (تُسجَّل عند تحميل القائمة). */
const reciterServers = new Map<string, string>();

/** يسجّل خوادم ملفات السور للقراء القادمين من كتالوج MP3Quran. */
export function registerReciterServers(entries: Iterable<[string, string]>): void {
  for (const [id, server] of entries) {
    if (id && server) reciterServers.set(id, server.replace(/\/?$/, "/"));
  }
}

export function reciterServer(reciterId: string): string | undefined {
  return reciterServers.get(reciterId);
}

/** هل هذا القارئ يعتمد ملف السورة كاملة بدل ملف لكل آية؟ */
export function reciterIsSurah(reciterId: string, list: Reciter[] = reciters): boolean {
  if (reciterServers.has(reciterId)) return true;
  return list.find((reciter) => reciter.id === reciterId)?.mode === "surah";
}

export function ayahAudioUrl(reciterId: string, globalAyahNumber: number): string {
  const q = RECITER_QUALITY[reciterId] ?? 128;
  return `https://cdn.islamic.network/quran/audio/${q}/${reciterId}/${globalAyahNumber}.mp3`;
}

/**
 * رابط ملف السورة كاملة للقراء الذين لا تتوفر لهم ملفات آية بآية
 * (ياسر الدوسري، حسن صالح، منصور السالمي، وقراء كتالوج MP3Quran).
 */
export function surahAudioUrl(reciterId: string, surahNumber: number): string {
  const server = reciterServers.get(reciterId);
  if (server) return `${server}${String(surahNumber).padStart(3, "0")}.mp3`;
  if (reciterId === "mp3quran.mansouralsalmi") {
    return `https://cdn.mp3quran.net/audio/mansour-salimi/r1/${String(surahNumber).padStart(3, "0")}.mp3`;
  }
  return `https://cdn.islamic.network/quran/audio-surah/128/${reciterId}/${surahNumber}.mp3`;
}

/** رابط صوت مناسب لأي نطاق: آية أو سورة كاملة. */
export function audioUrlFor(
  reciterId: string,
  options: { globalAyah?: number; surah?: number },
): string {
  if (reciterIsSurah(reciterId)) {
    return surahAudioUrl(reciterId, Math.max(1, options.surah ?? 1));
  }
  return ayahAudioUrl(reciterId, Math.max(1, options.globalAyah ?? 1));
}

/** جودة الملف الصوتي (كيلوبت/ثانية) لحساب حجم التحميل التقديري. */
export function reciterBitrate(reciterId: string): number {
  return RECITER_QUALITY[reciterId] ?? 128;
}
