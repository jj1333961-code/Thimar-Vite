import { useEffect } from "react";
import { loadSettings } from "./appStore";
import type { Lang } from "./i18n";

/**
 * طبقة ترجمة واجهة التطبيق إلى الإنجليزية.
 * تعمل بمطابقة النصوص الظاهرة حرفياً مع قاموس المصطلحات،
 * وتستثني نصوص القرآن والتحفة ورسائل المستخدم حتى لا تُمس.
 */
const DICT: Record<string, string> = {
  // عام
  "ثمار": "Thimar",
  "حفظٌ يُثمر": "Memorization that bears fruit",
  "مسؤول": "Admin",
  "معلم": "Teacher",
  "طالب": "Student",
  "ولي أمر": "Guardian",
  "الرئيسية": "Home",
  "الرسائل": "Messages",
  "الإشعارات": "Notifications",
  "الإعدادات": "Settings",
  "المهمات": "Tasks",
  "التقارير": "Reports",
  "الألغاز": "Puzzles",
  "الحفظ": "Memorization",
  "تحدي": "Challenge",
  "الأبناء": "Children",
  "رجوع": "Back",
  "إلغاء": "Cancel",
  "حفظ": "Save",
  "إرسال": "Send",
  "إغلاق": "Close",
  "بحث": "Search",
  "اليوم": "Today",
  "جارٍ التحميل…": "Loading…",
  "جارٍ…": "Loading…",
  "لا توجد بيانات": "No data",
  "تسجيل الخروج": "Sign out",
  "نقطة": "points",
  "يوم": "day",
  "إشعار": "notification",
  "إشعارات": "notifications",
  "معلمون بانتظار الاعتماد": "Teachers awaiting approval",
  "شكاوى مفتوحة": "Open complaints",
  "إشعارات غير مقروءة": "Unread notifications",
  "روابط سريعة": "Quick links",
  "القراءة الذكية": "Smart recitation",
  "مواقيت الصلاة والأذان": "Prayer times & adhan",
  "جارٍ تحديد الموقع…": "Locating…",
  "حسب موقعك الجغرافي": "Based on your location",
  "اختيار المدينة": "Choose city",
  "موقعي الحالي": "My current location",
  "اختر الأذان المناسب": "Choose adhan",
  "تشغيل الأذان": "Play adhan",
  "نغمة أذان هادئة مناسبة للاستماع اليومي.": "A calm adhan tone suitable for daily listening.",
  "المصحف": "Mushaf",
  "صفحة قراءة متصلة": "Continuous reading page",
  "تحفة الأطفال": "Tuhfat Al-Atfal",
  "النظم كاملًا بالصوت": "Full poem with audio",
  "تفسير القرآن": "Quran tafsir",
  "لكل آية": "For every verse",
  "الأحاديث": "Hadiths",
  "حديث وشرح": "Hadith & explanation",
  "الأدعية والأذكار": "Duas & adhkar",
  "أذكار متنوعة": "Various adhkar",
  "القبلة": "Qibla",
  "حسب موقعك": "Based on your location",
  "الصفحات الدراسية تُفتح في صفحة مستقلة. الأذان والمواقيت في الأعلى دائمًا.": "Study pages open separately. Prayer times stay at the top.",

  // الإعدادات
  "المظهر واللغة": "Appearance & language",
  "اللغة": "Language",
  "العربية": "Arabic",
  "الإضاءة": "Theme",
  "فاتح": "Light",
  "داكن": "Dark",
  "سيبيا": "Sepia",
  "ورقي": "Paper",
  "تقليل الحركة": "Reduce motion",
  "نعم": "Yes",
  "لا": "No",
  "المصحف والتلاوة": "Mushaf & recitation",
  "القارئ الافتراضي": "Default reciter",
  "عدد مرات التكرار": "Repeat count",
  "حجم خط المصحف": "Mushaf font size",
  "الصلاة والأذان": "Prayer & adhan",
  "طريقة حساب المواقيت": "Prayer time calculation",
  "الإشعارات والمهام": "Notifications & tasks",
  "صوت الأذان": "Adhan sound",
  "الحساب": "Account",
  "عن التطبيق": "About",
  "بيانات التجربة": "Demo data",
  "مسح بيانات التجربة": "Reset demo data",
  "تصدير نسخة من البيانات": "Export data copy",
  "تغيير كلمة المرور": "Change password",
  "كلمة المرور الحالية": "Current password",
  "كلمة المرور الجديدة": "New password",
  "حفظ التغييرات": "Save changes",
  "المهمات والتسميع": "Tasks & recitation",

  "جارٍ التحديد…": "Locating…",
  "مرحبًا،": "Welcome,",
  "مسؤول النظام": "System Admin",
  "لوحة التحكم — راقب التسجيلات والشكاوى واعتمادات المعلمين.": "Dashboard — monitor recordings, complaints and teacher approvals.",
  "حجم خط التطبيق": "App font size",
  "القرآن والصلاة": "Quran & prayer",
  "طريقة حساب الصلاة": "Prayer calculation method",
  "أم القرى (السعودية)": "Umm Al-Qura (Saudi Arabia)",
  "الهيئة المصرية العامة للمساحة": "Egyptian General Authority of Survey",
  "رابطة العالم الإسلامي": "Muslim World League",
  "الجمعية الإسلامية لأمريكا الشمالية": "Islamic Society of North America",
  "جامعة العلوم الإسلامية بكراتشي": "University of Islamic Sciences, Karachi",
  "مفعّلة": "Enabled",
  "معطّلة": "Disabled",
  "مفعّل": "Enabled",
  "معطّل": "Disabled",
  "صوت الإشعارات": "Notification sound",
  "اهتزاز": "Vibration",
  "تجربة صوت المؤذن": "Muezzin voice test",
  "تسجيلات الأذان": "Adhan recordings",
  "نغمة الأذان المناسبة": "Adhan tone",
  "أذان ١ — هادئ": "Adhan 1 — Calm",
  "أذان ٢ — واضح": "Adhan 2 — Clear",
  "أذان ٣ — طويل": "Adhan 3 — Long",
  "أذان الفجر — مشاري العفاسي": "Fajr adhan — Mishary Alafasy",
  "رفيق ثمار والذكاء الاصطناعي (Gemini)": "Thimar companion & AI (Gemini)",
  "توليد الاختبارات والألغاز، تصحيح التسميع، ردود الشكاوى، والرفيق الصوتي": "Generating quizzes and puzzles, recitation correction, complaint replies, and the voice companion",
  "ظهور رفيق ثمار على الواجهة": "Show Thimar companion",
  "ظاهر": "Visible",
  "مخفي": "Hidden",
  "حفظ مفتاح الذكاء الاصطناعي": "Save AI key",
  "اختبار الاتصال": "Test connection",
  "مسح المفتاح": "Clear key",
  "اختبار الميكروفون": "Test microphone",
  "اختبار النطق": "Test speech",
  "فحص الصوت والميكروفون": "Audio & microphone check",
  "تحويل الكلام إلى نص": "Speech to text",
  "مدعوم": "Supported",
  "النطق الآلي": "Speech synthesis",
  "صوت عربي مثبت": "Arabic voice installed",
  "اعتماد المعلمين": "Teacher approvals",
  "لا توجد طلبات": "No requests",
  "لا يوجد معلمون بانتظار الاعتماد.": "No teachers awaiting approval.",
  "إضافة مستخدم": "Add user",
  "الاسم الكامل": "Full name",
  "إضافة": "Add",
  "الشكاوى والاقتراحات": "Complaints & suggestions",
  "لا توجد شكاوى": "No complaints",
  "ستظهر هنا.": "Will appear here.",
  "المستخدمون والربط": "Users & linking",
  "أدوات المسؤول": "Admin tools",
  "تصدير البيانات": "Export data",
  "إعادة تعيين": "Reset",
  "الحساب الحالي:": "Current account:",
  "تأكيد كلمة المرور الجديدة": "Confirm new password",
  "إعادة الضبط": "Reset",
  "حساب المسؤول لا يُحذف": "The admin account cannot be deleted",
  "إعادة ضبط الإعدادات": "Reset settings",
  "إزالة البيانات المؤقتة": "Clear temporary data",
  "تحميل نطق المصحف (القرآن الكريم)": "Download Quran recitation",
  "للتسميع بدون إنترنت": "For offline recitation",
  "الحجم المطلوب:": "Required size:",
  "ميجابايت": "MB",
  "تحميل نطق تحفة الأطفال": "Download Tuhfat Al-Atfal audio",

  // الدخول
  "مرحبًا بعودتك": "Welcome back",
  "تسجيل الدخول": "Sign in",
  "اسم المستخدم": "Username",
  "كلمة المرور": "Password",
  "تذكّر هذا الجهاز": "Remember this device",
  "إنشاء حساب جديد": "Create a new account",
  "شكوى أو اقتراح": "Complaint or suggestion",
  "أو": "or",

  // المهمات
  "مهمة تسميع جديدة": "New recitation task",
  "مهمة قراءة جديدة": "New reading task",
  "التسميع": "Recitation",
  "القراءة": "Reading",
  "التسجيلات": "Recordings",
  "السجلات": "Records",
  "التسميعات": "Recitations",
  "طريقة الإجابة": "Answer method",
  "طريقة التسليم": "Submission method",
  "اللوح": "Board",
  "السورة": "Surah",
  "الماضي البعيد": "Far past",
  "الماضي القريب": "Near past",
  "آية إلى آية": "Verse to verse",
  "سورة إلى سورة": "Surah to surah",
  "من سورة": "From surah",
  "إلى سورة": "To surah",
  "من الآية": "From verse",
  "إلى الآية": "To verse",
  "السورة كاملة": "Whole surah",
  "إجبارية": "Mandatory",
  "اختيارية": "Optional",
  "نوع المهمة": "Task type",
  "ثوانٍ لكل آية (تلقائي ١)": "Seconds per verse (default 1)",
  "وقت الخروج المحسوب": "Calculated exit time",
  "تاريخ الاستحقاق": "Due date",
  "ملاحظات المعلم": "Teacher notes",
  "إرسال مهمة القراءة": "Send reading task",
  "إرسال مهمة التسميع": "Send recitation task",
  "إضافة مهمة قراءة أيضاً بنفس النطاق الأساسي": "Also add a reading task with the same range",
  "عنوان الوِرد": "Reading title",
  "ورد القراءة": "Reading portion",
  "داخل التطبيق": "In-app",
  "ملف صوتي": "Audio file",
  "فيديو": "Video",
  "نص مكتوب": "Written text",
  "تحدث هاتف": "Phone call",
  "رفع ملف": "File upload",
  "صورة": "Photo",
  "تسميع مباشر": "Live recitation",
  "الوقت المتبقي": "Time left",
  "الآيات المطلوبة": "Required verses",
  "جارٍ تحميل الآيات…": "Loading verses…",
  "تمّت القراءة": "Reading completed",
  "ابدأ التسميع في التطبيق": "Start in-app recitation",
  "افتح القرآن واقرأ": "Open the Quran and read",
  "تسليم المهمة": "Submit task",
  "سجل التسجيلات": "Recording history",
  "بانتظار التقييم": "Awaiting review",
  "بانتظار": "Pending",
  "تقييم التسجيل": "Review recording",
  "تعديل التقييم": "Edit review",
  "ملاحظات للطالب": "Notes for student",
  "تقييم المعلم": "Teacher review",
  "لا توجد مهام": "No tasks",
  "لا توجد تسجيلات": "No recordings",
  "لا توجد سجلات": "No records",
  "لا يوجد طلاب": "No students",
  "مهام": "Tasks",

  // التحدي
  "تحدَّ صديقك وجهاً لوجه على نفس الجهاز بشاشة مقسومة، أو اربط لاعبين في غرفة واحدة أونلاين. اختر الأجزاء وأنواع الأسئلة والوقت.": "Challenge a friend face to face on the same device, or play online in one room. Choose the juz, question types and time.",
  "ابدأ": "Start",
  "لعبة وجهاً لوجه (شاشة مقسومة)": "Face-to-face game (split screen)",
  "بحث سريع (خصم عشوائي)": "Quick match (random opponent)",
  "إنشاء غرفة لدعوة صديق": "Create a room to invite a friend",
  "الانضمام برمز": "Join with a code",
  "تحدي وجهاً لوجه": "Face-to-face challenge",
  "عدد اللاعبين": "Number of players",
  "اسم اللاعب": "Player name",
  "الأجزاء": "Juz",
  "تحديد الكل": "Select all",
  "أنواع الأسئلة": "Question types",
  "عدد الأسئلة": "Number of questions",
  "وقت كل سؤال (ث)": "Time per question (s)",
  "ابدأ التحدي": "Start challenge",
  "النتائج": "Results",
  "نتيجة التحدي": "Challenge result",
  "لوحة المتصدرين": "Leaderboard",
  "الإجابة الصحيحة": "Correct answer",
  "الصحيح": "Correct",
  "إنهاء": "End",
  "إنهاء التحدي وعرض النتيجة": "End challenge and show result",
  "اكشف الإجابة وانتقل": "Reveal answer and continue",
  "رجوع إلى القائمة": "Back to menu",
  "تحدٍ جديد": "New challenge",
  "القائمة": "Menu",
  "غرفة": "Room",
  "اللاعبون": "Players",
  "شارك الرمز": "Share the code",
  "بدء التحدّي": "Start challenge",
  "في انتظار المضيف لبدء التحدّي…": "Waiting for the host to start…",
  "تمرين": "Practice",

  // الحفظ
  "خطة حفظ — القرآن الكريم": "Memorization plan — Quran",
  "أول آية تريد حفظها": "First verse to memorize",
  "مقدار الحفظ في كل خطة (عدد الآيات)": "Amount per plan (verses)",
  "هل حفظتها من قبل؟": "Memorized before?",
  "نعم — تحتاج مراجعة": "Yes — needs review",
  "هل تريدها مجوّدة؟": "Want it with tajweed?",
  "القارئ": "Reciter",
  "السرعة": "Speed",
  "التكرار": "Repeat",
  "ابدأ — إنشاء الخطة": "Start — create plan",
  "مرات": "times",
  "اختر ما تريد حفظه": "Choose what to memorize",
  "القرآن الكريم": "The Holy Quran",
  "خطة الحفظ": "Memorization plan",
  "المراجعة": "Review",
  "الاختبار": "Test",
  "التالي": "Next",
  "السابق": "Previous",
  "ابدأ الحفظ": "Start memorizing",
  "أعد المحاولة": "Try again",
  "النتيجة": "Result",
  "التقدم": "Progress",
  "أخطاء": "Errors",
  "كلمات صحيحة": "Correct words",

  // الرسائل والإشعارات
  "محادثة": "Conversation",
  "المحادثات": "Conversations",
  "اكتب رسالة…": "Type a message…",
  "إرسال ملف": "Send file",
  "تسجيل صوتي": "Voice recording",
  "رفع": "Upload",
  "تحديد الكل كمقروء": "Mark all as read",
  "لا توجد إشعارات": "No notifications",
  "لا توجد رسائل": "No messages",
  "الأبناء المرتبطون": "Linked children",
  "ربط الأبناء": "Link children",

  // التقارير
  "تقييم الأبناء": "Children evaluation",
  "متوسط التقييم": "Average score",
  "آخر تقييم": "Latest score",
  "واجبات": "Homework",
  "سجل التسميع": "Recitation log",
  "التسليمات": "Submissions",

  // صفحات الدراسة
  "المصحف والتسميع": "Mushaf & recitation",
  "التفسير": "Tafsir",
  "الأحاديث والأذكار": "Hadiths & adhkar",
  "القبلة والمواقيت": "Qibla & prayer times",
  "أرشيف": "Archive",
  "أرشيف المصحف": "Mushaf archive",
  "علامات المراجعة": "Review marks",
  "الملاحظات": "Notes",
  "لا توجد علامات.": "No marks.",
  "لا توجد ملاحظات.": "No notes.",
  "لا توجد أخطاء.": "No errors.",
  "الانتقال إلى": "Jump to",
  "بحث باسم السورة والانتقال مباشرة إلى آية": "Search by surah name and jump to a verse",
  "رقم الآية": "Verse number",
  "انتقال إلى الآية": "Jump to verse",
  "دخول المصحف": "Open Mushaf",
  "انتقال": "Go",
  "حسب": "By",
  "الجزء": "Juz",
  "جزء": "Juz",

  // الألغاز
  "رحلة الألغاز A1–A12": "Puzzle journey A1–A12",
  "مسار المستويات العامة": "General levels path",
  "المسار العام — أسئلة مختلطة من جميع الأنواع، ولا يتأثر بصندوق أنواع الأسئلة.": "General path — mixed question types; not affected by the question-types box.",
  "كل نوع مسار مستقل بنوع واحد فقط": "Each type has its own single-type path",
  "تقدمك": "Your progress",
  "النقاط": "Points",
  "أفضل سلسلة": "Best streak",
  "المستويات المكتملة": "Completed levels",
  "الجولات": "Rounds",
  "تخمين السورة": "Guess the surah",
  "أكمل الآية": "Complete the verse",
  "تحديد الجزء": "Identify the juz",
  "تفسير الآيات": "Verse tafsir",
  "تسميع صوتي": "Voice recitation",
  "صح أو خطأ": "True or false",
  "ملخص الجولة": "Round summary",
  "المستوى": "Level",
  "الأسئلة": "Questions",
  "الوقت/سؤال": "Time/question",
  "المحاولات": "Attempts",
  "المنافس": "Opponent",
  "لعب ضد ذكاء اصطناعي (AI)": "Play against AI",
  "ابدأ الامتحان": "Start exam",
  "نتيجة": "Result",
  "إعادة": "Retry",
  "متابعة": "Continue",
};

const ATTRS = ["placeholder", "title", "aria-label", "alt"];
const AR_RE = /[\u0600-\u06FF]/;
const SKIP =
  "[data-no-translate],.mushaf-page,.tasmee-reciting-container,.tasmee-screen,.quran-text,.tuhfa-page,.tuhfa-reader,.tuhfa-verse,.message p,.system-message,textarea,input,script,style,code,pre";

const originalNodes = new Map<Text, string>();
const originalAttrs: Array<{ el: Element; name: string; value: string }> = [];
let observer: MutationObserver | null = null;

function skipped(node: Node): boolean {
  let el: Element | null = node.parentElement;
  while (el) {
    try {
      if (el.matches(SKIP)) return true;
    } catch {
      /* ignore invalid selector context */
    }
    el = el.parentElement;
  }
  return false;
}

function translateText(node: Text) {
  if (skipped(node)) return;
  const raw = node.nodeValue ?? "";
  const key = raw.trim();
  if (!key || !AR_RE.test(key)) return;
  const english = DICT[key];
  if (!english) return;
  if (raw === english) return;
  if (!originalNodes.has(node)) originalNodes.set(node, raw);
  const lead = raw.match(/^\s*/)?.[0] ?? "";
  const tail = raw.match(/\s*$/)?.[0] ?? "";
  node.nodeValue = `${lead}${english}${tail}`;
}

function translateAttrs(el: Element) {
  if (skipped(el)) return;
  ATTRS.forEach((name) => {
    const value = el.getAttribute(name);
    if (!value) return;
    const key = value.trim();
    if (!AR_RE.test(key)) return;
    const english = DICT[key];
    if (!english) return;
    originalAttrs.push({ el, name, value });
    el.setAttribute(name, english);
  });
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateText(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root instanceof Element) translateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) translateText(current as Text);
    else if (current instanceof Element) translateAttrs(current);
    current = walker.nextNode();
  }
}

/** يطبّق الترجمة الإنجليزية أو يعيد النصوص الأصلية. */
export function applyAutoTranslation(lang: Lang) {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (lang !== "en") {
    originalNodes.forEach((value, node) => {
      try {
        node.nodeValue = value;
      } catch {
        /* node removed */
      }
    });
    originalNodes.clear();
    originalAttrs.forEach(({ el, name, value }) => {
      try {
        el.setAttribute(name, value);
      } catch {
        /* element removed */
      }
    });
    originalAttrs.length = 0;
    return;
  }
  if (!document.body) return;
  walk(document.body);
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "characterData") {
        translateText(mutation.target as Text);
        return;
      }
      mutation.addedNodes.forEach((node) => walk(node));
    });
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}

/** مكوّن صامت يربط ترجمة الواجهة بإعداد اللغة. */
export function TranslationLayer() {
  useEffect(() => {
    const apply = () => applyAutoTranslation(loadSettings().language);
    apply();
    window.addEventListener("thimar:settings", apply);
    return () => {
      window.removeEventListener("thimar:settings", apply);
      applyAutoTranslation("ar");
    };
  }, []);
  return null;
}
