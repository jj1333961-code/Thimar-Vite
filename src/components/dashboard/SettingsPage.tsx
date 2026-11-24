import { useEffect, useRef, useState } from "react";
import MushafOfflineCard from "./MushafOfflineCard";
import FatwaOfflineCard from "./FatwaOfflineCard";
import AppFilesCard from "./AppFilesCard";
import { loadAccounts, setAccountStatus, loadComplaints, resolveComplaint, createAccount, deleteAccount, banAccount, unbanAccount, changePassword as changeAccountPassword, type Account, type Complaint } from "../../lib/auth";
import {
  loadSettings,
  saveSettings,
  applyTheme,
  type Settings,
  type Theme,
  clearDemoData,
  requestGuardianLink,
  loadGuardianLinkRequests,
  requestTeacherLink,
  pendingTeacherRequestOf,
  clearAccountData,
  defaultSettings,
} from "../../lib/appStore";
import { fallbackCities, getCoordinates, prayerMethods } from "../../lib/islamic";
import {
  requestNotificationPermission,
  showSystemNotification,
  watchNotificationPermission,
} from "../../lib/notify";
import { serverTestPush, subscribeToPush } from "../../lib/push";

import { adhanOptions } from "../../data/adhan";
import { applyVibrationSetting, installVibrationGate } from "../../lib/sound";
import { reciters as quranReciters, ayahAudioUrl, reciterBitrate } from "../../data/reciters";
import { tuhfaVerseReciters } from "../../data/tuhfaVerseAudio";
import {
  getArabicVoice,
  hasSpeechRecognition,
  hasSpeechSynthesis,
  mediaErrorMessage,
} from "../../lib/speech";
import {
  aiChat,
  checkAiAvailability,
  clearAiConfig,
  draftComplaintReply,
  fallbackComplaintReply,
  loadAiConfig,
  saveAiConfig,
  type AiAvailability,
  type AiConfig,
} from "../../lib/ai";
import { Icon, EmptyState, SectionCard } from "./ui";
import { loadTilawa, checkTilawaReadiness, type TilawaReadinessState } from "../../lib/tilawaRecitation";
import { detectPlatform, ANDROID_UPDATE_METADATA_URL, IOS_UPDATE_METADATA_URL } from "../UpdatePrompt";
import { getInstalledVersionCode } from "../../lib/nativePush";

const QURAN_AUDIO_CACHE = "thimar-audio-v1";
const TUHFA_AUDIO_CACHE = "thimar-tuhfa-audio-v1";
const QURAN_AUDIO_BYTES_KEY = "thimar.audio.quran.bytes";
const TUHFA_AUDIO_BYTES_KEY = "thimar.audio.tuhfa.bytes";
const QURAN_TOTAL_AYAHS = 6236;
/** متوسط مدة تلاوة الآية بالثواني، يُستخدم لحساب الحجم التقديري قبل التحميل. */
const AVERAGE_AYAH_SECONDS = 8.5;

function formatSize(bytes: number): string {
  if (!bytes) return "0 ميجابايت";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} جيجابايت`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} ميجابايت`;
}

function estimateBytes(seconds: number, bitrateKbps: number): number {
  return Math.round(seconds * ((bitrateKbps * 1000) / 8));
}

export default function SettingsPage({
  account,
  onLogout,
  onOpenAdhanLog,
}: {
  account: Account;
  onLogout: () => void;
  onOpenAdhanLog?: () => void;
}) {
  const [settings, setSettings] = useState<Settings>(loadSettings());
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const adhanPreviewRef = useRef<HTMLAudioElement | null>(null);

  /* مفتاح الاهتزاز العام: يُطبّق فورًا على كل اهتزازات التطبيق. */
  useEffect(() => {
    installVibrationGate();
    applyVibrationSetting(settings.vibration);
  }, [settings.vibration]);

  useEffect(() => {
    if (!activeGroup) return;
    window.history.pushState({ thimarSettingsGroup: activeGroup }, "");
    const onPop = () => setActiveGroup(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [activeGroup]);

  useEffect(() => {
    const handler = () => {
      setActiveGroup("updates");
      setAutoCheckUpdates(true);
    };
    window.addEventListener("thimar:open-updates", handler);
    return () => window.removeEventListener("thimar:open-updates", handler);
  }, []);

  useEffect(() => {
    if (autoCheckUpdates && activeGroup === "updates") {
      setAutoCheckUpdates(false);
      void checkForUpdates();
    }
  }, [autoCheckUpdates, activeGroup]);

  const closeSettingsGroup = () => {
    if (window.history.state?.thimarSettingsGroup) window.history.back();
    else setActiveGroup(null);
  };

  const settingsGroupLabel = (id: string) =>
    ({ appearance: "المظهر", sounds: "الأذان", downloads: "التحميل", updates: "التحديثات", approvals: "الاعتماد والشكاوى", users: "المستخدمين", password: "تغير الرقم السري", ai: "الذكاء الاصطناعي" } as Record<string, string>)[id] ?? "الإعدادات";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [newUser, setNewUser] = useState({ fullName: "", username: "", password: "", type: "student" as Account["type"], birthDate: "" });
  const [newUserMsg, setNewUserMsg] = useState("");
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [linked, setLinked] = useState(account.guardian?.studentUsernames?.join(", ") ?? account.guardian?.linkedStudent ?? "");
  const [linkMessage, setLinkMessage] = useState("");
  const [teacherUsernameInput, setTeacherUsernameInput] = useState("");
  const [teacherLinkMessage, setTeacherLinkMessage] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [notifyMsg, setNotifyMsg] = useState("");
  const [serverPushMsg, setServerPushMsg] = useState("");
  const [notifyPerm, setNotifyPerm] = useState<string>(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [ai, setAi] = useState<AiAvailability>({ mode: "off" });
  const [aiConfig, setAiConfig] = useState<AiConfig>(loadAiConfig());
  const [aiSaved, setAiSaved] = useState(false);
  const [aiTest, setAiTest] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [replyTarget, setReplyTarget] = useState<Complaint | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyNotice, setReplyNotice] = useState("");
  const [micStatus, setMicStatus] = useState("");
  const [ttsStatus, setTtsStatus] = useState("");
  const [, refreshVoiceSupport] = useState(0);
  const [prayerCity, setPrayerCity] = useState(() => {
    try { return localStorage.getItem("thimar.prayer.city") ?? "auto"; } catch { return "auto"; }
  });
  const [locating, setLocating] = useState(false);
  const [locationMsg, setLocationMsg] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [quranDownloadReciter, setQuranDownloadReciter] = useState(quranReciters[0]?.id ?? "ar.alafasy");
  const [quranDownloadProgress, setQuranDownloadProgress] = useState(0);
  const [quranDownloading, setQuranDownloading] = useState(false);
  const [quranDownloaded, setQuranDownloaded] = useState(false);
  const [tuhfaDownloadProgress, setTuhfaDownloadProgress] = useState(0);
  const [tuhfaDownloading, setTuhfaDownloading] = useState(false);
  const [tuhfaDownloaded, setTuhfaDownloaded] = useState(false);
  const [quranDownloadedBytes, setQuranDownloadedBytes] = useState(0);
  const [tuhfaDownloadedBytes, setTuhfaDownloadedBytes] = useState(0);
  const [asrDownloading, setAsrDownloading] = useState(false);
  const [asrProgress, setAsrProgress] = useState(0);
  const [asrReadiness, setAsrReadiness] = useState<TilawaReadinessState>("not_downloaded");
  const [asrReadinessMessage, setAsrReadinessMessage] = useState("");
  const [asrError, setAsrError] = useState("");
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "available" | "latest" | "error">("idle");
  const [updateVersion, setUpdateVersion] = useState("");
  const [updateReleaseNotes, setUpdateReleaseNotes] = useState<any>(null);
  const [updateFileSize, setUpdateFileSize] = useState<number | null>(null);
  const [updateMessage, setUpdateMessage] = useState("");
  const quranCancelRef = useRef(false);
  const quranAbortRef = useRef<AbortController | null>(null);
  const tuhfaCancelRef = useRef(false);
  const tuhfaAbortRef = useRef<AbortController | null>(null);

  const quranSizeEstimate = estimateBytes(QURAN_TOTAL_AYAHS * AVERAGE_AYAH_SECONDS, reciterBitrate(quranDownloadReciter));
  const tuhfaSizeEstimate = estimateBytes(
    tuhfaVerseReciters.reduce((total, reciter) => total + reciter.duration, 0),
    128,
  );

  // نكتشف ما حُمّل سابقًا حتى تظهر أزرار الحذف بعد إعادة فتح الصفحة.
  useEffect(() => {
    if (!("caches" in window)) return;
    let cancelled = false;
    (async () => {
      try {
        const quranCache = await caches.open(QURAN_AUDIO_CACHE);
        const quranKeys = await quranCache.keys();
        const tuhfaCache = await caches.open(TUHFA_AUDIO_CACHE);
        const tuhfaKeys = await tuhfaCache.keys();
        if (cancelled) return;
        setQuranDownloaded(quranKeys.length >= QURAN_TOTAL_AYAHS);
        setTuhfaDownloaded(tuhfaKeys.length >= tuhfaVerseReciters.length);
        setQuranDownloadedBytes(Number(localStorage.getItem(QURAN_AUDIO_BYTES_KEY) ?? 0) || 0);
        setTuhfaDownloadedBytes(Number(localStorage.getItem(TUHFA_AUDIO_BYTES_KEY) ?? 0) || 0);
      } catch {
        // تخزين الملفات غير متاح في هذا المتصفح.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // نراقب الإذن باستمرار: إذا سمح المستخدم من إعدادات الهاتف ثم عاد للتطبيق تتحدث الحالة فورًا.
  useEffect(() => watchNotificationPermission(setNotifyPerm), []);

  // readiness لمحرك Tilawa (بدون إنترنت).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await checkTilawaReadiness();
        if (cancelled) return;
        setAsrReadiness(r.state);
        setAsrReadinessMessage(r.message ?? "");
      } catch {
        if (!cancelled) setAsrReadiness("not_downloaded");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const cancelQuranAudio = () => {
    quranCancelRef.current = true;
    quranAbortRef.current?.abort();
  };

  const cancelTuhfaAudio = () => {
    tuhfaCancelRef.current = true;
    tuhfaAbortRef.current?.abort();
  };

  const downloadQuranAudio = async () => {
    if (quranDownloading) return;
    setQuranDownloading(true);
    setQuranDownloadProgress(0);
    quranCancelRef.current = false;
    const controller = new AbortController();
    quranAbortRef.current = controller;
    let bytes = 0;
    let completed = false;
    try {
      const cache = await caches.open(QURAN_AUDIO_CACHE);
      const total = QURAN_TOTAL_AYAHS;
      const batchSize = 20;
      for (let start = 1; start <= total; start += batchSize) {
        if (quranCancelRef.current) break;
        const end = Math.min(start + batchSize - 1, total);
        const batch: Promise<void>[] = [];
        for (let g = start; g <= end; g += 1) {
          const url = ayahAudioUrl(quranDownloadReciter, g);
          batch.push(
            (async () => {
              try {
                if (await cache.match(url)) return;
                const res = await fetch(url, { signal: controller.signal });
                if (!res.ok) return;
                const size = Number(res.headers.get("content-length") ?? 0) || 0;
                await cache.put(url, res.clone());
                bytes += size;
              } catch {
                // ملف تعذّر تنزيله أو أُلغي الطلب.
              }
            })(),
          );
        }
        await Promise.all(batch);
        setQuranDownloadProgress(Math.round((end / total) * 100));
      }
      completed = !quranCancelRef.current;
    } finally {
      quranAbortRef.current = null;
      setQuranDownloading(false);
      if (completed) {
        const stored = Number(localStorage.getItem(QURAN_AUDIO_BYTES_KEY) ?? 0) || 0;
        const totalBytes = stored + bytes;
        setQuranDownloaded(true);
        setQuranDownloadedBytes(totalBytes);
        try { localStorage.setItem(QURAN_AUDIO_BYTES_KEY, String(totalBytes)); } catch { /* تجاهل */ }
      } else {
        setQuranDownloadProgress(0);
      }
    }
  };

  const deleteQuranAudio = async () => {
    if (!window.confirm("حذف نطق المصحف المحمّل من هذا الجهاز؟")) return;
    try { await caches.delete(QURAN_AUDIO_CACHE); } catch { /* تجاهل */ }
    try { localStorage.removeItem(QURAN_AUDIO_BYTES_KEY); } catch { /* تجاهل */ }
    setQuranDownloaded(false);
    setQuranDownloadedBytes(0);
    setQuranDownloadProgress(0);
  };

  const downloadTuhfaAudio = async () => {
    if (tuhfaDownloading) return;
    setTuhfaDownloading(true);
    setTuhfaDownloadProgress(0);
    tuhfaCancelRef.current = false;
    const controller = new AbortController();
    tuhfaAbortRef.current = controller;
    let bytes = 0;
    let completed = false;
    try {
      const cache = await caches.open(TUHFA_AUDIO_CACHE);
      const total = tuhfaVerseReciters.length;
      let done = 0;
      for (const reciter of tuhfaVerseReciters) {
        if (tuhfaCancelRef.current) break;
        try {
          if (!(await cache.match(reciter.url))) {
            const res = await fetch(reciter.url, { signal: controller.signal });
            if (res.ok) {
              const size = Number(res.headers.get("content-length") ?? 0) || 0;
              await cache.put(reciter.url, res.clone());
              bytes += size;
            }
          }
        } catch {
          // ملف تعذّر تنزيله أو أُلغي الطلب.
        }
        done += 1;
        setTuhfaDownloadProgress(Math.round((done / total) * 100));
      }
      completed = !tuhfaCancelRef.current;
    } finally {
      tuhfaAbortRef.current = null;
      setTuhfaDownloading(false);
      if (completed) {
        const stored = Number(localStorage.getItem(TUHFA_AUDIO_BYTES_KEY) ?? 0) || 0;
        const totalBytes = stored + bytes;
        setTuhfaDownloaded(true);
        setTuhfaDownloadedBytes(totalBytes);
        try { localStorage.setItem(TUHFA_AUDIO_BYTES_KEY, String(totalBytes)); } catch { /* تجاهل */ }
      } else {
        setTuhfaDownloadProgress(0);
      }
    }
  };

  const deleteTuhfaAudio = async () => {
    if (!window.confirm("حذف نطق تحفة الأطفال المحمّل من هذا الجهاز؟")) return;
    try { await caches.delete(TUHFA_AUDIO_CACHE); } catch { /* تجاهل */ }
    try { localStorage.removeItem(TUHFA_AUDIO_BYTES_KEY); } catch { /* تجاهل */ }
    setTuhfaDownloaded(false);
    setTuhfaDownloadedBytes(0);
    setTuhfaDownloadProgress(0);
  };

  const refreshAdmin = () => {
    setAccounts(loadAccounts());
    setComplaints(loadComplaints());
  };

  useEffect(() => {
    refreshAdmin();
  }, [account.type]);

  useEffect(() => {
    checkAiAvailability().then(setAi);
  }, []);

  useEffect(() => {
    const refresh = () => refreshVoiceSupport((value) => value + 1);
    window.speechSynthesis?.addEventListener?.("voiceschanged", refresh);
    const timer = window.setTimeout(refresh, 900);
    return () => {
      window.clearTimeout(timer);
      window.speechSynthesis?.removeEventListener?.("voiceschanged", refresh);
    };
  }, []);

  useEffect(() => {
    applyTheme(settings);
  }, [settings]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
    window.dispatchEvent(new CustomEvent("thimar:settings"));
  };

  /* تجربة صوت المؤذن من داخل الإعدادات. */
  const previewAdhan = (id: string, url: string) => {
    if (!adhanPreviewRef.current) adhanPreviewRef.current = new Audio();
    const audio = adhanPreviewRef.current;
    if (previewId === id) {
      audio.pause();
      setPreviewId(null);
      return;
    }
    audio.pause();
    audio.src = url;
    audio.volume = 0.95;
    audio.onended = () => setPreviewId(null);
    audio.onerror = () => setPreviewId(null);
    audio.play().then(() => setPreviewId(id)).catch(() => setPreviewId(null));
  };

  const approveTeacher = (teacherId: string) => {
    setAccountStatus(teacherId, "active");
    refreshAdmin();
  };

  const rejectTeacher = (teacherId: string) => {
    const reason = prompt("سبب الرفض:", "لم يجتز اختبار الإتقان.") ?? "";
    setAccountStatus(teacherId, "rejected", reason);
    refreshAdmin();
  };

  const handleAddUser = async () => {
    if (!newUser.fullName.trim() || !newUser.username.trim() || !newUser.password.trim()) {
      setNewUserMsg("أكمل الاسم واسم المستخدم وكلمة المرور.");
      return;
    }
    try {
      await createAccount({
        type: newUser.type,
        fullName: newUser.fullName.trim(),
        username: newUser.username.trim(),
        password: newUser.password,
        birthDate: newUser.birthDate || null,
      });
      setNewUser({ fullName: "", username: "", password: "", type: "student", birthDate: "" });
      setNewUserMsg("تمت إضافة المستخدم.");
      refreshAdmin();
    } catch (e) {
      setNewUserMsg(e instanceof Error ? e.message : "تعذّر الإضافة.");
    }
  };

  const openReply = (complaint: Complaint) => {
    setReplyTarget(complaint);
    setReplyDraft(complaint.reply ?? "");
    setReplyNotice("");
  };

  const generateReply = async () => {
    if (!replyTarget) return;
    if (ai.mode === "off") {
      setReplyDraft(fallbackComplaintReply(replyTarget));
      setReplyNotice("الذكاء الاصطناعي غير مفعّل؛ استخدمنا ردًا جاهزًا يمكنك تعديله. فعّل AI من قسم «رفيق ثمار والذكاء الاصطناعي».");
      return;
    }
    setReplyBusy(true);
    setReplyNotice("");
    try {
      const draft = await draftComplaintReply(replyTarget);
      setReplyDraft(draft);
      setReplyNotice("تم توليد الرد بالذكاء الاصطناعي — راجعه وعدّله قبل الإرسال.");
    } catch {
      setReplyDraft(fallbackComplaintReply(replyTarget));
      setReplyNotice("الذكاء الاصطناعي غير مفعّل أو تعذّر الاتصال؛ استخدمنا ردًا جاهزًا يمكنك تعديله.");
    } finally {
      setReplyBusy(false);
    }
  };

  const sendReply = () => {
    if (!replyTarget || !replyDraft.trim()) return;
    resolveComplaint(replyTarget.id, replyDraft.trim());
    setReplyTarget(null);
    setReplyDraft("");
    refreshAdmin();
  };

  const saveAi = async () => {
    saveAiConfig({
      ...aiConfig,
      apiKey: aiConfig.apiKey.trim(),
      baseUrl: aiConfig.baseUrl.trim().replace(/\/+$/, ""),
      model: aiConfig.model.trim(),
    });
    setAiSaved(true);
    setAiTest("");
    setAi(await checkAiAvailability());
    window.dispatchEvent(new CustomEvent("thimar:ai-settings"));
    window.setTimeout(() => setAiSaved(false), 2500);
  };

  const removeAiKey = () => {
    clearAiConfig();
    const clean = loadAiConfig();
    setAiConfig(clean);
    setAiTest("تم مسح المفتاح من هذا المتصفح.");
    checkAiAvailability().then(setAi);
    window.dispatchEvent(new CustomEvent("thimar:ai-settings"));
  };

  const testAi = async () => {
    setAiBusy(true);
    setAiTest("");
    try {
      const answer = await aiChat(
        [
          { role: "system", content: "أجب بكلمة واحدة فقط: جاهز." },
          { role: "user", content: "هل أنت جاهز؟" },
        ],
        { temperature: 0, maxTokens: 20 },
      );
      setAiTest(`الرد: ${answer}`);
      setAi(await checkAiAvailability());
    } catch (error) {
      setAiTest(error instanceof Error ? error.message : "تعذّر الاتصال.");
    } finally {
      setAiBusy(false);
    }
  };

  const testMicrophone = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("هذا المتصفح لا يدعم الوصول إلى الميكروفون.");
      return;
    }
    setMicStatus("جارٍ طلب إذن الميكروفون…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicStatus("الميكروفون متاح ويعمل. يمكنك التسميع الآن.");
    } catch (error) {
      setMicStatus(mediaErrorMessage(error));
    }
  };

  const testSpeech = () => {
    if (!hasSpeechSynthesis()) {
      setTtsStatus("النطق الآلي غير مدعوم في هذا المتصفح.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance("أهلًا بك في ثمار. أنا رفيقك في رحلة الحفظ.");
    utterance.lang = "ar-SA";
    const voice = getArabicVoice();
    if (voice) utterance.voice = voice;
    utterance.onstart = () => setTtsStatus("تم بدء النطق الآلي. إن لم تسمع صوتًا فتحقق من مخرج الصوت في الجهاز.");
    utterance.onend = () => setTtsStatus("انتهى النطق الآلي.");
    utterance.onerror = () => setTtsStatus("تعذّر تشغيل النطق الآلي.");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const saveLinked = () => {
    // كل ابن يحتاج موافقة الطالب نفسه من إشعاراته، ويمكن إرسال أكثر من طلب.
    const result = requestGuardianLink(account, linked);
    setLinkMessage(result.message);
    if (result.ok) setLinked("");
    refreshAdmin();
  };

  const requestTeacher = () => {
    const result = requestTeacherLink(account, teacherUsernameInput);
    setTeacherLinkMessage(result.message);
    if (result.ok) setTeacherUsernameInput("");
  };

  const [adminResetMessage, setAdminResetMessage] = useState("");

  // حساب المسؤول: إعادة ضبط فقط، بلا حذف.
  const resetAdminSettings = () => {
    saveSettings({ ...defaultSettings });
    window.dispatchEvent(new Event("thimar:settings"));
    setAdminResetMessage("تمت إعادة ضبط الإعدادات إلى الوضع الافتراضي.");
  };

  const clearTempData = () => {
    try {
      const tempPrefixes = ["thimar.tafsir.", "thimar.quran.", "thimar.audio.", "thimar.cache."];
      Object.keys(localStorage)
        .filter((key) => tempPrefixes.some((prefix) => key.startsWith(prefix)))
        .forEach((key) => localStorage.removeItem(key));
      setAdminResetMessage("تم حذف البيانات المؤقتة (التفسير والتلاوات المخزّنة) دون المساس بالحساب.");
    } catch {
      setAdminResetMessage("تعذّر حذف البيانات المؤقتة.");
    }
  };

  /** يحذف المسؤول أي مستخدم مُضاف — بزر × بجواره في جدول المستخدمين. */
  const removeUser = (target: Account) => {
    if (account.type !== "admin") return;
    if (target.id === account.id) {
      alert("لا يمكن حذف حسابك الحالي.");
      return;
    }
    if (target.type === "admin") {
      alert("حساب المسؤول لا يُحذف.");
      return;
    }
    if (!confirm(`حذف المستخدم ${target.fullName} (@${target.username})؟`)) return;
    try {
      clearAccountData(target.id);
    } catch { /* ignore */ }
    const removed = deleteAccount(target.id);
    setAccounts(loadAccounts());
    setAdminResetMessage(removed ? `تم حذف ${target.fullName} (@${target.username}).` : "تعذّر حذف المستخدم.");
  };

  const removeMyAccount = () => {
    if (deleteConfirm.trim() !== "حذف") {
      setDeleteMessage("اكتب كلمة «حذف» للتأكيد.");
      return;
    }
    clearAccountData(account.id);
    const removed = deleteAccount(account.id);
    if (!removed) {
      setDeleteMessage("تعذّر حذف الحساب.");
      return;
    }
    onLogout();
  };

  const changePassword = () => {
    setPasswordMessage("");
    if (newPassword.length < 6) {
      setPasswordMessage("كلمة المرور الجديدة يجب أن تكون ٦ أحرف على الأقل.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage("تأكيد كلمة المرور غير مطابق.");
      return;
    }
    void (async () => {
      const result = await changeAccountPassword(account.id, oldPassword, newPassword);
      if (!result.ok) {
        setPasswordMessage(result.message);
        return;
      }
      const upgraded = loadAccounts().find((item) => item.id === account.id);
      if (upgraded) {
        account.passwordHash = upgraded.passwordHash;
        account.passwordSalt = upgraded.passwordSalt;
        delete account.password;
      }
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage(result.message);
    })();
  };

  const exportData = () => {
    const dump: Record<string, string | null> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) dump[key] = localStorage.getItem(key);
    }
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "thimar-backup.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const resetData = () => {
    if (!confirm("سيتم مسح جميع البيانات المحلية. متابعة؟")) return;
    clearDemoData();
    window.location.reload();
  };

  const checkForUpdates = async () => {
    if (updateChecking) return;
    setUpdateChecking(true);
    setUpdateStatus("idle");
    setUpdateMessage("");
    setUpdateVersion("");
    setUpdateReleaseNotes(null);
    setUpdateFileSize(null);
    const isArabic = settings.language !== "en";
    try {
      const platform = detectPlatform();
      if (platform === "android") {
        const response = await fetch(ANDROID_UPDATE_METADATA_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("metadata");
        const metadata = await response.json();
        if (!metadata?.available || !metadata.versionCode) throw new Error("invalid");
        const assetOnly = metadata.assetOnly === true || metadata.apkRequired === false;
        if (!assetOnly && (!metadata.downloadUrl || !metadata.sha256)) throw new Error("invalid");
        const available = Number(metadata.versionCode);
        let installedCode = getInstalledVersionCode();
        if (installedCode === null) {
          const installedName = (window as any).ThimarNative?.appVersion?.();
          const history = Array.isArray(metadata.versionHistory) ? metadata.versionHistory : [];
          const entry = history.find((item: any) => item?.versionName === installedName);
          if (entry && Number.isFinite(Number(entry.versionCode))) {
            installedCode = Number(entry.versionCode);
          } else if (installedName) {
            // No numeric versionCode available; do not guess via alphabetical comparison.
            // Treat as unknown and surface the published release as available.
            setUpdateStatus("available");
            setUpdateVersion(String(metadata.versionName ?? metadata.versionCode));
            setUpdateReleaseNotes(metadata.releaseNotes ?? null);
            setUpdateFileSize(typeof metadata.fileSize === "number" ? metadata.fileSize : null);
            setUpdateMessage(isArabic ? "يتوفر تحديث جديد لثمار" : "A new update is available for Thimar");
            return;
          }
        }
        if (installedCode === null) {
          setUpdateStatus("error");
          setUpdateMessage(isArabic ? "تعذر تحديد إصدار التطبيق المثبت. أعد المحاولة." : "Could not determine the installed app version. Try again.");
          return;
        }
        if (available > installedCode) {
          setUpdateStatus("available");
          setUpdateVersion(String(metadata.versionName ?? metadata.versionCode));
          setUpdateReleaseNotes(metadata.releaseNotes ?? null);
          setUpdateFileSize(typeof metadata.fileSize === "number" ? metadata.fileSize : null);
          setUpdateMessage(isArabic ? "يتوفر تحديث جديد لثمار" : "A new update is available for Thimar");
        } else if (available === installedCode) {
          setUpdateStatus("latest");
          setUpdateMessage(isArabic ? "أنت تستخدم أحدث إصدار من تطبيق ثمار." : "You are using the latest version of Thimar.");
        } else {
          setUpdateStatus("latest");
          setUpdateMessage(isArabic ? "الإصدار المثبت أحدث من الإصدار المنشور." : "The installed version is newer than the published release.");
        }
      } else if (platform === "ios") {
        const response = await fetch(IOS_UPDATE_METADATA_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("metadata");
        const metadata = await response.json();
        if (metadata?.available && metadata.url) {
          setUpdateStatus("available");
          setUpdateVersion("iOS");
          setUpdateMessage(isArabic ? "يتوفر تحديث جديد لثمار" : "A new update is available for Thimar");
        } else {
          setUpdateStatus("latest");
          setUpdateMessage(isArabic ? "أنت تستخدم أحدث إصدار من تطبيق ثمار." : "You are using the latest version of Thimar.");
        }
      } else if (platform === "web") {
        // Browser/PWA sessions are served from the live website and are not app upgrades.
        // The Updates screen in a browser offers the native app installer instead.
        const ua = (navigator.userAgent || "").toLowerCase();
        if (/iphone|ipad|ipod/.test(ua)) {
          const response = await fetch(IOS_UPDATE_METADATA_URL, { cache: "no-store" });
          if (!response.ok) throw new Error(`iOS metadata HTTP ${response.status}`);
          const metadata = await response.json();
          if (metadata?.available && metadata.url) {
            setUpdateStatus("available");
            setUpdateVersion("iOS");
            setUpdateMessage(isArabic ? "يتوفر رابط تنزيل تطبيق iOS. المتصفح نفسه لا يحتاج إلى تحديث." : "An iOS app link is available. The browser itself does not need an update.");
          } else {
            setUpdateStatus("latest");
            setUpdateMessage(isArabic ? "تطبيق iOS غير متاح للتنزيل حاليًا. المتصفح يعمل بأحدث نسخة من الموقع." : "The iOS app is not available for download yet. The website is already up to date.");
          }
        } else {
          const response = await fetch(ANDROID_UPDATE_METADATA_URL, { cache: "no-store" });
          if (!response.ok) throw new Error(`Android metadata HTTP ${response.status}`);
          const metadata = await response.json();
          if (metadata?.available && metadata.downloadUrl && metadata.versionCode) {
            setUpdateStatus("available");
            setUpdateVersion(String(metadata.versionName ?? metadata.versionCode));
            setUpdateReleaseNotes(metadata.releaseNotes ?? null);
            setUpdateFileSize(typeof metadata.fileSize === "number" ? metadata.fileSize : null);
            setUpdateMessage(isArabic ? "هذا متصفح ويب ولا يحتاج إلى تحديث. يمكنك تنزيل تطبيق ثمار وتثبيته من هنا." : "This browser is already up to date. You can download and install the Thimar Android app here.");
          } else {
            setUpdateStatus("latest");
            setUpdateMessage(isArabic ? "المتصفح يعمل بأحدث نسخة من الموقع، ولا يتوفر ملف تطبيق للتنزيل حاليًا." : "The website is up to date and no app installer is currently available.");
          }
        }
      } else {
        setUpdateStatus("latest");
        setUpdateMessage(isArabic ? "أنت تستخدم أحدث إصدار من تطبيق ثمار." : "You are using the latest version of Thimar.");
      }
    } catch (error) {
      setUpdateStatus("error");
      const detail = error instanceof Error ? error.message : "";
      setUpdateMessage(isArabic ? `تعذر التحقق من وجود تحديث. ${detail ? `(${detail})` : ""} تحقق من اتصال الإنترنت وحاول مرة أخرى.` : `Could not check for updates. ${detail ? `(${detail})` : ""} Check your internet connection and try again.`);
    } finally {
      setUpdateChecking(false);
    }
  };

  const guardianChildren = account.type === "guardian"
    ? loadAccounts().filter((item) => item.type === "student" && (account.guardian?.studentUsernames ?? []).includes(item.username))
    : [];
  const pendingTeacherRequest = account.type === "student" ? pendingTeacherRequestOf(account.id) : undefined;
  const linkedTeacher = account.type === "student" && account.student?.teacherAccountId
    ? loadAccounts().find((item) => item.id === account.student?.teacherAccountId)
    : undefined;

  return (
    <div className="page settings-page">
      <div className="page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>{activeGroup ? settingsGroupLabel(activeGroup) : "الإعدادات"}</h2>
        {activeGroup ? (
          <button
            type="button"
            onClick={closeSettingsGroup}
            aria-label="رجوع"
            style={{ background: "transparent", border: "none", fontSize: 28, lineHeight: 1, cursor: "pointer", color: "var(--text)" }}
          >
            ×
          </button>
        ) : null}
      </div>

      {!activeGroup && (
      <div className="settings-groups" style={{ display: "flex", flexDirection: "column", gap: 10, margin: "10px 0 14px" }}>
        {[
          { id: "appearance", label: "المظهر" },
          { id: "sounds", label: "الأذان" },
          { id: "downloads", label: "التحميل" },
          ...(detectPlatform() !== "web" ? [{ id: "updates", label: settings.language === "en" ? "Updates" : "التحديثات" }] : []),
          ...(account.type === "admin" ? [{ id: "approvals", label: "الاعتماد والشكاوى" }] : []),
          { id: "users", label: "المستخدمين" },
          { id: "password", label: "تغير الرقم السري" },
        ].map((g) => (
          <button
            key={g.id}
            type="button"
            className="settings-group-card"
            onClick={() => setActiveGroup(g.id)}
            style={{
              width: "100%",
              background: "var(--card)",
              border: `1px solid ${activeGroup === g.id ? "var(--primary)" : "var(--border)"}`,
              borderRadius: 14,
              padding: "14px 16px",
              textAlign: "right",
              cursor: "pointer",
              fontWeight: 700,
              color: activeGroup === g.id ? "var(--primary)" : "var(--text)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          >
            {g.label}
          </button>
        ))}
      </div>
      )}

      {activeGroup === "appearance" && (
      <SectionCard title="المظهر واللغة">
        <div className="settings-grid">
          <label>
            <span>اللغة</span>
            <select value={settings.language} onChange={(event) => update("language", event.target.value as "ar" | "en")}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span>الإضاءة</span>
            <select value={settings.theme} onChange={(event) => update("theme", event.target.value as Theme)}>
              <option value="light">فاتح</option>
              <option value="dark">داكن</option>
              <option value="auto">تلقائي (حسب النظام)</option>
              <option value="sepia">سيبيا</option>
            </select>
          </label>
          <label>
            <span>تقليل الحركة</span>
            <select value={settings.reduceMotion ? "yes" : "no"} onChange={(event) => update("reduceMotion", event.target.value === "yes")}>
              <option value="no">لا</option>
              <option value="yes">نعم</option>
            </select>
          </label>
          <label>
            <span>حجم خط التطبيق</span>
            <input
              type="range"
              min={13}
              max={22}
              value={settings.appFontSize}
              onChange={(event) => update("appFontSize", Number(event.target.value))}
            />
            <span className="muted">{settings.appFontSize}px</span>
          </label>
        </div>
      </SectionCard>
      )}

      {activeGroup === "sounds" && (
      <SectionCard title="القرآن والصلاة">
        <div className="settings-grid">
          <label>
            <span>الموقع (مدينة مواقيت الصلاة)</span>
            <select
              value={prayerCity}
              onChange={(event) => {
                const city = fallbackCities.find((item) => item.id === event.target.value);
                if (!city) return;
                try { localStorage.setItem("thimar.prayer.city", city.id); localStorage.removeItem("thimar.prayer.coords"); } catch { /* ignore */ }
                setPrayerCity(city.id);
                setLocationMsg(`تم اختيار ${city.name} — ستُحدَّث المواقيت والأذان.`);
                window.dispatchEvent(new CustomEvent("thimar:settings"));
              }}
            >
              <option value="auto">موقعي الحالي (تلقائي)</option>
              {fallbackCities.map((city) => (
                <option key={city.id} value={city.id}>{city.name}</option>
              ))}
            </select>
          </label>
          <div className="settings-inline-action">
            <button
              type="button"
              className="ghost-button"
              disabled={locating}
              onClick={async () => {
                setLocating(true);
                setLocationMsg("");
                try {
                  const coords = await getCoordinates();
                  try {
                    localStorage.setItem("thimar.prayer.city", "auto");
                    localStorage.setItem("thimar.prayer.coords", JSON.stringify(coords));
                  } catch { /* ignore */ }
                  setPrayerCity("auto");
                  setLocationMsg("تم تحديد موقعك بنجاح.");
                  window.dispatchEvent(new CustomEvent("thimar:settings"));
                } catch {
                  setLocationMsg("تعذّر تحديد الموقع؛ اختر مدينة من القائمة.");
                } finally {
                  setLocating(false);
                }
              }}
            >
              {locating ? "جارٍ تحديد الموقع…" : "تحديد موقعي تلقائيًا"}
            </button>
            {locationMsg ? <small className="muted">{locationMsg}</small> : null}
          </div>
          <label>
            <span>طريقة حساب الصلاة</span>
            <select value={settings.prayerMethod} onChange={(event) => update("prayerMethod", Number(event.target.value))}>
              {prayerMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>الإشعارات</span>
            <select value={settings.notifications ? "yes" : "no"} onChange={(event) => update("notifications", event.target.value === "yes")}>
              <option value="yes">مفعّلة</option>
              <option value="no">معطّلة</option>
            </select>
          </label>
          <div className="settings-notify">
            <p className="muted">
              حالة إذن الإشعارات:{" "}
              {notifyPerm === "granted"
                ? "مسموح ✓ — ستصل الرسائل والتذكيرات خارج التطبيق."
                : notifyPerm === "denied"
                  ? "مرفوض من النظام — لا يستطيع التطبيق إظهار الإشعارات حتى تسمح بها من إعدادات الهاتف."
                  : notifyPerm === "unsupported"
                    ? "غير مدعوم في هذا المتصفح."
                    : "غير مفعّل — اضغط زر السماح أدناه ثم اختر «السماح» في نافذة الهاتف."}
            </p>
            {notifyPerm === "denied" ? (
              <div className="settings-notify-help">
                <strong>خطوات السماح على أندرويد:</strong>
                <ol>
                  <li>
                    من التطبيق المثبّت: اضغط مطوّلًا على أيقونة «ثمار» ← <b>معلومات التطبيق</b> ←{" "}
                    <b>الإشعارات</b> ← فعّل <b>«السماح بالإشعارات»</b>.
                  </li>
                  <li>
                    إن كان الخيار معطّلًا (رمادي): افتح <b>كروم</b> ← <b>⋮</b> ← <b>الإعدادات</b> ←{" "}
                    <b>إعدادات المواقع</b> ← <b>الإشعارات</b> ← ابحث عن <b>thimar.freebuff.page</b> ←{" "}
                    <b>السماح</b>.
                  </li>
                  <li>
                    أو من داخل كروم على الموقع: اضغط أيقونة القفل بجوار العنوان ← <b>الأذونات</b> ←{" "}
                    <b>الإشعارات</b> ← <b>السماح</b>.
                  </li>
                  <li>ارجع إلى «ثمار»؛ تتحدث الحالة هنا تلقائيًا بمجرد السماح.</li>
                </ol>
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="primary-button"
                disabled={notifyPerm === "granted" || notifyPerm === "unsupported"}
                onClick={() => {
                  void (async () => {
                    const current = await requestNotificationPermission();
                    setNotifyPerm(current);
                    if (current === "granted") {
                      const subscribed = await subscribeToPush(account.id);
                      setNotifyMsg(
                        subscribed
                          ? "تم تفعيل الإشعارات من الخادم — ستصل الرسائل والأذان والتذكير اليومي حتى والتطبيق مغلق ✓"
                          : "الإذن مسموح، لكن تعذّر تسجيل الجهاز في خدمة الإشعارات. تأكد من الإنترنت ثم أعد المحاولة.",
                      );
                      return;
                    }
                    setNotifyMsg(
                      current === "denied"
                        ? "الإذن مرفوض من النظام: الإعدادات ← التطبيقات ← ثمار ← الإشعارات ← السماح، أو من إعدادات كروم للموقع."
                        : "لم يُمنح الإذن بعد؛ أعد المحاولة من داخل التطبيق المثبّت.",
                    );
                  })();
                }}
              >
                {notifyPerm === "denied"
                  ? "إعادة فحص الإذن بعد السماح"
                  : "السماح بالإشعارات خارج التطبيق"}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={notifyPerm !== "granted"}
                onClick={() =>
                  void showSystemNotification("ثمار", "الإشعارات تعمل الآن على جهازك ✓")
                }
              >
                إرسال إشعار تجريبي
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={notifyPerm !== "granted"}
                onClick={() => {
                  void (async () => {
                    setServerPushMsg("جارٍ الإرسال من الخادم…");
                    const ok = await serverTestPush(account.id);
                    setServerPushMsg(
                      ok
                        ? "أرسل الخادم الإشعار — يجب أن يظهر الآن على شاشة الهاتف (جرّبه والتطبيق مغلق)."
                        : "تعذّر إرسال الإشعار من الخادم؛ تأكد من الإنترنت وأن الجهاز مسجّل (أعد زر السماح).",
                    );
                  })();
                }}
              >
                إرسال إشعار من الخادم
              </button>
            </div>
            {serverPushMsg ? <small className="muted">{serverPushMsg}</small> : null}
            {notifyPerm === "granted" ? (
              <small className="muted">
                بعد السماح قد يبقى زر الإشعارات في «معلومات التطبيق» غير مفعّل حتى تغلق التطبيق
                وتعيد فتحه من الأيقونة.
              </small>
            ) : null}
          </div>
          {notifyMsg ? <small className="muted">{notifyMsg}</small> : null}
          <label>
            <span>صوت الإشعارات</span>
            <select value={settings.notificationSound ? "yes" : "no"} onChange={(event) => update("notificationSound", event.target.value === "yes")}>
              <option value="yes">مفعّل</option>
              <option value="no">معطّل</option>
            </select>
          </label>
          <label>
            <span>اهتزاز</span>
            <select value={settings.vibration ? "yes" : "no"} onChange={(event) => update("vibration", event.target.value === "yes")}>
              <option value="yes">مفعّل</option>
              <option value="no">معطّل</option>
            </select>
          </label>
          <label>
            <span>صوت الأذان</span>
            <select value={settings.adhanSound ? "yes" : "no"} onChange={(event) => update("adhanSound", event.target.value === "yes")}>
              <option value="yes">مفعّل</option>
              <option value="no">معطّل</option>
            </select>
          </label>
          <label>
            <span>شاشة وقت الصلاة</span>
            <select
              value={settings.adhanScreen === false ? "no" : "yes"}
              onChange={(event) => update("adhanScreen", event.target.value === "yes")}
            >
              <option value="yes">مفعّلة</option>
              <option value="no">معطّلة</option>
            </select>
          </label>
          <label>
            <span>نغمة الأذان المناسبة</span>
            <select value={settings.adhanId} onChange={(event) => update("adhanId", event.target.value)}>
              {adhanOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="settings-log-row"
            onClick={() => onOpenAdhanLog?.()}
            disabled={!onOpenAdhanLog}
          >
            <span>
              <Icon name="volume" size={16} /> سجل الأذان
            </span>
            <span aria-hidden="true">‹</span>
          </button>
          <label>
            <span>مستوى صوت الأذان</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((settings.adhanVolume ?? 0.9) * 100)}
              onChange={(event) => update("adhanVolume", Number(event.target.value) / 100)}
            />
            <span className="muted">{Math.round((settings.adhanVolume ?? 0.9) * 100)}%</span>
          </label>
          <div className="settings-grid" style={{ marginTop: 8 }}>
            {(["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"] as const).map((prayer) => (
              <label key={prayer + "-enabled"}>
                <span>{
                  prayer === "Fajr" ? "تفعيل أذان الفجر" :
                  prayer === "Dhuhr" ? "تفعيل أذان الظهر" :
                  prayer === "Asr" ? "تفعيل أذان العصر" :
                  prayer === "Maghrib" ? "تفعيل أذان المغرب" : "تفعيل أذان العشاء"
                }</span>
                <select
                  value={settings.adhanPrayerEnabled?.[prayer] === false ? "no" : "yes"}
                  onChange={(event) => {
                    const next = { ...settings, adhanPrayerEnabled: { ...(settings.adhanPrayerEnabled || {}), [prayer]: event.target.value === "yes" } };
                    setSettings(next);
                    saveSettings(next);
                    window.dispatchEvent(new CustomEvent("thimar:settings"));
                  }}
                >
                  <option value="yes">مفعّل</option>
                  <option value="no">معطّل</option>
                </select>
              </label>
            ))}
          </div>
          <div className="settings-grid" style={{ marginTop: 8 }}>
            {(["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"] as const).map((prayer) => (
              <label key={prayer}>
                <span>{
                  prayer === "Fajr" ? "أذان الفجر" :
                  prayer === "Dhuhr" ? "أذان الظهر" :
                  prayer === "Asr" ? "أذان العصر" :
                  prayer === "Maghrib" ? "أذان المغرب" : "أذان العشاء"
                }</span>
                <select
                  value={settings.adhanByPrayer?.[prayer] || settings.adhanId}
                  onChange={(event) => {
                    const next = { ...settings, adhanByPrayer: { ...(settings.adhanByPrayer || {}), [prayer]: event.target.value } };
                    setSettings(next);
                    saveSettings(next);
                    window.dispatchEvent(new CustomEvent("thimar:settings"));
                  }}
                >
                  {adhanOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="adhan-preview">
            <span className="adhan-preview-title">تجربة صوت المؤذن</span>
            <ul>
              {adhanOptions.map((option) => {
                const isPlaying = previewId === option.id;
                return (
                  <li key={option.id}>
                    <span>{option.name}</span>
                    <button
                      type="button"
                      className={`adhan-preview-btn${isPlaying ? " playing" : ""}`}
                      onClick={() => previewAdhan(option.id, option.url)}
                      aria-label={isPlaying ? "إيقاف" : "تجربة الصوت"}
                    >
                      {isPlaying ? "إيقاف" : "تجربة الصوت"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </SectionCard>
      )}

      {activeGroup === "updates" && detectPlatform() !== "web" && (
      <SectionCard title={settings.language === "en" ? "Updates" : "التحديثات"}>
        <div className="settings-grid">
          <div className="settings-inline-action">
            <button
              type="button"
              className="primary-button"
              disabled={updateChecking}
              onClick={() => void checkForUpdates()}
            >
              {updateChecking
                ? (settings.language === "en" ? "Checking…" : "جارٍ التحقق…")
                : (settings.language === "en" ? "Check for Updates" : "البحث عن تحديث جديد")}
            </button>
            {updateStatus === "available" ? (
              <div style={{ marginTop: 10 }}>
                <p className="muted">
                  {updateMessage}
                  {updateVersion ? ` — ${updateVersion}` : ""}
                  {updateVersion ? (
                    <span style={{ marginInlineStart: 8, fontWeight: 600 }}>
                      ({updateFileSize
                        ? (updateFileSize >= 1024 * 1024 * 1024
                            ? (updateFileSize / (1024 * 1024 * 1024)).toFixed(2) + " GB"
                            : (updateFileSize / (1024 * 1024)).toFixed(1) + " MB")
                        : (settings.language === "en" ? "Size unavailable" : "الحجم غير متوفر")})
                    </span>
                  ) : null}
                </p>
                {updateReleaseNotes ? (() => {
                  const rn = updateReleaseNotes[settings.language === "en" ? "en" : "ar"] || updateReleaseNotes.ar || updateReleaseNotes.en || {};
                  return (
                    <div style={{ marginTop: 8, textAlign: settings.language === "en" ? "left" : "right" }}>
                      {rn.shortDescription ? <p className="muted">{rn.shortDescription}</p> : null}
                      {rn.releaseDate ? <p className="muted">{settings.language === "en" ? "Release date:" : "تاريخ الإصدار:"} {rn.releaseDate}</p> : null}
                      {Array.isArray(rn.features) && rn.features.length ? (
                        <div>
                          <strong>{settings.language === "en" ? "New features" : "الميزات الجديدة"}</strong>
                          <ul>{rn.features.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
                        </div>
                      ) : null}
                      {Array.isArray(rn.improvements) && rn.improvements.length ? (
                        <div>
                          <strong>{settings.language === "en" ? "Improvements" : "تحسينات"}</strong>
                          <ul>{rn.improvements.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
                        </div>
                      ) : null}
                      {Array.isArray(rn.bugFixes) && rn.bugFixes.length ? (
                        <div>
                          <strong>{settings.language === "en" ? "Bug fixes" : "إصلاحات"}</strong>
                          <ul>{rn.bugFixes.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
                        </div>
                      ) : null}
                      {Array.isArray(rn.securityUpdates) && rn.securityUpdates.length ? (
                        <div>
                          <strong>{settings.language === "en" ? "Security updates" : "تحديثات أمنية"}</strong>
                          <ul>{rn.securityUpdates.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
                        </div>
                      ) : null}
                      {updateFileSize ? (
                        <p className="muted">{settings.language === "en" ? "APK size:" : "حجم APK:"} {(updateFileSize / (1024 * 1024)).toFixed(1)} MB</p>
                      ) : null}
                    </div>
                  );
                })() : null}
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => (window as any).__thimarStartUpdateDownload?.()}
                >
                  {settings.language === "en"
                    ? (detectPlatform() === "web" ? "Download the app" : "Update Now")
                    : (detectPlatform() === "web" ? "تحميل التطبيق" : "تحديث الآن")}
                </button>
              </div>
            ) : null}
            {updateStatus === "latest" ? <p className="muted">{updateMessage}</p> : null}
            {updateStatus === "error" ? <p className="muted">{updateMessage}</p> : null}
          </div>
        </div>
      </SectionCard>
      )}

      {activeGroup === "ai" && (
      <SectionCard title="رفيق ثمار والذكاء الاصطناعي (Gemini)" subtitle="توليد الاختبارات والألغاز، تصحيح التسميع، ردود الشكاوى، والرفيق الصوتي">
        <div className="settings-grid">
          <label>
            <span>ظهور رفيق ثمار على الواجهة</span>
            <select value={settings.robotVisible ? "yes" : "no"} onChange={(event) => update("robotVisible", event.target.value === "yes")}>
              <option value="yes">ظاهر</option>
              <option value="no">مخفي</option>
            </select>
          </label>
        </div>
        <p className="muted">إذا أخفيت الرفيق بعلامة ×، يمكنك إعادته من هنا في أي وقت.</p>
        <div className={`ai-status ${ai.mode !== "off" ? "online" : ""}`}>
          <span className="dot" />
          <span>
            {ai.mode === "proxy"
              ? `الخادم المحلي مهيأ${ai.model ? ` (${ai.model})` : ""} — المفتاح محمي على الخادم.`
              : ai.mode === "client"
                ? `متصل عبر مفتاح المتصفح${ai.model ? ` (${ai.model})` : ""} — يُستخدم عندما لا يكون مفتاح الخادم مهيأ.`
                : "غير مفعّل — أضف مفتاحًا من الحقول أعلاه أو مفتاح الخادم في متغيرات البيئة. يعمل رفيق ثمار بالوضع المحلي، والتسميع النصي يعمل دائمًا."}
          </span>
        </div>

        <div className="ai-config-grid">
          <label className="full">
            <span>مفتاح API (اختياري — يُحفظ في هذا المتصفح فقط)</span>
            <input
              type="password"
              value={aiConfig.apiKey}
              onChange={(event) => setAiConfig({ ...aiConfig, apiKey: event.target.value })}
              placeholder="ألصق مفتاح المزوّد هنا..."
              autoComplete="off"
            />
          </label>
          <label>
            <span>Base URL</span>
            <input
              dir="ltr"
              value={aiConfig.baseUrl}
              onChange={(event) => setAiConfig({ ...aiConfig, baseUrl: event.target.value })}
              placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
            />
          </label>
          <label>
            <span>Model</span>
            <input
              dir="ltr"
              value={aiConfig.model}
              onChange={(event) => setAiConfig({ ...aiConfig, model: event.target.value })}
              placeholder="gemini-2.0-flash"
            />
          </label>
        </div>


        <div className="speech-diag">
          <h4>فحص الصوت والميكروفون</h4>
          <div className="speech-diag-row">
            <span>تحويل الكلام إلى نص</span>
            <span className={hasSpeechRecognition() ? "status-ok" : "status-bad"}>
              {hasSpeechRecognition() ? "مدعوم" : "غير مدعوم — استخدم الكتابة"}
            </span>
          </div>
          <div className="speech-diag-row">
            <span>النطق الآلي</span>
            <span className={hasSpeechSynthesis() ? "status-ok" : "status-bad"}>
              {hasSpeechSynthesis() ? "مدعوم" : "غير مدعوم"}
            </span>
          </div>
          <div className="speech-diag-row">
            <span>صوت عربي مثبت</span>
            <span className={getArabicVoice() ? "status-ok" : "status-warn"}>
              {getArabicVoice() ? "موجود" : "سيُستخدم الصوت الافتراضي للنطق تلقائيًا"}
            </span>
          </div>
          <div className="form-actions">
            <button type="button" className="ghost-button" onClick={testMicrophone}>
              <Icon name="mic" size={16} /> اختبار الميكروفون
            </button>
            <button type="button" className="ghost-button" onClick={testSpeech}>
              <Icon name="play" size={16} /> اختبار النطق
            </button>
          </div>
          {micStatus ? <p className="muted">{micStatus}</p> : null}
          {ttsStatus ? <p className="muted">{ttsStatus}</p> : null}
        </div>

        <div className="form-actions">
          <button type="button" className="primary-button" onClick={saveAi}>
            حفظ مفتاح الذكاء الاصطناعي
          </button>
          <button type="button" className="ghost-button" onClick={testAi} disabled={aiBusy}>
            {aiBusy ? "جارٍ الاختبار…" : "اختبار الاتصال"}
          </button>
          <button type="button" className="danger-button" onClick={removeAiKey}>
            مسح المفتاح
          </button>
        </div>
        {aiSaved ? <p className="muted">تم حفظ الإعدادات في هذا المتصفح.</p> : null}
        {aiTest ? <p className="muted">{aiTest}</p> : null}
      </SectionCard>
      )}

      {activeGroup === "users" && (
      <>
      {account.type === "guardian" ? (
        <SectionCard title="ربط الأبناء" subtitle="أرسل طلبًا لكل ابن على حدة، ولا يُتم الربط إلا بعد موافقته من إشعاراته">
          <label>
            <span>اسم مستخدم الطالب</span>
            <input value={linked} onChange={(event) => setLinked(event.target.value)} placeholder="student" />
          </label>
          <div className="form-actions">
            <button type="button" className="primary-button" onClick={saveLinked}>
              إرسال طلب ربط
            </button>
          </div>
          {linkMessage ? <p className="muted">{linkMessage}</p> : null}

          {(() => {
            const pending = loadGuardianLinkRequests().filter(
              (request) => request.guardianId === account.id && request.status === "pending",
            );
            if (pending.length === 0) return null;
            return (
              <div className="connection-list">
                <strong style={{ fontSize: 14 }}>طلبات بانتظار موافقة الأبناء</strong>
                {pending.map((request) => (
                  <div key={request.id} className="connection-row">
                    <span>{request.studentName} (@{request.studentUsername})</span>
                    <span className="badge badge-warning">بانتظار الموافقة</span>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="connection-list">
            {guardianChildren.length === 0 ? (
              <p className="muted">لا يوجد أبناء مرتبطون حاليًا.</p>
            ) : (
              guardianChildren.map((child) => (
                <div key={child.id} className="connection-row">
                  <span>{child.fullName} (@{child.username})</span>
                  <span className="status-ok">مرتبط</span>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      ) : null}

      {account.type === "student" ? (
        <SectionCard title="ربط معلم" subtitle="اكتب اسم مستخدم المعلم ليصله طلبك ويوافق عليه">
          {linkedTeacher ? (
            <p className="success">مرتبط بالمعلم: {linkedTeacher.fullName} (@{linkedTeacher.username})</p>
          ) : pendingTeacherRequest ? (
            <p className="muted">طلبك عند المعلم {pendingTeacherRequest.teacherName} — بانتظار الموافقة.</p>
          ) : (
            <>
              <div className="inline-form">
                <input
                  value={teacherUsernameInput}
                  onChange={(event) => setTeacherUsernameInput(event.target.value)}
                  placeholder="اسم مستخدم المعلم"
                />
                <button type="button" className="primary-button" onClick={requestTeacher}>
                  إرسال طلب الربط
                </button>
              </div>
              <p className="muted">
                يصل الطلب إلى إشعارات المعلم ومن الصفحة الرئيسية، ويستطيع الموافقة أو الرفض.
              </p>
            </>
          )}
          {teacherLinkMessage ? <p className="muted">{teacherLinkMessage}</p> : null}
        </SectionCard>
      ) : null}
      </>
      )}

      {activeGroup === "downloads" && (
      <>
      <SectionCard title="تحميل نطق المصحف (القرآن الكريم)" subtitle="للتسميع بدون إنترنت">
        <p className="muted">حمّل نطق المصحف كاملاً (6236 آية) لاستخدام التسميع بدون اتصال.</p>
        <div className="settings-grid">
          <label>
            <span>القارئ</span>
            <select value={quranDownloadReciter} onChange={(e) => setQuranDownloadReciter(e.target.value)} disabled={quranDownloading}>
              {quranReciters.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          الحجم المطلوب: <strong>{formatSize(quranSizeEstimate)}</strong> (تقديري بجودة {reciterBitrate(quranDownloadReciter)} كيلوبت/ث)
          {quranDownloadedBytes ? <> — المحمّل فعليًا: <strong>{formatSize(quranDownloadedBytes)}</strong></> : null}
        </p>
        <div className="form-actions" style={{ marginTop: 8 }}>
          {!quranDownloaded ? (
            <button type="button" className="primary-button" onClick={downloadQuranAudio} disabled={quranDownloading}>
              <Icon name="download" size={16} /> {quranDownloading ? `جارٍ التحميل… ${quranDownloadProgress}%` : "تحميل نطق المصحف (6236 آية)"}
            </button>
          ) : null}
          {quranDownloading ? (
            <button type="button" className="danger-button" onClick={cancelQuranAudio}>إلغاء التحميل</button>
          ) : null}
          {quranDownloaded && !quranDownloading ? (
            <button type="button" className="ghost-button" onClick={deleteQuranAudio}>حذف النطق من الجهاز</button>
          ) : null}
        </div>
        {quranDownloading ? (
          <div style={{ marginTop: 8, background: "#e5e7eb", borderRadius: 8, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${quranDownloadProgress}%`, background: "#16a34a", height: "100%", transition: "width 0.3s" }} />
          </div>
        ) : null}
        {quranDownloaded ? <p className="muted" style={{ marginTop: 8, color: "#16a34a" }}>✅ تم تحميل نطق المصحف (6236 آية) — يمكن التسميع بدون اتصال.</p> : null}
      </SectionCard>

      <SectionCard title="تحميل نطق تحفة الأطفال" subtitle="للتسميع بدون إنترنت">
        <p className="muted">حمّل نطق تحفة الأطفال كاملاً (متن التحفة كاملًا بصوت الغامدي والقاسم) لاستخدام التسميع بدون اتصال.</p>
        <p className="muted" style={{ marginTop: 8 }}>
          الحجم المطلوب: <strong>{formatSize(tuhfaSizeEstimate)}</strong> (تقديري — ملفان صوتيان كاملان)
          {tuhfaDownloadedBytes ? <> — المحمّل فعليًا: <strong>{formatSize(tuhfaDownloadedBytes)}</strong></> : null}
        </p>
        <div className="form-actions" style={{ marginTop: 8 }}>
          {!tuhfaDownloaded ? (
            <button type="button" className="primary-button" onClick={downloadTuhfaAudio} disabled={tuhfaDownloading}>
              <Icon name="download" size={16} /> {tuhfaDownloading ? `جارٍ التحميل… ${tuhfaDownloadProgress}%` : "تحميل نطق تحفة الأطفال"}
            </button>
          ) : null}
          {tuhfaDownloading ? (
            <button type="button" className="danger-button" onClick={cancelTuhfaAudio}>إلغاء التحميل</button>
          ) : null}
          {tuhfaDownloaded && !tuhfaDownloading ? (
            <button type="button" className="ghost-button" onClick={deleteTuhfaAudio}>حذف النطق من الجهاز</button>
          ) : null}
        </div>
        {tuhfaDownloading ? (
          <div style={{ marginTop: 8, background: "#e5e7eb", borderRadius: 8, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${tuhfaDownloadProgress}%`, background: "#16a34a", height: "100%", transition: "width 0.3s" }} />
          </div>
        ) : null}
        {tuhfaDownloaded ? <p className="muted" style={{ marginTop: 8, color: "#16a34a" }}>✅ تم تحميل نطق تحفة الأطفال — يمكن التسميع بدون اتصال.</p> : null}
      </SectionCard>

      <SectionCard title="التسميع الصوتي (بدون إنترنت)" subtitle="جزء دائم من حزمة التثبيت">
        <p className="muted">
          التسميع الصوتي يعمل داخل التطبيق مباشرة، دون إنترنت ودون أي تنزيل أو إعداد منك.{" "}
          لا يلزم أي إجراء بعد التثبيت.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          نص قرآني من{" "}
          <a href="https://tanzil.net" target="_blank" rel="noreferrer">Tanzil</a>.{" "}
          <a href={`${import.meta.env.BASE_URL}licenses/THIRD_PARTY_NOTICES.md`} target="_blank" rel="noreferrer">إشعارات التراخيص</a>{" • "}
          <a href={`${import.meta.env.BASE_URL}licenses/tilawa-NOTICE.md`} target="_blank" rel="noreferrer">التفاصيل الكاملة</a>
        </p>
        {asrDownloading ? (
          <div style={{ marginTop: 8, background: "#e5e7eb", borderRadius: 8, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(asrProgress * 100)}%`, background: "#16a34a", height: "100%", transition: "width 0.3s" }} />
          </div>
        ) : null}
        {asrReadiness === "ready" ? <p className="muted" style={{ color: "#16a34a" }}>✅ التسميع الصوتي جاهز دون إنترنت.</p> : null}
        {asrReadiness === "integrity_failed" ? (
          <p className="game-error">
            {asrReadinessMessage || "تعذّر تجهيز التسميع الصوتي. أعد تثبيت التطبيق — لن يُنزَّل شيء من الشبكة تلقائيًا."}
          </p>
        ) : null}
        {asrReadiness !== "ready" && asrReadiness !== "not_downloaded" && asrReadiness !== "integrity_failed" ? <p className="muted">الحالة: {asrReadiness}</p> : null}
        {asrError ? <p className="game-error">{asrError}</p> : null}
        <div className="form-actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="primary-button"
            disabled={asrDownloading}
            onClick={() => void (async () => {
              setAsrError("");
              setAsrDownloading(true);
              setAsrProgress(0);
              try {
                setAsrReadiness("downloading");
                await loadTilawa((p) => setAsrProgress(p.fraction ?? 0));
                setAsrReadiness("verifying");
                const r = await checkTilawaReadiness();
                setAsrReadiness(r.state);
              } catch (e) {
                setAsrReadiness("download_failed");
                setAsrError(e instanceof Error ? e.message : "تعذّر التنزيل.");
              } finally {
                setAsrDownloading(false);
              }
            })()}
          >
            {asrDownloading ? `جارٍ… ${Math.round(asrProgress * 100)}%` : "تحقق من الجاهزية"}
          </button>
        </div>
      </SectionCard>

      <MushafOfflineCard />
      <AppFilesCard />
      <FatwaOfflineCard />
      </>
      )}

      {account.type === "admin" ? (
        <>
          {activeGroup === "approvals" && (
            <>
          <SectionCard title="اعتماد المعلمين">
            {accounts.filter((item) => item.type === "teacher" && item.status === "pending").length === 0 ? (
              <EmptyState title="لا توجد طلبات" body="لا يوجد معلمون بانتظار الاعتماد." />
            ) : (
              <div className="approval-list">
                {accounts
                  .filter((item) => item.type === "teacher" && item.status === "pending")
                  .map((teacher) => (
                    <div key={teacher.id} className="approval-card">
                      <div>
                        <strong>{teacher.fullName}</strong>
                        <p className="muted">
                          {teacher.username} • {teacher.teacher?.juzMemorized} جزء • {teacher.teacher?.hasIjazah ? "إجازة" : "بدون إجازة"}
                          {teacher.teacher?.qiraat?.length ? ` • ${teacher.teacher.qiraat.join("، ")}` : ""}
                          {teacher.teacher?.mujawwad ? " • مجود" : ""}
                          {teacher.teacher?.birthDate ? ` • ${teacher.teacher.birthDate}` : ""}
                        </p>
                      </div>
                      <div className="approval-actions">
                        <button type="button" className="success-button" onClick={() => approveTeacher(teacher.id)}>
                          اعتماد
                        </button>
                        <button type="button" className="danger-button" onClick={() => rejectTeacher(teacher.id)}>
                          رفض
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </SectionCard>
          </>
        )}

          {activeGroup === "users" && (
          <>
          <SectionCard title="إضافة مستخدم" subtitle="اسم مستخدم + كلمة مرور + نوع الحساب + بيانات">
            <div className="form-grid" style={{ display: "grid", gap: 8 }}>
              <input placeholder="الاسم الكامل" value={newUser.fullName} onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })} />
              <input placeholder="اسم المستخدم" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
              <input placeholder="كلمة المرور" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
              <select value={newUser.type} onChange={(e) => setNewUser({ ...newUser, type: e.target.value as Account["type"] })}>
                <option value="student">طالب</option>
                <option value="teacher">معلم</option>
                <option value="guardian">ولي أمر</option>
                <option value="admin">مسؤول</option>
              </select>
              <input type="date" value={newUser.birthDate} onChange={(e) => setNewUser({ ...newUser, birthDate: e.target.value })} />
              <button type="button" className="primary-button" onClick={handleAddUser}>إضافة</button>
              {newUserMsg ? <p className="muted">{newUserMsg}</p> : null}
            </div>
          </SectionCard>
          </>
          )}

          {activeGroup === "approvals" && (
          <>
          <SectionCard title="الشكاوى والاقتراحات">
            {complaints.length === 0 ? (
              <EmptyState title="لا توجد شكاوى" body="ستظهر هنا." />
            ) : (
              <div className="complaint-list">
                {complaints.map((complaint) => (
                  <div key={complaint.id} className="complaint-card">
                    <div className="complaint-head">
                      <strong>{complaint.subject}</strong>
                      <span className={`badge badge-${complaint.status === "open" ? "warning" : "success"}`}>
                        {complaint.status === "open" ? "مفتوحة" : "مغلقة"}
                      </span>
                    </div>
                    <p className="muted">
                      {complaint.name} • {complaint.role} • {complaint.contact}
                    </p>
                    <p>{complaint.body}</p>
                    {complaint.reply ? <p className="reply">رد: {complaint.reply}</p> : null}
                    {complaint.status === "open" ? (
                      <button type="button" className="primary-button" onClick={() => openReply(complaint)}>
                        رد وإغلاق
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
          </>
          )}

          {activeGroup === "users" && (
          <>
          <SectionCard title="المستخدمون والربط">
            <div className="users-table">
              {accounts.map((item) => (
                <div key={item.id} className="user-row">
                  <span>{item.fullName}</span>
                  <span className="muted">{item.username}</span>
                  <span className="badge badge-neutral">{item.type}</span>
                  <span className={`badge badge-${item.status === "active" ? "success" : item.status === "pending" ? "warning" : "danger"}`}>
                    {item.banned ? "محظور" : item.status}
                  </span>
                  {account.type === "admin" && item.id !== account.id && item.type !== "admin" ? (
                    <div className="form-actions" style={{ display: "flex", gap: 6 }}>
                      {item.banned ? (
                        <button
                          type="button"
                          className="success-button"
                          onClick={() => { unbanAccount(item.id); setAccounts(loadAccounts()); }}
                        >
                          رفع الحظر
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => { banAccount(item.id, "تم حظر الحساب من قبل المسؤول."); setAccounts(loadAccounts()); }}
                        >
                          حظر
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button user-delete"
                        aria-label={`حذف ${item.fullName}`}
                        title={`حذف ${item.fullName}`}
                        onClick={() => removeUser(item)}
                      >
                        <Icon name="x" size={16} />
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="أدوات المسؤول">
            <div className="form-actions">
              <button type="button" className="ghost-button" onClick={exportData}>
                <Icon name="download" size={16} /> تصدير البيانات
              </button>
              <button type="button" className="danger-button" onClick={resetData}>
                <Icon name="trash" size={16} /> إعادة تعيين
              </button>
            </div>
          </SectionCard>
            </>
          )}
        </>
      ) : null}

      {activeGroup === "password" && (
      <>
      <SectionCard title="الحساب">
        <p className="muted">الحساب الحالي: {account.fullName} (@{account.username})</p>
        <div className="settings-grid">
          <label>
            <span>كلمة المرور الحالية</span>
            <input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} autoComplete="current-password" />
          </label>
          <label>
            <span>كلمة المرور الجديدة</span>
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" />
          </label>
          <label>
            <span>تأكيد كلمة المرور الجديدة</span>
            <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
          </label>
        </div>
        {passwordMessage ? <p className="muted">{passwordMessage}</p> : null}
        <div className="form-actions">
          <button type="button" className="primary-button" onClick={changePassword}>
            تغيير كلمة المرور
          </button>
          <button type="button" className="danger-button" onClick={onLogout}>
            <Icon name="logout" size={16} /> تسجيل الخروج
          </button>
        </div>
      </SectionCard>

      {account.type === "admin" ? (
        <SectionCard title="إعادة الضبط" subtitle="حساب المسؤول لا يُحذف">
          <p className="muted">
            لا يمكن حذف حساب المسؤول. المتاح فقط إعادة ضبط الإعدادات أو إزالة البيانات المؤقتة
            (التفسير والتلاوات المخزّنة على الجهاز) مع بقاء الحساب وبياناتك كما هي.
          </p>
          <div className="form-actions" style={{ marginTop: 10 }}>
            <button type="button" className="ghost-button" onClick={resetAdminSettings}>
              <Icon name="settings" size={16} /> إعادة ضبط الإعدادات
            </button>
            <button type="button" className="ghost-button" onClick={clearTempData}>
              <Icon name="trash" size={16} /> إزالة البيانات المؤقتة
            </button>
          </div>
          {adminResetMessage ? <p className="muted">{adminResetMessage}</p> : null}
        </SectionCard>
      ) : (
        <SectionCard title="حذف الحساب" subtitle="إجراء نهائي لا يمكن التراجع عنه">
          <p className="muted">
            حذف الحساب يمسح بياناتك وتسجيلاتك ومستنداتك وتعريفاتك المحفوظة على هذا الجهاز، ويحذف
            تقدمك في الاختبارات والألغاز والخطط والنقاط. اكتب كلمة <strong>حذف</strong> للتأكيد.
          </p>
          <div className="inline-form">
            <input
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              placeholder="اكتب: حذف"
            />
            <button type="button" className="danger-button" onClick={removeMyAccount} disabled={deleteConfirm.trim() !== "حذف"}>
              <Icon name="trash" size={16} /> حذف الحساب نهائيًا
            </button>
          </div>
          {deleteMessage ? <p className="error-text">{deleteMessage}</p> : null}
        </SectionCard>
      )}
      </>
      )}

      {replyTarget ? (
        <div className="modal-backdrop" onClick={() => setReplyTarget(null)}>
          <div className="modal wide" onClick={(event) => event.stopPropagation()}>
            <h3>الرد على: {replyTarget.subject}</h3>
            <p className="muted">
              {replyTarget.name} • {replyTarget.role} • {replyTarget.contact}
            </p>
            <p>{replyTarget.body}</p>
            <label>
              <span>نص الرد</span>
              <textarea
                value={replyDraft}
                onChange={(event) => setReplyDraft(event.target.value)}
                placeholder="اكتب ردك أو اطلب اقتراحًا من الذكاء الاصطناعي..."
              />
            </label>
            {replyNotice ? <p className="muted">{replyNotice}</p> : null}
            <div className="form-actions">
              <button type="button" className="primary-button" onClick={generateReply} disabled={replyBusy}>
                <Icon name="sparkles" size={16} />
                {replyBusy ? "جارٍ الاقتراح…" : "اقتراح رد بالذكاء الاصطناعي"}
              </button>
              <button type="button" className="success-button" onClick={sendReply} disabled={!replyDraft.trim()}>
                <Icon name="send" size={16} /> إرسال الرد وإغلاق
              </button>
              <button type="button" className="ghost-button" onClick={() => setReplyTarget(null)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
