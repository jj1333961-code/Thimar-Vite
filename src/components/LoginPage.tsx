import { useState, type FormEvent } from "react";
import { findAccountByUsername, login, type Account } from "../lib/auth";
import { requestPasswordReset, resetPasswordWithDevice } from "../lib/cloud";
import { loadSettings } from "../lib/appStore";
import { t } from "../lib/i18n";
import { BrandMark, EyeIcon, EyeOffIcon, LockIcon, UserIcon } from "./ui";

export default function LoginPage({
  onLoggedIn,
  onPending,
  onCreateAccount,
  onFeedback,
}: {
  onLoggedIn: (account: Account) => void;
  onPending: (account: Account) => void;
  onCreateAccount: () => void;
  onFeedback: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetUsername, setResetUsername] = useState("");
  const [resetContact, setResetContact] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const lang = loadSettings().language;
  const L = (key: string) => t(lang, key);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError(L("login.errorEmpty"));
      return;
    }
    setBusy(true);
    const result = await login(username, password, remember);
    setBusy(false);
    if (result.status === "error") {
      setError(result.message ?? "");
      return;
    }
    setError("");
    if (result.status === "pending") {
      if (result.account) onPending(result.account);
      return;
    }
    if (result.account) onLoggedIn(result.account);
  }

  /* جهاز موثوق: السر محفوظ من تفويض سابق على هذا الجهاز نفسه. */
  function trustedDeviceSecret(username: string): { accountId: string; secret: string; deviceId: string } | null {
    const account = findAccountByUsername(username);
    if (!account) return null;
    try {
      const secret = localStorage.getItem(`thimar.deviceSecret.${account.id}`);
      if (!secret) return null;
      const nativeDeviceId = (window as any)?.ThimarNative?.deviceId?.();
      return {
        accountId: account.id,
        secret,
        deviceId: typeof nativeDeviceId === "string" && nativeDeviceId ? nativeDeviceId : `web-${account.id}`,
      };
    } catch {
      return null;
    }
  }

  async function handleRequestReset() {
    if (!resetUsername.trim()) {
      setResetMessage("اكتب اسم المستخدم.");
      return;
    }
    if (!resetContact.trim()) {
      setResetMessage("اكتب وسيلة تواصل (جوال أو بريد) ليصلك الرد.");
      return;
    }
    setResetBusy(true);
    await requestPasswordReset(resetUsername.trim(), resetContact.trim());
    setResetBusy(false);
    setResetMessage("تم إرسال الطلب. إن كان الحساب موجودًا فسيصل الرد على وسيلة التواصل التي كتبتها.");
  }

  async function handleDeviceReset() {
    if (resetPassword.length < 8) {
      setResetMessage("كلمة المرور الجديدة 8 أحرف على الأقل.");
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetMessage("تأكيد كلمة المرور غير مطابق.");
      return;
    }
    const trusted = trustedDeviceSecret(resetUsername.trim());
    if (!trusted) {
      setResetMessage("هذا الجهاز غير موثوق لهذا الحساب. استخدم طلب الاستعادة من المسؤول.");
      return;
    }
    setResetBusy(true);
    const result = await resetPasswordWithDevice({
      username: resetUsername.trim(),
      deviceId: trusted.deviceId,
      deviceSecret: trusted.secret,
      newPassword: resetPassword,
    });
    setResetBusy(false);
    if (!result.ok) {
      setResetMessage(
        result.code === "NETWORK"
          ? "تحتاج اتصالًا بالإنترنت لاستعادة كلمة المرور."
          : "تعذّرت الاستعادة. استخدم طلب الاستعادة من المسؤول.",
      );
      return;
    }
    setResetMessage("تم تعيين كلمة المرور الجديدة. يمكنك تسجيل الدخول الآن.");
    setResetPassword("");
    setResetConfirm("");
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
          <div className="login-veil" aria-hidden="true" />

        <section className="form-pane">
          <div className="brand-row">
            <BrandMark size={44} />
            <div className="brand-row-text">
              <span className="wordmark">{L("app.name")}</span>
            </div>
          </div>

          <div className="form-head login-head">
            <h1 className="login-cta-title">تسجّل الدخول</h1>
          </div>

          <form onSubmit={handleSubmit} className="stack" noValidate>
            <div className="field">
              <label className="field-label" htmlFor="login-username">
                {L("login.username")}
              </label>
              <div className="input-wrap">
                <span className="input-icon">
                  <UserIcon />
                </span>
                <input
                  id="login-username"
                  className="input has-icon"
                  type="text"
                  autoComplete="username"
                  placeholder={L("login.usernamePlaceholder")}
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setError("");
                  }}
                />
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="login-password">
                {L("login.password")}
              </label>
              <div className="input-wrap">
                <span className="input-icon">
                  <LockIcon />
                </span>
                <input
                  id="login-password"
                  className="input has-icon has-action"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError("");
                  }}
                />
                <button
                  type="button"
                  className="input-action"
                  aria-label={showPassword ? L("login.hidePassword") : L("login.showPassword")}
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span className="check-box" aria-hidden="true" />
              <span className="check-text">
                {L("login.remember")}
                <small>{L("login.rememberSub")}</small>
              </span>
            </label>

            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}

            <button
type="submit"
              className="btn btn-primary btn-block btn-lg"
              disabled={busy}
            >
              {L("login.submit")}
            </button>
          </form>

          <div className="divider">
            <span>{L("login.or")}</span>
          </div>

          <button
type="button"
            className="btn btn-ghost btn-block"
            onClick={onCreateAccount}
          >
            {L("login.create")}
          </button>

          <div className="login-links">
            <button
              type="button"
              className="link-mini"
              onClick={() => {
                setResetOpen(true);
                setResetUsername(username);
                setResetMessage("");
              }}
            >
              نسيت كلمة المرور؟
            </button>
            <span className="dot" aria-hidden="true" />
            <button type="button" className="link-mini" onClick={onFeedback}>
              {L("login.feedback")}
            </button>
            <span className="dot" aria-hidden="true" />
          </div>
        </section>
      </div>

      {resetOpen ? (
        <div className="modal-backdrop" onClick={() => setResetOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>استعادة كلمة المرور</h3>
            <p className="muted">
              من جهاز سبق أن سجّلت الدخول عليه يمكنك تعيين كلمة مرور جديدة فورًا.
              وإلا أرسل طلبًا يصل إلى مسؤول التطبيق.
            </p>
            <label>
              <span>اسم المستخدم</span>
              <input value={resetUsername} onChange={(event) => setResetUsername(event.target.value)} />
            </label>
            <label>
              <span>وسيلة التواصل (لطلب الاستعادة)</span>
              <input
                value={resetContact}
                onChange={(event) => setResetContact(event.target.value)}
                placeholder="جوال أو بريد"
              />
            </label>
            <div className="form-actions">
              <button type="button" className="ghost-button" disabled={resetBusy} onClick={() => void handleRequestReset()}>
                إرسال طلب للمسؤول
              </button>
            </div>
            <hr style={{ opacity: 0.25, margin: "14px 0" }} />
            <p className="muted">أو على هذا الجهاز:</p>
            <label>
              <span>كلمة المرور الجديدة</span>
              <input
                type="password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label>
              <span>تأكيد كلمة المرور</span>
              <input
                type="password"
                value={resetConfirm}
                onChange={(event) => setResetConfirm(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            {resetMessage ? <p className="muted">{resetMessage}</p> : null}
            <div className="form-actions">
              <button type="button" className="primary-button" disabled={resetBusy} onClick={() => void handleDeviceReset()}>
                تعيين كلمة المرور
              </button>
              <button type="button" className="ghost-button" onClick={() => setResetOpen(false)}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
