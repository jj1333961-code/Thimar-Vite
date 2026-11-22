import { useEffect, useState } from "react";
import { type Account } from "../../lib/auth";
import {
  studentsOfTeacher,
  loadSubmissions,
  loadHomework,
  averageScore,
  scoreTrend,
  latestSubmissionOf,
  loadGameProgress,
  loadRecitationAttempts,
  homeworkSurahRange,
  type HomeworkMethod,
  type Submission,
} from "../../lib/appStore";
import { surahs } from "../../data/surahs";
import { Icon, EmptyState, Stars, SectionCard } from "./ui";
import GameProgressCard from "./GameProgressCard";

const METHOD_LABELS: Record<HomeworkMethod, string> = {
  live: "تسميع مباشر",
  inapp: "تسميع عبر التطبيق",
  photo: "صورة",
  audio: "ملف صوتي",
  video: "فيديو",
  text: "نص",
  call: "مكالمة هاتفية",
  file: "ملف مرفق",
};

function surahName(n: number) {
  return surahs[n - 1]?.name ?? `سورة ${n}`;
}

export default function ReportsPage({ account }: { account: Account }) {
  const [students, setStudents] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  useEffect(() => {
    const list = studentsOfTeacher(account.id);
    setStudents(list);
    if (list.length && !selectedId) setSelectedId(list[0].id);
  }, [account.id]);

  useEffect(() => {
    if (selectedId) {
      setSubmissions(
        loadSubmissions()
          .filter((submission) => submission.studentId === selectedId)
          .sort((a, b) => b.createdAt - a.createdAt),
      );
    }
  }, [selectedId]);

  const selectedStudent = students.find((student) => student.id === selectedId);
  const gameProgress = selectedStudent ? loadGameProgress(selectedStudent.id) : null;
  const recitationAttempts = selectedStudent ? loadRecitationAttempts(selectedStudent.id) : [];
  const studentHomework = selectedStudent
    ? loadHomework()
        .filter((item) => item.studentId === selectedStudent.id)
        .sort((a, b) => b.createdAt - a.createdAt)
    : [];
  return (
    <div className="page reports-page">
      <div className="page-head">
        <h2>التقارير</h2>
      </div>

      {students.length === 0 ? (
        <EmptyState title="لا يوجد طلاب" body="سيظهر طلابك هنا بعد ربطهم." />
      ) : (
        <div className="reports-layout">
          <aside className="student-list">
            {students.map((student) => {
              const trend = scoreTrend(student.id);
              const avg = averageScore(student.id);
              return (
                <button
                  key={student.id}
                  type="button"
                  className={`student-row ${selectedId === student.id ? "active" : ""}`}
                  onClick={() => setSelectedId(student.id)}
                >
                  <div>
                    <strong>{student.fullName}</strong>
                    <span className="muted">{student.student?.level ?? "—"}</span>
                  </div>
                  <div className="student-meta">
                    <Stars value={Math.round(avg)} />
                    <span className={`trend trend-${trend}`}>
                      <Icon name={trend === "up" ? "up" : trend === "down" ? "down" : "check"} size={14} />
                    </span>
                  </div>
                </button>
              );
            })}
          </aside>

          <section className="report-detail">
            {selectedStudent ? (
              <>
                <SectionCard
                  title={selectedStudent.fullName}
                  subtitle={`المستوى ${selectedStudent.student?.level ?? "—"} • ${selectedStudent.student?.track}`}
                  action={
                    <span className={`trend-badge trend-${scoreTrend(selectedStudent.id)}`}>
                      {scoreTrend(selectedStudent.id) === "up"
                        ? "صعود"
                        : scoreTrend(selectedStudent.id) === "down"
                          ? "هبوط"
                          : "مستقر"}
                    </span>
                  }
                >
                  <div className="stat-row">
                    <div className="stat-mini">
                      <span>متوسط التقييم</span>
                      <strong>{averageScore(selectedStudent.id) || "—"}</strong>
                    </div>
                    <div className="stat-mini">
                      <span>عدد التسليمات</span>
                      <strong>{submissions.length}</strong>
                    </div>
                    <div className="stat-mini">
                      <span>آخر تقييم</span>
                      <strong>{latestSubmissionOf(selectedStudent.id)?.score ?? "—"}</strong>
                    </div>
                    <div className="stat-mini">
                      <span>واجبات مسندة</span>
                      <strong>{loadHomework().filter((item) => item.studentId === selectedStudent.id).length}</strong>
                    </div>
                  </div>
                </SectionCard>

                {gameProgress ? (
                  <GameProgressCard progress={gameProgress} recitations={recitationAttempts} />
                ) : null}

                <SectionCard title="تفاصيل الواجبات وتقييم السور" subtitle="كل واجب ونطاق السور وتقييم المعلم لكل سورة على حدة">
                  {studentHomework.length === 0 ? (
                    <EmptyState title="لا توجد واجبات" body="لم يُسند هذا المعلم واجبًا لهذا الطالب بعد." />
                  ) : (
                    <div className="report-homework-list">
                      {studentHomework.map((item) => {
                        const range = homeworkSurahRange(item);
                        const relatedSubmissions = submissions.filter((submission) => submission.homeworkId === item.id);
                        return (
                          <div key={item.id} className="report-homework-card">
                            <div className="report-homework-head">
                              <div>
                                <strong>{range.map(surahName).join(" ← ")}</strong>
                                <p className="muted">
                                  {METHOD_LABELS[item.method]} • أُسند {new Date(item.createdAt).toLocaleDateString("ar-SA")} • الاستحقاق {new Date(item.dueAt).toLocaleDateString("ar-SA")}
                                </p>
                              </div>
                              <span className="badge badge-info">{range.length} سورة</span>
                            </div>
                            {item.notes ? <p className="homework-notes">{item.notes}</p> : null}
                            <div className="report-surah-grades">
                              {range.map((surah) => {
                                const grade = item.surahGrades?.[String(surah)];
                                return (
                                  <div key={surah} className={`report-surah-grade ${grade ? "done" : ""}`}>
                                    <strong>{surahName(surah)}</strong>
                                    {grade ? (
                                      <>
                                        <span className="grade-score">{grade.score}/5</span>
                                        <span className="muted">{grade.feedback || "بدون ملاحظة"}</span>
                                      </>
                                    ) : (
                                      <span className="muted">لم تُقيّم</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="report-submissions">
                              <span className="muted">التسميعات المرفقة: {relatedSubmissions.length}</span>
                              {relatedSubmissions.map((submission) => (
                                <div key={submission.id} className="report-submission-row">
                                  <span>{new Date(submission.createdAt).toLocaleString("ar-SA")}</span>
                                  {submission.audioUrl ? <audio controls src={submission.audioUrl} /> : null}
                                  {submission.note ? <span className="muted">{submission.note}</span> : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="سجل التسميع والواجب">
                  {submissions.length === 0 ? (
                    <EmptyState title="لا توجد تسليمات" body="لم يسلّم الطالب تسميعًا بعد." />
                  ) : (
                    <div className="timeline">
                      {submissions.map((submission) => (
                        <div key={submission.id} className="timeline-item">
                          <div className="timeline-dot" />
                          <div className="timeline-body">
                            <div className="timeline-head">
                              <strong>{submission.score ? `${submission.score}/5` : "بانتظار التصحيح"}</strong>
                              <span className="muted">
                                {new Date(submission.createdAt).toLocaleString("ar-SA")}
                              </span>
                            </div>
                            {submission.note ? <p>{submission.note}</p> : null}
                            {submission.feedback ? <p className="muted">{submission.feedback}</p> : null}
                            {submission.audioUrl ? <audio controls src={submission.audioUrl} /> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
