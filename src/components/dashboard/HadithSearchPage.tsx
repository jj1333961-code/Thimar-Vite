import { useEffect, useMemo, useRef, useState } from "react";
import { hadiths, searchHadiths, type HadithEntry } from "../../data/hadiths";
import {
  HADITH_BOOKS,
  loadHadithBook,
  searchInBook,
  type RemoteHadith,
} from "../../lib/hadithApi";
import { aiChat } from "../../lib/ai";
import { Icon, EmptyState } from "./ui";

type Row = {
  key: string;
  title: string;
  text: string;
  grade: string;
  gradeKind: "صحيح" | "حسن" | "ضعيف" | "غير محدد";
  source: string;
  explanation?: string;
};

const LOCAL_ID = "local";

export default function HadithSearchPage() {
  const [bookId, setBookId] = useState<string>(LOCAL_ID);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [aiText, setAiText] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const loadedRef = useRef<Set<string>>(new Set());

  const localRows = useMemo<Row[]>(
    () =>
      hadiths.map((item: HadithEntry) => ({
        key: `local-${item.id}`,
        title: item.title,
        text: item.text,
        grade: item.grade,
        gradeKind: item.grade,
        source: item.source,
        explanation: item.explanation,
      })),
    [],
  );

  useEffect(() => {
    if (bookId === LOCAL_ID) {
      setRows(submitted ? searchHadiths(submitted).map((item) => ({
        key: `local-${item.id}`,
        title: item.title,
        text: item.text,
        grade: item.grade,
        gradeKind: item.grade,
        source: item.source,
        explanation: item.explanation,
      })) : localRows);
      setStatus(submitted ? "" : `مجموعة مختارة من ${hadiths.length} حديثًا موثّقًا.`);
      return;
    }
    let cancelled = false;
    const book = HADITH_BOOKS.find((item) => item.id === bookId);
    if (!book) return;
    setBusy(true);
    setRows([]);
    loadHadithBook(bookId, (message) => { if (!cancelled) setStatus(message); })
      .then((list) => {
        if (cancelled) return;
        loadedRef.current.add(bookId);
        setStatus(`${book.name}: ${list.length} حديثًا جاهزة للبحث.`);
        if (submitted) {
          const found = searchInBook(list, submitted);
          setRows(found.map(toRow));
          setStatus(`${found.length} نتيجة في ${book.name}.`);
        }
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "تعذّر التحميل.");
      })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  function toRow(item: RemoteHadith): Row {
    return {
      key: item.id,
      title: `${item.bookName} — حديث ${item.number}`,
      text: item.text,
      grade: item.grade,
      gradeKind: item.gradeKind,
      source: `${item.bookName} • رقم ${item.number}`,
    };
  }

  const runSearch = async () => {
    const value = query.trim();
    setSubmitted(value);
    setOpenKey(null);
    if (!value) {
      if (bookId === LOCAL_ID) {
        setRows(localRows);
        setStatus(`مجموعة مختارة من ${hadiths.length} حديثًا موثّقًا.`);
      }
      return;
    }
    if (bookId === LOCAL_ID) {
      const found = searchHadiths(value);
      setRows(found.map((item) => ({
        key: `local-${item.id}`,
        title: item.title,
        text: item.text,
        grade: item.grade,
        gradeKind: item.grade,
        source: item.source,
        explanation: item.explanation,
      })));
      setStatus(`${found.length} نتيجة في المجموعة المختارة.`);
      return;
    }
    const book = HADITH_BOOKS.find((item) => item.id === bookId);
    if (!book) return;
    setBusy(true);
    try {
      const list = await loadHadithBook(bookId, setStatus);
      const found = searchInBook(list, value);
      setRows(found.map(toRow));
      setStatus(`${found.length} نتيجة في ${book.name} من ${list.length} حديثًا.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "تعذّر البحث الآن.");
    } finally {
      setBusy(false);
    }
  };

  const explain = async (row: Row) => {
    if (aiText[row.key]) return;
    setAiBusy(row.key);
    try {
      const answer = await aiChat(
        [
          {
            role: "system",
            content:
              "أنت معلّم حديث نبوي. اشرح الحديث شرحًا مبسّطًا موثوقًا بلا تحيز: معنى المفردات، الفوائد، والتطبيق العملي في نقاط قصيرة.",
          },
          {
            role: "user",
            content: `الحديث: «${row.text}»\nالمصدر: ${row.source}\nاشرحه في خمس نقاط قصيرة.\nإن كان في درجة الحديث ضعف فاذكر ذلك بصراحة وبيّن أنه لا يُبنى عليه حكم.`,
          },
        ],
        { temperature: 0.3, maxTokens: 800 },
      );
      setAiText((previous) => ({ ...previous, [row.key]: answer }));
    } catch {
      setAiText((previous) => ({
        ...previous,
        [row.key]: `${row.explanation ?? "تعذّر الوصول إلى الذكاء الاصطناعي الآن."}\n\n(تعذّر الاتصال بالشرح الذكي؛ هذا شرح محلي مختصر.)`,
      }));
    } finally {
      setAiBusy(null);
    }
  };

  const gradeClass = (kind: Row["gradeKind"]) =>
    kind === "صحيح" ? "grade-saheeh" : kind === "حسن" ? "grade-hasan" : kind === "ضعيف" ? "grade-daif" : "grade-unknown";

  return (
    <div className="hadith-search-page">
      <div className="hadith-book-row">
        <button
          type="button"
          className={`chip-toggle ${bookId === LOCAL_ID ? "active" : ""}`}
          onClick={() => { setBookId(LOCAL_ID); setSubmitted(""); }}
        >
          مختارة
        </button>
        {HADITH_BOOKS.map((book) => (
          <button
            key={book.id}
            type="button"
            className={`chip-toggle ${bookId === book.id ? "active" : ""}`}
            onClick={() => setBookId(book.id)}
          >
            {book.name}
          </button>
        ))}
      </div>

      <div className="hadith-search-box">
        <Icon name="search" size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); }}
          placeholder="ابحث بكلمة أو أكثر في الأحاديث (عبر الإنترنت في الكتب الكبرى)…"
          aria-label="بحث في الأحاديث"
        />
        <button type="button" className="primary-button mini" onClick={() => void runSearch()} disabled={busy}>
          {busy ? "…" : "بحث"}
        </button>
      </div>

      {status ? <p className={`muted hadith-count ${busy ? "loading" : ""}`}>{status}</p> : null}

      {rows.length === 0 && !busy ? (
        <EmptyState title="لا نتائج" body="جرّب كلمة أخرى مثل: الصلاة، النية، الصدقة." />
      ) : (
        <div className="hadith-list">
          {rows.map((row) => {
            const open = openKey === row.key;
            return (
              <article key={row.key} className={`hadith-card ${open ? "open" : ""}`}>
                <button type="button" className="hadith-card-head" onClick={() => setOpenKey(open ? null : row.key)}>
                  <div>
                    <strong>{row.title}</strong>
                    <span className="muted">{row.source}</span>
                  </div>
                  <span className={`grade ${gradeClass(row.gradeKind)}`}>{row.grade}</span>
                </button>
                {open ? (
                  <div className="hadith-card-body">
                    <p className="hadith-card-text">«{row.text}»</p>
                    <p className="hadith-card-source">{row.source}</p>
                    {row.gradeKind === "ضعيف" ? (
                      <p className="hadith-weak">تنبيه: درجة هذا الحديث ضعيفة — يُذكر للعلم ولا يُبنى عليه حكم.</p>
                    ) : null}
                    {row.explanation ? (
                      <>
                        <h4>الشرح</h4>
                        <p>{row.explanation}</p>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="primary-button mini"
                      onClick={() => void explain(row)}
                      disabled={aiBusy === row.key}
                    >
                      <Icon name="sparkles" size={14} />{" "}
                      {aiBusy === row.key ? "جارٍ توليد الشرح…" : "اشرحه بالذكاء الاصطناعي"}
                    </button>
                    {aiText[row.key] ? (
                      <div className="hadith-ai-text">
                        <h4>شرح الذكاء الاصطناعي</h4>
                        <p style={{ whiteSpace: "pre-wrap" }}>{aiText[row.key]}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
