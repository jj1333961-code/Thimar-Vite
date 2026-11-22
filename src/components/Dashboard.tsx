import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "./dashboard/AppShell";
import HomePage from "./dashboard/HomePage";
import MessagesPage from "./dashboard/MessagesPage";
import NotificationsPage from "./dashboard/NotificationsPage";
import HomeworkPage from "./dashboard/HomeworkPage";
import ReportsPage from "./dashboard/ReportsPage";
import ChildrenPage from "./dashboard/ChildrenPage";
import GamesPage from "./dashboard/GamesPage";
import OnlineChallenge from "./dashboard/OnlineChallenge";
import SettingsPage from "./dashboard/SettingsPage";
import RecitationCoach from "./dashboard/RecitationCoach";
import FatwaPage from "./dashboard/FatwaPage";
import AdhkarPage from "./dashboard/AdhkarPage";
import TasbihPage from "./dashboard/TasbihPage";
import Exam from "./Exam";
import { HadithPage, QiblaPage, QuranPage, TafsirPage, TuhfaPage } from "./dashboard/StudyPages";
import QuranReadingEntry from "./dashboard/QuranReadingEntry";
import AdhanNotifier from "./dashboard/AdhanNotifier";
import DailyReminder from "./dashboard/DailyReminder";
import AdhanLogPage from "./dashboard/AdhanLogPage";
import { preloadQuranOffline } from "../lib/preloadQuran";
import MemorizationPathPage from "./dashboard/MemorizationPathPage";
import { applyTheme, childrenOfGuardian, loadChats, loadSettings, migrateLegacyGameProgress, recordLoginDay, unreadCount, type Settings } from "../lib/appStore";
import { t } from "../lib/i18n";
import { applyVibrationSetting, installVibrationGate, playNotificationSound, primeNotificationSound } from "../lib/sound";
import { showSystemNotification } from "../lib/notify";
import { ensureChatSeeds, ensureHomeworkSeeds, ensureNotificationSeeds, logLogin, sendAbsenceFollowUp } from "../lib/appStore";
import { loadAccounts } from "../lib/auth";
import { CLOUD_EVENT } from "../lib/cloud";
import { syncPushSubscription } from "../lib/push";
import { registerNativePush } from "../lib/nativePush";


export default function Dashboard({ account, onLogout }: { account: ReturnType<typeof loadAccounts>[number]; onLogout: () => void }) {
  const [active, setActive] = useState("home");
  const [settings, setSettings] = useState<Settings>(loadSettings());
  const [examOpen, setExamOpen] = useState(false);
  /** محادثة يطلبها إشعار (من الضغط على إشعار الرسائل). */
  const [openConversation, setOpenConversation] = useState<string | null>(null);

  /* كل صفحة تُفتح تُضاف إلى سجل الهاتف، فرجوع الجهاز يعيد للصفحة السابقة. */
  const navigate = (tab: string) => {
    if (tab === active) return;
    if (tab === "home") {
      setActive("home");
      if (window.history.state?.thimarTab) window.history.replaceState(null, "");
      return;
    }
    window.history.pushState({ thimarTab: tab }, "");
    setActive(tab);
  };

  useEffect(() => {
    const onPop = () => {
      const state = window.history.state as { thimarTab?: string } | null;
      if (state?.thimarTab) setActive(state.thimarTab);
      else if (!state) setActive("home");
      // حالات الطبقات الفرعية (نوافذ/مصحف) لا تغيّر التبويب الحالي.
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    applyTheme(settings);
    document.documentElement.lang = settings.language;
    document.documentElement.dir = settings.language === "ar" ? "rtl" : "ltr";
  }, [settings]);

  /* متابعة تغيير theme النظام في الوضع التلقائي. */
  useEffect(() => {
    if (settings.theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(settings);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, [settings]);

  // مفتاح واحد لكل اهتزازات التطبيق (أخطاء/إشعارات/تسبيح…).
  useEffect(() => {
    installVibrationGate();
    applyVibrationSetting(settings.vibration);
  }, [settings.vibration]);

  useEffect(() => {
    ensureChatSeeds(account);
    ensureHomeworkSeeds();
    ensureNotificationSeeds(account);
    if (account.type === "student") migrateLegacyGameProgress(account.id);
    logLogin(account);
  }, [account.id]);
  useEffect(() => {
    preloadQuranOffline();
  }, []);

  useEffect(() => {
    const handler = () => setSettings(loadSettings());
    window.addEventListener("thimar:settings", handler);
    return () => window.removeEventListener("thimar:settings", handler);
  }, []);

  // تحديث اشتراك الإشعارات (الموقع وطريقة الحساب) عند فتح التطبيق أو تغيير الإعدادات.
  useEffect(() => {
    // تطبيق أندرويد: تسجيل رمز FCM ليصل الإشعار والتطبيق مغلق.
    void registerNativePush(account.id, (target) => {
      const normalized = String(target || "").replace(/^thimar:\/\//, "/");
      const [pathPart, queryPart] = normalized.split("?");
      const segments = pathPart.replace(/^\/+/, "").split("/").filter(Boolean);
      const page = segments[0] || "";
      const params = new URLSearchParams(queryPart ?? "");
      const wantsUpdates =
        page === "settings" && (segments[1] === "updates" || params.get("update") === "1" || params.get("section") === "updates");
      const known = ["quran", "tafsir", "hadith", "qibla", "fatwa", "adhkar", "tasbih", "messages", "notifications", "settings"];
      if (wantsUpdates) {
        navigate("settings");
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("thimar:open-updates")), 0);
      } else if (known.includes(page)) {
        navigate(page);
      }
      const conversationId = params.get("c");
      if (page === "messages" && conversationId) setOpenConversation(conversationId);
    });
    const sync = () => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      void syncPushSubscription(account.id);
    };
    sync();
    window.addEventListener("thimar:settings", sync);
    return () => window.removeEventListener("thimar:settings", sync);
  }, [account.id]);



  const L = settings.language;
  const nav = (() => {
    if (account.type === "admin") {
      return [
        { id: "home", label: t(L, "nav.home"), icon: "home" as const },
        { id: "messages", label: t(L, "nav.messages"), icon: "chat" as const },
                { id: "notifications", label: t(L, "nav.notifications"), icon: "bell" as const, badge: 0 },
                { id: "path", label: t(L, "nav.path"), icon: "book" as const },
        { id: "challenge", label: t(L, "nav.challenge"), icon: "chart" as const },
      { id: "settings", label: t(L, "nav.settings"), icon: "settings" as const },

      ];
    }
    if (account.type === "teacher") {
      return [
        { id: "home", label: t(L, "nav.home"), icon: "home" as const },
        { id: "messages", label: t(L, "nav.messages"), icon: "chat" as const },
        { id: "homework", label: t(L, "nav.homework"), icon: "clipboard" as const },
        { id: "path", label: t(L, "nav.path"), icon: "book" as const },
        { id: "reports", label: t(L, "nav.reports"), icon: "chart" as const },
        { id: "challenge", label: t(L, "nav.challenge"), icon: "chart" as const },
        { id: "settings", label: t(L, "nav.settings"), icon: "settings" as const },
      ];
    }
    if (account.type === "guardian") {
      return [
        { id: "home", label: t(L, "nav.home"), icon: "home" as const },
        { id: "messages", label: t(L, "nav.messages"), icon: "chat" as const },
        { id: "children", label: t(L, "nav.children"), icon: "users" as const },
        { id: "homework", label: t(L, "nav.homework"), icon: "clipboard" as const },
        { id: "path", label: t(L, "nav.path"), icon: "book" as const },
        { id: "challenge", label: t(L, "nav.challenge"), icon: "chart" as const },
        { id: "settings", label: t(L, "nav.settings"), icon: "settings" as const },
      ];
    }
    return [
      { id: "home", label: t(L, "nav.home"), icon: "home" as const },
      { id: "messages", label: t(L, "nav.messages"), icon: "chat" as const },
            { id: "homework", label: t(L, "nav.homework"), icon: "clipboard" as const },
      { id: "path", label: t(L, "nav.path"), icon: "book" as const },
      { id: "games", label: t(L, "nav.games"), icon: "sparkles" as const },
      { id: "challenge", label: t(L, "nav.challenge"), icon: "chart" as const },
      { id: "settings", label: t(L, "nav.settings"), icon: "settings" as const },

    ];
  })();

  const [unreadBadge, setUnreadBadge] = useState(0);
  const [messageBadge, setMessageBadge] = useState(0);
  const lastUnreadRef = useRef<number | null>(null);
  const lastMessagesRef = useRef<number | null>(null);

  // يسجّل يوم الدخول لحساب الأيام المتتالية، ويرسل تنبيه الغياب للطالب المرتبط بمعلم.
  useEffect(() => {
    if (account.type === "student") sendAbsenceFollowUp(account);
    recordLoginDay(account.id);
  }, [account.id]);

  const linkedToTeacher =
    account.type === "student" &&
    Boolean(account.student?.teacherAccountId || account.student?.teacherId);

  /* ولي الأمر: صفحة المهمات تظهر فقط عند وجود أبناء مرتبطين. */
  const [accountsTick, setAccountsTick] = useState(0);
  useEffect(() => {
    const bump = () => setAccountsTick((value) => value + 1);
    window.addEventListener("focus", bump);
    window.addEventListener("storage", bump);
    window.addEventListener("thimar:settings", bump);
    window.addEventListener(CLOUD_EVENT, bump);
    const timer = window.setInterval(bump, 8000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", bump);
      window.removeEventListener("storage", bump);
      window.removeEventListener("thimar:settings", bump);
      window.removeEventListener(CLOUD_EVENT, bump);
    };
  }, []);

  const guardianHasChildren = useMemo(() => {
    if (account.type !== "guardian") return false;
    const fresh = loadAccounts().find((item) => item.id === account.id) ?? account;
    return childrenOfGuardian(fresh).length > 0;
  }, [account, accountsTick]);

  // المهمات تظهر للطالب المرتبط بمعلم، ولولي الأمر الذي أضاف أبناء.
  const visibleNav = nav.filter((item) => {
    /* التحدي لم يعد في الشريط السفلي: يُفتح من صفحة الحفظ فقط. */
    if (item.id === "challenge") return false;
    if (item.id !== "homework") return true;
    if (account.type === "student") return linkedToTeacher;
    if (account.type === "guardian") return guardianHasChildren;
    return true;
  });

  const homeworkHidden =
    (account.type === "student" && !linkedToTeacher) ||
    (account.type === "guardian" && !guardianHasChildren);

  useEffect(() => {
    if (active === "homework" && homeworkHidden) navigate("home");
  }, [active, homeworkHidden]);

  // يفتح مخرج الصوت عند أول تفاعل (مطلوب على الجوال).
  useEffect(() => {
    const unlock = () => primeNotificationSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  useEffect(() => {
    const messageCount = () => {
      try {
        return loadChats()
          .filter((conversation) => conversation.memberIds.includes(account.id))
          .reduce((total, conversation) => total + conversation.messages.length, 0);
      } catch {
        return 0;
      }
    };
    const refreshBadge = () => {
      const unread = unreadCount(account);
      const messages = messageCount();
      // صوت عند وصول إشعار أو رسالة جديدة.
      const newNotification = lastUnreadRef.current !== null && unread > lastUnreadRef.current;
      const newMessage = lastMessagesRef.current !== null && messages > lastMessagesRef.current;
      if (newNotification || newMessage) {
        playNotificationSound("info");
        // إشعار خارج التطبيق عندما يكون التطبيق في الخلفية.
        if (document.visibilityState === "hidden") {
          void showSystemNotification(
            newMessage ? "رسالة جديدة في ثمار" : "إشعار جديد في ثمار",
            newMessage
              ? "لديك رسالة جديدة من أحد أعضاء الدائرة."
              : "لديك إشعار جديد، افتح التطبيق للاطلاع عليه.",
          );
        }
      }
      lastUnreadRef.current = unread;
      lastMessagesRef.current = messages;
      setUnreadBadge(unread);
      /* عدد الرسائل التي وصلت ولم تُقرأ بعد — تظهر على أيقونة الرسائل. */
      try {
        const unreadMessages = loadChats()
          .filter((conversation) => conversation.memberIds.includes(account.id))
          .reduce(
            (total, conversation) =>
              total +
              conversation.messages.filter(
                (message) => message.senderId !== account.id && !(message.readBy ?? []).includes(account.id),
              ).length,
            0,
          );
        setMessageBadge(unreadMessages);
      } catch {
        setMessageBadge(0);
      }
    };
    refreshBadge();
    const timer = window.setInterval(refreshBadge, 4000);
    window.addEventListener("thimar:settings", refreshBadge);
    window.addEventListener("focus", refreshBadge);
    window.addEventListener(CLOUD_EVENT, refreshBadge);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("thimar:settings", refreshBadge);
      window.removeEventListener("focus", refreshBadge);
      window.removeEventListener(CLOUD_EVENT, refreshBadge);
    };
  }, [account.id]);

  const roleLabel =
    account.type === "admin"
      ? t(L, "role.admin")
      : account.type === "teacher"
        ? t(L, "role.teacher")
        : account.type === "guardian"
          ? t(L, "role.guardian")
          : t(L, "role.student");

  if (examOpen) {
    return (
      <Exam
        account={account}
        kind={account.type === "teacher" ? "teacher" : "student"}
        onExit={() => setExamOpen(false)}
      />
    );
  }

  const renderPage = () => {
    switch (active) {
      case "home":
        return (
          <HomePage
            account={account}
            settings={settings}
            onNavigate={navigate}
            onOpenExam={() => setExamOpen(true)}
          />
        );
      case "messages":
        return <MessagesPage account={account} initialConversationId={openConversation ?? undefined} />;
      case "notifications":
        return <NotificationsPage account={account} onNavigate={navigate} />;
      case "homework":
        return <HomeworkPage account={account} />;
      case "reports":
        return <ReportsPage account={account} />;
      case "children":
        return <ChildrenPage account={account} />;
      case "games":
        return <GamesPage account={account} />;
      case "path":
        return <MemorizationPathPage account={account} />;
      case "challenge":
        return <OnlineChallenge account={{ id: account.id, fullName: account.fullName }} />;
      case "quran":
        return <QuranPage settings={settings} onBack={() => navigate("home")} onOpenSettings={() => navigate("settings")} />;
      case "quran-circle":
        return <QuranReadingEntry onBack={() => navigate("home")} />;
      case "tuhfa":
        return <TuhfaPage onBack={() => navigate("home")} onOpenSettings={() => navigate("settings")} />;
      case "tafsir":
        return <TafsirPage onBack={() => navigate("home")} />;
      case "hadith":
        return <HadithPage onBack={() => navigate("home")} />;
      case "adhan-log":
        return <AdhanLogPage onBack={() => navigate("home")} />;
      case "qibla":
        return <QiblaPage onBack={() => navigate("home")} />;
      case "fatwa":
        return <FatwaPage />;
      case "adhkar":
        return <AdhkarPage />;
      case "tasbih":
        return <TasbihPage />;
      case "coach":
        return <RecitationCoach />;
      case "settings":
        return (
          <SettingsPage
            account={account}
            onLogout={onLogout}
            onOpenAdhanLog={() => navigate("adhan-log")}
          />
        );
      default:
        return null;
    }
  };

  return (
    <AppShell
      accountName={account.fullName}
      roleLabel={roleLabel}
      nav={visibleNav.map((item) => {
        if (item.id === "notifications") return { ...item, badge: unreadBadge };
        if (item.id === "messages") return { ...item, badge: messageBadge };
        return item;
      })}
      active={active}
      onNavigate={navigate}
      onLogout={onLogout}
      onOpenSettings={() => navigate("settings")}
    >
      {renderPage()}
      <AdhanNotifier />
      <DailyReminder />
    </AppShell>
  );
}
