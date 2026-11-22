import type { GameProgress, RecitationAttempt } from "../../lib/appStore";
import { SectionCard } from "./ui";

const GAME_LEVELS = [
  { id: "a1", name: "البداية" },
  { id: "a2", name: "الانطلاق" },
  { id: "a3", name: "التقدّم" },
  { id: "a4", name: "الإتقان" },
  { id: "a5", name: "التحدّي" },
  { id: "a6", name: "الأسطورة" },
  { id: "a7", name: "الإتقان (2)" },
  { id: "a8", name: "التحدّي (2)" },
  { id: "a9", name: "الأسطورة (2)" },
  { id: "a10", name: "الماهر" },
  { id: "a11", name: "الخبير" },
  { id: "a12", name: "الحافظ" },
] as const;

export default function GameProgressCard({
  progress,
  recitations = [],
  subtitle = "رحلة A1–A12 المحفوظة على حساب هذا الطالب",
}: {
  progress: GameProgress;
  recitations?: RecitationAttempt[];
  subtitle?: string;
}) {
  const clearedLevels = GAME_LEVELS.filter((level) => progress.levelCleared?.[level.id]).length;
  const gameStars = GAME_LEVELS.reduce(
    (total, level) => total + (progress.stars[`level-${level.id}`] ?? 0),
    0,
  );
  const recitationAverage = recitations.length
    ? Math.round((recitations.reduce((total, attempt) => total + attempt.score, 0) / recitations.length) * 10) / 10
    : 0;
  const latestRecitation = recitations[0];

  return (
    <SectionCard title="تقدم الألغاز والتسميع" subtitle={subtitle}>
      <div className="stat-row">
        <div className="stat-mini">
          <span>نقاط الألغاز</span>
          <strong>{progress.points}</strong>
        </div>
        <div className="stat-mini">
          <span>المستويات المكتملة</span>
          <strong>{clearedLevels}/12</strong>
        </div>
        <div className="stat-mini">
          <span>النجوم</span>
          <strong>{gameStars}/36</strong>
        </div>
        <div className="stat-mini">
          <span>أفضل سلسلة</span>
          <strong>{progress.bestStreak}</strong>
        </div>
        <div className="stat-mini">
          <span>محاولات التسميع</span>
          <strong>{recitations.length}</strong>
        </div>
        <div className="stat-mini">
          <span>متوسط النطق</span>
          <strong>{recitations.length ? `${recitationAverage}/10` : "—"}</strong>
        </div>
      </div>

      <div className="report-game-levels">
        {GAME_LEVELS.map((level) => {
          const stars = progress.stars[`level-${level.id}`] ?? 0;
          const done = Boolean(progress.levelCleared?.[level.id]);
          return (
            <div key={level.id} className={`report-game-level ${done ? "done" : ""}`}>
              <span className={`level-badge level-${level.id}`}>{level.id.toUpperCase()}</span>
              <div className="report-game-level-text">
                <strong>{level.name}</strong>
                <span>{done ? "مكتمل" : "لم يكتمل"}</span>
              </div>
              <span className="level-stars">
                {"★".repeat(stars)}
                {"☆".repeat(3 - stars)}
              </span>
            </div>
          );
        })}
      </div>

      {progress.history.length ? (
        <div className="history-list report-game-history">
          {progress.history.slice(0, 5).map((run, runIndex) => (
            <div key={`${run.at}-${runIndex}`} className="history-row">
              <span>
                {run.level.toUpperCase()} • {new Date(run.at).toLocaleDateString("ar-SA")}
              </span>
              <span>{run.points} نقطة</span>
              <span>{"★".repeat(run.stars)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted report-game-empty">لم يبدأ الطالب رحلة الألغاز بعد.</p>
      )}

      <div className="report-recitation">
        <div className="report-recitation-head">
          <div>
            <strong>تسميع صوتي — تقييم النطق</strong>
            <p className="muted">
              {latestRecitation
                ? `آخر محاولة: ${new Date(latestRecitation.at).toLocaleString("ar-SA")} • ${latestRecitation.score}/10`
                : "تُسجَّل كل محاولة مع تاريخها بعد التعرف على الآية من التلاوة."}
            </p>
          </div>
          {recitations.length ? <span className="badge badge-info">{recitations.length} محاولة</span> : null}
        </div>
        {recitations.length ? (
          <div className="history-list report-recitation-list">
            {recitations.slice(0, 8).map((attempt) => (
              <div key={attempt.id} className="recitation-report-row">
                <span className={`recitation-score-badge ${attempt.score >= 6 ? "pass" : "fail"}`}>
                  {attempt.score}/10
                </span>
                <div className="recitation-report-text">
                  <strong>سورة {attempt.surahName} • الآية {attempt.ayah}</strong>
                  <span className="muted">
                    {new Date(attempt.at).toLocaleString("ar-SA")} • تطابق {attempt.matched} من {attempt.total} كلمة
                  </span>
                </div>
                <span className={`confidence-chip confidence-${attempt.confidence}`}>
                  {attempt.confidence === "high" ? "تعرف عالٍ" : attempt.confidence === "medium" ? "تعرف متوسط" : "تعرف منخفض"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted report-game-empty">لم يسجّل الطالب أي محاولة تسميع صوتي بعد.</p>
        )}
      </div>
    </SectionCard>
  );
}
