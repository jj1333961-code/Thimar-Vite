import { useEffect, useState } from "react";
import Celebration from "./components/Celebration";
import Dashboard from "./components/Dashboard";
import FeedbackPage from "./components/FeedbackPage";
import LoginPage from "./components/LoginPage";
import { PendingScreen } from "./components/Portal";
import RegisterPage from "./components/RegisterPage";
import { restoreRememberedAccount, signOut, type Account } from "./lib/auth";
import { celebrate, celebrateOnce } from "./lib/celebrate";
import { pullCloud, startCloudSync } from "./lib/cloud";
import { requestAppPermissions } from "./lib/notify";
import UpdatePrompt from "./components/UpdatePrompt";

type View = "login" | "register" | "app" | "pending" | "feedback";

export default function App() {
  // ندخل مباشرةً بالحساب المحفوظ دون انتظار الشبكة؛ التطبيق يعمل دون إنترنت.
  const [view, setView] = useState<View>(() => (restoreRememberedAccount() ? "app" : "login"));
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? false : !navigator.onLine,
  );
  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const [account, setAccount] = useState<Account | null>(() => restoreRememberedAccount());
  const [pendingAccount, setPendingAccount] = useState<Account | null>(null);

  useEffect(() => {
    // مزامنة السحابة في الخلفية دون تعطيل الدخول المحلي أو انتظار الشبكة.
    void pullCloud().catch(() => undefined);
    const stopSync = startCloudSync();
    const ask = () => { void requestAppPermissions(); window.removeEventListener("pointerdown", ask); window.removeEventListener("keydown", ask); };
    window.addEventListener("pointerdown", ask, { once: true });
    window.addEventListener("keydown", ask, { once: true });
    return () => {
      stopSync();
      window.removeEventListener("pointerdown", ask);
      window.removeEventListener("keydown", ask);
    };
  }, []);

  function handleLogout() {
    signOut();
    setAccount(null);
    setPendingAccount(null);
    setView("login");
  }

  let content: React.ReactNode;

  if (view === "app" && account) {
    content = <Dashboard account={account} onLogout={handleLogout} />;
  } else if (view === "pending" && pendingAccount) {
    content = (
      <PendingScreen
        account={pendingAccount}
        onBack={() => {
          setPendingAccount(null);
          setView("login");
        }}
      />
    );
  } else if (view === "register") {
    content = (
      <RegisterPage
        onBack={() => setView("login")}
        onComplete={(created) => {
          if (created.type === "teacher") {
            setPendingAccount(created);
            setView("pending");
            return;
          }
          setAccount(created);
          setView("app");
          // احتفال إنشاء الحساب الجديد.
          celebrate("register", created.fullName);
        }}
      />
    );
  } else if (view === "feedback") {
    content = <FeedbackPage onBack={() => setView("login")} />;
  } else {
    content = (
      <LoginPage
        onLoggedIn={(logged) => {
          setAccount(logged);
          setView("app");
          // أول دخول لهذا الحساب: احتفال ترحيبي.
          celebrateOnce(`login.${logged.id}`, "login");
        }}
        onPending={(teacherAccount) => {
          setPendingAccount(teacherAccount);
          setView("pending");
        }}
        onCreateAccount={() => setView("register")}
        onFeedback={() => setView("feedback")}
      />
    );
  }

  return (
    <>
      {isOffline && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "#2F5C4A",
            color: "#fff",
            textAlign: "center",
            padding: "6px 12px",
            fontSize: "13px",
            direction: "rtl",
          }}
        >
          أنت الآن في وضع عدم الاتصال
        </div>
      )}
      {content}
      <Celebration />
      <UpdatePrompt />
    </>
  );
}
