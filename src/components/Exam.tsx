import { useEffect, useMemo, useRef, useState } from "react";
import { juzOfSurah } from "../data/juzSurahs";
import type { Account } from "../lib/auth";
import { celebrate } from "../lib/celebrate";
import {
  answerLabel,
  buildExam,
  correctAnswerLabel,
  examConfig,
  isCorrect,
  loadSeenAyahs,
  rememberSeenAyahs,
  saveExamResult,
  scoreExam,
  suggestedLevel,
  type ExamAnswer,
  type ExamKind,
  type ExamResult,
  type Question,
} from "../lib/exam";
import { fetchJuzs } from "../lib/quran";
import { BrandMark, CheckIcon } from "./ui";

type Status = "loading" | "error" | "running" | "done";

function sampleJuzs(juzs: number[]): number[] {
  if (juzs.length <= 3) return juzs;
  const sorted = [...juzs].sort((a, b) => a - b);
  return [
    sorted[0],
    sorted[Math.floor(sorted.length / 2)],
    sorted[sorted.length - 1],
  ];
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export default function Exam({
  account,
  kind,
  onExit,
}: {
  account: Account;
  kind: ExamKind;
  onExit: () => void;
}) {
  const pickedJuzs = useMemo(() => {
    if (kind === "teacher") {
      const total = Math.max(1, Math.min(30, account.teacher?.juzMemorized ?? 1));
      if (total <= 3) {
        return Array.from({ length: total }, (_, index) => index + 1);
      }
      return [1, Math.ceil(total / 2), total];
    }
    const student = account.student;
    if (!student) return [30];
    if (student.juz.length > 0) return sampleJuzs(student.juz);
    return [juzOfSurah(student.surahs[0] ?? 1)];
  }, [account, kind]);

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, ExamAnswer>>({});
  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [result, setResult] = useState<ExamResult | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [focusLost, setFocusLost] = useState(false);
  const savedRef = useRef(false);
  const runningRef = useRef(false);

  const level = kind === "teacher" ? "A6" : (account.student?.level ?? "A1");
  const config = useMemo(() => examConfig(kind, level), [kind, level]);

  useEffect(() => {
    runningRef.current = status === "running";
  }, [status]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!runningRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const onVisibility = () => {
      if (document.hidden && runningRef.current) setFocusLost(true);
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement && runningRef.current) setFocusLost(true);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.documentElement.requestFullscreen?.().catch(() => {
      // المتصفح قد يرفض ملء الشاشة قبل تفاعل المستخدم — نكتفي بالتحذير.
    });
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setError("");
      try {
        const ayahs = await fetchJuzs(pickedJuzs, controller.signal);
        let pool = ayahs;
        if (kind === "student" && account.student?.surahs.length) {
          const filtered = ayahs.filter((ayah) =>
            account.student?.surahs.includes(ayah.surah),
          );
          if (filtered.length >= 20) pool = filtered;
        }
        const built = buildExam(
          pool,
          level,
          kind,
          config.count,
          loadSeenAyahs(account.id),
        );
        rememberSeenAyahs(built, account.id);
        if (built.length < 4) {
          throw new Error(
            "لم نتمكن من تجهيز أسئلة كافية من الأجزاء المختارة. أضف أجزاءً أخرى أو أعد المحاولة.",
          );
        }
        if (cancelled) return;
        setQuestions(built);
        setAnswers({});
        setIndex(0);
        setSecondsLeft(config.seconds);
        setStatus("running");
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "تعذّر الاتصال بمصدر القرآن. تحقّق من الإنترنت وأعد المحاولة.",
        );
        setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  useEffect(() => {
    if (status !== "running") return;
    if (secondsLeft <= 0) {
      finishExam();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, secondsLeft]);

  function finishExam() {
    if (status !== "running" || questions.length === 0) return;
    const scored = scoreExam(questions, answers);
    const suggested = suggestedLevel(level, scored.percent);
    if (!savedRef.current) {
      savedRef.current = true;
      const saved = saveExamResult({
        accountId: account.id,
        kind,
        score: scored.score,
        total: scored.total,
        percent: scored.percent,
        level,
        suggestedLevel: suggested,
      });
      setResult(saved);
    }
    // احتفال عند النجاح في الاختبار.
    if (scored.percent >= 60) celebrate("exam");
    setStatus("done");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const question = questions[index];
  const picked = question ? answers[question.id] : undefined;
  const answeredCount = Object.values(answers).filter((value) =>
    Array.isArray(value) ? value.length > 0 : typeof value === "number",
  ).length;

  function setChoice(questionId: string, optionIndex: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
  }

  function addWord(questionId: string, word: string) {
    setAnswers((prev) => {
      const current = Array.isArray(prev[questionId])
        ? (prev[questionId] as string[])
        : [];
      return { ...prev, [questionId]: [...current, word] };
    });
  }

  function removeWord(questionId: string, wordIndex: number) {
    setAnswers((prev) => {
      const current = Array.isArray(prev[questionId])
        ? (prev[questionId] as string[])
        : [];
      return {
        ...prev,
        [questionId]: current.filter((_, position) => position !== wordIndex),
      };
    });
  }

  function renderOrder(activeQuestion: Question & { type: "order" }) {
    const pickedWords = Array.isArray(answers[activeQuestion.id])
      ? (answers[activeQuestion.id] as string[])
      : [];
    const totals = new Map<string, number>();
    activeQuestion.words.forEach((word) =>
      totals.set(word, (totals.get(word) ?? 0) + 1),
    );
    const used = new Map<string, number>();
    pickedWords.forEach((word) => used.set(word, (used.get(word) ?? 0) + 1));

    return (
      <div className="order-exam">
        <div className="answer-line" aria-live="polite">
          {pickedWords.length === 0 ? (
            <span className="answer-placeholder">
              اضغط الكلمات بالترتيب من الأسفل…
            </span>
          ) : (
            pickedWords.map((word, wordIndex) => (
              <button
                key={`${word}-${wordIndex}`}
                type="button"
                className="answer-word"
                onClick={() => removeWord(activeQuestion.id, wordIndex)}
                title="إزالة الكلمة"
              >
                {word}
              </button>
            ))
          )}
        </div>
        <div className="word-bank">
          {activeQuestion.words.map((word, wordIndex) => {
            const disabled = (used.get(word) ?? 0) >= (totals.get(word) ?? 0);
            return (
              <button
                key={`${word}-${wordIndex}`}
                type="button"
                className="word-chip"
                disabled={disabled}
                onClick={() => addWord(activeQuestion.id, word)}
              >
                {word}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="exam-shell">
      {focusLost && status === "running" ? (
        <div className="exam-lock-overlay">
          <div className="exam-lock-card">
            <h2>الاختبار في وضع التركيز</h2>
            <p>لا تفتح تطبيقًا آخر أو تنتقل من الصفحة أثناء الاختبار. إن عدت الآن يمكنك المتابعة من حيث توقفت.</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setFocusLost(false);
                document.documentElement.requestFullscreen?.().catch(() => {});
              }}
            >
              متابعة الاختبار
            </button>
          </div>
        </div>
      ) : null}
      <header className="exam-topbar">
        <div className="exam-brand">
          <BrandMark size={34} />
          <span>ثمار</span>
        </div>
        {status === "running" && (
          <div className="exam-timer" data-urgent={secondsLeft <= 60}>
            <span>الوقت المتبقي</span>
            <b dir="ltr">{formatTime(secondsLeft)}</b>
          </div>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (status === "running" && !window.confirm("سيُلغى تقدم الاختبار إذا خرجت الآن. هل تريد الخروج؟")) return;
            onExit();
          }}
        >
          خروج
        </button>
      </header>

      <main className="exam-main">
        {status === "loading" && (
          <div className="exam-state">
            <span className="spinner" aria-hidden="true" />
            <h1>نجهّز أسئلتك…</h1>
            <p>
              نجلب آيات الجزء {pickedJuzs.join(" · ")} من مصدر القرآن، ثم نبني
              أسئلة جديدة غير مكررة.
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="exam-state">
            <h1>تعذّر تجهيز الاختبار</h1>
            <p>{error}</p>
            <div className="exam-state-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setReloadKey((value) => value + 1)}
              >
                إعادة المحاولة
              </button>
              <button type="button" className="btn btn-ghost" onClick={onExit}>
                رجوع
              </button>
            </div>
          </div>
        )}

        {status === "running" && question && (
          <div className="exam-card">
            <div className="exam-meta">
              <span>
                السؤال {index + 1} من {questions.length}
              </span>
              <span className="exam-topic">{question.topic}</span>
              <span className="exam-answered">أُجيب {answeredCount}</span>
            </div>
            <div className="exam-progress" aria-hidden="true">
              <span style={{ width: `${((index + 1) / questions.length) * 100}%` }} />
            </div>

            <div className="exam-question">
              <h1>{question.prompt}</h1>
              {question.type === "choice" && question.text && (
                <p className="ayah-text">{question.text}</p>
              )}

              {question.type === "choice" && (
                <div className="exam-options">
                  {question.options.map((option, optionIndex) => {
                    const selected = picked === optionIndex;
                    return (
                      <button
                        key={option}
                        type="button"
                        className={
                          selected ? "exam-option is-picked" : "exam-option"
                        }
                        aria-pressed={selected}
                        onClick={() => setChoice(question.id, optionIndex)}
                      >
                        <span className="option-letter">
                          {["أ", "ب", "ج", "د"][optionIndex] ?? optionIndex + 1}
                        </span>
                        <span>{option}</span>
                        {selected && (
                          <span className="option-check">
                            <CheckIcon />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {question.type === "order" && question && renderOrder(question)}
            </div>

            <div className="exam-footer">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={index === 0}
                onClick={() => setIndex((value) => Math.max(0, value - 1))}
              >
                السابق
              </button>
              <div className="exam-dots" aria-hidden="true">
                {questions.map((item, dotIndex) => (
                  <span
                    key={item.id}
                    data-state={
                      dotIndex === index
                        ? "current"
                        : answers[item.id] !== undefined
                          ? "answered"
                          : "empty"
                    }
                  />
                ))}
              </div>
              {index < questions.length - 1 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}
                >
                  التالي
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={finishExam}>
                  تسليم الاختبار
                </button>
              )}
            </div>
          </div>
        )}

        {status === "done" && result && (
          <div className="exam-result">
            <div
              className="score-ring"
              style={{ ["--pct" as string]: `${result.percent}` }}
            >
              <b>{result.percent}%</b>
              <span>النتيجة</span>
            </div>
            <h1>
              {result.percent >= 85
                ? "ما شاء الله، أداء متقن"
                : result.percent >= 60
                  ? "جيد جدًا، واصل التقدّم"
                  : "بداية طيبة، والمراجعة ترفعك"}
            </h1>
            <p className="exam-result-text">
              أجبت بشكل صحيح على {result.score} من {result.total} سؤالًا.
            </p>

            {kind === "student" ? (
              <div className="level-suggestion">
                <span>المستوى المقترح بعد الاختبار</span>
                <b>{result.suggestedLevel}</b>
                <small>
                  {result.suggestedLevel === result.level
                    ? "مستواك الحالي مناسب، وستبدأ من هنا."
                    : "يمكنك اعتماد المستوى المقترح من صفحتك."}
                </small>
              </div>
            ) : (
              <div className="alert alert-soft">
                نتيجتك محفوظة ويطّلع عليها المسؤول مع بيانات طلبك.
              </div>
            )}

            <div className="exam-result-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowReview((value) => !value)}
              >
                {showReview ? "إخفاء المراجعة" : "مراجعة الأسئلة"}
              </button>
              <button type="button" className="btn btn-primary" onClick={onExit}>
                العودة
              </button>
            </div>

            {showReview && (
              <ol className="review-list">
                {questions.map((item, itemIndex) => {
                  const correct = isCorrect(item, answers[item.id] ?? null);
                  return (
                    <li
                      key={item.id}
                      className={correct ? "review-item is-correct" : "review-item is-wrong"}
                    >
                      <div className="review-head">
                        <span>
                          {itemIndex + 1}. {item.prompt}
                        </span>
                        <span className="review-status">{correct ? "صحيحة" : "خاطئة"}</span>
                      </div>
                      {item.type === "choice" && item.text && (
                        <p className="ayah-text small">{item.text}</p>
                      )}
                      <p className="review-line">
                        إجابتك: {answerLabel(item, answers[item.id] ?? null)}
                      </p>
                      {!correct && (
                        <p className="review-line">
                          الإجابة الصحيحة: {correctAnswerLabel(item)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
