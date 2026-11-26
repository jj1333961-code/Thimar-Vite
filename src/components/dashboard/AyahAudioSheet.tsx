import { useEffect, useMemo, useState } from "react";
import {
  ayahAudioUrl,
  reciters as bundledReciters,
  reciterIsSurah,
  repeatOptions,
  surahAudioUrl,
  type Reciter,
} from "../../data/reciters";
import { loadReciterCatalog, readCachedReciters } from "../../lib/reciterCatalog";
import { loadHafsPage, loadHafsSurah, type HafsAyah } from "../../lib/mushafText";
import { arabicNumber, surahNameOfNumber } from "../../lib/ayahImage";
import type { AyahPlayItem } from "../../lib/ayahPlayer";

/*
 * نافذة الاستماع والتكرار: نطاق واحد واضح (الآيات المحددة / الصفحة الحالية /
 * السورة كاملة)، قارئ من الكتالوج الكامل، وعدد مرات تكرار واحد بلا صناديق
 * متكررة. زر البدء يسلّم التشغيل للمشغل المصغّر فوق صفحة المصحف.
 */

export type AudioScope = "selection" | "page" | "surah";

export type AudioStartMeta = { reciterId: string; scope: AudioScope };

const PREFS_KEY = "thimar.mushaf.audio.prefs.v2";

type Prefs = { reciterId?: string; scope?: AudioScope; repeat?: number };

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Prefs;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* التخزين غير متاح */
  }
}

const SCOPES: { id: AudioScope; label: string }[] = [
  { id: "selection", label: "الآيات المحددة" },
  { id: "page", label: "الصفحة الحالية" },
  { id: "surah", label: "السورة كاملة" },
];

export default function AyahAudioSheet({
  ayahs,
  page,
  onClose,
  onStart,
}: {
  ayahs: HafsAyah[];
  page: number;
  onClose: () => void;
  onStart: (items: AyahPlayItem[], repeat: number, meta: AudioStartMeta) => void;
}) {
  const [prefs] = useState<Prefs>(() => readPrefs());
  const [scope, setScope] = useState<AudioScope>(prefs.scope ?? "selection");
  const [repeat, setRepeat] = useState(() =>
    repeatOptions.includes(Number(prefs.repeat)) ? Number(prefs.repeat) : 2,
  );
  const [list, setList] = useState<Reciter[]>(() => {
    const cached = readCachedReciters();
    return cached.length ? cached : bundledReciters;
  });
  const [catalogNote, setCatalogNote] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [reciterId, setReciterId] = useState(() => {
    const cached = readCachedReciters();
    const wanted = prefs.reciterId ?? "";
    return (cached.length ? cached : bundledReciters).some((reciter) => reciter.id === wanted)
      ? wanted
      : (cached[0] ?? bundledReciters[0]).id;
  });
  const [scopeAyahs, setScopeAyahs] = useState<HafsAyah[]>(ayahs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const surah = ayahs[0]?.surah ?? 1;

  useEffect(() => {
    let cancelled = false;
    loadReciterCatalog()
      .then((catalog) => {
        if (cancelled) return;
        setList(catalog.reciters);
        setCatalogNote(catalog.error);
        setReciterId((current) =>
          catalog.reciters.some((reciter) => reciter.id === current)
            ? current
            : catalog.reciters[0].id,
        );
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writePrefs({ reciterId, scope, repeat });
  }, [reciterId, scope, repeat]);

  useEffect(() => {
    if (scope === "selection") {
      setScopeAyahs(ayahs);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const task = scope === "page" ? loadHafsPage(page) : loadHafsSurah(surah);
    task
      .then((value) => {
        if (!cancelled) setScopeAyahs(value);
      })
      .catch(() => {
        if (cancelled) return;
        setScopeAyahs([]);
        setError("تعذّر تحميل آيات هذا النطاق. تحقّق من ملفات المصحف ثم أعد المحاولة.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, page, surah, ayahs]);

  const surahOnly = reciterIsSurah(reciterId, list);
  const visibleReciters = useMemo(() => {
    const term = filter.trim();
    if (!term) return list;
    return list.filter((reciter) => reciter.name.includes(term));
  }, [filter, list]);

  const scopeLabel =
    scope === "selection"
      ? `${arabicNumber(ayahs.length)} آيات محددة`
      : scope === "page"
        ? `الصفحة ${arabicNumber(page)}`
        : `سورة ${surahNameOfNumber(surah)}`;

  const start = () => {
    const reciter = list.find((item) => item.id === reciterId);
    if (!reciter) {
      setError("اختر قارئًا أولًا.");
      return;
    }
    if (loading) {
      setError("جارٍ تحميل آيات النطاق…");
      return;
    }
    const items: AyahPlayItem[] = [];
    if (surahOnly && scope === "surah") {
      items.push({
        url: surahAudioUrl(reciter.id, surah),
        label: `سورة ${surahNameOfNumber(surah)} — ${reciter.name}`,
      });
    } else if (surahOnly) {
      setError(
        "هذا القارئ متوفر بملف السورة كاملة فقط؛ اختر «السورة كاملة» أو قارئًا يتوفر له صوت آية بآية.",
      );
      return;
    } else {
      for (const ayah of scopeAyahs) {
        items.push({
          url: ayahAudioUrl(reciter.id, ayah.global),
          label: `${surahNameOfNumber(ayah.surah)} — الآية ${arabicNumber(ayah.ayah)}`,
        });
      }
    }
    if (!items.length) {
      setError("لا توجد آيات في هذا النطاق.");
      return;
    }
    setError("");
    onStart(items, repeat, { reciterId: reciter.id, scope });
  };

  return (
    <div className="mushaf-ayah-sheet-backdrop" onClick={onClose}>
      <div className="mushaf-ayah-sheet ayah-audio-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mushaf-ayah-sheet-head">
          <h3>الاستماع والتكرار</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق">
            ×
          </button>
        </div>

        <div className="ayah-audio-scopes" role="group" aria-label="نطاق التشغيل">
          {SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={scope === item.id ? "is-active" : ""}
              aria-pressed={scope === item.id}
              onClick={() => setScope(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <p className="ayah-audio-summary">{scopeLabel}</p>

        <label className="ayah-audio-field">
          <span>القارئ</span>
          <input
            type="search"
            className="ayah-audio-filter"
            placeholder="ابحث باسم القارئ"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="بحث في القراء"
          />
        </label>

        <label className="ayah-audio-field">
          <span>التلاوة</span>
          <select value={reciterId} onChange={(event) => setReciterId(event.target.value)}>
            {visibleReciters.length === 0 ? <option value={reciterId}>لا نتائج للبحث</option> : null}
            {visibleReciters.map((reciter) => (
              <option key={reciter.id} value={reciter.id}>
                {reciter.name}
              </option>
            ))}
          </select>
        </label>

        <label className="ayah-audio-field">
          <span>عدد مرات التكرار</span>
          <select value={repeat} onChange={(event) => setRepeat(Number(event.target.value))}>
            {repeatOptions.map((option) => (
              <option key={option} value={option}>
                {arabicNumber(option)} {option === 1 ? "مرة" : "مرات"}
              </option>
            ))}
          </select>
        </label>

        {catalogLoading ? <p className="mushaf-ayah-sheet-note">جارٍ تحميل قائمة القراء…</p> : null}
        {!catalogLoading && catalogNote ? <p className="mushaf-ayah-sheet-note">{catalogNote}</p> : null}
        {!catalogLoading ? (
          <p className="mushaf-ayah-sheet-note">
            {`القراء المتاحون: ${arabicNumber(list.length)} قارئًا — القائمة المضمّنة تعمل دون اتصال.`}
          </p>
        ) : null}
        {surahOnly ? (
          <p className="mushaf-ayah-sheet-note">
            هذا القارئ متوفر بملف السورة كاملة فقط؛ لتشغيل آيات محددة اختر قارئًا آخر.
          </p>
        ) : null}
        {loading ? <p className="mushaf-ayah-sheet-note">جارٍ تجهيز الآيات…</p> : null}
        {error ? <p className="mushaf-ayah-sheet-note">{error}</p> : null}

        <div className="ayah-audio-actions">
          <button type="button" className="primary-button" onClick={start} disabled={surahOnly && scope !== "surah"}>
            بدء
          </button>
          <button type="button" className="ghost-button" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
