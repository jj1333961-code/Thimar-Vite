import { useEffect } from "react";
import { showSystemNotification } from "../../lib/notify";

const VISIT_KEY = "thimar.lastVisitDate";
const REMINDER_KEY = "thimar.lastReminderDate";

const DAILY_MESSAGES = [
  "اقرأ شيئاً من القرآن اليوم — حتى آية واحدة تضيء يومك.",
  "اقرأ حديث اليوم وتأمل في معناه.",
  "لا تنسَ حفظ شيء من تحفة الأطفال اليوم.",
  "اكتشف كل جديد في تطبيق ثمار — زيارة سريعة تكفي.",
  "أتمم جزءاً من القرآن أو آية — المداومة هي السر.",
  "راجع حفظك اليوم: آية أو سورة.",
  "اقرأ حديثاً وشاركه مع من تحب.",
];

function todayKey(): string {
  return new Date().toDateString();
}

export default function DailyReminder() {
  useEffect(() => {
    const today = todayKey();
    try {
      const lastVisit = localStorage.getItem(VISIT_KEY);
      if (lastVisit !== today) localStorage.setItem(VISIT_KEY, today);
    } catch {
      /* ignore */
    }

    const sendReminder = () => {
      try {
        if (localStorage.getItem(REMINDER_KEY) === today) return;
        const message = DAILY_MESSAGES[Math.floor(Math.random() * DAILY_MESSAGES.length)];
        void showSystemNotification("تذكير ثمار", message);
        localStorage.setItem(REMINDER_KEY, today);
      } catch {
        /* ignore */
      }
    };

    const firstTimer = window.setTimeout(sendReminder, 5000);
    const interval = window.setInterval(() => {
      const now = todayKey();
      if (now !== today) {
        // يوم جديد: أعد ضبط مفتاح التذكير وأرسل.
        try { localStorage.removeItem(REMINDER_KEY); } catch { /* ignore */ }
        sendReminder();
      } else {
        sendReminder();
      }
    }, 60 * 60 * 1000);

    return () => {
      window.clearTimeout(firstTimer);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}