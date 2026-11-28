import { useEffect, useState } from "react";
import { type Account } from "../../lib/auth";
import {
  adminIssueReset,
  fetchDevices,
  fetchSessions,
  pullCloud,
  revokeAllOtherSessions,
  revokeDeviceById,
  revokeSessionById,
  type CloudDevice,
  type CloudSession,
  type ResetRequest,
} from "../../lib/cloud";
import SecurityStatusCard from "./SecurityStatusCard";
import { SectionCard } from "./ui";

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * الأمان: الجلسات النشطة، الأجهزة الموثوقة، وطلبات استعادة كلمة المرور.
 * كل الإجراءات تُنفَّذ على الخادم بهوية الجلسة، لا بمعرّفات من العميل.
 */
export default function SecurityPanel({ account }: { account: Account }) {
  const [sessions, setSessions] = useState<CloudSession[]>([]);
  const [devices, setDevices] = useState<CloudDevice[]>([]);
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ username: string; temporaryPassword: string } | null>(null);

  const load = async () => {
    try {
      const [nextSessions, nextDevices] = await Promise.all([fetchSessions(), fetchDevices()]);
      setSessions(nextSessions);
      setDevices(nextDevices);
    } catch {
      setMessage("تعذّر تحميل الجلسات. تحقق من الاتصال.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (account.type !== "admin") return;
    void pullCloud().then(() => {
      try {
        const raw = localStorage.getItem("thimar.resetRequests.v1");
        const parsed = raw ? (JSON.parse(raw) as ResetRequest[]) : [];
        setRequests(Array.isArray(parsed) ? parsed : []);
      } catch {
        setRequests([]);
      }
    });
  }, [account.type]);

  const endSession = async (sessionId: string) => {
    setBusy(true);
    try {
      await revokeSessionById(sessionId);
      await load();
      setMessage("تم إنهاء الجلسة.");
    } catch {
      setMessage("تعذّر إنهاء الجلسة.");
    } finally {
      setBusy(false);
    }
  };

  const endOtherSessions = async () => {
    setBusy(true);
    try {
      await revokeAllOtherSessions();
      await load();
      setMessage("تم إنهاء كل الجلسات الأخرى. الجلسة الحالية باقية.");
    } catch {
      setMessage("تعذّر إنهاء الجلسات.");
    } finally {
      setBusy(false);
    }
  };

  const removeDevice = async (deviceId: string) => {
    setBusy(true);
    try {
      await revokeDeviceById(deviceId);
      await load();
      setMessage("أُلغي تفويض الجهاز، ولن يستعيد الجلسة تلقائيًا بعد الآن.");
    } catch {
      setMessage("تعذّر إلغاء تفويض الجهاز.");
    } finally {
      setBusy(false);
    }
  };

  const issueReset = async (accountId: string) => {
    setBusy(true);
    try {
      const result = await adminIssueReset(accountId);
      if (!result) {
        setMessage("تعذّر إصدار كلمة مرور مؤقتة.");
        return;
      }
      setIssued(result);
      setMessage("أُصدرت كلمة مرور مؤقتة وأُنهيت جلسات المستخدم. تُعرض مرة واحدة فقط.");
      setRequests((items) => items.filter((item) => item.accountId !== accountId));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SecurityStatusCard />
      <SectionCard title="الجلسات النشطة" subtitle="الأجهزة المسجّلة دخولها الآن لهذا الحساب">
        {sessions.length === 0 ? (
          <p className="muted">لا توجد جلسات أخرى مسجّلة.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {sessions.map((session) => (
              <div
                key={session.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: "10px 12px",
                }}
              >
                <div>
                  <strong>{session.current ? "هذا الجهاز" : session.platform || "جهاز"}</strong>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    بدأت {formatDate(session.createdAt)} • آخر نشاط {formatDate(session.lastSeenAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busy || session.current}
                  onClick={() => void endSession(session.id)}
                >
                  {session.current ? "الحالية" : "إنهاء"}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="form-actions" style={{ marginTop: 10 }}>
          <button type="button" className="danger-button" disabled={busy} onClick={() => void endOtherSessions()}>
            إنهاء كل الجلسات الأخرى
          </button>
        </div>
      </SectionCard>

      <SectionCard title="الأجهزة الموثوقة" subtitle="الأجهزة التي يمكنها الدخول وتغيير كلمة المرور">
        {devices.length === 0 ? (
          <p className="muted">لا يوجد جهاز موثوق مسجّل لهذا الحساب.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {devices.map((device) => (
              <div
                key={device.deviceId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: "10px 12px",
                }}
              >
                <div>
                  <strong style={{ direction: "ltr", display: "inline-block" }}>{device.deviceId}</strong>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    فُوّض {formatDate(device.issuedAt)} • آخر استخدام {formatDate(device.lastUsedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busy}
                  onClick={() => void removeDevice(device.deviceId)}
                >
                  إلغاء الثقة
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {account.type === "admin" ? (
        <SectionCard title="طلبات استعادة كلمة المرور" subtitle="تُصدر كلمة مرور مؤقتة تُسلَّم للمستخدم">
          {issued ? (
            <div className="alert" role="status">
              المستخدم: <strong>{issued.username}</strong> — كلمة المرور المؤقتة:{" "}
              <strong style={{ direction: "ltr", display: "inline-block" }}>{issued.temporaryPassword}</strong>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                انسخها الآن؛ لن تُعرض مرة أخرى.
              </p>
            </div>
          ) : null}
          {requests.length === 0 ? (
            <p className="muted">لا توجد طلبات معلّقة.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {requests.map((request) => (
                <div
                  key={request.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: "10px 12px",
                  }}
                >
                  <div>
                    <strong>{request.username}</strong>
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                      {request.contact || "بلا وسيلة تواصل"} • {formatDate(request.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void issueReset(request.accountId)}
                  >
                    إصدار كلمة مؤقتة
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      ) : null}

      {message ? <p className="muted">{message}</p> : null}
    </>
  );
}
