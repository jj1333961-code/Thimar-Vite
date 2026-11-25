import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { surahs } from "../../data/surahs";
import { juzStarts, surahAyahCounts } from "../../data/juzSurahs";
import { fetchSurah, type Ayah } from "../../lib/quran";

import { useHistoryBack } from "../../lib/useHistoryBack";
import { loadQuranIndex, surahNameOf, type AyahInfo } from "../../lib/quranIndex";
import {
  buildNormalized,
  loadQuranSearchIndex,
  matchRange,
  normalizeQuery,
  searchQuran,
  type QuranSearchHit,
} from "../../lib/quranSearch";
import MushafPages from "./MushafPages";
import MushafTasmeeArchive from "./MushafTasmeeArchive";
import { Icon, type IconName } from "./ui";

type Tab = "juz" | "surah" | "marks" | "khatmah" | "notes" | "records";

type LastRead = { page: number; at: number; surah?: string; juz?: number };

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "juz", label: "الأجزاء", icon: "clipboard" },
  { id: "surah", label: "السور", icon: "book" },
  { id: "marks", label: "العلامات", icon: "star" },
  { id: "khatmah", label: "الخاتمة", icon: "clock" },
  { id: "notes", label: "الملاحظات", icon: "file" },
  { id: "records", label: "سجلات التسميع", icon: "clipboard" },
];

const PLACEHOLDERS: Record<Tab, string> = {
  surah: "ابحث باسم السورة أو رقمها…",
  juz: "ابحث برقم الجزء…",
  marks: "ابحث في العلامات…",
  khatmah: "اكتب رقم الصفحة للانتقال إليها…",
  notes: "ابحث في الملاحظات…",
  records: "ابحث في سجلات التسميع…",
};

/* ---------- تظليل نتيجة البحث داخل الآية ---------- */

const SEARCH_PAGE_SIZE = 40;

function highlightMatch(text: string, map: number[], startNorm: number, endNorm: number): ReactNode {
  if (startNorm < 0 || endNorm <= startNorm || map.length === 0) return text;
  const startOrig = map[startNorm] ?? 0;
  const endOrig = endNorm < map.length ? map[endNorm] : text.length;
  if (startOrig >= endOrig) return text;
  return (
    <>
      {text.slice(0, startOrig)}
      <mark>{text.slice(startOrig, endOrig)}</mark>
      {text.slice(endOrig)}
    </>
  );
}

export default function QuranReadingEntry({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("surah");
  const [query, setQuery] = useState("");
  const [openSurah, setOpenSurah] = useState<number | null>(null);
  const [surahAyahs, setSurahAyahs] = useState<Ayah[]>([]);
  const [surahLoading, setSurahLoading] = useState(false);
  const [surahSearch, setSurahSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchJuz, setSearchJuz] = useState(0);
  const [searchSurah, setSearchSurah] = useState(0);
  const [searchIndex, setSearchIndex] = useState<QuranSearchHit[] | null>(null);
  const [searchIndexProgress, setSearchIndexProgress] = useState(0);
  const [searchIndexError, setSearchIndexError] = useState(false);
  const [searchLimit, setSearchLimit] = useState(SEARCH_PAGE_SIZE);
  const [openPage, setOpenPage] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [index, setIndex] = useState<Map<number, AyahInfo>>(new Map());
  const [marks, setMarks] = useState<number[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [lastRead, setLastRead] = useState<LastRead | null>(null);

  const dismissSurah = useHistoryBack(openSurah !== null, () => setOpenSurah(null));
  const dismissSearch = useHistoryBack(searchOpen, () => setSearchOpen(false));

  /* فهرس الآيات المحلي: صفحة/سورة كل آية. */
  useEffect(() => {
    let active = true;
    loadQuranIndex().then((map) => {
      if (active) setIndex(map);
    });
    return () => {
      active = false;
    };
  }, []);

  /* العلامات والملاحظات وآخر صفحة قُرئت. */
  useEffect(() => {
    const read = () => {
      try {
        const rawMarks = JSON.parse(localStorage.getItem("thimar.reviewMarks") || "[]");
        setMarks(Array.isArray(rawMarks) ? rawMarks.map(Number).filter(Number.isFinite) : []);
      } catch {
        setMarks([]);
      }
      try {
        const rawNotes = JSON.parse(localStorage.getItem("thimar.notes") || "{}");
        setNotes(rawNotes && typeof rawNotes === "object" ? rawNotes : {});
      } catch {
        setNotes({});
      }
      try {
        const rawLast = JSON.parse(localStorage.getItem("thimar.lastMushaf") || "null");
        setLastRead(rawLast && typeof rawLast.page === "number" ? rawLast : null);
      } catch {
        setLastRead(null);
      }
    };
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [tab]);

  /* تحميل السورة كاملة عند اختيارها. */
  useEffect(() => {
    if (openSurah === null) return;
    const controller = new AbortController();
    setSurahLoading(true);
    setSurahAyahs([]);
    fetchSurah(openSurah, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSurahAyahs(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSurahAyahs([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSurahLoading(false);
      });
    return () => controller.abort();
  }, [openSurah]);

  /* فهرس البحث: يُحمَّل فقط عند فتح صفحة البحث، من ملف مضمَّن، فلا يتجمد التطبيق عند الدخول. */
  useEffect(() => {
    if (!searchOpen || searchIndex) return;
    let cancelled = false;
    setSearchIndexError(false);
    loadQuranSearchIndex((done, total) => {
      if (!cancelled) setSearchIndexProgress(total ? Math.round((done / total) * 100) : 0);
    })
      .then((value) => {
        if (!cancelled) setSearchIndex(value);
      })
      .catch(() => {
        if (!cancelled) setSearchIndexError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [searchOpen, searchIndex]);

  useEffect(() => {
    setSearchLimit(SEARCH_PAGE_SIZE);
  }, [searchQuery, searchSurah, searchJuz]);

  /* إدخال البحث مؤجَّل حتى يبقى الكتابة سلسة، والنتائج محدودة بصفحات. */
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchResults = useMemo(() => {
    if (!searchIndex || !deferredSearchQuery.trim()) return [];
    return searchQuran(searchIndex, deferredSearchQuery, searchSurah, searchJuz);
  }, [deferredSearchQuery, searchIndex, searchSurah, searchJuz]);
  const visibleSearchResults = useMemo(
    () => searchResults.slice(0, searchLimit),
    [searchResults, searchLimit],
  );
  const searchLoading = searchOpen && !searchIndex && !searchIndexError;
  const normalizedSearchQuery = useMemo(
    () => normalizeQuery(deferredSearchQuery),
    [deferredSearchQuery],
  );

  const openMushaf = (page: number, ayah?: number | null) => {
    setOpenPage(page);
    setHighlight(typeof ayah === "number" ? ayah : null);
  };

  const pageOfAyah = (global: number): number | null => index.get(global)?.page ?? null;

  const normalizedQuery = normalizeQuery(query);

  const firstPageByJuz = useMemo(() => {
    const map = new Map<number, number>();
    for (const info of index.values()) {
      if (!map.has(info.juz) || info.page < (map.get(info.juz) ?? Infinity)) {
        map.set(info.juz, info.page);
      }
    }
    return map;
  }, [index]);

  const surahList = useMemo(() => {
    const digits = query.trim();
    if (!digits) return surahs;
    return surahs.filter(
      (surah) => normalizeQuery(surah.name).includes(normalizedQuery) || String(surah.n) === digits,
    );
  }, [query, normalizedQuery]);

  /* أول صفحة في المصحف لكل سورة: اختيار السورة يفتح المصحف عندها. */
  const surahStartPages = useMemo(() => {
    const map = new Map<number, number>();
    for (const info of index.values()) {
      if (!map.has(info.surah) || info.page < (map.get(info.surah) ?? Infinity)) {
        map.set(info.surah, info.page);
      }
    }
    return map;
  }, [index]);

  const openSurahInMushaf = (surahNumber: number) => {
    const page = surahStartPages.get(surahNumber);
    setSurahSearch("");
    if (page) openMushaf(page);
    else setOpenSurah(surahNumber);
  };

  const juzList = useMemo(() => {
    const digits = query.replace(/[^\d]/g, "");
    return juzStarts.filter((item) => !digits || String(item.juz).includes(digits) || String(item.juz) === digits);
  }, [query]);

  const surahHits = useMemo(() => {
    const value = surahSearch.trim();
    if (!value) return [];
    const needle = normalizeQuery(value);
    return surahs.filter(
      (surah) => normalizeQuery(surah.name).includes(needle) || String(surah.n) === value,
    );
  }, [surahSearch]);

  const marksList = useMemo(() => {
    const needle = normalizeQuery(query);
    return [...marks]
      .sort((a, b) => a - b)
      .map((global) => ({ global, info: index.get(global) }))
      .filter(({ info, global }) => {
        if (!needle) return true;
        if (!info) return String(global).includes(needle);
        return (
          normalizeQuery(`${surahNameOf(info.surah)} ${info.ayah} ${info.text}`).includes(needle) ||
          String(global).includes(needle)
        );
      });
  }, [marks, index, query]);

  const notesList = useMemo(() => {
    const needle = normalizeQuery(query);
    return Object.entries(notes)
      .filter(([, value]) => value && value.trim())
      .map(([key, value]) => ({ global: Number(key), note: value, info: index.get(Number(key)) }))
      .sort((a, b) => a.global - b.global)
      .filter(({ note, info, global }) => {
        if (!needle) return true;
        const text = `${note} ${info ? surahNameOf(info.surah) + " " + info.ayah : ""} ${global}`;
        return normalizeQuery(text).includes(needle);
      });
  }, [notes, index, query]);

  /* فتح كامل الشاشة للمصحف داخل هذه الشاشة. */
  if (openPage !== null) {
    return <MushafPages onClose={() => setOpenPage(null)} initialPage={openPage} initialHighlight={highlight} />;
  }

  /* صفحة البحث في آية أو كلمة أو عبارة. */
  if (searchOpen) {
    return (
      <div className="page standalone-page quran-hub-page">
        <div className="quran-hub-box">
          <div className="quran-hub-head">
            <button type="button" className="quran-hub-back" onClick={dismissSearch} aria-label="إغلاق">
              <Icon name="x" size={18} />
            </button>
            <strong>البحث في القرآن الكريم</strong>
            <span className="muted quran-hub-count">
              {searchLoading
                ? searchIndexProgress
                  ? `تجهيز البحث… ${searchIndexProgress}%`
                  : "جارٍ تجهيز البحث…"
                : `${searchResults.length} نتيجة`}
            </span>
          </div>

          <div className="quran-hub-search">
            <Icon name="search" size={18} />
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="ابحث في القرآن الكريم بحرف أو كلمة أو آية…"
              aria-label="البحث في آيات القرآن"
            />
            {searchQuery ? (
              <button type="button" className="quran-hub-clear" onClick={() => setSearchQuery("")} aria-label="مسح">
                <Icon name="x" size={16} />
              </button>
            ) : null}
          </div>

          <div className="quran-hub-filters">
            <select
              className="quran-hub-filter"
              value={searchSurah}
              onChange={(event) => setSearchSurah(Number(event.target.value))}
              aria-label="تصفية حسب السورة"
            >
              <option value={0}>كل السور</option>
              {surahs.map((s) => (
                <option key={s.n} value={s.n}>{s.n}. {s.name}</option>
              ))}
            </select>
            <select
              className="quran-hub-filter"
              value={searchJuz}
              onChange={(event) => setSearchJuz(Number(event.target.value))}
              aria-label="تصفية حسب الجزء"
            >
              <option value={0}>كل الأجزاء</option>
              {Array.from({ length: 30 }, (_, i) => i + 1).map((j) => (
                <option key={j} value={j}>الجزء {j}</option>
              ))}
            </select>
          </div>

          <div className="quran-hub-content">
            {searchIndexError ? (
              <p className="quran-hub-empty">تعذّر تجهيز البحث في المصحف. أغلق الصفحة وأعد المحاولة.</p>
            ) : null}
            {!searchLoading && !searchIndexError && searchQuery.trim() && searchResults.length === 0 ? (
              <p className="quran-hub-empty">لا توجد نتائج مطابقة لـ «{searchQuery.trim()}».</p>
            ) : null}
            {visibleSearchResults.map((match) => {
              const page = match.page ?? pageOfAyah(match.number);
              const range = matchRange(match.norm, normalizedSearchQuery);
              const map = range ? buildNormalized(match.text).map : [];
              return (
                <button
                  key={`${match.number}-${match.surah.number}-${match.numberInSurah}`}
                  type="button"
                  className="quran-hub-result"
                  onClick={() => {
                    if (page) openMushaf(page, match.number);
                  }}
                >
                  <span className="quran-hub-result-ref">
                    سورة {match.surah?.name ?? surahNameOf(match.surah?.number)} • الآية {match.numberInSurah}
                    {page ? ` • صفحة ${page}` : ""}
                  </span>
                  <span className="quran-hub-result-text">
                    {range ? highlightMatch(match.text, map, range.start, range.end) : match.text}
                  </span>
                </button>
              );
            })}
            {visibleSearchResults.length < searchResults.length ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => setSearchLimit((value) => value + SEARCH_PAGE_SIZE)}
              >
                عرض المزيد ({searchResults.length - visibleSearchResults.length} نتيجة متبقية)
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  /* عرض السورة كاملة مع بحث باسم السورة. */
  if (openSurah !== null) {
    const surahName = surahNameOf(openSurah);
    const startPage = index.size > 0
      ? [...index.values()].find((info) => info.surah === openSurah)?.page ?? null
      : null;
    return (
      <div className="page standalone-page quran-hub-page">
        <div className="quran-hub-box">
          <div className="quran-hub-head">
            <button type="button" className="quran-hub-back" onClick={dismissSurah} aria-label="رجوع">
              <Icon name="arrow-right" size={18} />
            </button>
            <strong>سورة {surahName}</strong>
            <button
              type="button"
              className="quran-hub-open"
              onClick={() => {
                if (startPage) openMushaf(startPage);
              }}
              disabled={!startPage}
            >
              <Icon name="book" size={15} /> المصحف
            </button>
          </div>

          <div className="quran-hub-search">
            <Icon name="search" size={18} />
            <input
              value={surahSearch}
              onChange={(event) => setSurahSearch(event.target.value)}
              placeholder="ابحث باسم السورة للانتقال إليها…"
              aria-label="بحث باسم السورة"
            />
            {surahSearch ? (
              <button type="button" className="quran-hub-clear" onClick={() => setSurahSearch("")} aria-label="مسح">
                <Icon name="x" size={16} />
              </button>
            ) : null}
          </div>

          {surahSearch.trim() ? (
            <div className="quran-hub-hits">
              {surahHits.length === 0 ? (
                <p className="quran-hub-empty">لا توجد سورة بهذا الاسم.</p>
              ) : (
                surahHits.slice(0, 8).map((surah) => (
                  <button
                    key={surah.n}
                    type="button"
                    className="quran-hub-item"
                    onClick={() => {
                      setOpenSurah(surah.n);
                      setSurahSearch("");
                    }}
                  >
                    <span className="quran-hub-num">{surah.n}</span>
                    <span className="quran-hub-item-body">
                      <strong>{surah.name}</strong>
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}

          <div className="quran-hub-surah">
            {surahLoading ? <p className="quran-hub-empty">جارٍ تحميل السورة…</p> : null}
            {!surahLoading && surahAyahs.length === 0 ? (
              <p className="quran-hub-empty">تعذّر تحميل السورة.</p>
            ) : null}
            {!surahLoading && surahAyahs.length > 0 ? (
              <>
                {openSurah !== 1 && openSurah !== 9 ? (
                  <div className="quran-hub-basmalah">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>
                ) : null}
                {surahAyahs.map((ayah) => (
                  <p key={ayah.number} className="quran-hub-ayah">
                    {ayah.text}
                    <span className="quran-hub-ayah-num">{ayah.numberInSurah}</span>
                  </p>
                ))}
              </>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  /* الصفحة الرئيسية: صندوق البحث والتبويبات والمحتوى أسفلها. */
  return (
    <div className="page standalone-page quran-hub-page">
      <div className="quran-hub-box">
        <div className="quran-hub-head">
          <button type="button" className="quran-hub-back quran-hub-close" onClick={onBack} aria-label="إغلاق">
            <Icon name="x" size={18} />
          </button>
          <strong>القرآن الكريم</strong>
          <span className="muted quran-hub-count">صفحة {lastRead?.page ?? 1}</span>
        </div>

        {/* البحث في القرآن: أعلى خانة البحث عن اسم السورة، والضغط عليها يفتح صفحة البحث بالحرف/الكلمة. */}
        <button
          type="button"
          className="quran-hub-search quran-hub-search--ayah"
          onClick={() => setSearchOpen(true)}
          aria-label="البحث في القرآن الكريم بحرف أو كلمة أو آية"
        >
          <Icon name="search" size={18} />
          <span className="quran-hub-search-hint">ابحث في القرآن الكريم بحرف أو كلمة أو آية…</span>
          <span className="quran-hub-search-go" aria-hidden="true">
            <Icon name="x" size={18} />
          </span>
        </button>

        <div className="quran-hub-search">
          <Icon name="search" size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              if (tab === "khatmah") {
                const page = Number(query.replace(/[^\d]/g, ""));
                if (page >= 1 && page <= 604) openMushaf(page);
              }
            }}
            placeholder={PLACEHOLDERS[tab]}
            aria-label="البحث حسب التبويب المحدد"
          />
          {query ? (
            <button type="button" className="quran-hub-clear" onClick={() => setQuery("")} aria-label="مسح">
              <Icon name="x" size={16} />
            </button>
          ) : null}
        </div>

        <div className="quran-hub-tabs" role="tablist" aria-label="أقسام المصحف">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`quran-hub-tab ${tab === item.id ? "active" : ""}`}
              onClick={() => {
                setTab(item.id);
                setQuery("");
              }}
            >
              <Icon name={item.icon} size={15} />
              {item.label}
            </button>
          ))}
        </div>

        <div className="quran-hub-content">
          {tab === "surah" ? (
            <div className="quran-hub-list">
              {surahList.length === 0 ? <p className="quran-hub-empty">لا توجد سورة بهذا الاسم.</p> : null}
              {surahList.map((surah) => (
                <button
                  key={surah.n}
                  type="button"
                  className="quran-hub-item"
                  onClick={() => openSurahInMushaf(surah.n)}
                >
                  <span className="quran-hub-num">{surah.n}</span>
                  <span className="quran-hub-item-body">
                    <strong>سورة {surah.name}</strong>
                    <span>{surahAyahCounts[surah.n - 1] ?? 0} آية</span>
                  </span>
                  <Icon name="arrow-right" size={16} className="quran-hub-chevron" />
                </button>
              ))}
            </div>
          ) : null}

          {tab === "juz" ? (
            <div className="quran-hub-list">
              {juzList.length === 0 ? <p className="quran-hub-empty">لا يوجد جزء بهذا الرقم.</p> : null}
              {juzList.map((item) => {
                const firstPage = firstPageByJuz.get(item.juz) ?? null;
                return (
                  <button
                    key={item.juz}
                    type="button"
                    className="quran-hub-item"
                    onClick={() => {
                      if (firstPage) openMushaf(firstPage);
                    }}
                    disabled={!firstPage}
                  >
                    <span className="quran-hub-num">{item.juz}</span>
                    <span className="quran-hub-item-body">
                      <strong>الجزء {item.juz}</strong>
                      <span>
                        يبدأ من {surahNameOf(item.surah)} • الآية {item.ayah}
                        {firstPage ? ` • صفحة ${firstPage}` : ""}
                      </span>
                    </span>
                    <Icon name="arrow-right" size={16} className="quran-hub-chevron" />
                  </button>
                );
              })}
            </div>
          ) : null}

          {tab === "marks" ? (
            <div className="quran-hub-list">
              {marksList.length === 0 ? (
                <p className="quran-hub-empty">لا توجد علامات مراجعة بعد. أضفها من داخل المصحف.</p>
              ) : null}
              {marksList.map(({ global, info }) => (
                <button
                  key={global}
                  type="button"
                  className="quran-hub-item"
                  onClick={() => {
                    const page = info?.page ?? pageOfAyah(global);
                    if (page) openMushaf(page, global);
                  }}
                >
                  <span className="quran-hub-num">
                    <Icon name="star" size={16} />
                  </span>
                  <span className="quran-hub-item-body">
                    <strong>
                      {info ? `سورة ${surahNameOf(info.surah)} • الآية ${info.ayah}` : `الآية ${global}`}
                    </strong>
                    <span>
                      {info ? info.text : "علامة مراجعة"}
                      {info ? ` • صفحة ${info.page}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {tab === "notes" ? (
            <div className="quran-hub-list">
              {notesList.length === 0 ? (
                <p className="quran-hub-empty">لا توجد ملاحظات بعد. أضفها من داخل المصحف عند الوقوف على آية.</p>
              ) : null}
              {notesList.map(({ global, note, info }) => (
                <button
                  key={global}
                  type="button"
                  className="quran-hub-item"
                  onClick={() => {
                    const page = info?.page ?? pageOfAyah(global);
                    if (page) openMushaf(page, global);
                  }}
                >
                  <span className="quran-hub-num">
                    <Icon name="file" size={16} />
                  </span>
                  <span className="quran-hub-item-body">
                    <strong>
                      {info ? `سورة ${surahNameOf(info.surah)} • الآية ${info.ayah}` : `الآية ${global}`}
                    </strong>
                    <span>{note}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {tab === "records" ? (
            <div className="quran-hub-list">
              <MushafTasmeeArchive />
            </div>
          ) : null}

          {tab === "khatmah" ? (
            <div className="quran-hub-khatmah">
              {lastRead ? (
                <>
                  <span className="quran-hub-khatmah-label">آخر صفحة فتحتها في المصحف</span>
                  <span className="quran-hub-khatmah-page">صفحة {lastRead.page}</span>
                  {lastRead.surah ? (
                    <span className="muted">
                      سورة {lastRead.surah}
                      {lastRead.juz ? ` • الجزء ${lastRead.juz}` : ""}
                    </span>
                  ) : null}
                  <span className="muted">
                    {new Date(lastRead.at).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                  <button type="button" className="primary-button" onClick={() => openMushaf(lastRead.page)}>
                    متابعة القراءة من حيث توقفت
                  </button>
                </>
              ) : (
                <>
                  <p className="quran-hub-empty">لم تفتح أي صفحة من المصحف بعد.</p>
                  <button type="button" className="primary-button" onClick={() => openMushaf(1)}>
                    ابدأ من صفحة 1
                  </button>
                </>
              )}
              {query.trim() ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    const page = Number(query.replace(/[^\d]/g, ""));
                    if (page >= 1 && page <= 604) openMushaf(page);
                  }}
                >
                  الانتقال إلى الصفحة {query.replace(/[^\d]/g, "") || "—"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
