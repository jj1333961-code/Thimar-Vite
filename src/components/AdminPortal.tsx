import { useMemo, useState } from "react";
import { findCountry, flagOf } from "../data/countries";
import {
  accountTypeLabel,
  loadAccounts,
  loadComplaints,
  resolveComplaint,
  reopenComplaint,
  setAccountStatus,
  banAccount,
  unbanAccount,
  type Account,
  type Complaint,
} from "../lib/auth";
import { aiChat } from "../lib/ai";
import { latestExamFor } from "../lib/exam";
import { BrandMark, CheckIcon } from "./ui";

type Tab = "overview" | "teachers" | "complaints" | "users";

const statusLabels: Record<Account["status"], string> = {
  active: "معتمد",
  pending: "قيد المراجعة",
  rejected: "مرفوض",
};

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "short",
  });
}

export default function AdminPortal({
  account,
  onLogout,
}: {
  account: Account;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts());
  const [complaints, setComplaints] = useState<Complaint[]>(() => loadComplaints());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  const pendingTeachers = useMemo(
    () =>
      accounts.filter(
        (item) => item.type === "teacher" && item.status === "pending",
      ),
    [accounts],
  );
  const teachers = useMemo(
    () => accounts.filter((item) => item.type === "teacher"),
    [accounts],
  );
  const students = accounts.filter((item) => item.type === "student");
  const approvedTeachers = teachers.filter((item) => item.status === "active");
  const openComplaints = complaints.filter((item) => item.status === "open");

  function refresh() {
    setAccounts(loadAccounts());
    setComplaints(loadComplaints());
  }

  function approve(id: string) {
    setAccountStatus(id, "active");
    refresh();
  }

  function reject(id: string) {
    setAccountStatus(
      id,
      "rejected",
      reasons[id]?.trim() || "لم يستوفِ شروط الاعتماد",
    );
    refresh();
  }

  function sendBack(id: string) {
    setAccountStatus(id, "pending");
    refresh();
  }

  function closeComplaint(id: string) {
    resolveComplaint(id, replies[id] ?? "");
    setReplies((prev) => ({ ...prev, [id]: "" }));
    refresh();
  }

  function reopen(id: string) {
    reopenComplaint(id);
    refresh();
  }

  async function autoReply(complaint: Complaint) {
    setAiBusy(complaint.id);
    try {
      const reply = await aiChat([
        {
          role: "user",
          content: `أنت مسؤول دعم لتطبيق "ثمار" (حفظ القرآن). اكتب ردًا مهذبًا ومختصرًا (2-4 جمل) بالعربية على الشكوى التالية. الشكوى: "${complaint.subject}" — ${complaint.body}. لا تستخدم markdown.`,
        },
      ]);
      setReplies((prev) => ({ ...prev, [complaint.id]: reply }));
      resolveComplaint(complaint.id, reply);
      refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "تعذّر توليد الرد.");
    } finally {
      setAiBusy(null);
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "نظرة عامة" },
    { id: "teachers", label: `طلبات المعلمين (${pendingTeachers.length})` },
    { id: "complaints", label: `الشكاوى (${openComplaints.length})` },
    { id: "users", label: "المستخدمون" },
  ];

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-brand">
          <BrandMark size={36} />
          <span className="app-wordmark">ثمار</span>
          <span className="admin-tag">لوحة المسؤول</span>
        </div>
        <div className="app-user">
          <span className="app-user-name">{account.fullName}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
            تسجيل الخروج
          </button>
        </div>
      </header>

      <main className="app-main admin-main">
        <nav className="admin-tabs" aria-label="أقسام لوحة المسؤول">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "tab is-active" : "tab"}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {tab === "overview" && (
          <>
            <div className="stat-grid">
              <div className="stat-card">
                <span>الطلاب</span>
                <b>{students.length}</b>
              </div>
              <div className="stat-card">
                <span>المعلمون المعتمدون</span>
                <b>{approvedTeachers.length}</b>
              </div>
              <div className="stat-card is-gold">
                <span>طلبات قيد المراجعة</span>
                <b>{pendingTeachers.length}</b>
              </div>
              <div className="stat-card">
                <span>شكاوى مفتوحة</span>
                <b>{openComplaints.length}</b>
              </div>
            </div>

            <div className="portal-grid">
              <section className="panel">
                <div className="panel-head">
                  <h2>أحدث طلبات المعلمين</h2>
                  <button
                    type="button"
                    className="link-mini"
                    onClick={() => setTab("teachers")}
                  >
                    عرض الكل
                  </button>
                </div>
                {pendingTeachers.length === 0 ? (
                  <p className="panel-text">لا توجد طلبات جديدة حاليًا.</p>
                ) : (
                  <ul className="mini-list">
                    {pendingTeachers.slice(0, 4).map((teacher) => (
                      <li key={teacher.id}>
                        <span className="mini-avatar" aria-hidden="true">
                          {teacher.fullName.replace(/^(الشيخ|الشيخة|أ\.)\s+/, "").charAt(0)}
                        </span>
                        <span className="mini-body">
                          <b>{teacher.fullName}</b>
                          <small>
                            {teacher.teacher?.juzMemorized ?? 0} جزءًا ·{" "}
                            {teacher.teacher?.hasIjazah ? "إجازة" : "بدون إجازة"}
                          </small>
                        </span>
                        <span className="mini-date">{shortDate(teacher.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h2>أحدث الشكاوى</h2>
                  <button
                    type="button"
                    className="link-mini"
                    onClick={() => setTab("complaints")}
                  >
                    عرض الكل
                  </button>
                </div>
                {complaints.length === 0 ? (
                  <p className="panel-text">لا توجد رسائل بعد.</p>
                ) : (
                  <ul className="mini-list">
                    {complaints.slice(0, 4).map((complaint) => (
                      <li key={complaint.id}>
                        <span
                          className={
                            complaint.status === "open"
                              ? "status-dot is-open"
                              : "status-dot"
                          }
                          aria-hidden="true"
                        />
                        <span className="mini-body">
                          <b>{complaint.subject}</b>
                          <small>
                            {complaint.name} · {complaint.role}
                          </small>
                        </span>
                        <span className="mini-date">{shortDate(complaint.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}

        {tab === "teachers" && (
          <section className="panel">
            <div className="panel-head">
              <h2>طلبات المعلمين</h2>
              <span className="counter">{pendingTeachers.length} بانتظار القرار</span>
            </div>

            {teachers.length === 0 && (
              <p className="panel-text">لا توجد حسابات معلمين بعد.</p>
            )}

            <div className="teacher-applications">
              {teachers.map((teacher) => {
                const exam = latestExamFor(teacher.id, "teacher");
                const country = findCountry(teacher.countryCode);
                return (
                  <article key={teacher.id} className="admin-teacher-card">
                    <div className="admin-teacher-head">
                      <span className="teacher-avatar" aria-hidden="true">
                        {teacher.fullName.replace(/^(الشيخ|الشيخة|أ\.)\s+/, "").charAt(0)}
                      </span>
                      <div className="admin-teacher-body">
                        <div className="admin-teacher-title">
                          <b>{teacher.fullName}</b>
                          <span className={`status-pill status-${teacher.status}`}>
                            {statusLabels[teacher.status]}
                          </span>
                        </div>
                        <p className="admin-teacher-meta" dir="auto">
                          <bdi dir="ltr">{teacher.username}</bdi> ·{" "}
                          {country ? `${flagOf(country.code)} ${country.ar}` : "—"} ·{" "}
                          <bdi dir="ltr">{country?.dial} {teacher.phone}</bdi>
                        </p>
                        <p className="admin-teacher-meta" dir="ltr">
                          {teacher.email}
                        </p>
                        <div className="teacher-tags">
                          <span className="tag">
                            {teacher.teacher?.juzMemorized ?? 0} جزءًا
                          </span>
                          <span className="tag tag-soft">
                            {teacher.teacher?.hasIjazah ? "حاصل على إجازة" : "بدون إجازة"}
                          </span>
                          <span className="tag tag-soft">
                            {teacher.teacher?.mujawwad ? "مجوّد" : "غير مجوّد"}
                          </span>
                          {(teacher.teacher?.qiraat ?? []).map((qiraah) => (
                            <span key={qiraah} className="tag tag-soft">
                              {qiraah}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="admin-exam-box">
                        <span>اختبار الإتقان</span>
                        {exam ? (
                          <b>{exam.percent}%</b>
                        ) : (
                          <b className="muted">لم يُنجز</b>
                        )}
                      </div>
                    </div>

                    {teacher.status === "pending" && (
                      <div className="admin-teacher-actions">
                        <input
                          className="input reason-input"
                          placeholder="سبب الرفض (اختياري)"
                          value={reasons[teacher.id] ?? ""}
                          onChange={(event) =>
                            setReasons((prev) => ({
                              ...prev,
                              [teacher.id]: event.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => approve(teacher.id)}
                        >
                          <CheckIcon /> اعتماد الحساب
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger-ghost btn-sm"
                          onClick={() => reject(teacher.id)}
                        >
                          رفض الطلب
                        </button>
                      </div>
                    )}

                    {teacher.status === "rejected" && (
                      <div className="admin-teacher-actions">
                        <span className="admin-reject-note">
                          سبب الرفض: {teacher.rejectionReason ?? "—"}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => sendBack(teacher.id)}
                        >
                          إعادة للمراجعة
                        </button>
                      </div>
                    )}

                    {teacher.status === "active" && (
                      <div className="admin-teacher-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => sendBack(teacher.id)}
                        >
                          تعليق الحساب للمراجعة
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {tab === "complaints" && (
          <section className="panel">
            <div className="panel-head">
              <h2>الشكاوى والاقتراحات</h2>
              <span className="counter">{openComplaints.length} مفتوحة</span>
            </div>
            {complaints.length === 0 && (
              <p className="panel-text">لا توجد رسائل بعد.</p>
            )}
            <div className="complaint-list">
              {complaints.map((complaint) => (
                <article key={complaint.id} className="complaint-card">
                  <div className="complaint-head">
                    <div>
                      <b>{complaint.subject}</b>
                      <p className="complaint-meta">
                        {complaint.name} · {complaint.role}
                        {complaint.contact ? ` · ${complaint.contact}` : ""} ·{" "}
                        {shortDate(complaint.createdAt)}
                      </p>
                    </div>
                    <span
                      className={
                        complaint.status === "open"
                          ? "status-pill status-pending"
                          : "status-pill status-active"
                      }
                    >
                      {complaint.status === "open" ? "مفتوحة" : "تم الرد"}
                    </span>
                  </div>
                  <p className="complaint-body">{complaint.body}</p>
                  {complaint.reply && (
                    <p className="complaint-reply">
                      <b>رد المسؤول:</b> {complaint.reply}
                    </p>
                  )}
                  {complaint.status === "open" ? (
                    <div className="complaint-actions">
                      <input
                        className="input"
                        placeholder="اكتب ردًا (اختياري)…"
                        value={replies[complaint.id] ?? ""}
                        onChange={(event) =>
                          setReplies((prev) => ({
                            ...prev,
                            [complaint.id]: event.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={aiBusy === complaint.id}
                        onClick={() => autoReply(complaint)}
                      >
                        {aiBusy === complaint.id ? "جارٍ التوليد…" : "رد تلقائي (AI)"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => closeComplaint(complaint.id)}
                      >
                        إغلاق مع الرد
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => reopen(complaint.id)}
                    >
                      إعادة فتح
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "users" && (
          <section className="panel">
            <div className="panel-head">
              <h2>المستخدمون</h2>
              <span className="counter">{accounts.length} حسابًا</span>
            </div>
            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>اسم المستخدم</th>
                    <th>النوع</th>
                    <th>الحالة</th>
                    <th>البلد</th>
                    <th>التسجيل</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((item) => {
                    const country = findCountry(item.countryCode);
                    return (
                      <tr key={item.id}>
                        <td>{item.fullName}</td>
                        <td dir="ltr">{item.username}</td>
                        <td>{accountTypeLabel(item.type)}</td>
                        <td>
                          {item.type === "teacher"
                            ? statusLabels[item.status]
                            : item.banned
                              ? "محظور"
                              : item.type === "admin"
                                ? "—"
                                : "نشط"}
                        </td>
                        <td>{country?.ar ?? "—"}</td>
                        <td>{shortDate(item.createdAt)}</td>
                        <td>
                          {item.type !== "admin" ? (
                            item.banned ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => { unbanAccount(item.id); refresh(); }}
                              >
                                رفع الحظر
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => { banAccount(item.id); refresh(); }}
                              >
                                حظر
                              </button>
                            )
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
