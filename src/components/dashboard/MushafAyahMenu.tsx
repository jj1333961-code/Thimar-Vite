import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTafsir } from "../../lib/quran";
import { isMarked, setReviewMark, toggleMark } from "../../lib/mushafMarks";
import { readAyahNotes, saveAyahNote } from "../../lib/ayahNotes";
import { arabicNumber, selectionTitle, surahNameOfNumber } from "../../lib/ayahImage";
import { ayahKey, type HafsAyah } from "../../lib/mushafText";
import AyahAudioSheet from "./AyahAudioSheet";
import AyahReciteSheet from "./AyahReciteSheet";
import AyahShareSheet from "./AyahShareSheet";

/*
 * قائمة إجراءات الآية الدائرية: زر X في المركز بالضبط، وحوله ثمانية أزرار
 * برتقالية بأيقونات بيضاء — إخفاء النص، التفسير، الاستماع، المشاركة، العلامة،
 * الملاحظة، النسخ، والتسميع. كل زر ينفّذ وظيفته فعليًا على التحديد كاملًا.
 */

type Panel = "tafsir" | "notes" | "tasmee" | null;
type Sheet = "audio" | "share" | "recite" | null;

const ICONS: Record<string, string> = {
  close: "M6 6l12 12M18 6 6 18",
  hide: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5v.01M9.8 9a2.2 2.2 0 1 1 3.2 2c-.7.4-1 1-1 1.8",
  tafsir: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm3 4h8M8 12h8M8 16h5",
  play: "M8 5.5v13l11-6.5-11-6.5Z",
  share: "M12 16V4m0 0L8 8m4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5",
  pin: "M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z",
  note: "M5 3h9l6 6v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 1v6h6M7 14h10M7 18h7",
  copy: "M9 9V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4M4 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0M12 18v3",
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={ICONS[name]}
        fill={name === "pin" || name === "play" ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type TafsirRow = { key: string; label: string; text: string; tafsir: string };

export default function MushafAyahMenu({
  ayahs,
  page,
  anchor,
  hidden,
  onClose,
  onClearSelection,
  onToggleHidden,
  onToast,
  onOpenPage,
  onStartTasmee,
}: {
  ayahs: HafsAyah[];
  page: number;
  anchor: { x: number; y: number };
  hidden: Set<string>;
  onClose: () => void;
  onClearSelection: () => void;
  onToggleHidden: (keys: string[]) => void;
  onToast: (message: string) => void;
  onOpenPage: (page: number) => void;
  /** فتح جلسة تسميع المصحف (الصفحة/المحدد/السورة) بدل ورقة التسميع القديمة. */
  onStartTasmee?: (revealVerses: boolean) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [audioCompact, setAudioCompact] = useState(false);
  const [tafsirRows, setTafsirRows] = useState<TafsirRow[] | null>(null);
  const [tafsirLoading, setTafsirLoading] = useState(false);
  const [tafsirError, setTafsirError] = useState("");
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 360 : window.innerWidth,
    height: typeof window === "undefined" ? 640 : window.innerHeight,
  }));
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const keys = useMemo(() => ayahs.map((ayah) => ayahKey(ayah.surah, ayah.ayah)), [ayahs]);
  const [marked, setMarked] = useState(() => ayahs.every((ayah) => isMarked(ayah.surah, ayah.ayah)));

  useEffect(() => {
    setMarked(ayahs.every((ayah) => isMarked(ayah.surah, ayah.ayah)));
  }, [ayahs]);
  const allHidden = useMemo(() => keys.every((key) => hidden.has(key)), [hidden, keys]);
  const title = selectionTitle(ayahs);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (sheet) return;
      if (panel) {
        setPanel(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, panel, sheet]);

  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
    },
    [],
  );

  /* الجولة: ثمانية أزرار حول المركز بحجم مصغّر يناسب الشاشة مع إبقاء القائمة داخلها. */
  const layout = useMemo(() => {
    const size = viewport.width < 380 ? 38 : 42;
    const radius = Math.max(64, Math.min(84, Math.min(viewport.width, viewport.height) / 4.9));
    const side = radius + size / 2 + 8;
    const minX = side;
    const maxX = Math.max(minX, viewport.width - side);
    const minY = radius + size / 2 + 10;
    const maxY = Math.max(minY, viewport.height - (radius + size / 2 + 40));
    return {
      size,
      radius,
      centerX: Math.min(Math.max(anchor.x, minX), maxX),
      centerY: Math.min(Math.max(anchor.y, minY), maxY),
    };
  }, [anchor.x, anchor.y, viewport.height, viewport.width]);

  const openTafsir = () => {
    setPanel("tafsir");
    if (tafsirRows || tafsirLoading) return;
    setTafsirLoading(true);
    setTafsirError("");
    Promise.all(
      ayahs.map(async (ayah) => {
        const entry = await fetchTafsir(ayah.surah, ayah.ayah);
        return {
          key: ayahKey(ayah.surah, ayah.ayah),
          label: `${surahNameOfNumber(ayah.surah)} — الآية ${arabicNumber(ayah.ayah)}`,
          text: `${ayah.text} ﴿${arabicNumber(ayah.ayah)}﴾`,
          tafsir: entry.text,
        };
      }),
    )
      .then(setTafsirRows)
      .catch(() => setTafsirError("تعذّر تحميل التفسير. تحقّق من الاتصال ثم أعد المحاولة."))
      .finally(() => setTafsirLoading(false));
  };

  const openNotes = () => {
    const existing = readAyahNotes();
    const draft: Record<string, string> = {};
    for (const ayah of ayahs) draft[ayahKey(ayah.surah, ayah.ayah)] = existing[String(ayah.global)] ?? "";
    setNoteDraft(draft);
    setPanel("notes");
  };

  const handleBookmark = () => {
    const next = !marked;
    ayahs.forEach((ayah) => {
      const already = isMarked(ayah.surah, ayah.ayah);
      if (next && !already) {
        toggleMark({ surah: ayah.surah, ayah: ayah.ayah, page: ayah.page, at: Date.now(), text: ayah.text.slice(0, 180) });
      } else if (!next && already) {
        toggleMark({ surah: ayah.surah, ayah: ayah.ayah, page: ayah.page, at: Date.now(), text: ayah.text.slice(0, 180) });
      }
      // تظهر العلامة أيضًا في تبويب «العلامات» بصفحة القرآن للرجوع إليها لاحقًا.
      if (next) setReviewMark(ayah.global, true);
      else setReviewMark(ayah.global, false);
    });
    setMarked(next);
    onToast(next ? `حُفظت ${ayahs.length} آيات في العلامات` : "أُزيلت العلامة");
  };

  const handleCopy = async () => {
    const body = ayahs
      .map(
        (ayah) =>
          `سورة ${surahNameOfNumber(ayah.surah)} — الآية ${arabicNumber(ayah.ayah)}\n${ayah.text} ﴿${arabicNumber(ayah.ayah)}﴾`,
      )
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(body);
      onToast("نُسخت الآيات مع أسمائها وأرقامها");
    } catch {
      onToast("تعذّر النسخ على هذا المتصفح");
    }
  };

  const saveNotes = () => {
    ayahs.forEach((ayah) => saveAyahNote(ayah.global, noteDraft[ayahKey(ayah.surah, ayah.ayah)] ?? ""));
    onToast("حُفظت الملاحظات مع مراجع الآيات");
    setPanel(null);
  };

  const actions = [
    { key: "hide", label: allHidden ? "إظهار نص الآية" : "إخفاء نص الآية", run: () => onToggleHidden(keys), active: allHidden },
    { key: "tafsir", label: "التفسير", run: openTafsir },
    { key: "play", label: "الاستماع والتكرار", run: () => setSheet("audio") },
    { key: "share", label: "مشاركة صورة الآيات", run: () => setSheet("share") },
    { key: "pin", label: "علامة مرجعية", run: handleBookmark, active: marked },
    { key: "note", label: "ملاحظة شخصية", run: openNotes },
    { key: "copy", label: "نسخ الآيات", run: () => void handleCopy() },
    { key: "mic", label: "تسميع الآيات", run: () => (onStartTasmee ? onStartTasmee(false) : setSheet("recite")) },
  ];

  return (
    <>
      {!audioCompact ? <div className="mushaf-ayah-menu-layer" onClick={onClose}>
        <div
          className="mushaf-ayah-menu"
          style={{
            left: `${layout.centerX}px`,
            top: `${layout.centerY}px`,
            ["--ayah-menu-radius" as string]: `${layout.radius}px`,
            ["--ayah-menu-size" as string]: `${layout.size}px`,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="mushaf-ayah-menu-btn is-center"
            onClick={onClearSelection}
            aria-label="إلغاء التحديد وإغلاق القائمة"
            title="إلغاء التحديد"
          >
            <Icon name="close" />
          </button>

          {actions.map((action, index) => {
            const angle = (-90 + index * 45) * (Math.PI / 180);
            const x = Math.cos(angle) * layout.radius;
            const y = Math.sin(angle) * layout.radius;
            return (
              <button
                key={action.key}
                type="button"
                className={`mushaf-ayah-menu-btn${action.active ? " is-active" : ""}`}
                style={{
                  transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
                  animationDelay: `${index * 22}ms`,
                }}
                onClick={action.run}
                aria-label={action.label}
                title={action.label}
              >
                <Icon name={action.key} />
              </button>
            );
          })}

          <span className="mushaf-ayah-menu-badge">{title}</span>
        </div>
      </div> : null}

      {panel ? (
        <div className="mushaf-ayah-sheet-backdrop" onClick={() => setPanel(null)}>
          <div className="mushaf-ayah-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="mushaf-ayah-sheet-head">
              <h3>{panel === "tafsir" ? "التفسير الميسر" : panel === "tasmee" ? "تسميع الآيات" : "ملاحظاتي على الآيات"}</h3>
              <button type="button" onClick={() => setPanel(null)} aria-label="إغلاق">
                ×
              </button>
            </div>
            <p className="mushaf-ayah-sheet-sub">{title}</p>

            {panel === "tafsir" ? (
              tafsirLoading ? (
                <p className="mushaf-ayah-sheet-note">جارٍ تحميل التفسير…</p>
              ) : tafsirError ? (
                <p className="mushaf-ayah-sheet-note">{tafsirError}</p>
              ) : (
                <div className="ayah-tafsir-list">
                  {(tafsirRows ?? []).map((row) => (
                    <article key={row.key} className="ayah-tafsir-item">
                      <h4>{row.label}</h4>
                      <p className="ayah-tafsir-verse">{row.text}</p>
                      <p className="mushaf-ayah-sheet-text">{row.tafsir}</p>
                    </article>
                  ))}
                </div>
              )
            ) : (
              <>
                <div className="ayah-notes-list">
                  {ayahs.map((ayah) => {
                    const key = ayahKey(ayah.surah, ayah.ayah);
                    return (
                      <label key={key} className="ayah-note-field">
                        <span>{`${surahNameOfNumber(ayah.surah)} — الآية ${arabicNumber(ayah.ayah)}`}</span>
                        <textarea
                          rows={3}
                          value={noteDraft[key] ?? ""}
                          onChange={(event) => setNoteDraft((current) => ({ ...current, [key]: event.target.value }))}
                          placeholder="اكتب ملاحظتك على هذه الآية…"
                        />
                      </label>
                    );
                  })}
                </div>
                <button type="button" className="primary-button" onClick={saveNotes}>
                  حفظ الملاحظات
                </button>
              </>
            )}

            <div className="ayah-menu-sheet-links">
              <button type="button" className="ghost-button" onClick={() => onOpenPage(page)}>
                {`العودة إلى صفحة ${page}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sheet === "audio" ? <AyahAudioSheet ayahs={ayahs} page={page} onCompactChange={setAudioCompact} onClose={() => { setAudioCompact(false); setSheet(null); onClose(); }} /> : null}
      {sheet === "share" ? <AyahShareSheet ayahs={ayahs} onClose={() => setSheet(null)} /> : null}
      {sheet === "recite" ? <AyahReciteSheet ayahs={ayahs} onClose={() => setSheet(null)} /> : null}
    </>
  );
}
