export type AutoTafsir = {
  videoId: string;
  title: string;
  channel: string;
  start: number;
  end: number;
  chapterLabel?: string | null;
  source?: string;
};

/**
 * يطلب من الخادم اختيار فيديو التفسير وتوقيت المقطع تلقائيًا
 * عبر YouTube Data API (المفتاح محفوظ في أسرار الخادم).
 * يعيد null بهدوء عند عدم التهيئة أو عدم وجود مطابقة.
 */
export type AutoTafsirResponse = {
  data: AutoTafsir | null;
  /** الخادم يعمل لكن مفتاح YOUTUBE_API_KEY غير مضاف في الأسرار. */
  unconfigured: boolean;
};

export async function fetchAutoTafsir(params: {
  book: "quran" | "tuhfa";
  surahName: string;
  from: number;
  to: number;
}): Promise<AutoTafsirResponse> {
  const query = new URLSearchParams({
    book: params.book,
    surah: params.surahName,
    from: String(params.from),
    to: String(params.to),
  });
  try {
    const response = await fetch(`/api/tafsir?${query.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    // Vite في الإنتاج يعيد index.html بدل المسار.
    if (!contentType.includes("application/json")) return { data: null, unconfigured: false };
    if (!response.ok) return { data: null, unconfigured: response.status === 501 };
    const data = (await response.json()) as Partial<AutoTafsir>;
    if (!data.videoId) return { data: null, unconfigured: false };
    return {
      unconfigured: false,
      data: {
        videoId: data.videoId,
        title: data.title ?? "",
        channel: data.channel ?? "",
        start: Number(data.start ?? 0),
        end: Number(data.end ?? 0),
        chapterLabel: data.chapterLabel ?? null,
        source: data.source,
      },
    };
  } catch {
    return { data: null, unconfigured: false };
  }
}
