import { useEffect, useRef } from "react";
import { type Account } from "../../lib/auth";
import {
  loadHomework,
  loadSubmissions,
  studentsOfTeacher,
  childrenOfGuardian,
  latestSubmissionOf,
  unreadCount,
  loadGameProgress,
  emptyGameProgress,
  loginDaysOf,
  teacherLinkRequestsFor,
  respondTeacherLinkRequest,
  type Settings,
} from "../../lib/appStore";
import PrayerHero from "./PrayerHero";
import { Icon, SectionCard, StatCard, type IconName } from "./ui";

type HubId = "quran" | "quran-circle" | "tuhfa" | "tafsir" | "hadith" | "adhkar" | "fatwa" | "tasbih" | "qibla";

const HUB_TILES: Array<{ id: HubId; label: string; hint: string; icon: IconName }> = [
  { id: "quran-circle", label: "المصحف", hint: "أجزاء، سور، علامات", icon: "book" },
  { id: "tuhfa", label: "تحفة الأطفال", hint: "النظم كاملًا بالصوت", icon: "star" },
  { id: "tafsir", label: "تفسير القرآن", hint: "لكل آية", icon: "search" },
  { id: "hadith", label: "الأحاديث", hint: "حديث وشرح", icon: "chat" },
  { id: "adhkar", label: "الأدعية والأذكار", hint: "أذكار متنوعة", icon: "sun" },
  { id: "fatwa", label: "الإفتاء", hint: "فتاوى مختارة", icon: "file" },
  { id: "tasbih", label: "تسبيح", hint: "عدّاد التسبيح", icon: "sparkles" },
  { id: "qibla", label: "القبلة", hint: "حسب موقعك", icon: "compass" },
];

export default function HomePage({
  account,
  settings,
  onNavigate,
  onOpenExam,
}: {
  account: Account;
  settings: Settings;
  onNavigate: (tab: string) => void;
  onOpenExam: () => void;
}) {
  const hubRef = useRef<HTMLElement | null>(null);

  /* سحب الصندوق بالفأرة لعرض بقية الدوائر (اللمس يمرّر طبيعيًا). */
  useEffect(() => {
    const hub = hubRef.current;
    if (!hub) return;
    let dragging = false;
    let startX = 0;
    let startLeft = 0;
    let moved = false;
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startLeft = hub.scrollLeft;
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      hub.scrollLeft = startLeft - dx;
    };
    const onUp = () => { dragging = false; };
    const onClick = (event: MouseEvent) => {
      if (!moved) return;
      moved = false;
      event.preventDefault();
      event.stopPropagation();
    };
    hub.addEventListener("pointerdown", onDown);
    hub.addEventListener("click", onClick, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      hub.removeEventListener("pointerdown", onDown);
      hub.removeEventListener("click", onClick, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const today = new Date();
  let hijri = "";
  try {
    hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(today);
  } catch {
    hijri = today.toLocaleDateString("ar-SA");
  }

  const unread = unreadCount(account);

  const teacherStudents = account.type === "teacher" ? studentsOfTeacher(account.id) : [];
  const pendingReviews =
    account.type === "teacher"
      ? loadSubmissions().filter(
          (submission) =>
            submission.teacherId === account.id && submission.score === undefined,
        ).length
      : 0;
  const todayHomework =
    account.type === "teacher"
      ? loadHomework().filter((item) => item.teacherId === account.id).length
      : 0;

  const children = account.type === "guardian" ? childrenOfGuardian(account) : [];
  const gameProgress = account.type === "student" ? loadGameProgress(account.id) : emptyGameProgress();
  const loginDays = loginDaysOf(account.id);
  const linkRequests = account.type === "teacher" ? teacherLinkRequestsFor(account.id) : [];

  const openHub = (id: HubId) => onNavigate(id);

  return (
    <div className="page home-page">
      <section className="welcome-strip">
        <div>
          <span className="welcome-date">{hijri}</span>
          <h1>مرحبًا، {account.fullName}</h1>
          <p>
            {account.type === "admin"
              ? null
              : account.type === "teacher"
                ? "تابع طلابك، صحّح التسميعات، وتابع التقدّم."
                : account.type === "guardian"
                  ? "تابع أبناءك ومستواهم في الحفظ."
                  : "واصل الحفظ، وحلّ الألغاز، واجمع النجوم."}
          </p>
        </div>
        <div className="hero-chips">
          <button type="button" className="chip" onClick={() => onNavigate("games")} title="كل نقاطك في الألغاز والتحدي والاختبارات">
            <Icon name="star" size={14} /> {gameProgress.points} نقطة
          </button>
          <span className="chip" title="أيام الدخول المتتالية">
            <Icon name="trend" size={14} /> {loginDays} يوم
          </span>
          <button type="button" className="chip" onClick={() => onNavigate("notifications")} title="كل الإشعارات المرسلة إليك">
            <Icon name="bell" size={14} /> {unread} إشعار
          </button>
        </div>
      </section>

      <PrayerHero
        settings={settings}
        onOpenAdhanLog={() => onNavigate("adhan-log")}
        onOpenSettings={() => onNavigate("settings")}
      />

      <section className="home-hub" ref={hubRef}>
        {(account.type === "guardian" ? HUB_TILES.filter((tile) => tile.id !== "fatwa") : HUB_TILES).map((tile) => (
          <button
            key={tile.id}
            type="button"
            className={`hub-tile hub-tile-${tile.id}`}
            onClick={() => openHub(tile.id)}
          >
            {tile.id === "tasbih" ? (
              <span className="hub-icon hub-tasbih" aria-hidden="true">
                <span className="hub-tasbih-beads" />
                <span className="hub-tasbih-core">✿</span>
              </span>
            ) : (
              <span className="hub-icon">
                <Icon name={tile.icon} size={26} />
              </span>
            )}
            <strong>{tile.label}</strong>
          </button>
        ))}
      </section>

      {account.type === "teacher" && linkRequests.length ? (
        <SectionCard title="طلبات ربط الطلاب" subtitle={`${linkRequests.length} طلب بانتظار قرارك`}>
          <div className="connection-list">
            {linkRequests.map((request) => (
              <div key={request.id} className="connection-row">
                <span>{request.studentName} (@{request.studentUsername})</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="success-button" onClick={() => respondTeacherLinkRequest(request.id, true)}>
                    موافقة
                  </button>
                  <button type="button" className="danger-button" onClick={() => respondTeacherLinkRequest(request.id, false)}>
                    رفض
                  </button>
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {account.type === "teacher" ? (
        <div className="action-strip">
          <StatCard
            label="تسميعات بانتظار التصحيح"
            value={pendingReviews}
            icon="clipboard"
            tone={pendingReviews ? "warning" : "default"}
            onClick={() => onNavigate("homework")}
          />
          <StatCard
            label="طلابك"
            value={teacherStudents.length}
            icon="users"
            onClick={() => onNavigate("reports")}
          />
          <StatCard
            label="واجبات مسندة"
            value={todayHomework}
            icon="book"
            onClick={() => onNavigate("homework")}
          />
        </div>
      ) : null}

      {account.type === "guardian" ? (
        <div className="action-strip">
          {children.map((child) => (
            <StatCard
              key={child.id}
              label={child.fullName}
              value={latestSubmissionOf(child.id)?.score ? `${latestSubmissionOf(child.id)?.score}/5` : "—"}
              hint="آخر تقييم"
              icon="users"
              onClick={() => onNavigate("children")}
            />
          ))}
          {children.length === 0 ? (
            <StatCard label="أبناء" value={0} icon="users" onClick={() => onNavigate("children")} />
          ) : null}
        </div>
      ) : null}

      {account.type === "teacher" && (
        <SectionCard
          title="الاختبار التمهيدي / اختبار الإتقان"
          subtitle="أسئلة متنوعة من القرآن، بمؤقت ومراجعة"
          action={
            <button type="button" className="primary-button" onClick={onOpenExam}>
              <Icon name="sparkles" size={16} /> ابدأ
            </button>
          }
        >
          <p className="muted">اختبر إتقانك (12 سؤالًا) للحصول على اعتماد المعلم.</p>
        </SectionCard>
      )}

      <button type="button" className="primary-button" onClick={() => onNavigate("coach")}>
        <Icon name="mic" size={18} /> القراءة الذكية
      </button>
    </div>
  );
}
