import { useEffect, useState } from "react";
import { SectionCard } from "./ui";
import { mushafOfflineStatus } from "../../lib/mushafOffline";
import { offlineFatwaCount } from "../../lib/fatwaOffline";

/* ملفات التطبيق المحمّلة على الجهاز: المصحف ونطقه، نطق التحفة، الفتاوى، وبطاقة الصلاة. */

const QURAN_AUDIO_CACHE = "thimar-audio-v1";
const TUHFA_AUDIO_CACHE = "thimar-tuhfa-audio-v1";

type FilesState = {
  pages: number;
  pagesTotal: number;
  quranAudio: number;
  tuhfaAudio: number;
  fatwas: number;
};

async function cacheSize(name: string): Promise<number> {
  if (typeof caches === "undefined") return 0;
  try {
    const cache = await caches.open(name);
    return (await cache.keys()).length;
  } catch {
    return 0;
  }
}

export default function AppFilesCard() {
  const [files, setFiles] = useState<FilesState | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([mushafOfflineStatus(), cacheSize(QURAN_AUDIO_CACHE), cacheSize(TUHFA_AUDIO_CACHE), offlineFatwaCount()])
      .then(([mushaf, quranAudio, tuhfaAudio, fatwas]) => {
        if (cancelled) return;
        setFiles({
          pages: mushaf.cached,
          pagesTotal: mushaf.total,
          quranAudio,
          tuhfaAudio,
          fatwas,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = [
    {
      key: "mushaf",
      label: "المصحف الكريم (نص كامل — ٦٠٤ صفحات)",
      value: files ? `${files.pages} / ${files.pagesTotal} صفحة` : "…",
      ready: Boolean(files && files.pages >= files.pagesTotal),
    },
    {
      key: "quran-audio",
      label: "تلاوة القرآن (ملفات صوتية)",
      value: files ? `${files.quranAudio} ملفًا` : "…",
      ready: Boolean(files && files.quranAudio > 0),
    },
    {
      key: "tuhfa-audio",
      label: "نطق تحفة الأطفال",
      value: files ? `${files.tuhfaAudio} ملفًا` : "…",
      ready: Boolean(files && files.tuhfaAudio > 0),
    },
    {
      key: "fatwas",
      label: "الفتاوى المحفوظة",
      value: files ? `${files.fatwas} فتوى` : "…",
      ready: Boolean(files && files.fatwas > 0),
    },
    {
      key: "prayer-card",
      label: "بطاقة الصلاة (صورة جاهزة)",
      value: "مضمّنة داخل التطبيق",
      ready: true,
    },
  ];

  return (
    <SectionCard title="ملفات التطبيق" subtitle="ما هو محمّل على هذا الجهاز الآن">
      <ul className="app-files-list">
        {rows.map((row) => (
          <li key={row.key} className={row.ready ? "ready" : ""}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </li>
        ))}
      </ul>
      <p className="muted">حمّل المصحف كاملًا من البطاقة أعلاه ليعمل دون إنترنت، ويظهر هنا مباشرة.</p>
    </SectionCard>
  );
}
