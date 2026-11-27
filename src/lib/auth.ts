export type AccountType = "student" | "guardian" | "teacher" | "admin";
export type AccountStatus = "active" | "pending" | "rejected";
export type Track = "quran" | "tuhfa" | "both";

export interface StudentProfile {
  track: Track;
  tuhfaLastVerse: number | null;
  surahs: number[];
  juz: number[];
  level: string;
  needsTeacher: boolean;
  teacherId: string | null;
  teacherAccountId?: string | null;
  birthDate: string | null;
}

export interface TeacherProfile {
  juzMemorized: number;
  mujawwad: boolean;
  qiraat: string[];
  hasIjazah: boolean;
  birthDate: string | null;
}

export interface GuardianProfile {
  linkedStudent: string;
  studentUsernames?: string[];
  birthDate: string | null;
}

export interface Account {
  id: string;
  type: AccountType;
  fullName: string;
  username: string;
  /** كلمة مرور قديمة على أجهزة لم تُرقَّ بعد — تُحذف بعد أول دخول. */
  password?: string;
  /** بصمة كلمة المرور (SHA-256 مع ملح عشوائي) — لا تُخزَّن كلمة المرور نفسها. */
  passwordHash?: string;
  passwordSalt?: string;
  countryCode: string;
  phone: string;
  email: string;
  createdAt: number;
  status: AccountStatus;
  student?: StudentProfile;
  teacher?: TeacherProfile;
  guardian?: GuardianProfile;
  rejectionReason?: string;
  banned?: boolean;
}

export interface Complaint {
  id: string;
  accountId: string | null;
  name: string;
  contact: string;
  role: string;
  subject: string;
  body: string;
  status: "open" | "closed";
  createdAt: number;
  reply?: string;
}

export function accountTypeLabel(type: AccountType): string {
  if (type === "student") return "طالب";
  if (type === "teacher") return "معلم";
  if (type === "admin") return "مسؤول";
  return "ولي أمر";
}

// Supabase integration
import {
  accountFromRow,
  changePasswordInCloud,
  cloud,
  hasCloudSession,
  pullCloud,
  pushAccount,
  registerInCloud,
  removeAccountFromCloud,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} from "./cloud";
import { ApiError } from "./api";
import { authorizeDevice } from "./nativePush";
import { revokeSession, saveSessionToken } from "./sessionStore";
import { clearRememberedDevice, getRememberedAccountId, rememberThisDevice } from "./rememberedDevice.mjs";
export { rememberThisDevice };
import { hashPassword, newPasswordSalt, verifyPassword } from "./password";
import { loginViaRpc, type RpcAccountRow } from "./authRpc";

/** عميل Supabase المشترك (رابط المشروع والمفتاح العام في lib/cloud.ts). */
export const supabase = cloud;

// localStorage helpers
const STORAGE_KEY = "thimar_accounts";

function loadFromLocalStorage(): Account[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveToLocalStorage(accounts: Account[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch {}
}

/* لا تُزرع حسابات بكلمات مرور مكتوبة في الكود: الحسابات تأتي من قاعدة البيانات. */

export function loadAccounts(): Account[] {
  const stored = loadFromLocalStorage();
  // نتخلص من أي حسابات تجريبية قديمة زُرعت سابقًا بكلمات مرور معروفة.
  const filtered = stored.filter((a) => !a.id.startsWith("test-"));
  if (filtered.length !== stored.length) saveToLocalStorage(filtered);
  return filtered;
}

export async function loadAccountsFromSupabase(): Promise<Account[]> {
  /* كل الحسابات تأتي من `pull` المحمي بالجلسة؛ لا قراءة مباشرة للجدول. */
  if (hasCloudSession()) await pullCloud();
  return loadAccounts();
}


/** يُعلم مراقبة الأخطاء بالهوية الحالية بعد نجاح الدخول. */
function announceSignedIn(account: Account): void {
  try {
    window.dispatchEvent(
      new CustomEvent("thimar:signed-in", { detail: { accountId: account.id, role: account.type } }),
    );
  } catch {
    /* ignore */
  }
}

export function findAccountByUsername(username: string): Account | undefined {
  const accounts = loadAccounts();
  return accounts.find((a) => a.username.trim().toLowerCase() === username.trim().toLowerCase());
}

function registerErrorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "";
  if (code === "USERNAME_TAKEN") return "اسم المستخدم مستخدم بالفعل.";
  if (code === "WEAK_PASSWORD") return "كلمة المرور 8 أحرف على الأقل.";
  if (code === "INVALID_TYPE") return "لا يمكن إنشاء حساب بهذا النوع.";
  if (code === "FORBIDDEN") return "غير مسموح بإنشاء هذا الحساب.";
  if (code === "NETWORK") return "تحتاج اتصالًا بالإنترنت لإنشاء الحساب.";
  return "تعذّر إنشاء الحساب. تحقق من البيانات وحاول مرة أخرى.";
}

export async function createAccount(input: {
  type: AccountType;
  fullName: string;
  username: string;
  password: string;
  countryCode?: string;
  phone?: string;
  email?: string;
  birthDate?: string | null;
}): Promise<Account> {
  /* الإنشاء يتم على الخادم: النوع المسموح والحالة الابتدائية يقرّرهما هو. */
  let result: { account: any };
  try {
    result = await registerInCloud(
      {
        type: input.type,
        fullName: input.fullName,
        username: input.username,
        password: input.password,
        countryCode: input.countryCode,
        phone: input.phone,
        email: input.email,
        student:
          input.type === "student"
            ? {
                track: "quran",
                tuhfaLastVerse: null,
                surahs: [],
                juz: [],
                level: "A1",
                needsTeacher: false,
                teacherId: null,
                birthDate: input.birthDate ?? null,
              }
            : undefined,
        teacher:
          input.type === "teacher"
            ? {
                juzMemorized: 0,
                mujawwad: false,
                qiraat: ["حفص"],
                hasIjazah: false,
                birthDate: input.birthDate ?? null,
              }
            : undefined,
        guardian:
          input.type === "guardian"
            ? { linkedStudent: "", studentUsernames: [], birthDate: input.birthDate ?? null }
            : undefined,
      },
      { adoptSession: false },
    );
  } catch (error) {
    throw new Error(registerErrorMessage(error));
  }
  const account = accountFromRow(result.account);
  saveToLocalStorage([...loadAccounts().filter((item) => item.id !== account.id), account]);
  return account;
}

export function updateAccount(id: string, patch: Partial<Account>): Account | null {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  accounts[idx] = { ...accounts[idx], ...patch };
  // بعد الترقية إلى البصمة لا تبقى كلمة المرور النصية على الجهاز.
  if (patch.passwordHash) delete accounts[idx].password;
  saveToLocalStorage(accounts);
  /* الحفظ على الخادم: `account.update` لحسابي أو `admin.account.update` للمسؤول. */
  void pushAccount(accounts[idx]);
  return accounts[idx];
}

export function setAccountStatus(id: string, status: AccountStatus, reason?: string): void {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx !== -1) {
    accounts[idx].status = status;
    if (reason) accounts[idx].rejectionReason = reason;
    saveToLocalStorage(accounts);
    void pushAccount(accounts[idx]);
  }
}

export function banAccount(id: string, reason?: string): void {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx !== -1) {
    accounts[idx].banned = true;
    accounts[idx].status = "rejected";
    accounts[idx].rejectionReason = reason?.trim() || "تم حظر الحساب من قبل المسؤول.";
    saveToLocalStorage(accounts);
    void pushAccount(accounts[idx]);
  }
}

export function unbanAccount(id: string): void {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx !== -1) {
    accounts[idx].banned = false;
    accounts[idx].status = "active";
    delete accounts[idx].rejectionReason;
    saveToLocalStorage(accounts);
    void pushAccount(accounts[idx]);
  }
}

/** يدمج صفًّا عاد من الخادم في حساب محلي (دون فقدان أي حقل محلي). */
function mergeRpcAccount(row: RpcAccountRow): Account {
  const accounts = loadAccounts();
  const existing =
    accounts.find((a) => a.id === row.id) ??
    accounts.find((a) => a.username.trim().toLowerCase() === row.username.trim().toLowerCase());
  const base: Account = existing ?? {
    id: row.id,
    type: row.type as Account["type"],
    fullName: row.fullName ?? row.username,
    username: row.username,
    countryCode: row.countryCode ?? "SA",
    phone: row.phone ?? "",
    email: row.email ?? "",
    createdAt: Date.now(),
    status: "active" as Account["status"],
    banned: false,
  };
  const merged: Account = {
    ...base,
    id: row.id,
    type: (row.type as Account["type"]) ?? base.type,
    fullName: row.fullName ?? base.fullName,
    username: row.username,
    countryCode: row.countryCode ?? base.countryCode,
    phone: row.phone ?? base.phone,
    email: row.email ?? base.email,
    status: (row.status as Account["status"]) ?? base.status,
    banned: row.banned ?? base.banned,
  };
  if (row.student !== undefined) merged.student = row.student as Account["student"];
  if (row.teacher !== undefined) merged.teacher = row.teacher as Account["teacher"];
  if (row.guardian !== undefined) merged.guardian = row.guardian as Account["guardian"];
  if (existing) saveToLocalStorage(accounts.map((a) => (a.id === merged.id ? merged : a)));
  else saveToLocalStorage([...accounts, merged]);
  return merged;
}

/** يطلب رمز جلسة موقّع من الخادم ويحفظه محليًا (للمكالمات/العمليات المحمية). */
async function issueSessionToken(username: string, password: string): Promise<void> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/thimar-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    if (data?.token) saveSessionToken(String(data.token));
  } catch {
    /* الشبكة غير متاحة — تبقى الجلسة بدون رمز (توافق). */
  }
}

export async function login(username: string, password: string, remember = false): Promise<{ status: "ok" | "pending" | "error"; account?: Account; message?: string }> {
  /* التحقق على الخادم (RPC) — محاولة أولًا (لا يُعطل الدخول إذا كانت الدالة غير منشورة). */
  const viaRpc = await loginViaRpc(username, password);
  if (viaRpc.status === "error") return { status: "error", message: viaRpc.message };
  if (viaRpc.status === "ok") {
    const account = mergeRpcAccount(viaRpc.account);
    if (account.status === "pending") return { status: "pending", account, message: "حسابك قيد المراجعة." };
    if (account.banned) return { status: "error", message: "تم حظر حسابك من قبل المسؤول." };
    if (account.status === "rejected") return { status: "error", message: "تم رفض حسابك من قبل المسؤول." };
    if (remember) {
      rememberThisDevice(account.id);
    } else {
      clearRememberedDevice();
    }
      const nativeDeviceId = (window as any)?.ThimarNative?.deviceId?.();
  if (typeof nativeDeviceId === "string" && nativeDeviceId) {
    void authorizeDevice(account.id, password);
  }
  // إصدار رمز جلسة موقّع من الخادم (للمكالمات والعمليات المحمية).
  void issueSessionToken(username, password);
  // بصمة محلية للسماح بالدخول دون إنترنت على هذا الجهاز.
  const localSalt = newPasswordSalt();
  const localHash = await hashPassword(password, localSalt);
  updateAccount(account.id, { passwordHash: localHash, passwordSalt: localSalt });
  void pullCloud();
  announceSignedIn(account);
  return { status: "ok", account };
    }
  /* unavailable: الدالتان غير منشورتين — نكمل بالمسار المحلي (توافق). */
  const accounts = loadAccounts();
  const normalized = username.trim().toLowerCase();
  const account = accounts.find((a) => a.username.trim().toLowerCase() === normalized);
  if (!account) return { status: "error", message: "اسم المستخدم أو كلمة المرور غير صحيحة." };
  const valid = account.passwordHash && account.passwordSalt
    ? await verifyPassword(password, account.passwordSalt, account.passwordHash)
    : account.password !== undefined && account.password === password;
  if (!valid) return { status: "error", message: "اسم المستخدم أو كلمة المرور غير صحيحة." };
  // ترقية الحسابات القديمة: تُستبدل كلمة المرور النصية ببصمة محفوظة.
  if (!account.passwordHash || !account.passwordSalt) {
    const salt = newPasswordSalt();
    const hash = await hashPassword(password, salt);
    const upgraded = updateAccount(account.id, { passwordHash: hash, passwordSalt: salt });
    if (upgraded) {
      account.passwordHash = hash;
      account.passwordSalt = salt;
      delete account.password;
    }
  }
  if (account.status === "pending") return { status: "pending", account, message: "حسابك قيد المراجعة." };
  if (account.banned) return { status: "error", message: "تم حظر حسابك من قبل المسؤول." };
  if (account.status === "rejected") return { status: "error", message: "تم رفض حسابك من قبل المسؤول." };
  if (remember) {
    rememberThisDevice(account.id);
  } else {
    clearRememberedDevice();
  }
  const nativeDeviceId = (window as any)?.ThimarNative?.deviceId?.();
  if (typeof nativeDeviceId === "string" && nativeDeviceId) {
    void authorizeDevice(account.id, password);
  }
  // إصدار رمز جلسة موقّع من الخادم.
  void issueSessionToken(username, password);
  announceSignedIn(account);
  return { status: "ok", account };
}

export async function registerAccount(data: any): Promise<{ ok: true; account: Account } | { ok: false; message: string }> {
  const username = String(data.username ?? "").trim();
  if (loadAccounts().some((a) => a.username.trim().toLowerCase() === username.toLowerCase())) {
    return { ok: false, message: "اسم المستخدم مستخدم بالفعل." };
  }
  if (String(data.password ?? "").length < 8) {
    return { ok: false, message: "كلمة المرور 8 أحرف على الأقل." };
  }
  let result: { account: any };
  try {
    result = await registerInCloud({
      type: data.type,
      fullName: data.fullName,
      username,
      password: data.password,
      countryCode: data.countryCode,
      phone: data.phone,
      email: data.email,
      student: data.student,
      teacher: data.teacher,
      guardian: data.guardian,
    });
  } catch (error) {
    return { ok: false, message: registerErrorMessage(error) };
  }
  const account = accountFromRow(result.account);
  const localSalt = newPasswordSalt();
  account.passwordSalt = localSalt;
  account.passwordHash = await hashPassword(String(data.password ?? ""), localSalt);
  saveToLocalStorage([...loadAccounts().filter((item) => item.id !== account.id), account]);
  const nativeDeviceId = (window as any)?.ThimarNative?.deviceId?.();
  if (typeof nativeDeviceId === "string" && nativeDeviceId && data?.password) {
    void authorizeDevice(account.id, String(data.password));
  }
  void pullCloud();
  return { ok: true, account };
}

export function restoreRememberedAccount(): Account | null {
  const id = getRememberedAccountId();
  if (!id) return null;
  const accounts = loadAccounts();
  return accounts.find((a) => a.id === id) || null;
}

/** يحذف الحساب نهائيًا من هذا الجهاز (مع بياناته المحلية). */
export function deleteAccount(accountId: string): boolean {
  if (!accountId) return false;
  const accounts = loadAccounts().filter((account) => account.id !== accountId);
  saveToLocalStorage(accounts);
  // حذف موثّق: يبقى في طابور الحذف حتى يُنفَّذ في قاعدة البيانات ولو كان الجهاز دون إنترنت.
  void removeAccountFromCloud(accountId);
  // لا نُسجّل خروج المسؤول عند حذف مستخدم آخر.
  try {
    if (localStorage.getItem("thimar_remembered") === accountId) signOut();
  } catch {
    /* ignore */
  }
  return true;
}

export function signOut(): void {
  /* إبطال الجلسة على الخادم (فتسقط فورًا حتى لو بقي الرمز صالح التوقيع). */
  void revokeSession();
  clearRememberedDevice();
  /* إلغاء ربط جهاز هذا الحساب بإشعارات FCM (إن كنا داخل تطبيق أندرويد). */
  try {
    window.dispatchEvent(new Event("thimar:signout"));
  } catch {}
}

// Complaints
export function loadComplaints(): Complaint[] {
  try {
    const raw = localStorage.getItem("thimar_complaints");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function addComplaint(data: any): Complaint {
  const complaint: Complaint = {
    id: `cmp-${Date.now()}`,
    accountId: data.accountId || null,
    name: data.name || "",
    contact: data.contact || "",
    role: data.role || "",
    subject: data.subject || "",
    body: data.body || "",
    status: "open",
    createdAt: Date.now(),
  };
  const complaints = loadComplaints();
  complaints.push(complaint);
  try {
    localStorage.setItem("thimar_complaints", JSON.stringify(complaints));
  } catch {}
  return complaint;
}

export function resolveComplaint(id: string, reply: string): void {
  const complaints = loadComplaints();
  const idx = complaints.findIndex((c) => c.id === id);
  if (idx !== -1) {
    complaints[idx].status = "closed";
    complaints[idx].reply = reply;
    try {
      localStorage.setItem("thimar_complaints", JSON.stringify(complaints));
    } catch {}
  }
}

export function reopenComplaint(id: string): void {
  const complaints = loadComplaints();
  const idx = complaints.findIndex((c) => c.id === id);
  if (idx !== -1) {
    complaints[idx].status = "open";
    try {
      localStorage.setItem("thimar_complaints", JSON.stringify(complaints));
    } catch {}
  }
}

// Homework
export function loadHomework(): any[] {
  try {
    const raw = localStorage.getItem("thimar_homework");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function loadSubmissions(): any[] {
  try {
    const raw = localStorage.getItem("thimar_submissions");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function addHomework(data: any): any {
  return { id: `hw-${Date.now()}`, ...data };
}

export function homeworkSurahRange(): number[] {
  return [1];
}

export function gradeHomeworkSurah(): void {}

export function addSubmission(data: any): any {
  return { id: `sub-${Date.now()}`, ...data };
}

export function evaluateSubmission(_id: string, _score: number, _feedback: string): void {}

// Notifications
export function loadNotifications(): any[] {
  try {
    const raw = localStorage.getItem("thimar_notifications");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function addNotification(_data: any): void {}

export function notificationsFor(accountId: string): any[] {
  return loadNotifications().filter((n: any) => n.accountId === accountId);
}

export function unreadCount(accountId: string): number {
  return notificationsFor(accountId).filter((n: any) => !n.read).length;
}

export function markAllNotificationsRead(_accountId: string): void {}

export function markNotificationRead(_id: string): void {}

export async function ensureHomeworkSeeds(): Promise<void> {}
export async function ensureNotificationSeeds(): Promise<void> {}

// Password change helper
export async function changePassword(
  accountId: string,
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; message: string }> {
  if (!loadAccounts().some((a) => a.id === accountId)) {
    return { ok: false, message: "الحساب غير موجود." };
  }
  if (newPassword.length < 8) {
    return { ok: false, message: "كلمة المرور الجديدة 8 أحرف على الأقل." };
  }
  /* التحقق من كلمة المرور القديمة والتحديث يحدثان على الخادم فقط. */
  const failure = await changePasswordInCloud(oldPassword, newPassword);
  if (failure) return { ok: false, message: failure };
  const passwordSalt = newPasswordSalt();
  const passwordHash = await hashPassword(newPassword, passwordSalt);
  updateAccount(accountId, { passwordHash, passwordSalt });
  const nativeDeviceId = (window as any)?.ThimarNative?.deviceId?.();
  if (typeof nativeDeviceId === "string" && nativeDeviceId) {
    /* الخادم أبطل تفويض كل الأجهزة مع تغيير كلمة المرور؛ نُعيد تفويض هذا الجهاز. */
    const deviceSecret = await authorizeDevice(accountId, newPassword);
    if (!deviceSecret) {
      return {
        ok: true,
        message: "تم تغيير كلمة المرور بنجاح، لكن تعذّر إعادة تفويض هذا الجهاز. أعد تسجيل الدخول.",
      };
    }
  }
  return { ok: true, message: "تم تغيير كلمة المرور بنجاح." };
}
