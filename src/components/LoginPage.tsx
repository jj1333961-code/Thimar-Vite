import { useState, type FormEvent } from "react";
import { login, type Account } from "../lib/auth";
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
            <button type="button" className="link-mini" onClick={onFeedback}>
              {L("login.feedback")}
            </button>
            <span className="dot" aria-hidden="true" />
          </div>
        </section>
      </div>
    </div>
  );
}
