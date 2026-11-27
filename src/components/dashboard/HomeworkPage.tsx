import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { surahs } from "../../data/surahs";
import type { Account } from "../../lib/auth";
import {
  addHomework,
  addSubmission,
  childrenOfGuardian,
  evaluateSubmission,
  loadHomework,
  loadSubmissions,
  studentsOfTeacher,
  type Homework,
  type HomeworkMethod,
  type HomeworkSegment,
  type Submission,
} from "../../lib/appStore";
import { fetchSurah, type Ayah } from "../../lib/quran";
import { useRecorder } from "../../lib/recorder";
import { useMediaSrc } from "../../lib/mediaRef";
import { celebrate } from "../../lib/celebrate";
import { Icon, EmptyState, Stars, SectionCard } from "./ui";
const TasmeeReader = lazy(() => import("./TasmeeReader"));

const METHOD_LABELS: Record<HomeworkMethod, string> = {
  live: "تسميع مباشر",
  inapp: "داخل التطبيق",
  photo: "صورة",
  audio: "ملف صوتي",
  video: "فيديو",
  text: "نص مكتوب",
  call: "تحدث هاتف",
  file: "رفع ملف",
};

const METHOD_ICONS: Record<HomeworkMethod, "mic" | "video" | "phone" | "file" | "book" | "camera"> = {
  live: "mic",
  inapp: "mic",
  photo: "camera",
  audio: "mic",
  video: "video",
  text: "book",
  call: "phone",
  file: "file",
};

const TASMEE_METHODS: HomeworkMethod[] = ["inapp", "audio", "video", "call", "file"];
const READING_METHODS: HomeworkMethod[] = ["inapp", "file", "text", "audio"];

type Category = "tasmee" | "reading";
type Tab = Category | "recordings" | "records";

const CATEGORY_LABELS: Record<Category, string> = {
  tasmee: "تسميع",
  reading: "قراءة",
};

const TASMEE_LABELS = ["اللوح", "السورة", "الماضي البعيد", "الماضي القريب"];

function surahName(n: number) {
  return surahs[n - 1]?.name ?? `سورة ${n}`;
}

function categoryOf(item: Homework | undefined): Category {
  return item?.category === "reading" ? "reading" : "tasmee";
}

function dateLabel(value: number) {
  return new Date(value).toLocaleDateString("ar-SA");
}

function clampAyah(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(286, Math.max(1, Math.round(value)));
}

function rangeLabel(segment: HomeworkSegment): string {
  if (segment.mode === "surah") {
    const end = segment.surahTo ?? segment.surah;
    return segment.surah === end
      ? `سورة ${surahName(segment.surah)} كاملة`
      : `من سورة ${surahName(segment.surah)} إلى سورة ${surahName(end)}`;
  }
  return `${surahName(segment.surah)} • الآيات ${segment.fromAyah}–${segment.toAyah}`;
}

function emptyTasmeeSegments(): HomeworkSegment[] {
  return [
    { label: "اللوح", mode: "ayah", surah: 78, fromAyah: 1, toAyah: 5, surahTo: 78 },
    { label: "السورة", mode: "ayah", surah: 78, fromAyah: 1, toAyah: 10, surahTo: 78 },
    { label: "الماضي البعيد", mode: "ayah", surah: 77, fromAyah: 1, toAyah: 5, surahTo: 77 },
    { label: "الماضي القريب", mode: "ayah", surah: 79, fromAyah: 1, toAyah: 5, surahTo: 79 },
  ];
}

/** يحوّل «من سورة إلى سورة» إلى قائمة سور لتسميعها بالتتابع. */
function expandSegment(segment: HomeworkSegment): HomeworkSegment[] {
  if (segment.mode === "surah" && segment.surahTo && segment.surahTo !== segment.surah) {
    const start = Math.min(segment.surah, segment.surahTo);
    const end = Math.max(segment.surah, segment.surahTo);
    return Array.from({ length: end - start + 1 }, (_, index) => ({
      ...segment,
      surah: start + index,
      surahTo: start + index,
      fromAyah: 1,
      toAyah: 286,
    }));
  }
  return [segment];
}

export default function HomeworkPage({ account }: { account: Account }) {
  const [homework, setHomework] = useState<Homework[]>([]);
  const [students, setStudents] = useState<Account[]>([]);
  const [children, setChildren] = useState<Account[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedChildId, setSelectedChildId] = useState("");
  const [tab, setTab] = useState<Tab>("tasmee");
  const [method, setMethod] = useState<HomeworkMethod>("inapp");
  const [dueAt, setDueAt] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [segments, setSegments] = useState<HomeworkSegment[]>(emptyTasmeeSegments);
  const [addReadingWithTasmee, setAddReadingWithTasmee] = useState(false);
  const [readingForm, setReadingForm] = useState({
    title: "ورد القراءة",
    surah: 78,
    fromAyah: 1,
    toAyah: 10,
    optional: false,
    perAyahSeconds: 1,
  });
  const [formError, setFormError] = useState("");
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [submissionNote, setSubmissionNote] = useState("");
  const [submissionFile, setSubmissionFile] = useState<string | null>(null);
  const mediaSrc = useMediaSrc();
  const [recordingResult, setRecordingResult] = useState<{ dataUrl: string; duration: number } | null>(null);
  const [inApp, setInApp] = useState<{ homework: Homework; list: HomeworkSegment[]; index: number } | null>(null);
  const [readingTask, setReadingTask] = useState<Homework | null>(null);
  const [readingAyahs, setReadingAyahs] = useState<Ayah[]>([]);
  const [readingLeft, setReadingLeft] = useState(0);
  const [readingLoading, setReadingLoading] = useState(false);
  const [readingError, setReadingError] = useState("");
  const [reviewing, setReviewing] = useState<Submission | null>(null);
  const [reviewScore, setReviewScore] = useState(4);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readingDoneRef = useRef(false);
  const recorder = useRecorder();

  const refresh = () => {
    const all = loadHomework();
    setAllSubmissions(loadSubmissions());
    if (account.type === "teacher") {
      setHomework(all.filter((item) => item.teacherId === account.id));
      setStudents(studentsOfTeacher(account.id));
    } else if (account.type === "guardian") {
      const kids = childrenOfGuardian(account);
      setChildren(kids);
      const ids = new Set(kids.map((child) => child.id));
      setHomework(all.filter((item) => ids.has(item.studentId)));
    } else {
      setHomework(all.filter((item) => item.studentId === account.id));
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  useEffect(() => {
    if (account.type !== "teacher" || students.length === 0) return;
    if (!students.some((student) => student.id === selectedStudentId)) {
      setSelectedStudentId(students[0].id);
    }
  }, [students, selectedStudentId, account.type]);

  useEffect(() => {
    if (account.type !== "guardian" || children.length === 0) return;
    if (!children.some((child) => child.id === selectedChildId)) {
      setSelectedChildId(children[0].id);
    }
  }, [children, selectedChildId, account.type]);

  const studentHomework = homework.filter((item) => item.studentId === selectedStudentId);
  const selectedStudent = students.find((student) => student.id === selectedStudentId);
  const selectedChild = children.find((child) => child.id === selectedChildId);
  const learnerId = account.type === "guardian" ? selectedChildId : account.id;
  const learnerTasks = homework.filter((item) => item.studentId === learnerId);
  const learnerSubmissions = allSubmissions.filter((submission) => submission.studentId === learnerId);

  const resetFormError = () => setFormError("");

  const updateSegment = (index: number, patch: Partial<HomeworkSegment>) => {
    setSegments((prev) => prev.map((segment, position) => (position === index ? { ...segment, ...patch } : segment)));
  };

  const createReadingTask = (studentId: string, base?: HomeworkSegment) => {
    const source: HomeworkSegment = base ?? {
      label: "القراءة",
      mode: "ayah",
      surah: readingForm.surah,
      surahTo: readingForm.surah,
      fromAyah: Math.min(readingForm.fromAyah, readingForm.toAyah),
      toAyah: Math.max(readingForm.fromAyah, readingForm.toAyah),
    };
    addHomework({
      teacherId: account.id,
      studentId,
      surah: source.surah,
      surahFrom: source.surah,
      surahTo: source.mode === "surah" ? (source.surahTo ?? source.surah) : source.surah,
      fromAyah: source.fromAyah,
      toAyah: source.toAyah,
      farPastSurah: source.surah,
      nearPastSurah: source.surah,
      method: method === "text" || method === "file" || method === "audio" || method === "inapp" ? method : "inapp",
      title: readingForm.title.trim() || "ورد القراءة",
      category: "reading",
      optional: readingForm.optional,
      perAyahSeconds: Math.max(1, Math.round(readingForm.perAyahSeconds)),
      segments: [source],
      dueAt: new Date(dueAt).getTime(),
      notes: notes.trim(),
    });
  };

  const createTasmee = () => {
    if (account.type !== "teacher" || !selectedStudentId) return;
    if (segments.some((segment) => segment.fromAyah < 1 || segment.toAyah < 1 || segment.surah < 1)) {
      setFormError("أدخل نطاقاً صحيحاً لكل عنصر من عناصر التسميع.");
      return;
    }
    resetFormError();
    const primary = segments[1] ?? segments[0];
    addHomework({
      teacherId: account.id,
      studentId: selectedStudentId,
      surah: primary.surah,
      surahFrom: primary.surah,
      surahTo: primary.mode === "surah" ? (primary.surahTo ?? primary.surah) : primary.surah,
      fromAyah: Math.min(primary.fromAyah, primary.toAyah),
      toAyah: Math.max(primary.fromAyah, primary.toAyah),
      farPastSurah: segments[2]?.surah ?? primary.surah,
      nearPastSurah: segments[3]?.surah ?? primary.surah,
      method,
      title: "مهمة تسميع",
      category: "tasmee",
      segments,
      dueAt: new Date(dueAt).getTime(),
      notes: notes.trim(),
    });
    if (addReadingWithTasmee) {
      createReadingTask(selectedStudentId, {
        label: "القراءة",
        mode: primary.mode ?? "ayah",
        surah: primary.surah,
        surahTo: primary.surahTo ?? primary.surah,
        fromAyah: Math.min(primary.fromAyah, primary.toAyah),
        toAyah: Math.max(primary.fromAyah, primary.toAyah),
      });
    }
    setNotes("");
    refresh();
  };

  const createReading = () => {
    if (account.type !== "teacher" || !selectedStudentId) return;
    if (readingForm.toAyah < readingForm.fromAyah) {
      setFormError("آية النهاية يجب أن تكون بعد آية البداية.");
      return;
    }
    resetFormError();
    createReadingTask(selectedStudentId);
    setNotes("");
    refresh();
  };

  const submit = (item: Homework) => {
    const audioUrl = recordingResult?.dataUrl ?? submissionFile ?? undefined;
    addSubmission({
      homeworkId: item.id,
      studentId: account.id,
      teacherId: item.teacherId,
      kind: item.method,
      note: submissionNote,
      audioUrl,
      duration: recordingResult?.duration,
      fileName: submissionFile ? "ملف مرفق" : undefined,
    });
    // احتفال عند تسليم مهمة المعلم.
    celebrate("task");
    setSubmittingId(null);
    setSubmissionNote("");
    setSubmissionFile(null);
    setRecordingResult(null);
    refresh();
  };

  const finishInApp = (outcome: { progress: number; correct: number; wrong: number; cancelled: boolean }) => {
    if (!inApp) return;
    const current = inApp.list[inApp.index];
    addSubmission({
      homeworkId: inApp.homework.id,
      studentId: account.id,
      teacherId: inApp.homework.teacherId,
      kind: "inapp",
      note: `${current.label}: ${rangeLabel(current)} — التقدم ${outcome.progress}% • صحيح ${outcome.correct} • أخطاء ${outcome.wrong}${outcome.cancelled ? " • أُلغي" : ""}`,
    });
    if (inApp.index + 1 < inApp.list.length) {
      setInApp({ ...inApp, index: inApp.index + 1 });
    } else {
      setInApp(null);
    }
    refresh();
  };

  const startInApp = (item: Homework, segment: HomeworkSegment) => {
    setInApp({ homework: item, list: expandSegment(segment), index: 0 });
  };

  const openReading = (item: Homework) => {
    readingDoneRef.current = false;
    setReadingTask(item);
    setReadingLoading(true);
    setReadingError("");
    setReadingAyahs([]);
    const segment = item.segments?.[0];
    const surah = segment?.surah ?? item.surah;
    fetchSurah(surah)
      .then((data) => {
        const from = segment?.fromAyah ?? item.fromAyah ?? 1;
        const to = segment?.toAyah ?? item.toAyah ?? data.length;
        const filtered = data.filter((ayah) => ayah.numberInSurah >= Math.min(from, to) && ayah.numberInSurah <= Math.max(from, to));
        setReadingAyahs(filtered);
        setReadingLeft(item.optional ? 0 : filtered.length * Math.max(1, item.perAyahSeconds ?? 1));
      })
      .catch((error) => setReadingError(error instanceof Error ? error.message : "تعذّر تحميل الآيات."))
      .finally(() => setReadingLoading(false));
  };

  const finishReading = (auto: boolean) => {
    if (!readingTask || readingDoneRef.current) return;
    readingDoneRef.current = true;
    addSubmission({
      homeworkId: readingTask.id,
      studentId: account.id,
      teacherId: readingTask.teacherId,
      kind: "inapp",
      note: auto
        ? `قراءة داخل التطبيق — انتهى الوقت المحدد (${readingAyahs.length} آية)`
        : `قراءة داخل التطبيق — أُتمّت قراءة ${readingAyahs.length} آية`,
    });
    setReadingTask(null);
    setReadingAyahs([]);
    refresh();
  };

  useEffect(() => {
    if (!readingTask || readingTask.optional || readingLoading || readingAyahs.length === 0) return;
    if (readingLeft <= 0) {
      finishReading(true);
      return;
    }
    const timer = window.setTimeout(() => setReadingLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingTask, readingLeft, readingLoading, readingAyahs.length]);

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSubmissionFile(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const openReview = (submission: Submission) => {
    setReviewing(submission);
    setReviewScore(submission.score ?? 4);
    setReviewFeedback(submission.feedback ?? "");
  };

  const saveReview = () => {
    if (!reviewing) return;
    evaluateSubmission(reviewing.id, reviewScore, reviewFeedback.trim());
    setReviewing(null);
    refresh();
  };

  /* ---------------- عارض القراءة داخل التطبيق ---------------- */
  if (readingTask) {
    const total = readingAyahs.length * Math.max(1, readingTask.perAyahSeconds ?? 1);
    return (
      <div className="page homework-page">
        <div className="page-head">
          <div>
            <h2>{readingTask.title || "ورد القراءة"}</h2>
            <p className="muted">
              {readingTask.optional ? "مهمة اختيارية" : "مهمة إجبارية"} • {rangeLabel(readingTask.segments?.[0] ?? {
                label: "القراءة", surah: readingTask.surah, fromAyah: readingTask.fromAyah, toAyah: readingTask.toAyah, mode: "ayah",
              })}
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setReadingTask(null)}>خروج</button>
        </div>

        {!readingTask.optional ? (
          <SectionCard title="الوقت المتبقي">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 28 }}>{Math.max(0, readingLeft)}ث</strong>
              <span className="muted">{readingAyahs.length} آية × {readingTask.perAyahSeconds ?? 1}ث = {total}ث</span>
            </div>
          </SectionCard>
        ) : null}

        <SectionCard title="الآيات المطلوبة">
          {readingLoading ? <p className="muted">جارٍ تحميل الآيات…</p> : null}
          {readingError ? <p className="game-error">{readingError}</p> : null}
          <div className="tasmee-reciting-container">
            {readingAyahs.map((ayah) => (
              <div key={ayah.number} style={{ marginBottom: 12 }}>
                <span className="mushaf-ayah-number" style={{ marginInlineEnd: 6 }}>{ayah.numberInSurah}</span>
                <span style={{ fontSize: 24, lineHeight: 2 }}>{ayah.text}</span>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="primary-button" onClick={() => finishReading(false)} disabled={readingLoading || readingAyahs.length === 0}>
              <Icon name="check" size={16} /> تمّت القراءة
            </button>
          </div>
        </SectionCard>
      </div>
    );
  }

  /* ---------------- التسميع داخل التطبيق ---------------- */
  if (inApp) {
    const current = inApp.list[inApp.index];
    const preset = {
      surah: current.surah,
      fromAyah: current.mode === "surah" ? 1 : current.fromAyah,
      toAyah: current.mode === "surah" ? 286 : current.toAyah,
    };
    return (
      <div className="page homework-page">
        <div className="page-head">
          <div>
            <h2>تسميع: {inApp.homework.title || "مهمة تسميع"}</h2>
            <p className="muted">{current.label} • {rangeLabel(current)} {inApp.list.length > 1 ? `• (${inApp.index + 1}/${inApp.list.length})` : ""}</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setInApp(null)}>رجوع</button>
        </div>
        <Suspense fallback={<p className="muted">جارٍ فتح محرك التسميع…</p>}>
          <TasmeeReader key={`${current.surah}-${current.fromAyah}-${inApp.index}`} preset={preset} onFinished={finishInApp} />
        </Suspense>
      </div>
    );
  }

  /* ---------------- واجهة المعلم ---------------- */
  if (account.type === "teacher") {
    const teacherSubmissions = allSubmissions.filter((submission) => submission.teacherId === account.id);
    const pending = teacherSubmissions.filter((submission) => submission.score === undefined).length;
    const readingTotal = (Math.max(readingForm.fromAyah, readingForm.toAyah) - Math.min(readingForm.fromAyah, readingForm.toAyah) + 1) * Math.max(1, readingForm.perAyahSeconds);

    return (
      <div className="page homework-page">
        <div className="page-head">
          <div>
            <h2>المهمات</h2>
            <p className="muted">مهام التسميع والقراءة، ومتابعة التسجيلات وتقييمها بعد الاطلاع.</p>
          </div>
          <span className="badge badge-info">{pending} بانتظار التقييم</span>
        </div>

        {students.length === 0 ? (
          <EmptyState title="لا يوجد طلاب" body="اربط طالبًا بحسابك من الإعدادات ليظهر هنا." />
        ) : (
          <div className="reports-layout homework-teacher-layout">
            <aside className="student-list">
              {students.map((student) => {
                const count = homework.filter((item) => item.studentId === student.id).length;
                return (
                  <button
                    key={student.id}
                    type="button"
                    className={`student-row ${selectedStudentId === student.id ? "active" : ""}`}
                    onClick={() => setSelectedStudentId(student.id)}
                  >
                    <div>
                      <strong>{student.fullName}</strong>
                      <span className="muted">{student.username} • {student.student?.level ?? "—"}</span>
                    </div>
                    <span className="badge badge-info">{count}</span>
                  </button>
                );
              })}
            </aside>

            <section className="report-detail">
              {selectedStudent ? (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                    {([
                      { id: "tasmee", label: "التسميع", icon: "mic" },
                      { id: "reading", label: "القراءة", icon: "book" },
                      { id: "recordings", label: "التسجيلات", icon: "play" },
                    ] as const).map((item) => (
                      <button key={item.id} type="button" className={tab === item.id ? "primary-button" : "ghost-button"} onClick={() => setTab(item.id)}>
                        <Icon name={item.icon} size={16} /> {item.label}
                      </button>
                    ))}
                    <span className="badge badge-info">{selectedStudent.fullName}</span>
                  </div>

                  {tab === "tasmee" ? (
                    <SectionCard title="مهمة تسميع جديدة" subtitle="اختر النطاق (سورة إلى سورة أو آية إلى آية) وطريقة الإجابة">
                      <div style={{ display: "grid", gap: 12 }}>
                        {segments.map((segment, index) => (
                          <div key={segment.label} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                              <strong>{TASMEE_LABELS[index]}</strong>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  type="button"
                                  className={segment.mode === "ayah" ? "primary-button" : "ghost-button"}
                                  onClick={() => updateSegment(index, { mode: "ayah" })}
                                >آية إلى آية</button>
                                <button
                                  type="button"
                                  className={segment.mode === "surah" ? "primary-button" : "ghost-button"}
                                  onClick={() => updateSegment(index, { mode: "surah", surahTo: segment.surahTo ?? segment.surah })}
                                >سورة إلى سورة</button>
                              </div>
                            </div>

                            {segment.mode === "surah" ? (
                              <div className="form-grid">
                                <label>
                                  <span>من سورة</span>
                                  <select value={segment.surah} onChange={(event) => updateSegment(index, { surah: Number(event.target.value) })}>
                                    {surahs.map((surah) => <option key={surah.n} value={surah.n}>{surah.n}. {surah.name}</option>)}
                                  </select>
                                </label>
                                <label>
                                  <span>إلى سورة</span>
                                  <select value={segment.surahTo ?? segment.surah} onChange={(event) => updateSegment(index, { surahTo: Number(event.target.value) })}>
                                    {surahs.filter((surah) => surah.n >= segment.surah).map((surah) => <option key={surah.n} value={surah.n}>{surah.n}. {surah.name}</option>)}
                                  </select>
                                </label>
                              </div>
                            ) : (
                              <div className="form-grid">
                                <label>
                                  <span>السورة</span>
                                  <select value={segment.surah} onChange={(event) => updateSegment(index, { surah: Number(event.target.value) })}>
                                    {surahs.map((surah) => <option key={surah.n} value={surah.n}>{surah.n}. {surah.name}</option>)}
                                  </select>
                                </label>
                                <label>
                                  <span>من الآية</span>
                                  <input type="number" min={1} max={286} value={segment.fromAyah} onChange={(event) => updateSegment(index, { fromAyah: clampAyah(Number(event.target.value)) })} />
                                </label>
                                <label>
                                  <span>إلى الآية</span>
                                  <input type="number" min={1} max={286} value={segment.toAyah} onChange={(event) => updateSegment(index, { toAyah: clampAyah(Number(event.target.value)) })} />
                                </label>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="setup-block">
                        <h4>طريقة الإجابة</h4>
                        <div className="question-kinds-grid">
                          {TASMEE_METHODS.map((value) => (
                            <button key={value} type="button" className={`question-kind-chip ${method === value ? "active" : ""}`} onClick={() => setMethod(value)}>
                              <Icon name={METHOD_ICONS[value]} size={16} /> <span>{METHOD_LABELS[value]}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                        <input type="checkbox" checked={addReadingWithTasmee} onChange={(event) => setAddReadingWithTasmee(event.target.checked)} />
                        <span>إضافة مهمة قراءة أيضاً بنفس النطاق الأساسي</span>
                      </label>

                      <div className="form-grid">
                        <label>
                          <span>تاريخ الاستحقاق</span>
                          <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
                        </label>
                        <label>
                          <span>ملاحظات المعلم</span>
                          <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="تعليمات للطالب…" />
                        </label>
                      </div>

                      {formError ? <p className="game-error">{formError}</p> : null}
                      <div className="form-actions">
                        <button type="button" className="primary-button" onClick={createTasmee}>
                          <Icon name="send" size={16} /> إرسال مهمة التسميع
                        </button>
                      </div>
                    </SectionCard>
                  ) : null}

                  {tab === "reading" ? (
                    <SectionCard title="مهمة قراءة جديدة" subtitle="حدّد السورة والآيات، واختر إجبارية أو اختيارية">
                      <div className="form-grid">
                        <label>
                          <span>عنوان الوِرد</span>
                          <input value={readingForm.title} onChange={(event) => setReadingForm({ ...readingForm, title: event.target.value })} />
                        </label>
                        <label>
                          <span>السورة</span>
                          <select value={readingForm.surah} onChange={(event) => setReadingForm({ ...readingForm, surah: Number(event.target.value) })}>
                            {surahs.map((surah) => <option key={surah.n} value={surah.n}>{surah.n}. {surah.name}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>من الآية</span>
                          <input type="number" min={1} max={286} value={readingForm.fromAyah} onChange={(event) => setReadingForm({ ...readingForm, fromAyah: clampAyah(Number(event.target.value)) })} />
                        </label>
                        <label>
                          <span>إلى الآية</span>
                          <input type="number" min={1} max={286} value={readingForm.toAyah} onChange={(event) => setReadingForm({ ...readingForm, toAyah: clampAyah(Number(event.target.value)) })} />
                        </label>
                      </div>

                      <div className="setup-block">
                        <h4>نوع المهمة</h4>
                        <div className="form-actions">
                          <button type="button" className={!readingForm.optional ? "primary-button" : "ghost-button"} onClick={() => setReadingForm({ ...readingForm, optional: false })}>إجبارية</button>
                          <button type="button" className={readingForm.optional ? "primary-button" : "ghost-button"} onClick={() => setReadingForm({ ...readingForm, optional: true })}>اختيارية</button>
                        </div>
                        {!readingForm.optional ? (
                          <div className="form-grid" style={{ marginTop: 10 }}>
                            <label>
                              <span>ثوانٍ لكل آية (تلقائي ١)</span>
                              <input
                                type="number"
                                min={1}
                                max={60}
                                value={readingForm.perAyahSeconds}
                                onChange={(event) => setReadingForm({ ...readingForm, perAyahSeconds: Math.max(1, Number(event.target.value) || 1) })}
                              />
                            </label>
                            <div className="stat-mini">
                              <span>وقت الخروج المحسوب</span>
                              <strong>{readingTotal}ث</strong>
                            </div>
                          </div>
                        ) : (
                          <p className="muted" style={{ marginBottom: 0 }}>المهمة الاختيارية بلا مؤقت، ويمكن للطالب قراءتها متى شاء.</p>
                        )}
                      </div>

                      <div className="setup-block">
                        <h4>طريقة التسليم</h4>
                        <div className="question-kinds-grid">
                          {READING_METHODS.map((value) => (
                            <button key={value} type="button" className={`question-kind-chip ${method === value ? "active" : ""}`} onClick={() => setMethod(value)}>
                              <Icon name={METHOD_ICONS[value]} size={16} /> <span>{METHOD_LABELS[value]}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="form-grid">
                        <label>
                          <span>تاريخ الاستحقاق</span>
                          <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
                        </label>
                        <label>
                          <span>ملاحظات المعلم</span>
                          <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="تعليمات للطالب…" />
                        </label>
                      </div>

                      {formError ? <p className="game-error">{formError}</p> : null}
                      <div className="form-actions">
                        <button type="button" className="primary-button" onClick={createReading}>
                          <Icon name="send" size={16} /> إرسال مهمة القراءة
                        </button>
                      </div>
                    </SectionCard>
                  ) : null}

                  {tab === "recordings" ? (
                    <SectionCard title="التسجيلات" subtitle="نتائج التسميع والقراءة داخل التطبيق، والملفات المرفوعة">
                      {teacherSubmissions.length === 0 ? (
                        <EmptyState title="لا توجد تسجيلات" body="ستظهر هنا نتائج الطلاب بعد التسليم أو التسميع داخل التطبيق." />
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          {teacherSubmissions.slice().sort((a, b) => b.createdAt - a.createdAt).map((submission) => {
                            const task = homework.find((item) => item.id === submission.homeworkId);
                            return (
                              <div key={submission.id} className="homework-card">
                                <div className="homework-head">
                                  <div>
                                    <h3>{task?.title || "مهمة"} • {students.find((student) => student.id === submission.studentId)?.fullName ?? "طالب"}</h3>
                                    <p className="muted">{CATEGORY_LABELS[categoryOf(task)]} • {METHOD_LABELS[submission.kind]} • {new Date(submission.createdAt).toLocaleString("ar-SA")}</p>
                                  </div>
                                  <span className={`badge ${submission.score === undefined ? "badge-warning" : "badge-success"}`}>
                                    {submission.score === undefined ? "بانتظار التقييم" : `${submission.score}/5`}
                                  </span>
                                </div>
                                {task?.segments?.length
                                  ? <p className="muted">{task.segments.map((segment) => `${segment.label}: ${rangeLabel(segment)}`).join(" • ")}</p>
                                  : null}
                                {submission.note ? <p className="homework-notes">{submission.note}</p> : null}
                                {mediaSrc(submission.audioUrl) ? <audio controls src={mediaSrc(submission.audioUrl)} style={{ width: "100%", marginTop: 6 }} /> : null}
                                {submission.feedback ? <p className="muted">ملاحظة المعلم: {submission.feedback}</p> : null}
                                <div className="form-actions" style={{ marginTop: 8 }}>
                                  <button type="button" className="ghost-button" onClick={() => openReview(submission)}>
                                    {submission.score === undefined ? "تقييم التسجيل" : "تعديل التقييم"}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </SectionCard>
                  ) : null}

                  <SectionCard title={`مهام ${selectedStudent.fullName}`} subtitle="تنظيم المهام وحالة التقييم">
                    {studentHomework.length === 0 ? (
                      <p className="muted">لا توجد مهام بعد.</p>
                    ) : (
                      <div className="grade-surah-list">
                        {studentHomework.slice().reverse().map((item) => {
                          const category = categoryOf(item);
                          const submissions = allSubmissions.filter((submission) => submission.homeworkId === item.id);
                          const graded = submissions.find((submission) => submission.score !== undefined);
                          return (
                            <div key={item.id} className={`grade-surah-row ${graded ? "done" : ""}`}>
                              <div>
                                <strong>{item.title || CATEGORY_LABELS[category]}</strong>
                                <span className="muted">
                                  {CATEGORY_LABELS[category]} • {METHOD_LABELS[item.method]} • {item.optional ? "اختيارية" : "إجبارية"} • استحقاق {dateLabel(item.dueAt)} • {submissions.length} تسليم
                                </span>
                              </div>
                              <div className="grade-surah-actions">
                                {graded ? <Stars value={graded.score ?? 0} /> : <span className="badge badge-warning">بانتظار</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </SectionCard>
                </>
              ) : null}
            </section>
          </div>
        )}

        {reviewing ? (
          <div className="modal-backdrop" onClick={() => setReviewing(null)}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <h3>تقييم التسجيل</h3>
              {mediaSrc(reviewing.audioUrl) ? <audio controls src={mediaSrc(reviewing.audioUrl)} style={{ width: "100%" }} /> : null}
              {reviewing.note ? <p className="muted">{reviewing.note}</p> : null}
              <label>
                <span>التقييم (1–5)</span>
                <input type="range" min={1} max={5} value={reviewScore} onChange={(event) => setReviewScore(Number(event.target.value))} />
                <strong>{reviewScore} / 5</strong>
              </label>
              <label>
                <span>ملاحظات للطالب</span>
                <textarea value={reviewFeedback} onChange={(event) => setReviewFeedback(event.target.value)} />
              </label>
              <div className="form-actions">
                <button type="button" className="primary-button" onClick={saveReview}>حفظ التقييم</button>
                <button type="button" className="ghost-button" onClick={() => setReviewing(null)}>إلغاء</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  /* ---------------- واجهة الطالب وولي الأمر ---------------- */
  const readOnly = account.type === "guardian";
  const activeLearnerTasks = learnerTasks;

  return (
    <div className="page homework-page">
      <div className="page-head">
        <div>
          <h2>المهمات</h2>
          <p className="muted">
            {readOnly
              ? "مهام أبنائك، نتائجهم، وتقييمات المعلم."
              : "مهامك من المعلم: تسميعات، قراءة، وتسجيلات."}
          </p>
        </div>
      </div>

      {readOnly ? (
        children.length === 0 ? (
          <EmptyState title="لا يوجد أبناء مرتبطون" body="ربط أبنائك من الإعدادات." />
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                className={`chip-toggle ${selectedChildId === child.id ? "active" : ""}`}
                onClick={() => setSelectedChildId(child.id)}
              >
                {child.fullName}
              </button>
            ))}
          </div>
        )
      ) : null}

      {readOnly && !selectedChild ? null : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {(readOnly
              ? ([{ id: "tasmee", label: "التسميعات", icon: "mic" },
                  { id: "reading", label: "القراءة", icon: "book" },
                  { id: "recordings", label: "التسجيلات", icon: "play" },
                  { id: "records", label: "السجلات", icon: "clipboard" }] as const)
              : ([{ id: "tasmee", label: "التسميعات", icon: "mic" },
                  { id: "reading", label: "القراءة", icon: "book" },
                  { id: "recordings", label: "التسجيلات", icon: "play" }] as const)
            ).map((item) => (
              <button key={item.id} type="button" className={tab === item.id ? "primary-button" : "ghost-button"} onClick={() => setTab(item.id)}>
                <Icon name={item.icon} size={16} /> {item.label}
              </button>
            ))}
          </div>

          {tab === "tasmee" || tab === "reading" ? (
            <SectionCard
              title={tab === "tasmee" ? "التسميعات" : "القراءة"}
              subtitle={tab === "tasmee" ? "مهام التسميع المسندة" : "مهام القراءة المسندة"}
            >
              {activeLearnerTasks.filter((item) => categoryOf(item) === tab).length === 0 ? (
                <EmptyState title="لا توجد مهام" body="لم تُسنَد إليك مهمة من هذا النوع بعد." />
              ) : (
                <div className="homework-list">
                  {activeLearnerTasks
                    .filter((item) => categoryOf(item) === tab)
                    .slice().reverse()
                    .map((item) => {
                      const submissions = learnerSubmissions.filter((sub) => sub.homeworkId === item.id);
                      const lastSubmission = submissions[submissions.length - 1];
                      const category = categoryOf(item);
                      return (
                        <div key={item.id} className="homework-card">
                          <div className="homework-head">
                            <div>
                              <h3>{item.title || CATEGORY_LABELS[category]}</h3>
                              <p className="muted">
                                {CATEGORY_LABELS[category]} • {METHOD_LABELS[item.method]} • {item.optional ? "اختيارية" : "إجبارية"} • استحقاق: {dateLabel(item.dueAt)}
                              </p>
                            </div>
                            {lastSubmission?.score ? <Stars value={lastSubmission.score} /> : <span className="badge badge-warning">بانتظار</span>}
                          </div>

                          {item.segments?.length ? (
                            <div className="surah-grades-grid">
                              {item.segments.map((segment) => (
                                <div key={segment.label} className="surah-grade-chip">
                                  <strong>{segment.label}</strong>
                                  <span>{rangeLabel(segment)}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          {item.notes ? <p className="homework-notes">{item.notes}</p> : null}

                          <div className="submission-area">
                            {readOnly ? (
                              <p className="muted">يمكنك متابعة النتيجة والتقييم في خانتي التسجيلات والسجلات.</p>
                            ) : submittingId === item.id ? (
                              <div className="submission-form">
                                <textarea value={submissionNote} onChange={(event) => setSubmissionNote(event.target.value)} placeholder="ملاحظة (اختياري)" />
                                {item.method === "audio" || item.method === "video" || item.method === "live" ? (
                                  recorder.recording ? (
                                    <div className="recording-bar">
                                      <span className="recording-dot" />
                                      <span>تسجيل… {recorder.seconds}ث</span>
                                      <button type="button" className="danger-button" onClick={async () => {
                                        const result = await recorder.stop();
                                        if (result) setRecordingResult(result);
                                      }}>إيقاف</button>
                                    </div>
                                  ) : recordingResult ? (
                                    <div className="recording-bar">
                                      <audio controls src={recordingResult.dataUrl} />
                                      <button type="button" className="ghost-button" onClick={() => setRecordingResult(null)}>إعادة</button>
                                    </div>
                                  ) : (
                                    <button type="button" className="primary-button" onClick={recorder.start}><Icon name="mic" size={16} /> ابدأ التسجيل</button>
                                  )
                                ) : null}
                                {recorder.error ? <p className="recorder-error">{recorder.error}</p> : null}
                                {item.method !== "inapp" ? (
                                  <div>
                                    <button type="button" className="ghost-button" onClick={() => fileInputRef.current?.click()}><Icon name="file" size={16} /> اختر ملفًا</button>
                                    <input ref={fileInputRef} type="file" hidden onChange={handleFile} />
                                    {submissionFile ? <span className="muted">تم اختيار ملف</span> : null}
                                  </div>
                                ) : null}
                                <div className="submission-actions">
                                  <button type="button" className="primary-button" onClick={() => submit(item)}>تسليم المهمة</button>
                                  <button type="button" className="ghost-button" onClick={() => setSubmittingId(null)}>إلغاء</button>
                                </div>
                              </div>
                            ) : (
                              <div className="form-actions" style={{ flexWrap: "wrap" }}>
                                {item.method === "inapp" && category === "tasmee" ? (
                                  item.segments?.length ? (
                                    item.segments.map((segment) => (
                                      <button key={segment.label} type="button" className="primary-button" onClick={() => startInApp(item, segment)}>
                                        <Icon name="mic" size={16} /> {segment.label}: {rangeLabel(segment)}
                                      </button>
                                    ))
                                  ) : (
                                    <button type="button" className="primary-button" onClick={() => startInApp(item, {
                                      label: "التسميع", mode: "ayah", surah: item.surah, fromAyah: item.fromAyah, toAyah: item.toAyah,
                                    })}>
                                      <Icon name="mic" size={16} /> ابدأ التسميع
                                    </button>
                                  )
                                ) : item.method === "inapp" && category === "reading" ? (
                                  <button type="button" className="primary-button" onClick={() => openReading(item)}>
                                    <Icon name="book" size={16} /> افتح القرآن واقرأ
                                  </button>
                                ) : (
                                  <button type="button" className="primary-button" onClick={() => setSubmittingId(item.id)}>
                                    <Icon name="send" size={16} /> تسليم المهمة
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {submissions.length ? (
                            <div className="submission-history">
                              <h4>سجل التسجيلات</h4>
                              {submissions.slice().reverse().map((submission) => (
                                <div key={submission.id} className="submission-row">
                                  <div>
                                    <strong>{new Date(submission.createdAt).toLocaleString("ar-SA")} • {METHOD_LABELS[submission.kind]}</strong>
                                    {submission.note ? <p>{submission.note}</p> : null}
                                    {submission.feedback ? <p className="muted">تقييم المعلم: {submission.feedback}</p> : null}
                                    {mediaSrc(submission.audioUrl) ? <audio controls src={mediaSrc(submission.audioUrl)} /> : null}
                                  </div>
                                  <span className={`badge ${submission.score === undefined ? "badge-warning" : "badge-success"}`}>
                                    {submission.score === undefined ? "بانتظار التقييم" : `${submission.score}/5`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                </div>
              )}
            </SectionCard>
          ) : null}

          {tab === "recordings" ? (
            <SectionCard title="التسجيلات" subtitle="كل ما سلّمته أو سجّلته داخل التطبيق">
              {learnerSubmissions.length === 0 ? (
                <EmptyState title="لا توجد تسجيلات" body="ستظهر هنا نتائج التسميع والقراءة بعد التسليم." />
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {learnerSubmissions.slice().sort((a, b) => b.createdAt - a.createdAt).map((submission) => {
                    const task = learnerTasks.find((item) => item.id === submission.homeworkId);
                    return (
                      <div key={submission.id} className="homework-card">
                        <div className="homework-head">
                          <div>
                            <h3>{task?.title || "مهمة"}</h3>
                            <p className="muted">{CATEGORY_LABELS[categoryOf(task)]} • {METHOD_LABELS[submission.kind]} • {new Date(submission.createdAt).toLocaleString("ar-SA")}</p>
                          </div>
                          <span className={`badge ${submission.score === undefined ? "badge-warning" : "badge-success"}`}>
                            {submission.score === undefined ? "بانتظار التقييم" : `${submission.score}/5`}
                          </span>
                        </div>
                        {submission.note ? <p className="homework-notes">{submission.note}</p> : null}
                        {mediaSrc(submission.audioUrl) ? <audio controls src={mediaSrc(submission.audioUrl)} style={{ width: "100%", marginTop: 6 }} /> : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          ) : null}

          {tab === "records" ? (
            <SectionCard title="السجلات" subtitle="تقييمات المعلم ونتائجك">
              {learnerSubmissions.length === 0 ? (
                <EmptyState title="لا توجد سجلات" body="ستظهر هنا تقييمات المعلم بعد تصحيح المهام." />
              ) : (
                <div className="timeline-list">
                  {learnerSubmissions.slice().sort((a, b) => b.createdAt - a.createdAt).map((submission) => {
                    const task = learnerTasks.find((item) => item.id === submission.homeworkId);
                    return (
                      <div key={submission.id} className="timeline-item">
                        <div className="timeline-dot" />
                        <div className="timeline-body">
                          <div className="timeline-head">
                            <strong>{task?.title || "مهمة"} • {submission.score === undefined ? "بانتظار التقييم" : `${submission.score}/5`}</strong>
                            <span className="muted">{new Date(submission.createdAt).toLocaleString("ar-SA")}</span>
                          </div>
                          <p className="muted">{CATEGORY_LABELS[categoryOf(task)]} • {METHOD_LABELS[submission.kind]}</p>
                          {submission.note ? <p>{submission.note}</p> : null}
                          {submission.feedback ? <p className="success">تقييم المعلم: {submission.feedback}</p> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          ) : null}
        </>
      )}
    </div>
  );
}
