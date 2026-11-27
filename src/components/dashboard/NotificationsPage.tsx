import { useEffect, useState } from "react";
import { type Account } from "../../lib/auth";
import {
  notificationsFor,
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
  teacherLinkRequestsFor,
  respondTeacherLinkRequest,
  guardianLinkRequestsFor,
  respondGuardianLinkRequest,
  unreadCount,
  type AppNotification,
} from "../../lib/appStore";
import { CLOUD_EVENT } from "../../lib/cloud";
import { Icon, EmptyState } from "./ui";

const KIND_LABELS: Record<AppNotification["kind"], string> = {
  complaint: "شكوى",
  login: "تسجيل دخول",
  teacher: "معلم",
  homework: "واجب",
  evaluation: "تقييم",
  system: "نظام",
};

export default function NotificationsPage({
  account,
  onNavigate,
}: {
  account: Account;
  onNavigate?: (page: string) => void;
}) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [openRequest, setOpenRequest] = useState<string | null>(null);
  const [openGuardian, setOpenGuardian] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");

  const refresh = () => setItems(notificationsFor(account));
  useEffect(() => {
    refresh();
    // تحديث فوري عندما تصل بيانات جديدة من جهاز آخر عبر المزامنة.
    const onCloud = () => refresh();
    window.addEventListener(CLOUD_EVENT, onCloud);
    return () => window.removeEventListener(CLOUD_EVENT, onCloud);
  }, [account.id]);

  const pendingRequests = teacherLinkRequestsFor(account.id);
  const guardianRequests = guardianLinkRequestsFor(account.id);

  const handleClick = (item: AppNotification) => {
    markNotificationRead(item.id);
    refresh();
    if (item.action === "teacher-link") {
      setOpenRequest(item.id);
      return;
    }
    if (item.action === "guardian-link") {
      setOpenGuardian(item.id);
      return;
    }
    if (item.target && onNavigate && item.target !== "notifications") onNavigate(item.target);
  };

  const visible = filter === "unread" ? items.filter((item) => !item.read) : items;

  return (
    <div className="page notifications-page">
      <div className="page-head">
        <h2>الإشعارات</h2>
        <div className="page-actions">
          <button type="button" className="ghost-button" onClick={() => setFilter(filter === "all" ? "unread" : "all")}>
            {filter === "all" ? "غير المقروءة فقط" : "الكل"}
          </button>
          <button type="button" className="primary-button" onClick={() => { markAllNotificationsRead(account); refresh(); }}>
            تعليم الكل كمقروء
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="لا توجد إشعارات" body="ستظهر هنا الشكاوى وتسجيلات الدخول والتحديثات." />
      ) : (
        <div className="notification-list">
          {visible.map((item) => (
            <div
              key={item.id}
              className={`notification-card ${item.read ? "" : "unread"}`}
              role={item.target || item.action ? "button" : undefined}
              tabIndex={item.target || item.action ? 0 : undefined}
              style={item.target || item.action ? { cursor: "pointer" } : undefined}
              onClick={() => handleClick(item)}
            >
              <div className="notification-icon">
                <Icon
                  name={
                    item.kind === "complaint"
                      ? "chat"
                      : item.kind === "login"
                        ? "users"
                        : item.kind === "evaluation"
                          ? "star"
                          : item.kind === "homework"
                            ? "clipboard"
                            : "bell"
                  }
                  size={18}
                />
              </div>
              <div className="notification-body">
                <div className="notification-head">
                  <strong>{item.title}</strong>
                  <span className="badge badge-neutral">{KIND_LABELS[item.kind]}</span>
                </div>
                <p>{item.body}</p>
                <span className="muted">{new Date(item.createdAt).toLocaleString("ar-SA")}</span>
                {item.action === "guardian-link" && guardianRequests.length ? (
                  <div className="link-request-box" onClick={(event) => event.stopPropagation()}>
                    <p style={{ margin: "0 0 6px" }}>
                      {openGuardian === item.id ? "ولي أمر يطلب ربطك به — وافق أو ارفض:" : "اضغط على الإشعار لعرض الطلب."}
                    </p>
                    {openGuardian === item.id ? (
                      <div className="link-request-list">
                        {guardianRequests.map((request) => (
                          <div key={request.id} className="connection-row">
                            <span>{request.guardianName}</span>
                            <span style={{ display: "flex", gap: 6 }}>
                              <button
                                type="button"
                                className="success-button"
                                onClick={() => {
                                  setActionMessage(respondGuardianLinkRequest(request.id, true).message);
                                  refresh();
                                }}
                              >
                                موافق
                              </button>
                              <button
                                type="button"
                                className="danger-button"
                                onClick={() => {
                                  setActionMessage(respondGuardianLinkRequest(request.id, false).message);
                                  refresh();
                                }}
                              >
                                رفض
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {actionMessage ? <p className="muted" style={{ margin: "6px 0 0" }}>{actionMessage}</p> : null}
                  </div>
                ) : null}
                {item.action === "teacher-link" && pendingRequests.length ? (
                  <div className="link-request-box" onClick={(event) => event.stopPropagation()}>
                    <p style={{ margin: "0 0 6px" }}>
                      {openRequest === item.id ? "راجع الطلب ثم اختر:" : "اضغط على الإشعار لعرض الطلب."}
                    </p>
                    {openRequest === item.id ? (
                      <div className="link-request-list">
                        {pendingRequests.map((request) => (
                          <div key={request.id} className="connection-row">
                            <span>
                              {request.studentName} <span className="muted">(@{request.studentUsername})</span>
                            </span>
                            <span style={{ display: "flex", gap: 6 }}>
                              <button
                                type="button"
                                className="success-button"
                                onClick={() => {
                                  const result = respondTeacherLinkRequest(request.id, true);
                                  setActionMessage(result.message);
                                  refresh();
                                }}
                              >
                                نعم
                              </button>
                              <button
                                type="button"
                                className="danger-button"
                                onClick={() => {
                                  const result = respondTeacherLinkRequest(request.id, false);
                                  setActionMessage(result.message);
                                  refresh();
                                }}
                              >
                                لا
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {actionMessage ? <p className="muted" style={{ margin: "6px 0 0" }}>{actionMessage}</p> : null}
                  </div>
                ) : null}
              </div>
              {!item.read ? <span className="unread-dot" /> : null}
              {account.type === "admin" ? (
                <button
                  type="button"
                  className="notification-delete"
                  aria-label="حذف الإشعار"
                  title="حذف الإشعار"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteNotification(item.id);
                    refresh();
                  }}
                >
                  <Icon name="trash" size={15} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {!items.some((item) => item.action === "guardian-link") && guardianRequests.length ? (
        <div className="link-request-box">
          <strong>طلبات ربط ولي الأمر</strong>
          <div className="link-request-list">
            {guardianRequests.map((request) => (
              <div key={request.id} className="connection-row">
                <span>{request.guardianName}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="success-button" onClick={() => { setActionMessage(respondGuardianLinkRequest(request.id, true).message); refresh(); }}>
                    موافق
                  </button>
                  <button type="button" className="danger-button" onClick={() => { setActionMessage(respondGuardianLinkRequest(request.id, false).message); refresh(); }}>
                    رفض
                  </button>
                </span>
              </div>
            ))}
          </div>
          {actionMessage ? <p className="muted">{actionMessage}</p> : null}
        </div>
      ) : null}

      {!items.some((item) => item.action === "teacher-link") && pendingRequests.length ? (
        <div className="link-request-box">
          <strong>طلبات ربط الطلاب</strong>
          <div className="link-request-list">
            {pendingRequests.map((request) => (
              <div key={request.id} className="connection-row">
                <span>{request.studentName} <span className="muted">(@{request.studentUsername})</span></span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="success-button" onClick={() => { setActionMessage(respondTeacherLinkRequest(request.id, true).message); refresh(); }}>
                    نعم
                  </button>
                  <button type="button" className="danger-button" onClick={() => { setActionMessage(respondTeacherLinkRequest(request.id, false).message); refresh(); }}>
                    لا
                  </button>
                </span>
              </div>
            ))}
          </div>
          {actionMessage ? <p className="muted">{actionMessage}</p> : null}
        </div>
      ) : null}

      <div className="muted center">إجمالي غير مقروء: {unreadCount(account)}</div>
    </div>
  );
}
