import { Account, loadAccounts, updateAccount } from "./auth";
import {
  CLOUD_KEYS,
  deleteConversationFromCloud,
  deleteMessagesFromCloud,
  deleteNotificationsFromCloud,
  gradeSubmissionInCloud,
  notifyAdminsInCloud,
  pushChats,
  pushHomework,
  pushLinkRequests,
  pushNotifications,
  pushSubmissions,
} from "./cloud";
import { notifyAccounts } from "./push";
export type Theme = "light" | "dark" | "sepia" | "auto";

export type Settings = {
  theme: Theme;
  language: "ar" | "en";
  appFontSize: number;
  quranFontSize?: number;
  reciter: string;
  repeat: number;
  notifications: boolean;
  messagePreview: boolean;
  notificationSound: boolean;
  vibration: boolean;
  adhanSound: boolean;
  /** شاشة وقت الصلاة مستقلة تمامًا عن صوت الأذان. */
  adhanScreen: boolean;
  adhanId: string;
  adhanVolume: number;
  /** كتم صوت الأذان بأزرار الصوت في الهاتف (يعمل داخل تطبيق أندرويد). */
  adhanVolumeKeyMute: boolean;
  adhanByPrayer: Record<string, string>;
  adhanPrayerEnabled: Record<string, boolean>;
  robotVisible: boolean;
  reduceMotion: boolean;
  prayerMethod: number;
  /** إبقاء الشاشة مفتوحة داخل المصحف وتحفة الأطفال. */
  keepScreenAwake: boolean;
};

const SETTINGS_KEY = "thimar.settings.v1";

export const defaultSettings: Settings = {
  theme: "light",
  language: "ar",
  appFontSize: 16,
  reciter: "ar.alafasy",
  repeat: 2,
  notifications: true,
  messagePreview: true,
  notificationSound: true,
  vibration: true,
  adhanSound: true,
  adhanScreen: true,
  adhanId: "adhan-1",
  adhanVolume: 0.9,
  adhanVolumeKeyMute: true,
  adhanByPrayer: {},
  adhanPrayerEnabled: { Fajr: true, Dhuhr: true, Asr: true, Maghrib: true, Isha: true },
  robotVisible: true,
  reduceMotion: false,
  prayerMethod: 4,
  keepScreenAwake: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...defaultSettings, ...parsed };
    if (typeof parsed.appFontSize !== "number" && typeof parsed.quranFontSize === "number") {
      merged.appFontSize = Math.min(24, Math.max(12, parsed.quranFontSize - 10));
    }
    return merged;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  applyTheme(settings);
}

export function applyTheme(settings: Settings): void {
  const root = document.documentElement;
  const resolved =
    settings.theme === "auto"
      ? (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light")
      : settings.theme;
  root.dataset.theme = resolved;
  root.dataset.themePreference = settings.theme;
  root.dataset.motion = settings.reduceMotion ? "reduced" : "full";
  root.style.setProperty("--app-font-size", `${settings.appFontSize}px`);
  /* أكبر قليلًا من السابق مع تكبير أوضح للنصوص الصغيرة. */
  root.style.setProperty("--app-font-scale", String((settings.appFontSize + 1) / 16));
  root.style.setProperty("--quran-size", `${settings.appFontSize + 10}px`);
}

/* ---------------- المحادثات ---------------- */

export type ChatMessage = {
  id: string;
  senderId: string;
  kind: "text" | "audio" | "file" | "call" | "system";
  text?: string;
  audioUrl?: string;
  duration?: number;
  fileName?: string;
  createdAt: number;
  /** من شاهد الرسالة من الأعضاء الآخرين. */
  readBy?: string[];
};

export type Conversation = {
  id: string;
  title: string;
  isGroup: boolean;
  memberIds: string[];
  admins?: string[];
  createdBy: string;
  createdAt: number;
  messages: ChatMessage[];
  /** أعضاء كتموا إشعارات هذه المحادثة. */
  mutedBy?: string[];
};

const CHAT_KEY = "thimar.chat.v1";
const CHAT_SEED_KEY = "thimar.chat.seeded.v1";

function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadChats(): Conversation[] {
  return safeParse<Conversation[]>(localStorage.getItem(CHAT_KEY), []);
}

function saveChats(conversations: Conversation[]) {
  const previous = loadChats();
  localStorage.setItem(CHAT_KEY, JSON.stringify(conversations));
  /* يُرفع التغيير إلى السيرفر مباشرة، وإن انقطع الإنترنت يُرفع في المزامنة التالية.
     الملفات الصوتية والمرفقات لا تُرفع؛ تبقى محلية. */
  const changed = conversations.filter((conversation) => {
    const before = previous.find((item) => item.id === conversation.id);
    return !before || JSON.stringify(before) !== JSON.stringify(conversation);
  });
  if (changed.length) void pushChats(changed);
}

function makeMessage(
  senderId: string,
  text: string,
  kind: ChatMessage["kind"] = "text",
  minutesAgo = 0,
): ChatMessage {
  return {
    id: id("msg"),
    senderId,
    kind,
    text,
    createdAt: Date.now() - minutesAgo * 60000,
  };
}

/** ينشئ (أو يعيد) محادثة مباشرة بين حسابين — تُستخدم بعد قبول ربط الطالب بالمعلم. */
export function ensureDirectConversation(a: Account, b: Account): string | null {
  const chats = loadChats();
  const existing = chats.find(
    (conversation) =>
      !conversation.isGroup &&
      conversation.memberIds.length === 2 &&
      conversation.memberIds.includes(a.id) &&
      conversation.memberIds.includes(b.id),
  );
  if (existing) return existing.id;
  const conversation: Conversation = {
    id: id("conv"),
    title: b.fullName || b.username,
    isGroup: false,
    memberIds: [a.id, b.id],
    admins: [a.id],
    createdBy: a.id,
    createdAt: Date.now(),
    messages: [
      makeMessage(a.id, "تم قبول طلب الربط، يمكننا الآن التواصل وإرسال المهمات."),
    ],
  };
  saveChats([...chats, conversation]);
  return conversation.id;
}

// Load accounts from localStorage fallback (sync)
function loadAccountsFromLocalStorage(): Account[] {
  const stored = safeParse<Account[] | null>(localStorage.getItem("thimar.accounts.v1"), null);
  if (stored && stored.length > 0) {
    return stored;
  }
  // لا تُزرع حسابات بكلمات مرور مكتوبة في الكود؛ الحسابات تُسحب من قاعدة البيانات.
  return [];
}

export function ensureChatSeeds(account: Account): void {
  const seeded = safeParse<Record<string, boolean>>(
    localStorage.getItem(CHAT_SEED_KEY),
    {}
  );
  if (seeded[account.id]) return;

  // الحسابات الحقيقية لا تُزرع لها محادثات وهمية (معلمون/أولياء غير موجودين).
  const isDemo = account.id.startsWith("test-");
  if (!isDemo && account.type !== "admin") {
    localStorage.setItem(CHAT_SEED_KEY, JSON.stringify({ ...seeded, [account.id]: true }));
    return;
  }

  const accounts = loadAccountsFromLocalStorage();
  const find = (username: string) =>
    accounts.find((item) => item.username === username);
  const admin = find("admin");
  const teacher = find("teacher");
  const student = find("student");
  const guardian = find("guardian");
  const sara = find("sara");

  const conversations = [...loadChats()];
  const now = Date.now();

  const addConversation = (
    title: string,
    members: Array<Account | undefined>,
    isGroup: boolean,
    messages: ChatMessage[],
  ) => {
    const memberIds = [
      ...new Set(
        members
          .filter((member): member is Account => Boolean(member))
          .map((member) => member.id),
      ),
    ];
    if (!memberIds.includes(account.id) || memberIds.length < 2) return;
    if (
      conversations.some(
        (conversation) =>
          conversation.title === title &&
          conversation.memberIds.length === memberIds.length &&
          conversation.memberIds.every((member) => memberIds.includes(member)),
      )
    ) {
      return;
    }
    conversations.push({
      id: id("conv"),
      title,
      isGroup,
      memberIds,
      admins: [account.id],
      createdBy: account.id,
      createdAt: now - 1000 * 60 * 60 * 24,
      messages,
    });
  };

  if (account.type === "admin") {
    addConversation(
      teacher?.fullName ?? "المعلم",
      [account, teacher],
      false,
      [
        makeMessage(teacher?.id ?? "", "السلام عليكم، تم رفع طلب اعتماد حسابي.", "text", 180),
        makeMessage(account.id, "وعليكم السلام، سنراجع الطلب واختبار الإتقان اليوم.", "text", 160),
        makeMessage(teacher?.id ?? "", "بارك الله فيكم.", "text", 155),
      ],
    );
    addConversation(
      guardian?.fullName ?? "ولي الأمر",
      [account, guardian],
      false,
      [
        makeMessage(guardian?.id ?? "", "أرجو إفادتي بمستوى ابني في الحلقة.", "text", 300),
        makeMessage(account.id, "أهلًا بك، تقرير الأسبوع سيصلك عبر صفحة الأبناء.", "text", 280),
      ],
    );
    addConversation(
      "فريق ثمار",
      [account, teacher, guardian, student],
      true,
      [
        makeMessage(teacher?.id ?? "", "أهلًا بالجميع في مجموعة المتابعة الأسبوعية.", "text", 500),
        makeMessage(guardian?.id ?? "", "شكرًا لجهودكم.", "text", 480),
        makeMessage(account.id, "نرحّب بملاحظات الجميع عبر الشكاوى والاقتراحات.", "text", 470),
      ],
    );
  } else if (account.type === "teacher") {
    addConversation(
      student?.fullName ?? "طالب",
      [account, student],
      false,
      [
        makeMessage(student?.id ?? "", "السلام عليكم شيخي، أرسلت تسميع اليوم.", "text", 200),
        makeMessage(account.id, "وعليكم السلام، بارك الله فيك، سأستمع له بعد قليل.", "text", 190),
        makeMessage(
          account.id,
          "تم التصحيح، حفظك ممتاز، راجع الآية السابعة مرة أخرى.",
          "text",
          120,
        ),
      ],
    );
    addConversation(
      guardian?.fullName ?? "ولي الأمر",
      [account, guardian],
      false,
      [
        makeMessage(guardian?.id ?? "", "كيف مستوى عبد الله هذا الأسبوع?", "text", 320),
        makeMessage(account.id, "تحسّن واضح، ودرجته ارتفعت من ٣ إلى ٤ نجوم.", "text", 300),
      ],
    );
    addConversation(
      "حلقة النور",
      [account, student, sara, guardian],
      true,
      [
        makeMessage(account.id, "تذكير: تسميع الجزء المحدد قبل يوم الخميس.", "text", 600),
        makeMessage(student?.id ?? "", "تم، جزاك الله خيرًا.", "text", 590),
        makeMessage(sara?.id ?? "", "سأرفع التسميع الليلة بإذن الله.", "text", 580),
      ],
    );
  } else if (account.type === "student") {
    addConversation(
      teacher?.fullName ?? "المعلم",
      [account, teacher],
      false,
      [
        makeMessage(account.id, "السلام عليكم شيخي، أرسلت تسميع اليوم.", "text", 200),
        makeMessage(teacher?.id ?? "", "وعليكم السلام، بارك الله فيك، سأستمع له بعد قليل.", "text", 190),
        makeMessage(
          teacher?.id ?? "",
          "تم التصحيح، حفظك ممتاز، راجع الآية السابعة مرة أخرى.",
          "text",
          120,
        ),
      ],
    );
    addConversation(
      guardian?.fullName ?? "ولي الأمر",
      [account, guardian],
      false,
      [
        makeMessage(guardian?.id ?? "", "وفقك الله يا بني، لا تنسَ مراجعة القريب.", "text", 400),
        makeMessage(account.id, "إن شاء الله، سأسمّع اليوم بعد المغرب.", "text", 390),
      ],
    );
    addConversation(
      "حلقة النور",
      [account, teacher, sara, guardian],
      true,
      [makeMessage(teacher?.id ?? "", "أحسنتم جميعًا هذا الأسبوع.", "text", 700)],
    );
  } else if (account.type === "guardian") {
    addConversation(
      teacher?.fullName ?? "المعلم",
      [account, teacher],
      false,
      [
        makeMessage(account.id, "السلام عليكم، أرجو إفادتي بمستوى عبد الله.", "text", 320),
        makeMessage(teacher?.id ?? "", "وعليكم السلام، تحسّن واضح هذا الأسبوع.", "text", 300),
      ],
    );
    addConversation(
      student?.fullName ?? "الطالب",
      [account, student],
      false,
      [
        makeMessage(account.id, "وفقك الله يا بني، لا تنسَ مراجعة القريب.", "text", 400),
        makeMessage(student?.id ?? "", "إن شاء الله، سأسمّع اليوم بعد المغرب.", "text", 390),
      ],
    );
    addConversation(
      admin?.fullName ?? "المسؤول",
      [account, admin],
      false,
      [makeMessage(admin?.id ?? "", "أهلًا بك، أي ملاحظة تصلنا مباشرة.", "text", 900)],
    );
    addConversation(
      "حلقة النور",
      [account, teacher, student, sara],
      true,
      [makeMessage(teacher?.id ?? "", "التسميع الأسبوعي يوم الخميس بعد العصر.", "text", 950)],
    );
  }

  saveChats(conversations);
  localStorage.setItem(
    CHAT_SEED_KEY,
    JSON.stringify({ ...seeded, [account.id]: true }),
  );
}

/* ---------------- الإشعارات ---------------- */

export type AppNotificationKind =
  | "complaint"
  | "login"
  | "teacher"
  | "homework"
  | "evaluation"
  | "system";

export type AppNotification = {
  id: string;
  recipientId: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  /** الصفحة التي يُنقل إليها عند الضغط على الإشعار. */
  target?: string;
  /** إجراء خاص: طلب ربط يحتاج موافقة/رفض. */
  action?: "teacher-link" | "guardian-link";
};

const NOTIF_KEY = CLOUD_KEYS.notifications;
const NOTIF_SEED_KEY = "thimar.notifications.seeded.v1";

export function loadNotifications(): AppNotification[] {
  return safeParse<AppNotification[]>(localStorage.getItem(NOTIF_KEY), []);
}

function saveNotifications(notifications: AppNotification[]) {
  const previous = loadNotifications();
  localStorage.setItem(NOTIF_KEY, JSON.stringify(notifications.slice(-300)));
  const kept = notifications.slice(-300);
  void pushNotifications(kept);
  const keptIds = new Set(kept.map((notification) => notification.id));
  const removed = previous
    .map((notification) => notification.id)
    .filter((notificationId) => !keptIds.has(notificationId));
  if (removed.length) void deleteNotificationsFromCloud(removed);
}

/**
 * يُشعر كل حسابات المسؤولين عند تسجيل معلم جديد. البيانات الكاملة تُرفع مع
 * الحساب إلى السحابة، ويصل إشعار فوري إلى أجهزة المسؤولين (FCM/Web Push)
 * إضافة إلى إشعار داخل التطبيق يستطيع كل مسؤول رؤيته.
 */
export function notifyAdminsOfTeacherApplication(account: Account): void {
  if (account.type !== "teacher") return;

  // منع تكرار الإشعار إذا أعاد المستخدم المحاولة أو أُعيد تحميل الصفحة.
  const marker = `thimar.teacherApplicationNotified.${account.id}`;
  try {
    if (localStorage.getItem(marker)) return;
    localStorage.setItem(marker, "1");
  } catch {
    /* التخزين قد يكون معطلاً؛ نكمل الإرسال */
  }

  const title = "طلب اعتماد معلم جديد";
  const body = `${account.fullName} (@${account.username}) — ${account.countryCode} ${account.phone} — ${account.email}`;

  /* الإشعار الحقيقي يُكتب على الخادم لكل مسؤول نشط، حتى لو لم يكن مسؤولي
     هذا الجهاز ضمن قائمة الحسابات المحلية. */
  void notifyAdminsInCloud({
    title,
    body: `${body}. راجع البيانات كاملة واعتمد الحساب أو ارفضه.`,
    kind: "teacher",
    target: "settings",
  });

  const admins = loadAccounts().filter(
    (item) => item.type === "admin" && item.status === "active",
  );
  if (!admins.length) return;
  for (const admin of admins) {
    addNotification({
      recipientId: admin.id,
      kind: "teacher",
      title,
      body: `${body}. راجع البيانات كاملة واعتمد الحساب أو ارفضه.`,
      target: "settings",
    });
  }
  void notifyAccounts(admins.map((admin) => admin.id), {
    title,
    body: `${account.fullName} (@${account.username}) قدّم طلب اعتماد. راجع طلبات المعلمين.`,
    url: "/notifications",
    tag: `teacher-application-${account.id}`,
  });
}

export function addNotification(
  input: Omit<AppNotification, "id" | "createdAt" | "read">,
): void {
  const notifications = loadNotifications();
  notifications.push({
    ...input,
    id: id("ntf"),
    createdAt: Date.now(),
    read: false,
  });
  saveNotifications(notifications);
}

export function notificationsFor(account: Account): AppNotification[] {
  const targeted = loadNotifications().filter(
    (notification) =>
      notification.recipientId === account.id ||
      (account.type === "admin" && notification.recipientId === "admins"),
  );
  return targeted.sort((a, b) => b.createdAt - a.createdAt);
}

export function unreadCount(account: Account): number {
  return notificationsFor(account).filter((notification) => !notification.read).length;
}

export function markAllNotificationsRead(account: Account): void {
  const notifications = loadNotifications().map((notification) =>
    notification.recipientId === account.id ||
    (account.type === "admin" && notification.recipientId === "admins")
      ? { ...notification, read: true }
      : notification,
  );
  saveNotifications(notifications);
}

export function deleteNotification(notificationId: string): void {
  saveNotifications(loadNotifications().filter((notification) => notification.id !== notificationId));
}

export function markNotificationRead(notificationId: string): void {
  saveNotifications(
    loadNotifications().map((notification) =>
      notification.id === notificationId ? { ...notification, read: true } : notification,
    ),
  );
}

export function ensureNotificationSeeds(account: Account): void {
  const seeded = safeParse<Record<string, boolean>>(
    localStorage.getItem(NOTIF_SEED_KEY),
    {}
  );
  if (seeded[account.id]) return;

  // لا إشعارات وهمية لحساب حقيقي: كل شيء يصل من معلم حقيقي أو من التطبيق.
  const isDemo = account.id.startsWith("test-");
  if (!isDemo && account.type !== "admin") {
    localStorage.setItem(NOTIF_SEED_KEY, JSON.stringify({ ...seeded, [account.id]: true }));
    return;
  }

  const accounts = loadAccountsFromLocalStorage();
  const student = accounts.find((item) => item.username === "student");

  if (account.type === "admin") {
    /* لا تُزرع إشعارات تجريبية لمدير النظام: الإشعارات تأتي من الأحداث الحقيقية فقط. */
    localStorage.setItem(NOTIF_SEED_KEY, JSON.stringify({ ...seeded, [account.id]: true }));
    void student;
  } else if (account.type === "teacher") {
    addNotification({
      recipientId: account.id,
      kind: "homework",
      title: "تسميع جديد بانتظار التصحيح",
      body: "أرسلت سارة تسميعها لسورة الملك، الآيات ١–٥.",
    });
    addNotification({
      recipientId: account.id,
      kind: "homework",
      title: "مهمة اليوم",
      body: "لديك واجبان مستحقان اليوم، راجع صفحة الواجب والتسميع.",
    });
    addNotification({
      recipientId: account.id,
      kind: "system",
      title: "تم اعتماد حسابك",
      body: "أصبح حساب المعلم معتمدًا، ويمكنك استقبال التسميعات.",
    });
  } else if (account.type === "student") {
    addNotification({
      recipientId: account.id,
      kind: "homework",
      title: "واجب جديد من معلمك",
      body: "تسميع سورة النبأ، الآيات ١–١٠، مع مراجعة سورة الماعون.",
    });
    addNotification({
      recipientId: account.id,
      kind: "evaluation",
      title: "تقييم جديد",
      body: "قيّم معلمك تسميعك الأخير بـ ٤ من ٥ نجوم.",
    });
    addNotification({
      recipientId: account.id,
      kind: "system",
      title: "حافظ على سلسلتك",
      body: "أكملت ٣ أيام متتالية من التسميع، واصل!",
    });
  } else if (account.type === "guardian") {
    addNotification({
      recipientId: account.id,
      kind: "evaluation",
      title: "تقرير ابنك الأسبوعي",
      body: "ارتفع تقييم عبد الله من ٣ إلى ٤ نجوم هذا الأسبوع.",
    });
    addNotification({
      recipientId: account.id,
      kind: "homework",
      title: "تسميع اليوم",
      body: "سلّم عبد الله تسميع سورة النبأ، بانتظار تصحيح المعلم.",
    });
  }

  localStorage.setItem(
    NOTIF_SEED_KEY,
    JSON.stringify({ ...seeded, [account.id]: true }),
  );
}

/* ---------------- الواجبات والتسميع ---------------- */

export type HomeworkMethod = "live" | "inapp" | "photo" | "audio" | "video" | "text" | "call" | "file";

export type HomeworkSegment = {
  label: string;
  surah: number;
  fromAyah: number;
  toAyah: number;
  /** نطاق التسميع: سورة كاملة (سورة إلى سورة) أو نطاق آيات داخل سورة. */
  mode?: "surah" | "ayah";
  /** سورة النهاية عند اختيار «من سورة إلى سورة». */
  surahTo?: number;
};

export type Homework = {
  id: string;
  teacherId: string;
  studentId: string;
  surah: number;
  surahFrom?: number;
  surahTo?: number;
  fromAyah: number;
  toAyah: number;
  farPastSurah: number;
  nearPastSurah: number;
  method: HomeworkMethod;
  /** عنوان المهمة (للمهمات الإضافية والقراءة). */
  title?: string;
  /** نوع المهمة: تسميع أو قراءة. */
  category?: "tasmee" | "reading" | "extra";
  /** مهمة اختيارية (غير إجبارية). */
  optional?: boolean;
  /** ثوانٍ محسوبة لكل آية في مهمة القراءة الإجبارية. */
  perAyahSeconds?: number;
  /** عناصر التسميع (اللوح/السورة/الماضي البعيد/الماضي القريب) بنطاق آيات لكل عنصر. */
  segments?: HomeworkSegment[];
  dueAt: number;
  notes: string;
  surahGrades?: Record<string, { score: number; feedback: string; gradedAt: number }>;
  createdAt: number;
};

export type Submission = {
  id: string;
  homeworkId: string;
  studentId: string;
  teacherId: string;
  kind: HomeworkMethod;
  note?: string;
  audioUrl?: string;
  duration?: number;
  fileName?: string;
  score?: number;
  feedback?: string;
  createdAt: number;
  reviewedAt?: number;
};

const HW_KEY = "thimar.homework.v1";
const SUB_KEY = "thimar.submissions.v1";

export function loadHomework(): Homework[] {
  return safeParse<Homework[]>(localStorage.getItem(HW_KEY), []);
}

export function loadSubmissions(): Submission[] {
  return safeParse<Submission[]>(localStorage.getItem(SUB_KEY), []);
}

function saveHomework(items: Homework[]) {
  localStorage.setItem(HW_KEY, JSON.stringify(items));
  /* الواجبات تُزامن إلى الخادم حتى يراها الطالب على أي جهاز. */
  void pushHomework(items);
}

function saveSubmissions(items: Submission[]) {
  localStorage.setItem(SUB_KEY, JSON.stringify(items));
  void pushSubmissions(items);
}

export function addHomework(input: Omit<Homework, "id" | "createdAt">): Homework {
  const homework: Homework = { ...input, id: id("hw"), createdAt: Date.now() };
  saveHomework([...loadHomework(), homework]);
  addNotification({
    recipientId: input.studentId,
    kind: "homework",
    title: "واجب جديد",
    body: `أسند إليك معلمك واجبًا جديدًا في سورة ${input.surah}.`,
    target: "homework",
  });
  void notifyAccounts(
    [input.studentId],
    {
      title: "واجب جديد",
      body: `أسند إليك معلمك واجبًا جديدًا في سورة ${input.surah}.`,
      url: "/homework",
      tag: `homework-${homework.id}`,
    },
    { senderId: input.teacherId, kind: "homework" },
  );
  return homework;
}

export function homeworkSurahRange(
  item: Pick<Homework, "surah" | "surahFrom" | "surahTo">,
): number[] {
  const from = Math.min(114, Math.max(1, item.surahFrom ?? item.surah));
  const to = Math.min(114, Math.max(1, item.surahTo ?? from));
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function gradeHomeworkSurah(
  homeworkId: string,
  surah: number,
  score: number,
  feedback: string,
): void {
  const items = loadHomework();
  const target = items.find((item) => item.id === homeworkId);
  if (!target) return;
  const updated = items.map((item) =>
    item.id === homeworkId
      ? {
          ...item,
          surahGrades: {
            ...(item.surahGrades ?? {}),
            [String(surah)]: { score, feedback: feedback.trim(), gradedAt: Date.now() },
          },
        }
      : item,
  );
  saveHomework(updated);
  addNotification({
    recipientId: target.studentId,
    kind: "evaluation",
    title: `تقييم سورة ${surah}`,
    body: `قيّم معلمك تسميعك في سورة ${surah}: ${score} من ٥ نجوم.`,
    target: "homework",
  });
  void notifyAccounts(
    [target.studentId],
    {
      title: `تقييم سورة ${surah}`,
      body: `قيّم معلمك تسميعك في سورة ${surah}: ${score} من ٥ نجوم.`,
      url: "/homework",
      tag: `homework-${target.id}`,
    },
    { senderId: target.teacherId, kind: "homework" },
  );
}

export function addSubmission(
  input: Omit<Submission, "id" | "createdAt">,
): Submission {
  const submission: Submission = {
    ...input,
    id: id("sub"),
    createdAt: Date.now(),
  };
  saveSubmissions([...loadSubmissions(), submission]);
  void pushSubmissions([submission]);
  addNotification({
    recipientId: input.teacherId,
    kind: "homework",
    title: "تسميع جديد بانتظار التصحيح",
    body: "أرسل أحد طلابك تسميعًا جديدًا.",
    target: "homework",
  });
  return submission;
}

export function evaluateSubmission(
  submissionId: string,
  score: number,
  feedback: string,
): void {
  const submissions = loadSubmissions();
  const target = submissions.find((item) => item.id === submissionId);
  const updated = submissions.map((submission) =>
    submission.id === submissionId
      ? {
          ...submission,
          score,
          feedback,
          reviewedAt: Date.now(),
        }
      : submission,
  );
  saveSubmissions(updated);
  /* التصحيح يُحفظ على الخادم أولًا فلا يُستبدل بتسليم غير مصحح. */
  void gradeSubmissionInCloud(submissionId, score, feedback);
  if (target) {
    addNotification({
      recipientId: target.studentId,
      kind: "evaluation",
      title: "تم تصحيح تسميعك",
      body: `تقييم المعلم: ${score} من ٥ نجوم. ${feedback ? "راجع ملاحظاته." : ""}`,
      target: "homework",
    });
  }
}

export function ensureHomeworkSeeds(): void {
  if (loadHomework().length > 0) return;
  const accounts = loadAccountsFromLocalStorage();
  const teacher = accounts.find((item) => item.username === "teacher");
  const student = accounts.find((item) => item.username === "student");
  const sara = accounts.find((item) => item.username === "sara");
  const yousef = accounts.find((item) => item.username === "yousef");
  if (!teacher || !student) return;

  const now = Date.now();
  const day = 86400000;
  const items: Homework[] = [
    {
      id: "hw-1",
      teacherId: teacher.id,
      studentId: student.id,
      surah: 78,
      fromAyah: 1,
      toAyah: 10,
      farPastSurah: 107,
      nearPastSurah: 105,
      method: "audio",
      dueAt: now + day,
      notes: "ركّز على المدود في الآيات الأولى، وأرسل التسميع قبل المغرب.",
      createdAt: now - day,
    },
    {
      id: "hw-2",
      teacherId: teacher.id,
      studentId: sara?.id ?? student.id,
      surah: 67,
      fromAyah: 1,
      toAyah: 5,
      farPastSurah: 68,
      nearPastSurah: 68,
      method: "photo",
      dueAt: now + 2 * day,
      notes: "أرسل صورة من اللوح بعد الحفظ.",
      createdAt: now - day,
    },
    {
      id: "hw-3",
      teacherId: teacher.id,
      studentId: yousef?.id ?? student.id,
      surah: 80,
      fromAyah: 1,
      toAyah: 8,
      farPastSurah: 79,
      nearPastSurah: 79,
      method: "live",
      dueAt: now - day / 2,
      notes: "تسميع مباشر مع المعلم بعد العصر.",
      createdAt: now - 2 * day,
    },
  ];
  saveHomework(items);

  const seeds: Submission[] = [
    {
      id: "sub-1",
      homeworkId: "hw-1",
      studentId: student.id,
      teacherId: teacher.id,
      kind: "audio",
      note: "تسميع سورة النبأ ١–١٠",
      duration: 74,
      createdAt: now - 3600000,
    },
    {
      id: "sub-2",
      homeworkId: "hw-1",
      studentId: student.id,
      teacherId: teacher.id,
      kind: "audio",
      score: 4,
      feedback: "حفظ جيد، انتبه للمد المتصل في الآية الثالثة.",
      duration: 68,
      createdAt: now - day * 2,
      reviewedAt: now - day * 2 + 3600000,
    },
    {
      id: "sub-3",
      homeworkId: "hw-2",
      studentId: sara?.id ?? student.id,
      teacherId: teacher.id,
      kind: "photo",
      note: "صورة اللوح",
      score: 5,
      feedback: "ما شاء الله، إتقان ممتاز.",
      createdAt: now - day * 3,
      reviewedAt: now - day * 3 + 7200000,
    },
    {
      id: "sub-4",
      homeworkId: "hw-3",
      studentId: yousef?.id ?? student.id,
      teacherId: teacher.id,
      kind: "live",
      score: 2,
      feedback: "يحتاج مراجعة القريب مرتين قبل التسميع القادم.",
      createdAt: now - day * 4,
      reviewedAt: now - day * 4 + 5400000,
    },
    {
      id: "sub-5",
      homeworkId: "",
      studentId: student.id,
      teacherId: teacher.id,
      kind: "audio",
      score: 3,
      feedback: "جيد، مع تكرار الآية السابعة.",
      createdAt: now - day * 5,
      reviewedAt: now - day * 5 + 3600000,
    },
    {
      id: "sub-6",
      homeworkId: "",
      studentId: student.id,
      teacherId: teacher.id,
      kind: "audio",
      score: 5,
      feedback: "تسميع متقن وأداء جميل.",
      createdAt: now - day * 8,
      reviewedAt: now - day * 8 + 3600000,
    },
    {
      id: "sub-7",
      homeworkId: "",
      studentId: sara?.id ?? student.id,
      teacherId: teacher.id,
      kind: "audio",
      score: 4,
      feedback: "ممتاز، مع مراجعة المد اللازم.",
      createdAt: now - day * 6,
      reviewedAt: now - day * 6 + 4000000,
    },
  ];
  saveSubmissions(seeds);
}

/* ---------------- الألعاب ---------------- */

export type GameProgress = {
  points: number;
  bestStreak: number;
  stars: Record<string, number>;
  levelCleared?: Record<string, boolean>;
  dailyDate?: string;
  history: Array<{
    mode: string;
    level: string;
    points: number;
    stars: number;
    at: number;
  }>;
};

export type RecitationAttempt = {
  id: string;
  at: number;
  surah: number;
  surahName: string;
  ayah: number;
  ayahNumber: number;
  score: number;
  matched: number;
  total: number;
  confidence: "high" | "medium" | "low";
  transcript: string;
  expectedText: string;
  level?: string;
  source: "games" | "coach";
};

const RECITATION_ATTEMPTS_PREFIX = "thimar.recitation.v1.";

function recitationAttemptsKey(studentId: string): string {
  return `${RECITATION_ATTEMPTS_PREFIX}${studentId}`;
}

export function loadRecitationAttempts(studentId: string): RecitationAttempt[] {
  if (!studentId) return [];
  const stored = safeParse<RecitationAttempt[]>(
    localStorage.getItem(recitationAttemptsKey(studentId)),
    [],
  );
  return Array.isArray(stored)
    ? stored.filter((attempt) => attempt && typeof attempt.score === "number").sort((a, b) => b.at - a.at)
    : [];
}

export function saveRecitationAttempt(
  studentId: string,
  attempt: RecitationAttempt,
): RecitationAttempt[] {
  if (!studentId) return [];
  const next = [attempt, ...loadRecitationAttempts(studentId)].slice(0, 120);
  localStorage.setItem(recitationAttemptsKey(studentId), JSON.stringify(next));
  return next;
}

const GAMES_KEY = "thimar.games.v1";
const GAMES_KEY_PREFIX = "thimar.games.v2.";
const GAMES_LEGACY_OWNER_KEY = "thimar.games.v2.legacy-owner";

export function emptyGameProgress(): GameProgress {
  return {
    points: 0,
    bestStreak: 0,
    stars: {},
    levelCleared: {},
    history: [],
  };
}

function gameProgressKey(studentId: string): string {
  return `${GAMES_KEY_PREFIX}${studentId}`;
}

export function loadGameProgress(studentId: string): GameProgress {
  if (!studentId) return emptyGameProgress();
  return safeParse<GameProgress>(
    localStorage.getItem(gameProgressKey(studentId)),
    emptyGameProgress(),
  );
}

export function saveGameProgress(studentId: string, progress: GameProgress): void {
  if (!studentId) return;
  localStorage.setItem(gameProgressKey(studentId), JSON.stringify(progress));
}

/** ينقل تقدّم النسخة القديمة المشتركة إلى أول طالب يسجّل الدخول، مرة واحدة فقط. */
export function migrateLegacyGameProgress(studentId: string): void {
  if (!studentId) return;
  const target = gameProgressKey(studentId);
  if (localStorage.getItem(target)) return;
  if (localStorage.getItem(GAMES_LEGACY_OWNER_KEY)) {
    localStorage.removeItem(GAMES_KEY);
    return;
  }
  const legacy = localStorage.getItem(GAMES_KEY);
  if (!legacy) return;
  localStorage.setItem(target, legacy);
  localStorage.setItem(GAMES_LEGACY_OWNER_KEY, studentId);
  localStorage.removeItem(GAMES_KEY);
}

export function linkStudentToTeacher(studentUsername: string, teacherAccountId: string): { ok: boolean; message: string } {
  const accounts = loadAccountsFromLocalStorage();
  const studentIndex = accounts.findIndex(
    (account) => account.type === "student" && account.username.toLowerCase() === studentUsername.trim().toLowerCase(),
  );
  if (studentIndex < 0) return { ok: false, message: "لم يتم العثور على طالب بهذا الاسم." };
  const teacher = accounts.find((account) => account.id === teacherAccountId && account.type === "teacher");
  if (!teacher) return { ok: false, message: "المعلم غير موجود." };
  const student = accounts[studentIndex];
  accounts[studentIndex] = {
    ...student,
    student: {
      track: student.student?.track ?? "quran",
      tuhfaLastVerse: student.student?.tuhfaLastVerse ?? null,
      surahs: student.student?.surahs ?? [],
      juz: student.student?.juz ?? [],
      level: student.student?.level ?? "A1",
      needsTeacher: student.student?.needsTeacher ?? true,
      teacherId: student.student?.teacherId ?? null,
      ...student.student,
      teacherAccountId,
      birthDate: student.student?.birthDate ?? null,
    },
  };
  localStorage.setItem("thimar.accounts.v1", JSON.stringify(accounts));
  addNotification({
    recipientId: student.id,
    kind: "system",
    title: "تم ربطك بمعلم",
    body: `تم ربط حسابك بالمعلم ${teacher.fullName}.`,
  });
  addNotification({
    recipientId: teacherAccountId,
    kind: "system",
    title: "طالب جديد",
    body: `تم ربط الطالب ${student.fullName} بحسابك.`,
  });
  return { ok: true, message: `تم ربط الطالب ${student.fullName} بنجاح.` };
}

export function linkStudentsToGuardian(guardianId: string, usernames: string[]): { ok: boolean; message: string } {
  const accounts = loadAccountsFromLocalStorage();
  const guardianIndex = accounts.findIndex((account) => account.id === guardianId && account.type === "guardian");
  if (guardianIndex < 0) return { ok: false, message: "حساب ولي الأمر غير موجود." };
  const clean = [...new Set(usernames.map((u) => u.trim().toLowerCase()).filter(Boolean))];
  const found = accounts.filter((account) => account.type === "student" && clean.includes(account.username.toLowerCase()));
  const guardian = accounts[guardianIndex];
  accounts[guardianIndex] = {
    ...guardian,
    guardian: {
      linkedStudent: found[0]?.username ?? "",
      studentUsernames: found.map((item) => item.username),
      birthDate: guardian.guardian?.birthDate ?? null,
    },
  };
  localStorage.setItem("thimar.accounts.v1", JSON.stringify(accounts));
  const missing = clean.filter((u) => !found.some((f) => f.username.toLowerCase() === u));
  if (found.length === 0) return { ok: false, message: "لم يتم العثور على أي طالب بهذه الأسماء." };
  return {
    ok: true,
    message: `تم ربط ${found.length} طالب/طالبة.${missing.length ? ` أسماء غير موجودة: ${missing.join("، ")}` : ""}`,
  };
}

/* ---------------- تصدير العناصر ---------------- */

/* ---------------- دوال التقارير والبحث ---------------- */

export function studentsOfTeacher(teacherId: string): Account[] {
  try {
    const accounts = loadAccounts();
    return accounts.filter((a) => a.type === "student" && (a.student as any)?.teacherAccountId === teacherId);
  } catch {
    return [];
  }
}

export function childrenOfGuardian(account: Account): Account[] {
  try {
    const accounts = loadAccountsFromLocalStorage();
    const guardian = accounts.find((a) => a.id === account.id);
    const usernames = (guardian?.guardian as any)?.studentUsernames ?? [];
    return accounts.filter((a) => a.type === "student" && usernames.includes(a.username));
  } catch {
    return [];
  }
}

export function latestSubmissionOf(studentId: string): Submission | undefined {
  const subs = loadSubmissions().filter((s) => s.studentId === studentId).sort((a, b) => b.createdAt - a.createdAt);
  return subs[0];
}

export function averageScore(studentId: string): number {
  const subs = loadSubmissions().filter((s) => s.studentId === studentId && typeof s.score === "number");
  if (subs.length === 0) return 0;
  return subs.reduce((sum, s) => sum + (s.score ?? 0), 0) / subs.length;
}

export function scoreTrend(studentId: string): "up" | "down" | "stable" {
  const subs = loadSubmissions().filter((s) => s.studentId === studentId && typeof s.score === "number").sort((a, b) => b.createdAt - a.createdAt);
  if (subs.length < 2) return "stable";
  const recent = subs[0].score ?? 0;
  const previous = subs[1].score ?? 0;
  if (recent > previous) return "up";
  if (recent < previous) return "down";
  return "stable";
}

export function clearDemoData(): void {
  try {
    localStorage.removeItem("thimar.accounts.v1");
    localStorage.removeItem("thimar.chat.v1");
    localStorage.removeItem("thimar.notifications.v1");
    localStorage.removeItem("thimar.homework.v1");
    localStorage.removeItem("thimar.submissions.v1");
  } catch {}
}

/* ---------------- دوال المحادثات ---------------- */

export function sendChatMessage(
  conversationId: string,
  message: any,
  options: { silent?: boolean } = {},
): void {
  const conversations = loadChats();
  const conv = conversations.find((c) => c.id === conversationId);
  if (!conv) return;
  const messageId = String(message.id ?? `msg-${Math.random().toString(36).slice(2, 10)}`);
  if (conv.messages.some((item) => item.id === messageId)) return;
  conv.messages.push({
    id: messageId,
    senderId: message.senderId,
    kind: message.kind || "text",
    text: message.text,
    audioUrl: message.audioUrl,
    duration: message.duration,
    fileName: message.fileName,
    createdAt: Number(message.createdAt ?? Date.now()),
  });
  saveChats(conversations);
  /* ارفع الرسالة فورًا بدل انتظار دورة المزامنة الدورية. بدون هذا كانت
     الرسالة تبقى محلية إن أغلق المرسل التطبيق قبل دورة السحب التالية، فلا
     تصل إلى الطرف الآخر أبدًا. */
  void pushChats([conv]).catch(() => undefined);

  // إشعار فوري على أجهزة بقية الأعضاء — يصل من الخادم حتى والتطبيق مغلق.
  // رسائل المكالمة تُحفظ بصمت لأن الطرفين داخل المكالمة أصلًا.
  // تُحترم conversations mutedBy: الأعضاء الذين كتموا المحادثة لا يُخطَرون.
  const muted = new Set(conv.mutedBy ?? []);
  const recipients = options.silent
    ? []
    : conv.memberIds.filter((memberId) => memberId && memberId !== message.senderId && !muted.has(memberId));
  if (loadSettings().notifications !== false && recipients.length) {
    const sender = loadAccounts().find((item) => item.id === message.senderId);
    const preview =
      message.kind === "audio"
        ? "رسالة صوتية"
        : message.kind === "file"
          ? `ملف: ${message.fileName ?? "مرفق"}`
          : String(message.text ?? "").slice(0, 120);
    void notifyAccounts(
      recipients,
      {
        title: conv.isGroup
          ? `${sender?.fullName ?? "عضو"} • ${conv.title}`
          : sender?.fullName ?? "ثمار",
        body: loadSettings().messagePreview === false ? "رسالة جديدة" : (preview || "رسالة جديدة"),
        // الضغط على الإشعار يفتح المحادثة نفسها لا الصفحة الرئيسية.
        url: `/messages?c=${conv.id}`,
        tag: `chat-${conv.id}`,
      },
      { senderId: message.senderId, kind: "chat", conversationId: conv.id },
    );
  }
}

/* عدد الرسائل غير المقروءة في محادثة معيّنة (لحساب معيّن). */
export function unreadMessagesForConversation(conversation: Conversation, accountId: string): number {
  return conversation.messages.filter(
    (message) => message.senderId !== accountId && !(message.readBy ?? []).includes(accountId),
  ).length;
}

/* عدد الرسائل غير المقروءة لحساب: ما أرسله غيره ولم يُضَف بعد إلى قائمة من شاهدها. */
export function unreadMessagesFor(accountId: string): number {
  return loadChats()
    .filter((conversation) => conversation.memberIds.includes(accountId))
    .reduce(
      (total, conversation) =>
        total +
        conversation.messages.filter(
          (message) => message.senderId !== accountId && !(message.readBy ?? []).includes(accountId),
        ).length,
      0,
    );
}

/** يعلّم رسائل المحادثة كمقروءة لهذا العضو ويحفظها (فتشاهدها بقية الأجهزة). */
export function markChatRead(conversationId: string, userId: string): void {
  const conversations = loadChats();
  const conv = conversations.find((item) => item.id === conversationId);
  if (!conv) return;
  let changed = false;
  conv.messages = conv.messages.map((message) => {
    if (message.senderId === userId) return message;
    const readBy = message.readBy ?? [];
    if (readBy.includes(userId)) return message;
    changed = true;
    return { ...message, readBy: [...readBy, userId] };
  });
  if (changed) saveChats(conversations);
}

export function createConversation(title: string, memberIds: string[], creatorId: string): Conversation {
  const conversations = loadChats();
  const newConv: Conversation = {
    id: `conv-${Math.random().toString(36).slice(2, 10)}`,
    title,
    isGroup: memberIds.length > 1,
    memberIds: [...new Set([creatorId, ...memberIds])],
    admins: [creatorId],
    createdBy: creatorId,
    createdAt: Date.now(),
    messages: [],
  };
  conversations.push(newConv);
  saveChats(conversations);
  return newConv;
}

/** يحذف رسالة من المحادثة ومن قاعدة البيانات. */
export function deleteChatMessage(conversationId: string, messageId: string): void {
  const conversations = loadChats();
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) return;
  conversation.messages = conversation.messages.filter((message) => message.id !== messageId);
  saveChats(conversations);
  void deleteMessagesFromCloud([messageId]);
}

/** يحذف المحادثة كاملة من هذا الجهاز ومن قاعدة البيانات. */
export function deleteConversation(conversationId: string): void {
  localStorage.setItem(
    CHAT_KEY,
    JSON.stringify(loadChats().filter((item) => item.id !== conversationId)),
  );
  void deleteConversationFromCloud(conversationId);
}

export function addConversationMember(conversationId: string, memberId: string): void {
  const conversations = loadChats();
  const conv = conversations.find((c) => c.id === conversationId);
  if (!conv) return;
  if (!conv.memberIds.includes(memberId)) {
    conv.memberIds.push(memberId);
  }
  saveChats(conversations);
}

export function removeConversationMember(conversationId: string, memberId: string): void {
  const conversations = loadChats();
  const conv = conversations.find((c) => c.id === conversationId);
  if (!conv) return;
  conv.memberIds = conv.memberIds.filter((id) => id !== memberId);
  saveChats(conversations);
}

export function setConversationMuted(conversationId: string, userId: string, muted: boolean): void {
  const conversations = loadChats();
  const conv = conversations.find((item) => item.id === conversationId);
  if (!conv) return;
  const set = new Set(conv.mutedBy ?? []);
  if (muted) set.add(userId);
  else set.delete(userId);
  conv.mutedBy = [...set];
  saveChats(conversations);
  void pushChats([conv]);
}

export function setConversationAdmin(conversationId: string, memberId: string, isAdmin: boolean): void {
  const conversations = loadChats();
  const conv = conversations.find((c) => c.id === conversationId);
  if (!conv) return;
  if (!conv.admins) conv.admins = [conv.createdBy];
  if (isAdmin) {
    if (!conv.admins.includes(memberId)) conv.admins.push(memberId);
  } else {
    conv.admins = conv.admins.filter((id) => id !== memberId);
  }
  saveChats(conversations);
}

export function logLogin(_account: Account): void {
  // Just a no-op for now, could add notification
}

/* ---------------- أيام الدخول والنقاط ---------------- */

const LOGIN_DAYS_PREFIX = "thimar.loginDays.v1.";

function loginDaysKey(accountId: string): string {
  return `${LOGIN_DAYS_PREFIX}${accountId}`;
}

function todayKey(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

/** يسجّل دخول اليوم ويحسب الأيام المتتالية. */
export function recordLoginDay(accountId: string): number {
  if (!accountId) return 0;
  const stored = safeParse<{ last: string; days: number }>(
    localStorage.getItem(loginDaysKey(accountId)),
    { last: "", days: 0 },
  );
  const today = todayKey();
  if (stored.last === today) return stored.days;
  const days = stored.last === todayKey(-1) ? stored.days + 1 : 1;
  localStorage.setItem(loginDaysKey(accountId), JSON.stringify({ last: today, days }));
  return days;
}

/**
 * يرسل رسالة تلقائية من المعلم للطالب إذا لم يدخل التطبيق في اليوم السابق.
 * تُرسل مرة واحدة فقط لكل يوم غياب.
 */
export function sendAbsenceFollowUp(account: Account): boolean {
  if (account.type !== "student") return false;
  const teacherId = account.student?.teacherAccountId || account.student?.teacherId;
  if (!teacherId) return false;
  const stored = safeParse<{ last: string; days: number }>(
    localStorage.getItem(loginDaysKey(account.id)),
    { last: "", days: 0 },
  );
  if (!stored.last || stored.last >= todayKey(-1)) return false;
  const markerKey = `thimar.absenceFollowUp.v1.${account.id}`;
  if (localStorage.getItem(markerKey) === todayKey()) return false;
  const teacher = loadAccounts().find((item) => item.id === teacherId);
  if (!teacher) return false;
  let chats = loadChats();
  let conversation = chats.find(
    (item) =>
      !item.isGroup &&
      item.memberIds.length === 2 &&
      item.memberIds.includes(account.id) &&
      item.memberIds.includes(teacher.id),
  );
  if (!conversation) {
    ensureDirectConversation(teacher, account);
    chats = loadChats();
    conversation = chats.find(
      (item) =>
        !item.isGroup &&
        item.memberIds.includes(account.id) &&
        item.memberIds.includes(teacher.id),
    );
  }
  if (!conversation) return false;
  conversation.messages.push(
    makeMessage(
      teacher.id,
      "لم نرَك أمس في التطبيق. افتح «المهمات» وسمّع وردك اليوم حتى لا يتأخر تقدمك، ونحن هنا إن احتجت مساعدة.",
    ),
  );
  saveChats(chats);
  localStorage.setItem(markerKey, todayKey());
  return true;
}

/** عدد أيام الدخول المتتالية الحالية. */
export function loginDaysOf(accountId: string): number {
  if (!accountId) return 0;
  const stored = safeParse<{ last: string; days: number }>(
    localStorage.getItem(loginDaysKey(accountId)),
    { last: "", days: 0 },
  );
  if (stored.last === todayKey() || stored.last === todayKey(-1)) return stored.days;
  return 0;
}

/** يضيف نقاطًا إلى رصيد الطالب ويعيد الرصيد الجديد. */
export function addPoints(accountId: string, points: number): number {
  if (!accountId || points <= 0) return 0;
  const progress = loadGameProgress(accountId);
  const next: GameProgress = { ...progress, points: progress.points + Math.round(points) };
  saveGameProgress(accountId, next);
  return next.points;
}

/* ---------------- طلبات ربط الطالب بالمعلم ---------------- */

export type TeacherLinkRequest = {
  id: string;
  studentId: string;
  studentName: string;
  studentUsername: string;
  teacherId: string;
  teacherName: string;
  createdAt: number;
  status: "pending" | "approved" | "rejected";
};

const LINK_REQUEST_KEY = CLOUD_KEYS.teacherLinks;

export function loadTeacherLinkRequests(): TeacherLinkRequest[] {
  const list = safeParse<TeacherLinkRequest[]>(localStorage.getItem(LINK_REQUEST_KEY), []);
  return Array.isArray(list) ? list : [];
}

function saveTeacherLinkRequests(list: TeacherLinkRequest[]): void {
  const kept = list.slice(-300);
  localStorage.setItem(LINK_REQUEST_KEY, JSON.stringify(kept));
  void pushLinkRequests(kept);
}

export function teacherLinkRequestsFor(teacherId: string): TeacherLinkRequest[] {
  return loadTeacherLinkRequests()
    .filter((request) => request.teacherId === teacherId && request.status === "pending")
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function pendingTeacherRequestOf(studentId: string): TeacherLinkRequest | undefined {
  return loadTeacherLinkRequests().find(
    (request) => request.studentId === studentId && request.status === "pending",
  );
}

export function requestTeacherLink(
  student: Pick<Account, "id" | "fullName" | "username" | "student">,
  teacherUsername: string,
): { ok: boolean; message: string } {
  const username = teacherUsername.trim().toLowerCase();
  if (!username) return { ok: false, message: "اكتب اسم مستخدم المعلم." };
  const teacher = loadAccounts().find(
    (item) => item.type === "teacher" && item.username.toLowerCase() === username,
  );
  if (!teacher) return { ok: false, message: "لا يوجد معلم بهذا الاسم. تأكد من اسم المستخدم." };
  if (teacher.status !== "active") return { ok: false, message: "حساب هذا المعلم لم يُعتمد بعد." };
  if (student.student?.teacherAccountId === teacher.id) {
    return { ok: false, message: "أنت مرتبط بهذا المعلم بالفعل." };
  }
  const pending = pendingTeacherRequestOf(student.id);
  if (pending && pending.teacherId === teacher.id) {
    return { ok: false, message: "طلبك قيد المراجعة عند هذا المعلم." };
  }
  const request: TeacherLinkRequest = {
    id: id("tlink"),
    studentId: student.id,
    studentName: student.fullName,
    studentUsername: student.username,
    teacherId: teacher.id,
    teacherName: teacher.fullName,
    createdAt: Date.now(),
    status: "pending",
  };
  saveTeacherLinkRequests([...loadTeacherLinkRequests(), request]);
  addNotification({
    recipientId: teacher.id,
    kind: "teacher",
    title: "طلب ربط طالب جديد",
    body: `${student.fullName} (@${student.username}) يطلب الارتباط بك. اضغط لاختيار «نعم» أو «لا».`,
    target: "notifications",
    action: "teacher-link",
  });
  return { ok: true, message: `أُرسل الطلب إلى ${teacher.fullName}. ستظهر النتيجة في إشعاراتك.` };
}

export function respondTeacherLinkRequest(
  requestId: string,
  approve: boolean,
): { ok: boolean; message: string } {
  const list = loadTeacherLinkRequests();
  const request = list.find((item) => item.id === requestId);
  if (!request || request.status !== "pending") return { ok: false, message: "الطلب غير متاح." };
  request.status = approve ? "approved" : "rejected";
  saveTeacherLinkRequests(list);
  if (approve) {
    const student = loadAccounts().find((item) => item.id === request.studentId);
    if (student) {
      updateAccount(student.id, {
        student: {
          track: student.student?.track ?? "quran",
          tuhfaLastVerse: student.student?.tuhfaLastVerse ?? null,
          surahs: student.student?.surahs ?? [],
          juz: student.student?.juz ?? [],
          level: student.student?.level ?? "a1",
          needsTeacher: false,
          teacherId: request.teacherId,
          teacherAccountId: request.teacherId,
          birthDate: student.student?.birthDate ?? null,
        },
      });
    }
  }
  addNotification({
    recipientId: request.studentId,
    kind: "teacher",
    title: approve ? "تم قبول طلب الربط" : "تم رفض طلب الربط",
    body: approve
      ? `قبل المعلم ${request.teacherName} طلبك، وأصبح مرتبطًا بك. يمكنكما الآن التراسل وإرسال المهمات.`
      : `اعتذر المعلم ${request.teacherName} عن ربط حسابك.`,
    target: approve ? "messages" : "notifications",
  });
  if (approve) {
    // محادثة مباشرة بين المعلم والطالب ليتمكنا من التحدث فور الموافقة.
    const teacher = loadAccounts().find((item) => item.id === request.teacherId);
    const student = loadAccounts().find((item) => item.id === request.studentId);
    if (teacher && student) ensureDirectConversation(teacher, student);
  }
  return {
    ok: true,
    message: approve ? `تم قبول ${request.studentName}.` : `تم رفض طلب ${request.studentName}.`,
  };
}

/* ---------------- طلبات ربط ولي الأمر بالطالب ---------------- */

export type GuardianLinkRequest = {
  id: string;
  guardianId: string;
  guardianName: string;
  studentId: string;
  studentName: string;
  studentUsername: string;
  createdAt: number;
  status: "pending" | "approved" | "rejected";
};

const GUARDIAN_LINK_KEY = CLOUD_KEYS.guardianLinks;

export function loadGuardianLinkRequests(): GuardianLinkRequest[] {
  const list = safeParse<GuardianLinkRequest[]>(localStorage.getItem(GUARDIAN_LINK_KEY), []);
  return Array.isArray(list) ? list : [];
}

function saveGuardianLinkRequests(list: GuardianLinkRequest[]): void {
  const kept = list.slice(-300);
  localStorage.setItem(GUARDIAN_LINK_KEY, JSON.stringify(kept));
  void pushLinkRequests(kept);
}

/** الطلبات المعلّقة التي تنتظر موافقة هذا الطالب. */
export function guardianLinkRequestsFor(studentId: string): GuardianLinkRequest[] {
  return loadGuardianLinkRequests()
    .filter((request) => request.studentId === studentId && request.status === "pending")
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** يعيد طلب ولي الأمر المعلّق لهذا الطالب (إن وجد). */
export function pendingGuardianRequestFor(studentId: string): GuardianLinkRequest | undefined {
  return guardianLinkRequestsFor(studentId)[0];
}

/** يرسل ولي الأمر طلب ربط لطالب حقيقي، ولا يُربط إلا بعد موافقة الطالب. */
export function requestGuardianLink(
  guardian: Pick<Account, "id" | "fullName" | "guardian">,
  studentUsername: string,
): { ok: boolean; message: string } {
  const username = studentUsername.trim().toLowerCase().replace(/^@/, "");
  if (!username) return { ok: false, message: "اكتب اسم مستخدم الطالب." };
  const accounts = loadAccounts();
  const student = accounts.find(
    (item) => item.type === "student" && item.username.toLowerCase() === username,
  );
  if (!student) return { ok: false, message: "لا يوجد طالب بهذا الاسم. تأكد من اسم المستخدم." };
  if ((guardian.guardian?.studentUsernames ?? []).includes(student.username)) {
    return { ok: false, message: "هذا الطالب مرتبط بك بالفعل." };
  }
  const pending = loadGuardianLinkRequests().find(
    (request) =>
      request.guardianId === guardian.id &&
      request.studentId === student.id &&
      request.status === "pending",
  );
  if (pending) return { ok: false, message: "طلبك لهذا الطالب قيد انتظار موافقته." };

  saveGuardianLinkRequests([
    ...loadGuardianLinkRequests(),
    {
      id: id("glink"),
      guardianId: guardian.id,
      guardianName: guardian.fullName,
      studentId: student.id,
      studentName: student.fullName,
      studentUsername: student.username,
      createdAt: Date.now(),
      status: "pending",
    },
  ]);
  addNotification({
    recipientId: student.id,
    kind: "system",
    title: "طلب ربط ولي أمر",
    body: `${guardian.fullName} يطلب ربطك كابن له لمتابعة تقدمك. وافق أو ارفض من هنا.`,
    target: "notifications",
    action: "guardian-link",
  });
  return { ok: true, message: `أُرسل الطلب إلى ${student.fullName}. سيظهر له في الإشعارات للموافقة أو الرفض.` };
}

/** يوافق الطالب على ربط ولي أمره أو يرفضه. */
export function respondGuardianLinkRequest(
  requestId: string,
  approve: boolean,
): { ok: boolean; message: string } {
  const list = loadGuardianLinkRequests();
  const request = list.find((item) => item.id === requestId);
  if (!request || request.status !== "pending") return { ok: false, message: "الطلب غير متاح." };
  request.status = approve ? "approved" : "rejected";
  saveGuardianLinkRequests(list);

  if (approve) {
    const guardian = loadAccounts().find((item) => item.id === request.guardianId);
    const student = loadAccounts().find((item) => item.id === request.studentId);
    if (guardian && student) {
      const usernames = new Set(guardian.guardian?.studentUsernames ?? []);
      usernames.add(student.username);
      updateAccount(guardian.id, {
        guardian: {
          linkedStudent: student.username,
          studentUsernames: [...usernames],
          birthDate: guardian.guardian?.birthDate ?? null,
        },
      });
    }
  }

  addNotification({
    recipientId: request.guardianId,
    kind: "system",
    title: approve ? "تم قبول طلب الربط" : "تم رفض طلب الربط",
    body: approve
      ? `${request.studentName} وافق على ربطك به. يمكنك الآن متابعة تقدمه.`
      : `${request.studentName} لم يوافق على طلب الربط.`,
    target: "children",
  });
  return {
    ok: true,
    message: approve ? `تم ربطك بـ ${request.studentName}.` : "تم رفض طلب الربط.",
  };
}

/** يحذف بيانات الحساب المحلية (تقدّمه وإشعاراته وملفاته على الجهاز). */
export function clearAccountData(accountId: string): void {
  if (!accountId) return;
  const keys = [
    gameProgressKey(accountId),
    recitationAttemptsKey(accountId),
    loginDaysKey(accountId),
    `thimar.memorize.plans.${accountId}.v1`,
    `thimar.robot.${accountId}.v1`,
  ];
  keys.forEach((key) => localStorage.removeItem(key));
  saveNotifications(loadNotifications().filter((item) => item.recipientId !== accountId));
  saveTeacherLinkRequests(
    loadTeacherLinkRequests().filter(
      (item) => item.studentId !== accountId && item.teacherId !== accountId,
    ),
  );
}
