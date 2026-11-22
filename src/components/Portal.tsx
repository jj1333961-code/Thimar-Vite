import { useState } from "react";
import { findCountry, flagOf } from "../data/countries";
import { surahs } from "../data/surahs";
import {
  accountTypeLabel,
  loadAccounts,
  updateAccount,
  type Account,
} from "../lib/auth";
import { latestExamFor, type ExamKind, type ExamResult } from "../lib/exam";
import ComplaintForm from "./ComplaintForm";
import Exam from "./Exam";
import { BrandMark, CheckIcon } from "./ui";

const trackLabels: Record<string, string> = {
  quran: "القرآن الكريم",
  tuhfa: "تحفة الأطفال",
  both: "القرآن وتحفة الأطفال",
};

const levelDescriptions: Record<string, string> = {
  A1: "قصار السور ونطق الحروف",
  A2: "جزء عمّ مع تجويد مبسّط",
  A3: "عدة أجزاء وحفظ منتظم",
  A4: "نحو نصف القرآن",
  A5: "أكثر من خمسة عشر جزءًا",
  A6: "حفظ شبه كامل للمصحف",
  A7: "ختمة كاملة بإتقان",
};

function examKindOf(account: Account): ExamKind {
  return account.type === "teacher" ? "teacher" : "student";
}

function scoreLabel(result: ExamResult): string {
  return `${result.score} من ${result.total} · ${result.percent}%`;
}

export function PendingScreen({
  account,
  onBack,
}: {
  account: Account;
  onBack: () => void;
}) {
  const [examOpen, setExamOpen] = useState(false);
  const [latest, setLatest] = useState<ExamResult | undefined>(() =>
    latestExamFor(account.id, "teacher"),
  );

  if (examOpen) {
    return (
      <Exam
        account={account}
        kind="teacher"
        onExit={() => {
          setExamOpen(false);
          setLatest(latestExamFor(account.id, "teacher"));
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="pending-wrap">
        <div className="pending-card pending-wide">
          <span className="status-pill">قيد المراجعة</span>
          <h1>شكرًا لك، {account.fullName.split(" ")[0]}</h1>
          <p className="pending-text">
            وصل طلبك إلى المسؤول للتحقق من بياناتك. يُفعَّل حساب المعلم بعد
            الاعتماد، ويمكنك بعدها الدخول ومتابعة طلابك.
          </p>

          <div className="pending-details">
            <div>
              <span>نوع الحساب</span>
              <b>معلم</b>
            </div>
            <div>
              <span>اسم المستخدم</span>
              <b dir="ltr">{account.username}</b>
            </div>
            <div>
              <span>الأجزاء المحفوظة</span>
              <b>{account.teacher?.juzMemorized ?? 0} من ٣٠</b>
            </div>
            <div>
              <span>الإجازة</span>
              <b>{account.teacher?.hasIjazah ? "حاصل على إجازة" : "بدون إجازة"}</b>
            </div>
            <div>
              <span>القراءات</span>
              <b>{account.teacher?.qiraat.join(" · ") || "—"}</b>
            </div>
            <div>
              <span>التجويد</span>
              <b>{account.teacher?.mujawwad ? "مجوّد" : "غير مجوّد"}</b>
            </div>
          </div>

          <div className="pending-exam">
            <div className="pending-exam-head">
              <h2>اختبار الإتقان</h2>
              {latest ? (
                <span className="score-pill">{latest.percent}%</span>
              ) : (
                <span className="locked-tag">مطلوب للاعتماد</span>
              )}
            </div>
            <p>
              اختبار مولَّد من الأجزاء التي ذكرتها، مع أسئلة في القراءات وعلوم
              القرآن. نتيجة الاختبار تظهر للمسؤول مع طلبك.
            </p>
            {latest && (
              <p className="exam-latest-line">
                آخر نتيجة: {scoreLabel(latest)}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => setExamOpen(true)}
            >
              {latest ? "إعادة اختبار الإتقان" : "ابدأ اختبار الإتقان"}
            </button>
          </div>

          <button type="button" className="btn btn-ghost btn-block" onClick={onBack}>
            العودة إلى تسجيل الدخول
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Portal({
  account,
  onLogout,
}: {
  account: Account;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState<Account>(account);
  const [examKind, setExamKind] = useState<ExamKind | null>(null);
  const [latest, setLatest] = useState<ExamResult | undefined>(() =>
    latestExamFor(account.id, examKindOf(account)),
  );
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [levelApplied, setLevelApplied] = useState(false);

  const country = findCountry(current.countryCode);
  const student = current.student;
  const teacher = current.teacher;
  const kind = examKindOf(current);
  // المعلم المختار حساب حقيقي معتمد داخل التطبيق، وليس من قائمة تجريبية.
  const linkedTeacherId = student?.teacherAccountId || student?.teacherId;
  const selectedTeacher = linkedTeacherId
    ? loadAccounts().find((item) => item.id === linkedTeacherId && item.type === "teacher")
    : undefined;
  const firstName = current.fullName.split(" ")[0];

  if (examKind) {
    return (
      <Exam
        account={current}
        kind={examKind}
        onExit={() => {
          setExamKind(null);
          setLatest(latestExamFor(current.id, examKindOf(current)));
          setLevelApplied(false);
        }}
      />
    );
  }

  function applySuggestedLevel() {
    if (!latest || !current.student) return;
    const updated = updateAccount(current.id, {
      student: { ...current.student, level: latest.suggestedLevel },
    });
    if (updated) {
      setCurrent(updated);
      setLevelApplied(true);
    }
  }

  const canTakeExam =
    current.type === "student" ||
    (current.type === "teacher" && current.status === "active");

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-brand">
          <BrandMark size={36} />
          <span className="app-wordmark">ثمار</span>
        </div>
        <div className="app-user">
          <span className="badge">{accountTypeLabel(current.type)}</span>
          <span className="app-user-name">{current.fullName}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
            تسجيل الخروج
          </button>
        </div>
      </header>

      <main className="app-main">
        <section className="hello-card">
          <div>
            <p className="eyebrow">تم تسجيل الدخول بنجاح</p>
            <h1>أهلًا، {firstName} 👋</h1>
            <p className="hello-sub">
              {current.type === "student"
                ? "خطوتك الأولى هي الاختبار التمهيدي، ثم نضبط لك خطة الحفظ على مستواك."
                : current.type === "teacher"
                  ? "اختبر إتقانك من الأجزاء التي تحفظها، وتابع طلابك بعد الاعتماد."
                  : "تابع تقدّم أبنائك وتقارير المعلم من مكان واحد."}
            </p>
          </div>
          <div className="hello-meta">
            <span className="meta-chip">
              <span aria-hidden="true">{country ? flagOf(country.code) : "🌍"}</span>
              {country?.ar ?? "—"}
            </span>
            <span className="meta-chip" dir="ltr">
              {country?.dial} {current.phone}
            </span>
          </div>
        </section>

        <div className="portal-grid">
          <section className="panel">
            <h2>ملفك في ثمار</h2>

            {current.type === "student" && student && (
              <>
                <ul className="summary-list">
                  <li>
                    <span>المسار</span>
                    <b>{trackLabels[student.track]}</b>
                  </li>
                  {student.track !== "quran" && (
                    <li>
                      <span>آخر بيت في التحفة</span>
                      <b>{student.tuhfaLastVerse ?? "—"} من ٦١</b>
                    </li>
                  )}
                  <li>
                    <span>المستوى</span>
                    <b>{student.level}</b>
                  </li>
                  <li>
                    <span>الأجزاء</span>
                    <b>
                      {student.juz.length === 0
                        ? "لم تُحدَّد بعد"
                        : student.juz.length === 30
                          ? "القرآن كاملًا"
                          : `${student.juz.length} جزءًا`}
                    </b>
                  </li>
                  <li>
                    <span>السور</span>
                    <b>
                      {student.surahs.length === 0
                        ? "لم تُحدَّد بعد"
                        : student.surahs
                            .slice(0, 3)
                            .map((n) => surahs[n - 1]?.name)
                            .join(" · ") +
                          (student.surahs.length > 3
                            ? ` +${student.surahs.length - 3}`
                            : "")}
                    </b>
                  </li>
                  <li>
                    <span>المعلم</span>
                    <b>
                      {selectedTeacher?.fullName ?? (student.needsTeacher ? "بانتظار موافقة المعلم" : "بدون معلم حاليًا")}
                    </b>
                  </li>
                </ul>

                <div className="level-ladder" aria-label="مستويات الرحلة">
                  {["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12"].map((level) => (
                    <span
                      key={level}
                      className={
                        level === student.level
                          ? "level-pill is-current"
                          : "level-pill"
                      }
                      title={levelDescriptions[level]}
                    >
                      {level}
                    </span>
                  ))}
                </div>
              </>
            )}

            {current.type === "teacher" && teacher && (
              <ul className="summary-list">
                <li>
                  <span>الأجزاء المحفوظة</span>
                  <b>{teacher.juzMemorized} من ٣٠</b>
                </li>
                <li>
                  <span>التجويد</span>
                  <b>{teacher.mujawwad ? "مجوّد" : "غير مجوّد"}</b>
                </li>
                <li>
                  <span>الإجازة</span>
                  <b>{teacher.hasIjazah ? "حاصل على إجازة" : "بدون إجازة"}</b>
                </li>
                <li>
                  <span>القراءات</span>
                  <b>{teacher.qiraat.join(" · ")}</b>
                </li>
              </ul>
            )}

            {current.type === "guardian" && (
              <ul className="summary-list">
                <li>
                  <span>الطالب المرتبط</span>
                  <b dir="ltr">{current.guardian?.linkedStudent || "لم يُضف بعد"}</b>
                </li>
                <li>
                  <span>الدور</span>
                  <b>متابعة الحفظ والتقارير</b>
                </li>
              </ul>
            )}
          </section>

          {canTakeExam ? (
            <section className="panel">
              <div className="panel-head">
                <h2>
                  {current.type === "teacher"
                    ? "اختبار الإتقان"
                    : "الاختبار التمهيدي"}
                </h2>
                {latest && <span className="score-pill">{latest.percent}%</span>}
              </div>
              <p className="panel-text">
                {current.type === "teacher"
                  ? "اختبار مبني على الأجزاء التي تحفظها، مع أسئلة في القراءات وعلوم القرآن. النتيجة تُحفظ للمراجعة."
                  : "أسئلة تُولَّد من نص القرآن عبر الإنترنت: معرفة السورة، إكمال الآية، ترتيب الكلمات، والصح والخطأ — بلا تكرار."}
              </p>

              {latest ? (
                <div className="exam-latest">
                  <span className="exam-score">{latest.percent}%</span>
                  <div>
                    <b>آخر نتيجة</b>
                    <small>{scoreLabel(latest)}</small>
                  </div>
                  <span className="exam-suggest">المقترح {latest.suggestedLevel}</span>
                </div>
              ) : (
                <ul className="exam-points">
                  <li>
                    <CheckIcon /> {current.type === "teacher" ? "١٢" : "٨"} أسئلة
                    مولَّدة جديدة في كل محاولة
                  </li>
                  <li>
                    <CheckIcon /> وقت محدد مع تسليم تلقائي عند الانتهاء
                  </li>
                  <li>
                    <CheckIcon /> مراجعة الإجابات الصحيحة بعد التسليم
                  </li>
                  <li>
                    <CheckIcon /> التسميع الصوتي يُضاف في المرحلة القادمة
                  </li>
                </ul>
              )}

              <div className="panel-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setExamKind(kind)}
                >
                  {latest ? "إعادة الاختبار" : "ابدأ الاختبار"}
                </button>
                {latest &&
                  latest.suggestedLevel !== current.student?.level &&
                  !levelApplied && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={applySuggestedLevel}
                    >
                      اعتماد المستوى {latest.suggestedLevel}
                    </button>
                  )}
                {levelApplied && (
                  <span className="applied-note">تم تحديث مستواك إلى {latest?.suggestedLevel}</span>
                )}
              </div>
            </section>
          ) : (
            <section className="panel">
              <h2>متاحة لولي الأمر قريبًا</h2>
              <p className="panel-text">
                التقارير الأسبوعية، مواضع الضعف، ومتابعة تسميع الأبناء ستظهر في
                لوحة ولي الأمر ضمن المرحلة القادمة. الاختبار التمهيدي مخصص
                للطلاب فقط.
              </p>
              <ul className="exam-points">
                <li>
                  <CheckIcon /> تقرير حفظ أسبوعي لكل طالب
                </li>
                <li>
                  <CheckIcon /> ملاحظات المعلم ومواضع المراجعة
                </li>
              </ul>
            </section>
          )}
        </div>

        <section className="panel">
          <div className="panel-head">
            <h2>الشكاوى والاقتراحات</h2>
            {!complaintOpen && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setComplaintOpen(true)}
              >
                رسالة جديدة
              </button>
            )}
          </div>
          <p className="panel-text">
            أي مشكلة تواجهها أو اقتراح لتطوير ثمار يصل مباشرة إلى المسؤول.
          </p>
          {complaintOpen ? (
            <ComplaintForm
              account={current}
              onSent={() => setComplaintOpen(false)}
            />
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setComplaintOpen(true)}
            >
              أرسل شكوى أو اقتراحًا
            </button>
          )}
        </section>

        <p className="portal-note">
          لوحات الطالب والمعلم وولي الأمر التفصيلية تُبنى في المرحلة القادمة.
        </p>
      </main>
    </div>
  );
}
