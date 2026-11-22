export type TafsirVideo = {
  id: string;
  title: string;
  channel: string;
  /** معرّف فيديو يوتيوب (watch/embed) */
  videoId?: string;
  /** معرّف قائمة تشغيل يوتيوب */
  playlistId?: string;
};

/**
 * مكتبة فيديوهات تفسير موثوقة (قنوات معروفة).
 * تُضمَّن داخل الصفحة، ويمكن اقتصاص الفيديو على مقطع محدد عبر start/end.
 */
export const quranTafsirLibrary: TafsirVideo[] = [
  {
    id: "adawi-full",
    title: "تفسير القرآن الكريم كاملًا — مرتّب على الآيات",
    channel: "الشيخ مصطفى العدوي",
    playlistId: "PL92HwYx3aJluEiTdotGejIsuoTnnTwXl0",
  },
  {
    id: "shaarawi-full",
    title: "سلسلة تفسير القرآن الكريم",
    channel: "القناة الرسمية للشيخ الشعراوي",
    playlistId: "PLjdstnTfkW8iG1T1TGVffBRIa4WFMy6zl",
  },
  {
    id: "fatiha",
    title: "تفسير سورة الفاتحة (6 حلقات)",
    channel: "قناة الشيخ الشعراوي",
    playlistId: "PL080E6868C6CFA15F",
  },
  {
    id: "baqara-1-5",
    title: "تفسير الشعراوي — البقرة 1–5",
    channel: "القناة الرسمية للشيخ الشعراوي",
    videoId: "LozezgxC6ZQ",
  },
];

export const tuhfaTafsirLibrary: TafsirVideo[] = [
  {
    id: "taj-1",
    title: "شرح تحفة الأطفال — الحلقة 1 (مقدمة الأبيات)",
    channel: "مؤسسة تاج لتعليم القرآن الكريم",
    videoId: "8Do87VxmhLQ",
  },
  {
    id: "taj-playlist",
    title: "شرح تحفة الأطفال (8 حلقات)",
    channel: "مؤسسة تاج لتعليم القرآن الكريم",
    playlistId: "PLdkqnk87UnGHLBG_-swDHin4rXc2hF-5G",
  },
  {
    id: "araini",
    title: "شرح تحفة الأطفال",
    channel: "الشيخ محمد بن عبد الله العريني",
    playlistId: "PLNLdDOYQ5Uc6sm9AUmPXOcqQIOh-d-zkO",
  },
  {
    id: "kamees",
    title: "شرح تحفة الأطفال — مقدمة الكتاب",
    channel: "د. عثمان الخميس",
    videoId: "N_fOpCtLN-I",
  },
  {
    id: "by-verses",
    title: "تحفة الأطفال مقسّمة على الأبيات (مكرّرة للحفظ)",
    channel: "د. أحمد بن شهاب حامد",
    playlistId: "PL2KOHInv_fdQGi6DgxfPafS7R87g_6IBQ",
  },
];

export function tafsirLibraryFor(book: "quran" | "tuhfa", surah?: number): TafsirVideo[] {
  if (book === "tuhfa") return tuhfaTafsirLibrary;
  if (surah === 1) {
    const fatiha = quranTafsirLibrary.find((v) => v.id === "fatiha");
    return fatiha ? [fatiha, ...quranTafsirLibrary.filter((v) => v.id !== "fatiha")] : quranTafsirLibrary;
  }
  if (surah === 2) {
    const baqara = quranTafsirLibrary.find((v) => v.id === "baqara-1-5");
    return baqara ? [baqara, ...quranTafsirLibrary.filter((v) => v.id !== "baqara-1-5")] : quranTafsirLibrary;
  }
  return quranTafsirLibrary;
}

/** يحوّل «1:20» أو «80» إلى ثوانٍ. */
export function toSeconds(value: string): number {
  const clean = value.trim();
  if (!clean) return 0;
  if (/^\d+$/.test(clean)) return Number(clean);
  const parts = clean.split(":").map((p) => Number(p.trim()));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function formatClock(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** يبني رابط تضمين يوتيوب مع اقتصاص المقطع (start/end). */
export function buildEmbedUrl(video: TafsirVideo, start: number, end: number): string {
  const params = new URLSearchParams();
  params.set("rel", "0");
  params.set("modestbranding", "1");
  if (start > 0) params.set("start", String(Math.floor(start)));
  if (end > start && end > 0) params.set("end", String(Math.floor(end)));
  if (video.videoId) return `https://www.youtube.com/embed/${video.videoId}?${params.toString()}`;
  return `https://www.youtube.com/embed/videoseries?list=${video.playlistId ?? ""}&${params.toString()}`;
}
