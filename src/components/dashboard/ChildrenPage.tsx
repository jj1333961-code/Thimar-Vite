import { useEffect, useState } from "react";
import type { Account } from "../../lib/auth";
import {
  childrenOfGuardian,
  loadHomework,
  loadSubmissions,
  latestSubmissionOf,
  averageScore,
  scoreTrend,
  loadGameProgress,
  loadRecitationAttempts,
} from "../../lib/appStore";
import { surahs } from "../../data/surahs";
import { Icon, EmptyState, Stars, SectionCard } from "./ui";
import GameProgressCard from "./GameProgressCard";

export default function ChildrenPage({ account }: { account: Account }) {
  const [children, setChildren] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const list = childrenOfGuardian(account);
    setChildren(list);
    if (list.length && !selectedId) setSelectedId(list[0].id);
  }, [account]);

  const selected = children.find((child) => child.id === selectedId);
  const gameProgress = selected ? loadGameProgress(selected.id) : null;
  const recitationAttempts = selected ? loadRecitationAttempts(selected.id) : [];

  return (
    <div className="page children-page">
      <div className="page-head">
        <h2>تقييم الأبناء</h2>
      </div>

      {children.length === 0 ? (
        <EmptyState title="لا يوجد أبناء مرتبطون" body="ربط أبنائك من الإعدادات." />
      ) : (
        <div className="reports-layout">
          <aside className="student-list">
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                className={`student-row ${selectedId === child.id ? "active" : ""}`}
                onClick={() => setSelectedId(child.id)}
              >
                <div>
                  <strong>{child.fullName}</strong>
                  <span className="muted">{child.student?.level ?? "—"}</span>
                </div>
                <div className="student-meta">
                  <Stars value={Math.round(averageScore(child.id))} />
                  <span className={`trend trend-${scoreTrend(child.id)}`}>
                    <Icon name={scoreTrend(child.id) === "up" ? "up" : scoreTrend(child.id) === "down" ? "down" : "check"} size={14} />
                  </span>
                </div>
              </button>
            ))}
          </aside>

          <section className="report-detail">
            {selected ? (
              <>
                <SectionCard
                  title={selected.fullName}
                  subtitle={`المستوى ${selected.student?.level ?? "—"} • ${selected.student?.track}`}
                >
                  <div className="stat-row">
                    <div className="stat-mini">
                      <span>متوسط التقييم</span>
                      <strong>{averageScore(selected.id) || "—"}</strong>
                    </div>
                    <div className="stat-mini">
                      <span>آخر تقييم</span>
                      <strong>{latestSubmissionOf(selected.id)?.score ?? "—"}</strong>
                    </div>
                    <div className="stat-mini">
                      <span>واجبات</span>
                      <strong>{loadHomework().filter((item) => item.studentId === selected.id).length}</strong>
                    </div>
                  </div>
                </SectionCard>

                {gameProgress ? (
                  <GameProgressCard progress={gameProgress} recitations={recitationAttempts} />
                ) : null}

                <SectionCard title="الواجبات والتسميع">
                  {loadHomework().filter((item) => item.studentId === selected.id).length === 0 ? (
                    <EmptyState title="لا توجد واجبات" body="لم يُسنَد للابن واجب بعد." />
                  ) : (
                    loadHomework()
                      .filter((item) => item.studentId === selected.id)
                      .map((item) => {
                        const submission = loadSubmissions().find((sub) => sub.homeworkId === item.id && sub.studentId === selected.id);
                        const surahName = surahs[item.surah - 1]?.name ?? `سورة ${item.surah}`;
                        return (
                          <div key={item.id} className="homework-mini">
                            <strong>{surahName} ({item.fromAyah}–{item.toAyah})</strong>
                            <p className="muted">
                              {submission?.score ? `تقييم: ${submission.score}/5` : "بانتظار التسليم/التصحيح"}
                            </p>
                            {submission?.feedback ? <p>{submission.feedback}</p> : null}
                          </div>
                        );
                      })
                  )}
                </SectionCard>

                <SectionCard title="سجل التسميع">
                  {loadSubmissions()
                    .filter((sub) => sub.studentId === selected.id)
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((sub) => (
                      <div key={sub.id} className="timeline-item">
                        <div className="timeline-dot" />
                        <div className="timeline-body">
                          <div className="timeline-head">
                            <strong>{sub.score ? `${sub.score}/5` : "بانتظار"}</strong>
                            <span className="muted">{new Date(sub.createdAt).toLocaleString("ar-SA")}</span>
                          </div>
                          {sub.feedback ? <p className="muted">{sub.feedback}</p> : null}
                          {sub.audioUrl ? <audio controls src={sub.audioUrl} /> : null}
                        </div>
                      </div>
                    ))}
                </SectionCard>
              </>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
