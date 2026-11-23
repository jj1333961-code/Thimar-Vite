import { useMemo, useState, type FormEvent } from "react";
import { findCountry } from "../data/countries";
import { juzRangeLabel, surahsForJuzs } from "../data/juzSurahs";
import { surahs } from "../data/surahs";
import { qiraat } from "../data/teachers";
import {
  accountTypeLabel,
  loadAccounts,
  registerAccount,
  type Account,
  type AccountType,
  type StudentProfile,
  type TeacherProfile,
  type Track,
} from "../lib/auth";
import CountrySelect from "./CountrySelect";
import { requestTeacherLink } from "../lib/appStore";
import {
  BackIcon,
  BrandMark,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  Field,
  LockIcon,
  MailIcon,
  PhoneIcon,
  Segmented,
  UserIcon,
} from "./ui";

const tracks: { id: Track; title: string; desc: string; icon: string }[] = [
  { id: "quran", title: "القرآن الكريم", desc: "حفظ متدرّج للسور والأجزاء", icon: "📖" },
  { id: "tuhfa", title: "تحفة الأطفال", desc: "أحكام التجويد في ٦١ بيتًا", icon: "🌿" },
  { id: "both", title: "الاثنان معًا", desc: "مسار مزدوج: قرآن وتجويد", icon: "✨" },
];

const levels = [
  { id: "A1", title: "A1 · مبتدئ", desc: "قصار السور ونطق الحروف" },
  { id: "A2", title: "A2 · أساسي", desc: "جزء عمّ مع تجويد مبسّط" },
  { id: "A3", title: "A3 · متدرّج", desc: "عدة أجزاء وحفظ منتظم" },
  { id: "A4", title: "A4 · متوسط", desc: "نحو نصف القرآن" },
  { id: "A5", title: "A5 · متقدّم", desc: "أكثر من خمسة عشر جزءًا" },
  { id: "A6", title: "A6 · متقن", desc: "حفظ شبه كامل للمصحف" },
  { id: "A7", title: "A7 · مجيد", desc: "ختمة كاملة بإتقان" },
];

const accountTypes: {
  id: AccountType;
  title: string;
  desc: string;
  icon: string;
}[] = [
  {
    id: "student",
    title: "طالب",
    desc: "أحفظ القرآن أو تحفة الأطفال، وأتدرّب عبر الألغاز والاختبارات.",
    icon: "🎓",
  },
  {
    id: "guardian",
    title: "ولي أمر",
    desc: "أتابع تقدّم أبنائي وأطمئن على رحلتهم في الحفظ.",
    icon: "🏡",
  },
  {
    id: "teacher",
    title: "معلم",
    desc: "أتابع طلابي وأسمع تسميعهم بعد اعتماد حسابي من المسؤول.",
    icon: "🕌",
  },
];

export default function RegisterPage({
  onBack,
  onComplete,
}: {
  onBack: () => void;
  onComplete: (account: Account) => void;
}) {
  const [type, setType] = useState<AccountType | null>(null);
  const [step, setStep] = useState(0);
  const [base, setBase] = useState({
    fullName: "",
    countryCode: "SA",
    phone: "",
    email: "",
    username: "",
    password: "",
    birthDate: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [student, setStudent] = useState<StudentProfile>({
    track: "quran",
    tuhfaLastVerse: null,
    surahs: [],
    juz: [],
    level: "A1",
    needsTeacher: false,
    teacherId: null,
    birthDate: null,
  });
  const [teacher, setTeacher] = useState<TeacherProfile>({
    juzMemorized: 0,
    mujawwad: false,
    qiraat: [],
    hasIjazah: false,
    birthDate: null,
  });
  const [linkedStudent, setLinkedStudent] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [surahQuery, setSurahQuery] = useState("");
  const [created, setCreated] = useState<Account | null>(null);

  // المعلمون المعروضون للطالب هم حسابات معتمدة موجودة فعلًا في التطبيق.
  const realTeachers = useMemo(
    () => loadAccounts().filter((item) => item.type === "teacher" && item.status === "active"),
    [],
  );

  const country = findCountry(base.countryCode);
  const dial = country?.dial ?? "+966";
  const phoneDigits = base.phone.replace(/\D/g, "");

  const stepLabels =
    type === "teacher"
      ? ["نوع الحساب", "بياناتك", "الإتقان"]
      : type === "guardian"
        ? ["نوع الحساب", "بياناتك", "ربط الطالب"]
        : ["نوع الحساب", "بياناتك", "الحفظ"];

  const filteredSurahs = surahQuery.trim()
    ? surahs.filter((surah) => surah.name.includes(surahQuery.trim()))
    : surahs;

  function clearError(key: string) {
    setErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
  }

  function toggleSurah(n: number) {
    setStudent((prev) => ({
      ...prev,
      surahs: prev.surahs.includes(n)
        ? prev.surahs.filter((item) => item !== n)
        : [...prev.surahs, n].sort((a, b) => a - b),
    }));
    clearError("scope");
  }

  function toggleJuz(juz: number) {
    setStudent((prev) => {
      const nextJuzs = prev.juz.includes(juz)
        ? prev.juz.filter((item) => item !== juz)
        : [...prev.juz, juz].sort((a, b) => a - b);
      return {
        ...prev,
        juz: nextJuzs,
        surahs: surahsForJuzs(nextJuzs),
      };
    });
    clearError("scope");
  }

  function toggleQiraah(name: string) {
    setTeacher((prev) => ({
      ...prev,
      qiraat: prev.qiraat.includes(name)
        ? prev.qiraat.filter((item) => item !== name)
        : [...prev.qiraat, name],
    }));
    clearError("qiraat");
  }

  function validateStep(index: number): boolean {
    const next: Record<string, string> = {};

    if (index === 0 && !type) {
      next.type = "اختر نوع الحساب للمتابعة.";
    }

    if (index === 1) {
      if (base.fullName.trim().length < 3) {
        next.fullName = "اكتب الاسم بالكامل (٣ أحرف على الأقل).";
      }
      if (!base.countryCode) {
        next.countryCode = "اختر الدولة.";
      }
      if (phoneDigits.length < 6 || phoneDigits.length > 15) {
        next.phone = "أدخل رقم هاتف صحيحًا بدون كود الدولة.";
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(base.email.trim())) {
        next.email = "أدخل بريدًا إلكترونيًا صحيحًا للتواصل.";
      }
      if (!/^[A-Za-z0-9_\u0600-\u06FF.]{3,24}$/.test(base.username.trim())) {
        next.username =
          "من ٣ إلى ٢٤ حرفًا: حروف أو أرقام أو نقطة أو شرطة سفلية.";
      }
      if (base.password.length < 8) {
        next.password = "كلمة المرور ٨ أحرف على الأقل.";
      }
    }

    if (index === 2 && type === "student") {
      if (
        student.track !== "quran" &&
        (!student.tuhfaLastVerse ||
          student.tuhfaLastVerse < 1 ||
          student.tuhfaLastVerse > 61)
      ) {
        next.tuhfa = "حدّد رقم آخر بيت تحفظه من ١ إلى ٦١.";
      }
      if (student.surahs.length + student.juz.length === 0) {
        next.scope = "اختر جزءًا واحدًا على الأقل (أو سورة إن لم تحدد أجزاء).";
      }
      if (student.needsTeacher && !student.teacherId && realTeachers.length > 0) {
        next.teacher = "اختر معلمًا لمتابعة حفظك.";
      }
    }

    if (index === 2 && type === "teacher") {
      if (teacher.juzMemorized < 1) {
        next.juz = "حدّد عدد الأجزاء المحفوظة من ١ إلى ٣٠.";
      }
      if (teacher.qiraat.length === 0) {
        next.qiraat = "اختر قراءة واحدة على الأقل.";
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function goNext() {
    if (!validateStep(step)) return;
    if (step < 2) {
      setStep((prev) => prev + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (!type) return;
    const result = await registerAccount({
      type,
      fullName: base.fullName.trim(),
      countryCode: base.countryCode,
      phone: phoneDigits,
      email: base.email.trim(),
      username: base.username,
      password: base.password,
      student: type === "student" ? { ...student, birthDate: base.birthDate || null } : undefined,
      teacher: type === "teacher" ? { ...teacher, birthDate: base.birthDate || null } : undefined,
      guardian: type === "guardian" ? { linkedStudent: linkedStudent.trim(), birthDate: base.birthDate || null } : undefined,
    });
    if (!result.ok) {
      setErrors({ form: result.message });
      return;
    }
    setCreated(result.account);
    // إرسال طلب الربط الحقيقي للمعلم المختار ليصله إشعار الموافقة أو الرفض.
    if (
      result.account.type === "student" &&
      result.account.student?.needsTeacher &&
      result.account.student.teacherId
    ) {
      const teacher = loadAccounts().find((item) => item.id === student.teacherId);
      if (teacher) requestTeacherLink(result.account, teacher.username);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    goNext();
  }

  function enterAccount(account: Account) {
    onComplete(account);
  }

  if (created) {
    const isTeacher = created.type === "teacher";
    return (
      <div className="reg-shell">
        <div className="reg-wrap">
          <div className="success-card">
            <div className="success-icon">
              <CheckIcon />
            </div>
            <p className="eyebrow">{accountTypeLabel(created.type)}</p>
            <h1 className="reg-title">
              {isTeacher ? "تم إرسال طلبك للمراجعة" : "تم إنشاء حسابك بنجاح"}
            </h1>
            <p className="success-text">
              أهلًا {created.fullName.split(" ")[0]}، حسابك{" "}
              <bdi dir="ltr">{created.username}</bdi> جاهز.
            </p>

            {isTeacher ? (
              <div className="alert alert-soft">
                حساب المعلم يبقى معلّقًا حتى يطّلع المسؤول على بياناتك ويوافق
                عليها. يمكنك الآن أداء اختبار الإتقان لتُرفق نتيجته بطلبك.
              </div>
            ) : (
              <div className="alert alert-soft">
                خطوتك التالية هي الاختبار التمهيدي لتحديد نقطة البداية في
                مسارك، ويولّد أسئلته من النص القرآني مباشرة فلا تتكرر.
              </div>
            )}

            <div className="success-actions">
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => enterAccount(created)}
              >
                {isTeacher ? "عرض حالة الطلب واختبار الإتقان" : "الدخول إلى حسابي"}
              </button>
              <button type="button" className="btn btn-ghost btn-block" onClick={onBack}>
                العودة إلى تسجيل الدخول
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="reg-shell">
      <div className="reg-topbar">
        <button type="button" className="link-back" onClick={onBack}>
          <BackIcon />
          <span>لديك حساب؟ تسجيل الدخول</span>
        </button>
        <div className="reg-brand">
          <BrandMark size={34} />
          <span>ثمار</span>
        </div>
      </div>

      <div className="reg-wrap">
        <form className="reg-card" onSubmit={handleSubmit} noValidate>
          <div className="reg-head">
            <p className="eyebrow">انضم إلى ثمار</p>
            <h1 className="reg-title">إنشاء حساب جديد</h1>
            <p className="reg-sub">
              {step === 0
                ? "اختر نوع الحساب لنُجهّز لك التجربة المناسبة."
                : step === 1
                  ? "بياناتك الأساسية للتواصل والدخول الآمن."
                  : type === "teacher"
                    ? "أخبرنا عن حفظك وإجازاتك ليتم اعتماد حسابك."
                    : type === "guardian"
                      ? "اربط حساب ابنك لمتابعة تقدّمه."
                      : "حدّد الأجزاء المحفوظة، وستُختار سورها تلقائيًا."}
            </p>
          </div>

          <ol className="steps" aria-label="خطوات إنشاء الحساب">
            {stepLabels.map((label, index) => (
              <li
                key={label}
                className={
                  index === step
                    ? "step is-current"
                    : index < step
                      ? "step is-done"
                      : "step"
                }
                aria-current={index === step ? "step" : undefined}
              >
                <span className="step-bar" />
                <span className="step-label">{label}</span>
              </li>
            ))}
          </ol>

          {errors.form && (
            <div className="alert" role="alert">
              {errors.form}
            </div>
          )}

          {step === 0 && (
            <div className="type-grid">
              {accountTypes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={type === item.id ? "type-card is-selected" : "type-card"}
                  onClick={() => {
                    setType(item.id);
                    clearError("type");
                  }}
                  aria-pressed={type === item.id}
                >
                  <span className="type-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="type-body">
                    <span className="type-name">{item.title}</span>
                    <span className="type-desc">{item.desc}</span>
                  </span>
                  <span className="type-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                </button>
              ))}
              {errors.type && <p className="field-error">{errors.type}</p>}
            </div>
          )}

          {step === 1 && (
            <div className="form-grid">
              <div className="span-2">
                <Field label="الاسم بالكامل" htmlFor="reg-name" error={errors.fullName}>
                  <div className="input-wrap">
                    <span className="input-icon">
                      <UserIcon />
                    </span>
                    <input
                      id="reg-name"
                      className="input has-icon"
                      placeholder="مثال: عبد الله محمد الحربي"
                      value={base.fullName}
                      onChange={(event) => {
                        setBase((prev) => ({ ...prev, fullName: event.target.value }));
                        clearError("fullName");
                      }}
                    />
                  </div>
                </Field>
              </div>

              <Field label="البلد" htmlFor="reg-country" error={errors.countryCode}>
                <CountrySelect
                  id="reg-country"
                  value={base.countryCode}
                  onChange={(code) => {
                    setBase((prev) => ({ ...prev, countryCode: code }));
                    clearError("countryCode");
                  }}
                />
              </Field>

              <Field
                label="رقم الهاتف"
                htmlFor="reg-phone"
                error={errors.phone}
                hint={`كود ${country?.ar ?? "الدولة"}: ${dial}`}
              >
                <div className="phone-wrap">
                  <span className="phone-prefix" dir="ltr">
                    {dial}
                  </span>
                  <input
                    id="reg-phone"
                    className="input"
                    type="tel"
                    inputMode="tel"
                    dir="ltr"
                    placeholder="5X XXX XXXX"
                    value={base.phone}
                    onChange={(event) => {
                      setBase((prev) => ({
                        ...prev,
                        phone: event.target.value.replace(/[^\d\s]/g, ""),
                      }));
                      clearError("phone");
                    }}
                  />
                </div>
              </Field>

              <div className="span-2">
                <Field
                  label="البريد الإلكتروني"
                  htmlFor="reg-email"
                  error={errors.email}
                  hint="للتّواصل والتنبيهات المهمة فقط."
                >
                  <div className="input-wrap">
                    <span className="input-icon">
                      <MailIcon />
                    </span>
                    <input
                      id="reg-email"
                      className="input has-icon"
                      type="email"
                      dir="ltr"
                      placeholder="name@example.com"
                      value={base.email}
                      onChange={(event) => {
                        setBase((prev) => ({ ...prev, email: event.target.value }));
                        clearError("email");
                      }}
                    />
                  </div>
                </Field>
              </div>

              <Field label="اسم المستخدم" htmlFor="reg-username" error={errors.username}>
                <div className="input-wrap">
                  <span className="input-icon">
                    <UserIcon />
                  </span>
                  <input
                    id="reg-username"
                    className="input has-icon"
                    dir="ltr"
                    placeholder="abdullah_92"
                    autoComplete="username"
                    value={base.username}
                    onChange={(event) => {
                      setBase((prev) => ({ ...prev, username: event.target.value }));
                      clearError("username");
                    }}
                  />
                </div>
              </Field>

              <Field
                label="كلمة المرور"
                htmlFor="reg-password"
                error={errors.password}
                hint="٨ أحرف على الأقل."
              >
                <div className="input-wrap">
                  <span className="input-icon">
                    <LockIcon />
                  </span>
                  <input
                    id="reg-password"
                    className="input has-icon has-action"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={base.password}
                    onChange={(event) => {
                      setBase((prev) => ({ ...prev, password: event.target.value }));
                      clearError("password");
                    }}
                  />
                  <button
                    type="button"
                    className="input-action"
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </Field>

              <Field label="تاريخ الميلاد" htmlFor="reg-birthdate" hint="اختياري — لتحديد العمر والمستوى.">
                <input
                  id="reg-birthdate"
                  className="input"
                  type="date"
                  value={base.birthDate}
                  onChange={(event) => {
                    setBase((prev) => ({ ...prev, birthDate: event.target.value }));
                  }}
                />
              </Field>

              <div className="span-2">
                <div className="strength" data-score={passwordScore(base.password)}>
                  <span className="strength-label">قوة كلمة المرور</span>
                  <span className="strength-bars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>

              <div className="span-2 form-note">
                <PhoneIcon />
                <span>
                  سيُضاف كود {country?.ar ?? "الدولة"} تلقائيًا
                  <bdi dir="ltr"> {dial}</bdi> قبل رقم هاتفك:{" "}
                  <bdi dir="ltr">{dial} {base.phone || "…"}</bdi>
                </span>
              </div>
            </div>
          )}

          {step === 2 && type === "student" && (
            <div className="stack-lg">
              <div className="section">
                <h2 className="section-title">ما الذي تحفظه؟</h2>
                <div className="track-grid">
                  {tracks.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      className={
                        student.track === track.id
                          ? "track-card is-selected"
                          : "track-card"
                      }
                      aria-pressed={student.track === track.id}
                      onClick={() => {
                        setStudent((prev) => ({
                          ...prev,
                          track: track.id,
                          tuhfaLastVerse:
                            track.id === "quran" ? null : prev.tuhfaLastVerse,
                        }));
                        clearError("tuhfa");
                      }}
                    >
                      <span className="track-icon" aria-hidden="true">
                        {track.icon}
                      </span>
                      <span className="track-name">{track.title}</span>
                      <span className="track-desc">{track.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {student.track !== "quran" && (
                <div className="section">
                  <Field
                    label="آخر بيت تحفظه من تحفة الأطفال"
                    htmlFor="reg-tuhfa"
                    error={errors.tuhfa}
                    hint="من ١ إلى ٦١ بيتًا."
                  >
                    <input
                      id="reg-tuhfa"
                      className="input narrow"
                      type="number"
                      min={1}
                      max={61}
                      inputMode="numeric"
                      placeholder="مثال: 12"
                      value={student.tuhfaLastVerse ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setStudent((prev) => ({
                          ...prev,
                          tuhfaLastVerse: value === "" ? null : Number(value),
                        }));
                        clearError("tuhfa");
                      }}
                    />
                  </Field>
                </div>
              )}

              <div className="section">
                <div className="section-head">
                  <h2 className="section-title">الأجزاء التي تحفظها</h2>
                  <div className="juz-actions">
                    <button
                      type="button"
                      className="link-mini"
                      onClick={() =>
                        setStudent((prev) => {
                          const allJuz = Array.from({ length: 30 }, (_, i) => i + 1);
                          return {
                            ...prev,
                            juz: allJuz,
                            surahs: surahsForJuzs(allJuz),
                          };
                        })
                      }
                    >
                      الكل
                    </button>
                    <button
                      type="button"
                      className="link-mini"
                      onClick={() =>
                        setStudent((prev) => ({ ...prev, juz: [], surahs: [] }))
                      }
                    >
                      مسح
                    </button>
                  </div>
                </div>
                <p className="section-hint">
                  اختر الأجزاء أولًا، وستُحدَّد سورها تلقائيًا في الخطوة التالية.
                </p>
                <div className="juz-grid">
                  {Array.from({ length: 30 }, (_, index) => index + 1).map((juz) => {
                    const selected = student.juz.includes(juz);
                    return (
                      <button
                        key={juz}
                        type="button"
                        className={selected ? "chip is-on" : "chip"}
                        aria-pressed={selected}
                        title={`الجزء ${juz}: ${juzRangeLabel(juz)}`}
                        onClick={() => toggleJuz(juz)}
                      >
                        {juz}
                      </button>
                    );
                  })}
                </div>
                {errors.scope && <p className="field-error">{errors.scope}</p>}
              </div>

              <div className="section">
                <div className="section-head">
                  <h2 className="section-title">السور التي تحفظها</h2>
                  <span className="counter">
                    {student.surahs.length > 0
                      ? `${student.surahs.length} سورة محدَّدة`
                      : "لم تُحدَّد سور"}
                  </span>
                </div>
                <p className="section-hint">
                  تُحدَّد جميع سور الأجزاء المختارة تلقائيًا، ويمكنك إضافة سورة
                  أو إزالتها يدويًا.
                </p>
                {student.juz.length > 0 && (
                  <div className="auto-surahs">
                    {student.surahs.map((number) => (
                      <button
                        key={number}
                        type="button"
                        className="auto-chip"
                        onClick={() => toggleSurah(number)}
                        title="إزالة السورة"
                      >
                        {surahs[number - 1]?.name}
                        <span aria-hidden="true">×</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="picker">
                  <input
                    className="input picker-search"
                    placeholder="ابحث باسم السورة لإضافتها…"
                    value={surahQuery}
                    onChange={(event) => setSurahQuery(event.target.value)}
                    aria-label="بحث عن سورة"
                  />
                  <ul className="picker-list">
                    {filteredSurahs.map((surah) => {
                      const selected = student.surahs.includes(surah.n);
                      return (
                        <li key={surah.n}>
                          <button
                            type="button"
                            className={
                              selected ? "picker-item is-selected" : "picker-item"
                            }
                            aria-pressed={selected}
                            onClick={() => toggleSurah(surah.n)}
                          >
                            <span className="picker-num">{surah.n}</span>
                            <span className="picker-name">{surah.name}</span>
                            <span className="picker-check" aria-hidden="true">
                              <CheckIcon />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                    {filteredSurahs.length === 0 && (
                      <li className="picker-empty">لا توجد سورة بهذا الاسم</li>
                    )}
                  </ul>
                </div>
              </div>

              <div className="section">
                <Field
                  label="مستوى الحفظ وجودته"
                  htmlFor="reg-level"
                  hint={levels.find((level) => level.id === student.level)?.desc ?? ""}
                >
                  <select
                    id="reg-level"
                    className="input"
                    value={student.level}
                    onChange={(event) =>
                      setStudent((prev) => ({ ...prev, level: event.target.value }))
                    }
                  >
                    {levels.map((level) => (
                      <option key={level.id} value={level.id}>
                        {level.title}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="section">
                <div className="section-head">
                  <h2 className="section-title">هل تحتاج إلى معلم للمتابعة؟</h2>
                </div>
                <Segmented
                  value={student.needsTeacher}
                  onChange={(value) =>
                    setStudent((prev) => ({
                      ...prev,
                      needsTeacher: value,
                      teacherId: value ? prev.teacherId : null,
                    }))
                  }
                />
                {student.needsTeacher && (
                  <div className="teacher-block">
                    <p className="section-hint">
                      هؤلاء معلمون مسجّلون في التطبيق وتم اعتمادهم من المسؤول. سيصل طلب الربط إلى معلمك ليوافق أو يرفض.
                    </p>
                    {realTeachers.length === 0 ? (
                      <p className="muted">
                        لا يوجد معلمون معتمدون بعد. أنشئ حسابك الآن، ويمكنك اختيار معلم لاحقًا من الإعدادات.
                      </p>
                    ) : null}
                    <div className="teacher-list">
                      {realTeachers.map((item) => {
                        const selected = student.teacherId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={
                              selected ? "teacher-card is-selected" : "teacher-card"
                            }
                            aria-pressed={selected}
                            onClick={() => {
                              setStudent((prev) => ({
                                ...prev,
                                teacherId: item.id,
                              }));
                              clearError("teacher");
                            }}
                          >
                            <span className="teacher-avatar" aria-hidden="true">
                              {item.fullName.replace("الشيخ ", "").replace("الشيخة ", "").charAt(0)}
                            </span>
                            <span className="teacher-body">
                              <span className="teacher-name">{item.fullName}</span>
                              <span className="teacher-meta">@{item.username}</span>
                              <span className="teacher-tags">
                                {item.teacher?.juzMemorized ? (
                                  <span className="tag">{item.teacher.juzMemorized} جزءًا</span>
                                ) : null}
                                {(item.teacher?.qiraat ?? []).slice(0, 2).map((qiraah) => (
                                  <span key={qiraah} className="tag tag-soft">
                                    {qiraah}
                                  </span>
                                ))}
                                {item.teacher?.hasIjazah ? <span className="tag tag-soft">إجازة</span> : null}
                              </span>
                            </span>
                            <span className="teacher-side">
                              <span className="rating">معتمد</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {errors.teacher && <p className="field-error">{errors.teacher}</p>}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && type === "teacher" && (
            <div className="stack-lg">
              <div className="section">
                <Field
                  label="كم تحفظ من القرآن الكريم؟"
                  htmlFor="reg-juz"
                  error={errors.juz}
                  hint="عدد الأجزاء المحفوظة من ١ إلى ٣٠."
                >
                  <div className="juz-input-row">
                    <input
                      id="reg-juz"
                      className="input narrow"
                      type="number"
                      min={0}
                      max={30}
                      inputMode="numeric"
                      value={teacher.juzMemorized || ""}
                      placeholder="0"
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setTeacher((prev) => ({
                          ...prev,
                          juzMemorized: Number.isNaN(value)
                            ? 0
                            : Math.max(0, Math.min(30, value)),
                        }));
                        clearError("juz");
                      }}
                    />
                    <span className="juz-input-hint">جزءًا من ٣٠</span>
                  </div>
                </Field>
              </div>

              <div className="section">
                <div className="section-head">
                  <h2 className="section-title">هل أنت مجوّد؟</h2>
                </div>
                <Segmented
                  value={teacher.mujawwad}
                  onChange={(value) =>
                    setTeacher((prev) => ({ ...prev, mujawwad: value }))
                  }
                />
              </div>

              <div className="section">
                <div className="section-head">
                  <h2 className="section-title">القراءات التي تمتلكها</h2>
                  <span className="counter">{teacher.qiraat.length} قراءة</span>
                </div>
                <div className="qiraat-grid">
                  {qiraat.map((item) => {
                    const selected = teacher.qiraat.includes(item.name);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={selected ? "qiraah-card is-selected" : "qiraah-card"}
                        aria-pressed={selected}
                        onClick={() => toggleQiraah(item.name)}
                      >
                        <span className="qiraah-name">{item.name}</span>
                        <span className="qiraah-desc">{item.narrators}</span>
                      </button>
                    );
                  })}
                </div>
                {errors.qiraat && <p className="field-error">{errors.qiraat}</p>}
              </div>

              <div className="section">
                <div className="section-head">
                  <h2 className="section-title">هل أنت حاصل على إجازة؟</h2>
                </div>
                <Segmented
                  value={teacher.hasIjazah}
                  onChange={(value) =>
                    setTeacher((prev) => ({ ...prev, hasIjazah: value }))
                  }
                />
                <p className="section-hint">
                  سيُطلب منك إرفاق صورة الإجازة بعد اعتماد الحساب الأولي.
                </p>
              </div>
            </div>
          )}

          {step === 2 && type === "guardian" && (
            <div className="stack-lg">
              <div className="info-card">
                <h2 className="section-title">متابعة ابنك تبدأ من هنا</h2>
                <p>
                  اكتب اسم المستخدم الخاص بحساب الطالب ليظهر لك تقدّمه وخطته
                  الأسبوعية. يمكنك إضافة أكثر من طالب لاحقًا من لوحة ولي الأمر.
                </p>
              </div>
              <Field
                label="اسم مستخدم الطالب (اختياري)"
                htmlFor="reg-linked"
                hint="يمكن تركه فارغًا وإضافته لاحقًا."
              >
                <div className="input-wrap">
                  <span className="input-icon">
                    <UserIcon />
                  </span>
                  <input
                    id="reg-linked"
                    className="input has-icon"
                    dir="ltr"
                    placeholder="student"
                    value={linkedStudent}
                    onChange={(event) => setLinkedStudent(event.target.value)}
                  />
                </div>
              </Field>
              <div className="info-card info-soft">
                <h2 className="section-title">حساب ولي الأمر مجاني</h2>
                <p>
                  يمنحك متابعة الحفظ والتسميعات وتقارير المعلم دون أن يؤثر على
                  رحلة الطالب. الاختبار التمهيدي مخصص للطلاب فقط.
                </p>
              </div>
            </div>
          )}

          <div className="reg-footer">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (step === 0) onBack();
                else {
                  setStep((prev) => prev - 1);
                  setErrors({});
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
            >
              {step === 0 ? "إلغاء" : "رجوع"}
            </button>
            <button type="submit" className="btn btn-primary">
              {step < 2
                ? "متابعة"
                : type === "teacher"
                  ? "إرسال الطلب للمراجعة"
                  : "إنشاء الحساب"}
            </button>
          </div>
        </form>

        <p className="reg-footnote">
          بالإنشاء أنت توافق على استخدام بياناتك داخل التطبيق فقط.{" "}
          {type && step > 0 ? `نوع الحساب: ${accountTypeLabel(type)}` : ""}
        </p>
      </div>
    </div>
  );
}

function passwordScore(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Za-z]/.test(password) && /\d/.test(password)) score += 1;
  if (
    password.length >= 12 ||
    (/[^A-Za-z0-9]/.test(password) && password.length >= 8)
  ) {
    score += 1;
  }
  return Math.min(score, 3);
}
