/**
 * مزامنة بيانات التطبيق مع الخادم.
 *
 * التخزين المحلي (localStorage) يبقى المصدر الذي تقرأ منه الواجهة فورًا،
 * وهذه الطبقة تدفع كل تغيير إلى الخادم وتسحب الجديد منه.
 *
 * كل شيء يمرّ الآن عبر `public.thimar_api` (انظر lib/api.ts): لا وصول مباشر
 * إلى جداول PostgREST، والخادم يشتقّ هوية المستخدم من رمز الجلسة.
 */
import { createClient } from "@supabase/supabase-js";
import { ApiError, apiCall, clearApiSession, currentToken, getApiSession, setApiSession } from "./api";
import type { Account } from "./auth";
import type {
  AppNotification,
  ChatMessage,
  Conversation,
  GuardianLinkRequest,
  Homework,
  Submission,
  TeacherLinkRequest,
} from "./appStore";

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://jbsvmpiwdwowizzfzlqr.supabase.co";

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impic3ZtcGl3ZHdvd2l6emZ6bHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NDU2NzksImV4cCI6MjEwMjAyMTY3OX0.CPq3jBruh47_ZS8i_W7FKs_dRWynrQi2znSTzHMJEQk";

/** العميل العام: يُستخدم للمصادقة الحقيقية والقنوات اللحظية فقط (لا لجداول البيانات). */
export const cloud = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const CLOUD_EVENT = "thimar:cloud";

export const CLOUD_KEYS = {
  accounts: "thimar_accounts",
  notifications: "thimar.notifications.v1",
  teacherLinks: "thimar.teacherLinkRequests.v1",
  guardianLinks: "thimar.guardianLinkRequests.v1",
  homework: "thimar.homework.v1",
  submissions: "thimar.submissions.v1",
  sessions: "thimar.sessions.v1",
  resetRequests: "thimar.resetRequests.v1",
  mediaRefs: "thimar.mediaRefs.v1",
} as const;

/** حسابات حُذفت محليًا وينتظر حذفها من قاعدة البيانات. */
const DELETED_ACCOUNTS_KEY = "thimar.deletedAccounts.v1";
/** حسابات أُنشئت/عُدّلت محليًا وتنتظر الرفع إلى قاعدة البيانات. */
const PENDING_ACCOUNTS_KEY = "thimar.pendingAccounts.v1";
/** حسابات تأكد رفعها إلى قاعدة البيانات مرة واحدة على الأقل. */
const UPLOADED_ACCOUNTS_KEY = "thimar.uploadedAccounts.v1";
/** بصمات آخر ما رُفع، لتجنّب إعادة إرسال ما لم يتغيّر. */
const PUSHED_KEY = "thimar.pushed.v1";

type DeletionEntity = "account" | "notification" | "message" | "conversation";

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** لا نحاول الكتابة إلى السحابة بلا إنترنت: البيانات تُحفظ محليًا وتُرسل عند العودة. */
function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function warn(label: string, error: unknown) {
  console.warn(`Thimar cloud sync (${label}):`, error);
}

function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : "ERROR";
}

/** هل الجلسة الحالية تسمح بالمزامنة؟ */
export function hasCloudSession(): boolean {
  return Boolean(getApiSession());
}

function readIdSet(key: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeIdSet(key: string, ids: Set<string>): void {
  writeLocal(key, [...ids]);
}

function readPushed(): Record<string, string> {
  return readLocal<Record<string, string>>(PUSHED_KEY, {});
}

/** يعيد الصفوف التي تغيّر محتواها فقط. */
function changedRows<T>(rows: T[], slice: (row: T) => string, key: (row: T) => string): T[] {
  const cache = readPushed();
  return rows.filter((row) => cache[slice(row)] !== key(row));
}

function markPushed(entries: Record<string, string>): void {
  const cache = { ...readPushed(), ...entries };
  const keys = Object.keys(cache);
  if (keys.length > 3000) {
    const trimmed: Record<string, string> = {};
    keys.slice(-2000).forEach((key) => {
      trimmed[key] = cache[key];
    });
    writeLocal(PUSHED_KEY, trimmed);
    return;
  }
  writeLocal(PUSHED_KEY, cache);
}

/* ---------------- الجلسة ---------------- */

export async function loginInCloud(
  username: string,
  password: string,
  deviceId?: string,
): Promise<{ account: any; token: string; expiresAt?: string }> {
  const result = await apiCall<{ token: string; expiresAt?: string; account: any }>("login", {
    username,
    password,
    deviceId: deviceId ?? null,
    platform: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : null,
  });
  setApiSession({ token: result.token, accountId: result.account.id, expiresAt: result.expiresAt });
  return result;
}

export async function logoutFromCloud(): Promise<void> {
  try {
    await apiCall("logout");
  } catch {
    /* الجلسة تُمسح محليًا على أي حال */
  }
  clearApiSession();
}

/* ---------------- الحسابات ---------------- */

export function accountToRow(account: Account) {
  return {
    id: account.id,
    type: account.type,
    full_name: account.fullName,
    username: account.username,
    country_code: account.countryCode,
    phone: account.phone,
    email: account.email,
    created_at: account.createdAt,
    status: account.status,
    rejection_reason: account.rejectionReason ?? null,
    banned: account.banned ?? false,
    student: account.student ?? null,
    teacher: account.teacher ?? null,
    guardian: account.guardian ?? null,
  };
}

export function accountFromRow(row: any): Account {
  return {
    id: row.id,
    type: row.type,
    fullName: row.full_name,
    username: row.username,
    countryCode: row.country_code ?? "SA",
    phone: row.phone ?? "",
    email: row.email ?? "",
    createdAt: Number(row.created_at ?? 0),
    status: row.status ?? "active",
    student: row.student ?? undefined,
    teacher: row.teacher ?? undefined,
    guardian: row.guardian ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    banned: Boolean(row.banned),
  };
}

/** يوحّد الحسابات بحيث لا يتكرر اسم المستخدم (قيد unique في القاعدة). */
export function dedupeAccounts(list: Account[]): Account[] {
  const seenIds = new Set<string>();
  const seenUsernames = new Set<string>();
  const result: Account[] = [];
  for (const account of list) {
    const username = String(account.username ?? "").trim().toLowerCase();
    if (!username || seenIds.has(account.id) || seenUsernames.has(username)) continue;
    seenIds.add(account.id);
    seenUsernames.add(username);
    result.push(account);
  }
  return result;
}

export type RegisterInput = {
  id?: string;
  type: string;
  fullName: string;
  username: string;
  password: string;
  countryCode?: string;
  phone?: string;
  email?: string;
  student?: unknown;
  teacher?: unknown;
  guardian?: unknown;
};

/** إنشاء حساب: الخادم يقرّر النوع المسموح والحالة الابتدائية ويصدر الجلسة. */
export async function registerInCloud(
  input: RegisterInput,
  options: { adoptSession?: boolean } = {},
): Promise<{
  account: any;
  token: string;
  expiresAt?: string;
}> {
  const result = await apiCall<{ token: string; expiresAt?: string; account: any }>("register", {
    account: {
      id: input.id ?? null,
      type: input.type,
      fullName: input.fullName,
      username: input.username,
      countryCode: input.countryCode ?? "SA",
      phone: input.phone ?? "",
      email: input.email ?? "",
      student: input.student ?? null,
      teacher: input.teacher ?? null,
      guardian: input.guardian ?? null,
    },
    password: input.password,
  });
  /* عند إنشاء حساب من لوحة المسؤول لا نتبنّى جلسة المستخدم الجديد. */
  if (options.adoptSession !== false) {
    setApiSession({ token: result.token, accountId: result.account.id, expiresAt: result.expiresAt });
  }
  return result;
}

/**
 * يرفع تعديلات الحساب. تعديل حسابي يمرّ بـ`account.update`،
 * وتعديل حساب آخر يمرّ بـ`admin.account.update` (يرفضه الخادم لغير المسؤول).
 */
export async function pushAccount(account: Account): Promise<void> {
  queueAccountPush(account);
  if (!isOnline()) return;
  const session = getApiSession();
  if (!session) return;
  try {
    if (session.accountId === account.id) {
      await apiCall("account.update", {
        fullName: account.fullName,
        phone: account.phone,
        email: account.email,
        countryCode: account.countryCode,
        student: account.student ?? null,
        teacher: account.teacher ?? null,
        guardian: account.guardian ?? null,
      });
    } else {
      await apiCall("admin.account.update", {
        accountId: account.id,
        status: account.status,
        banned: Boolean(account.banned),
        type: account.type,
        rejectionReason: account.rejectionReason ?? null,
      });
    }
    removePendingAccount(account.id);
    markAccountsUploaded([account.id]);
  } catch (error) {
    warn("pushAccount", error);
  }
}

/** يرفع كل حساب تغيّر (يُستخدم في المزامنة الدورية). */
export async function pushAccounts(accounts: Account[]): Promise<void> {
  for (const account of dedupeAccounts(accounts)) {
    await pushAccount(account);
  }
}

function readDeletedAccounts(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DELETED_ACCOUNTS_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeDeletedAccounts(ids: string[]): void {
  writeLocal(DELETED_ACCOUNTS_KEY, [...new Set(ids)]);
}

/** يسجّل حذف حساب حتى يُنفَّذ على الخادم عند توفر الإنترنت. */
export function queueAccountDeletion(accountId: string): void {
  if (!accountId) return;
  writeDeletedAccounts([...readDeletedAccounts(), accountId]);
  removePendingAccount(accountId);
  unmarkAccountsUploaded([accountId]);
  void flushAccountDeletions();
}

export function isAccountDeleted(accountId: string): boolean {
  return readDeletedAccounts().includes(accountId);
}

async function flushAccountDeletions(): Promise<void> {
  const ids = readDeletedAccounts();
  if (!ids.length || !isOnline() || !getApiSession()) return;
  const done: string[] = [];
  for (const id of ids) {
    try {
      await apiCall("account.delete", { accountId: id });
      done.push(id);
    } catch (error) {
      /* لا نُبقي الحساب في الطابور إن رفض الخادم الحذف نهائيًا. */
      if (["FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED"].includes(errorCode(error))) done.push(id);
    }
  }
  if (done.length) writeDeletedAccounts(readDeletedAccounts().filter((id) => !done.includes(id)));
}

function readUploadedAccounts(): Set<string> {
  return readIdSet(UPLOADED_ACCOUNTS_KEY);
}

function markAccountsUploaded(ids: string[]): void {
  const uploaded = readUploadedAccounts();
  ids.forEach((id) => uploaded.add(id));
  writeIdSet(UPLOADED_ACCOUNTS_KEY, uploaded);
}

function unmarkAccountsUploaded(ids: string[]): void {
  const uploaded = readUploadedAccounts();
  ids.forEach((id) => uploaded.delete(id));
  writeIdSet(UPLOADED_ACCOUNTS_KEY, uploaded);
}

function readPendingAccounts(): Record<string, Account> {
  return readLocal<Record<string, Account>>(PENDING_ACCOUNTS_KEY, {});
}

function queueAccountPush(account: Account): void {
  if (!account?.id) return;
  const pending = readPendingAccounts();
  pending[account.id] = account;
  writeLocal(PENDING_ACCOUNTS_KEY, pending);
}

function removePendingAccount(accountId: string): void {
  const pending = readPendingAccounts();
  if (!pending[accountId]) return;
  delete pending[accountId];
  writeLocal(PENDING_ACCOUNTS_KEY, pending);
}

async function flushPendingAccounts(): Promise<void> {
  const pending = Object.values(readPendingAccounts());
  if (!pending.length || !isOnline() || !getApiSession()) return;
  for (const account of pending) {
    if (account.id === getApiSession()?.accountId) await pushAccount(account);
    else removePendingAccount(account.id);
  }
}

export async function removeAccountFromCloud(accountId: string): Promise<void> {
  queueAccountDeletion(accountId);
  await flushAccountDeletions();
}

/* ---------------- الإشعارات ---------------- */

function notificationToRow(notification: AppNotification) {
  return {
    id: notification.id,
    recipient_id: notification.recipientId,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    target: notification.target ?? null,
    action: notification.action ?? null,
    read: Boolean(notification.read),
    created_at: notification.createdAt,
  };
}

function rowToNotification(row: any): AppNotification {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    kind: row.kind ?? "system",
    title: row.title ?? "",
    body: row.body ?? "",
    createdAt: Number(row.created_at ?? 0),
    read: Boolean(row.read),
    target: row.target ?? undefined,
    action: row.action ?? undefined,
  };
}

/** يرفع الإشعارات الجديدة أو التي تغيّر نصّها/حالتها فقط. */
export async function pushNotifications(notifications: AppNotification[]): Promise<void> {
  if (!isOnline() || !notifications.length || !getApiSession()) return;
  const rows = notifications
    .filter((item) => Boolean(item?.id) && Boolean(item?.recipientId))
    .map(notificationToRow);
  const pending = changedRows(
    rows,
    (row) => `ntf:${row.id}`,
    (row) => `${row.read ? 1 : 0}|${row.title}|${row.body}`,
  );
  if (!pending.length) return;
  try {
    await apiCall("notifications.push", { rows: pending });
    markPushed(
      Object.fromEntries(
        pending.map((row) => [`ntf:${row.id}`, `${row.read ? 1 : 0}|${row.title}|${row.body}`]),
      ),
    );
  } catch (error) {
    warn("pushNotifications", error);
  }
}

export async function deleteNotificationsFromCloud(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const tombstoned = readDeletedNotifications();
  ids.forEach((id) => tombstoned.add(id));
  writeDeletedNotifications(tombstoned);
  if (!isOnline() || !getApiSession()) return;
  try {
    await apiCall("notifications.delete", { ids });
  } catch (error) {
    warn("deleteNotifications", error);
  }
}

/** إشعارات حُذفت ولا يجوز أن تعود من السحب. */
const DELETED_NOTIFICATIONS_KEY = "thimar.deletedNotifications.v1";

function readDeletedNotifications(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DELETED_NOTIFICATIONS_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeDeletedNotifications(ids: Set<string>): void {
  writeLocal(DELETED_NOTIFICATIONS_KEY, [...ids]);
}

/** إشعار لكل مسؤول نشط (يُستخدم لطلبات اعتماد المعلمين والشكاوى). */
export async function notifyAdminsInCloud(input: {
  title: string;
  body: string;
  kind?: string;
  target?: string;
}): Promise<string[]> {
  if (!isOnline() || !getApiSession()) return [];
  try {
    const result = await apiCall<{ adminIds: string[] }>("notify.admins", input);
    return Array.isArray(result?.adminIds) ? result.adminIds : [];
  } catch (error) {
    warn("notifyAdmins", error);
    return [];
  }
}

/* ---------------- طلبات الربط ---------------- */

type AnyLinkRequest = TeacherLinkRequest | GuardianLinkRequest;

function linkKind(request: AnyLinkRequest): "teacher" | "guardian" {
  return "teacherId" in request ? "teacher" : "guardian";
}

export async function pushLinkRequests(requests: AnyLinkRequest[]): Promise<void> {
  if (!isOnline() || !getApiSession()) return;
  const rows = requests
    .filter((request) => Boolean(request?.id))
    .map((request) => {
      const createdAt = Number(request.createdAt) || Date.now();
      const status = request.status ?? "pending";
      return {
        id: request.id,
        kind: linkKind(request),
        status,
        created_at: createdAt,
        payload: { ...request, createdAt, status },
      };
    });
  const pending = changedRows(rows, (row) => `link:${row.id}`, (row) => `${row.status}`);
  if (!pending.length) return;
  try {
    await apiCall("links.push", { rows: pending });
    markPushed(Object.fromEntries(pending.map((row) => [`link:${row.id}`, `${row.status}`])));
  } catch (error) {
    warn("pushLinkRequests", error);
  }
}

function rowToLinkRequests(rows: any[]): AnyLinkRequest[] {
  return rows
    .map((row) => {
      const payload = (row.payload ?? {}) as AnyLinkRequest;
      return { ...payload, status: row.status ?? payload.status ?? "pending" } as AnyLinkRequest;
    })
    .filter((request) => Boolean(request?.id));
}

/* ---------------- الوسائط ---------------- */

/** مراجع الوسائط (`thimar-media:<uuid>`) محوَّلة إلى روابط صالحة للعرض في هذا الجهاز. */
const MEDIA_CACHE = new Map<string, string>();
const MEDIA_PENDING = new Map<string, Promise<string | null>>();
const MEDIA_LISTENERS = new Set<() => void>();

export function isMediaRef(value?: string): boolean {
  return typeof value === "string" && value.startsWith("thimar-media:");
}

/** يربط مرجعًا محليًا برابط قابل للعرض فورًا (بعد الرفع من هذا الجهاز). */
export function rememberMediaRef(ref: string, url: string): void {
  if (!isMediaRef(ref) || !url) return;
  MEDIA_CACHE.set(ref, url);
  MEDIA_LISTENERS.forEach((listener) => listener());
}

export function onMediaResolved(listener: () => void): () => void {
  MEDIA_LISTENERS.add(listener);
  return () => MEDIA_LISTENERS.delete(listener);
}

export function cachedMediaUrl(ref?: string): string | undefined {
  if (!ref) return undefined;
  return MEDIA_CACHE.get(ref);
}

/** يجلب وسيطًا محميًا من الخادم ويعيد رابط blob صالحًا للعرض. */
export async function resolveMediaUrl(ref?: string): Promise<string | null> {
  if (!ref) return null;
  if (!isMediaRef(ref)) return ref;
  const cached = MEDIA_CACHE.get(ref);
  if (cached) return cached;
  const running = MEDIA_PENDING.get(ref);
  if (running) return running;
  if (!isOnline() || !getApiSession()) return null;
  const task = (async () => {
    try {
      const result = await apiCall<{ data: string; mime: string }>("media.get", { ref });
      const binary = atob(result.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mime || "application/octet-stream" }));
      MEDIA_CACHE.set(ref, url);
      MEDIA_LISTENERS.forEach((listener) => listener());
      return url;
    } catch (error) {
      warn("resolveMediaUrl", error);
      return null;
    } finally {
      MEDIA_PENDING.delete(ref);
    }
  })();
  MEDIA_PENDING.set(ref, task);
  return task;
}

/**
 * يرفع وسيطًا (صوت/ملف) عبر الخادم ويعيد مرجعه المحمي.
 * لا شيء يُرفع إلى حاوية عامة.
 */
export async function uploadChatMedia(
  dataUrl: string,
  fileName: string,
  conversationId?: string,
  homeworkId?: string,
): Promise<string | null> {
  if (!isOnline() || !dataUrl || !getApiSession()) return null;
  try {
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, comma);
    const data = dataUrl.slice(comma + 1);
    const mime = meta.split(";")[0] || "application/octet-stream";
    if (data.length > 11 * 1024 * 1024) {
      warn("uploadChatMedia", "MEDIA_TOO_LARGE");
      return null;
    }
    const result = await apiCall<{ ref: string }>("media.put", {
      conversationId: conversationId ?? null,
      homeworkId: homeworkId ?? null,
      fileName: fileName.slice(-80),
      mime,
      data,
    });
    if (!result?.ref) return null;
    /* يُعرض محليًا فورًا بالبيانات الأصلية بدل إعادة تنزيلها. */
    rememberMediaRef(result.ref, dataUrl);
    return result.ref;
  } catch (error) {
    warn("uploadChatMedia", error);
    return null;
  }
}

/* ---------------- المحادثات والرسائل ---------------- */

const CHAT_KEY = "thimar.chat.v1";
/** معرّفات الرسائل التي وصلت إلى قاعدة البيانات. */
const UPLOADED_MESSAGES_KEY = "thimar.uploadedMessages.v1";

function markMessagesUploaded(ids: string[]): void {
  if (!ids.length) return;
  const uploaded = readIdSet(UPLOADED_MESSAGES_KEY);
  ids.forEach((id) => uploaded.add(id));
  writeIdSet(UPLOADED_MESSAGES_KEY, uploaded);
}

function conversationToRow(conversation: Conversation) {
  return {
    id: conversation.id,
    title: conversation.title ?? "",
    is_group: Boolean(conversation.isGroup),
    member_ids: conversation.memberIds ?? [],
    admins: conversation.admins ?? [],
    created_by: conversation.createdBy ?? null,
    created_at: Number(conversation.createdAt) || Date.now(),
    updated_at: Date.now(),
  };
}

function messageToRow(conversationId: string, message: ChatMessage) {
  const ref = isMediaRef(message.audioUrl) ? message.audioUrl : null;
  const remote = message.audioUrl && /^https?:/i.test(message.audioUrl) ? message.audioUrl : null;
  return {
    id: message.id,
    conversation_id: conversationId,
    kind: message.kind ?? "text",
    text: message.text ?? null,
    duration: message.duration ?? null,
    file_name: message.fileName ?? null,
    media_url: ref ?? remote,
    read_by: message.readBy ?? [],
    created_at: Number(message.createdAt) || Date.now(),
  };
}

function rowToConversation(row: any): Conversation {
  return {
    id: row.id,
    title: row.title ?? "",
    isGroup: Boolean(row.is_group),
    memberIds: Array.isArray(row.member_ids) ? row.member_ids : [],
    admins: Array.isArray(row.admins) ? row.admins : [],
    mutedBy: [],
    createdBy: row.created_by ?? "",
    createdAt: Number(row.created_at) || 0,
    messages: [],
  };
}

function rowToChatMessage(row: any): ChatMessage {
  return {
    id: row.id,
    senderId: row.sender_id ?? "",
    kind: (row.kind ?? "text") as ChatMessage["kind"],
    text: row.text ?? undefined,
    duration: row.duration ?? undefined,
    fileName: row.file_name ?? undefined,
    audioUrl: row.media_url ?? undefined,
    readBy: Array.isArray(row.read_by) ? row.read_by : [],
    createdAt: Number(row.created_at) || 0,
  };
}

/** يرفع المحادثات المتغيّرة والرسائل التي لم تُرفع بعد. */
export async function pushChats(conversations: Conversation[]): Promise<void> {
  if (!isOnline() || !conversations.length || !getApiSession()) return;
  try {
    const uploadedMessages = readIdSet(UPLOADED_MESSAGES_KEY);
    const conversationRows = changedRows(
      conversations.map(conversationToRow),
      (row) => `conv:${row.id}`,
      (row) => `${row.title}|${row.member_ids.length}`,
    );
    const messageRows = conversations.flatMap((conversation) =>
      (conversation.messages ?? [])
        .filter((message) => !uploadedMessages.has(message.id))
        .map((message) => messageToRow(conversation.id, message)),
    );
    if (!conversationRows.length && !messageRows.length) return;
    await apiCall("chat.push", { conversations: conversationRows, messages: messageRows });
    markPushed(
      Object.fromEntries(
        conversationRows.map((row) => [
          `conv:${row.id}`,
          `${row.title}|${row.member_ids.length}`,
        ]),
      ),
    );
    markMessagesUploaded(messageRows.map((row) => row.id));
    window.dispatchEvent(new Event(CLOUD_EVENT));
  } catch (error) {
    warn("pushChats", error);
  }
}

/** يحذف رسائل من قاعدة البيانات (عند حذفها في التطبيق). */
export async function deleteMessagesFromCloud(ids: string[]): Promise<void> {
  if (!ids.length || !isOnline() || !getApiSession()) return;
  try {
    await apiCall("chat.deleteMessages", { ids });
    const uploaded = readIdSet(UPLOADED_MESSAGES_KEY);
    ids.forEach((id) => uploaded.delete(id));
    writeIdSet(UPLOADED_MESSAGES_KEY, uploaded);
  } catch (error) {
    warn("deleteMessagesFromCloud", error);
  }
}

/** يحذف محادثة كاملة ورسائلها من قاعدة البيانات. */
export async function deleteConversationFromCloud(id: string): Promise<void> {
  if (!id || !isOnline() || !getApiSession()) return;
  try {
    await apiCall("chat.deleteConversation", { conversationId: id });
  } catch (error) {
    warn("deleteConversationFromCloud", error);
  }
}

/** يدمج محادثات السحابة مع المحلي مع الحفاظ على الملفات المحلية. */
function mergeChats(
  remoteConversations: Conversation[],
  remoteMessagesByConversation: Map<string, ChatMessage[]>,
  deletedConversations: Set<string>,
  deletedMessages: Set<string>,
): { merged: Conversation[]; pending: Conversation[] } {
  const local = readLocal<Conversation[]>(CHAT_KEY, []);
  const uploaded = readIdSet(UPLOADED_MESSAGES_KEY);
  const merged: Conversation[] = [];
  const pending: Conversation[] = [];
  const remoteIds = new Set<string>();

  for (const conversation of remoteConversations) {
    if (deletedConversations.has(conversation.id)) continue;
    remoteIds.add(conversation.id);
    const localConversation = local.find((item) => item.id === conversation.id);
    const remote = (remoteMessagesByConversation.get(conversation.id) ?? []).filter(
      (message) => !deletedMessages.has(message.id),
    );
    const remoteMessageIds = new Set(remote.map((message) => message.id));
    const localMessages = (localConversation?.messages ?? []).filter(
      (message) => !deletedMessages.has(message.id),
    );
    /* رسائل محلية لم تُرفع بعد (أُنشئت دون إنترنت) تُحفظ وتُرفع. */
    const unsent = localMessages.filter(
      (message) => !remoteMessageIds.has(message.id) && !uploaded.has(message.id),
    );
    const withMedia = remote.map((message) => {
      const localMessage = localMessages.find((item) => item.id === message.id);
      const readBy = [...new Set([...(message.readBy ?? []), ...(localMessage?.readBy ?? [])])];
      if (!localMessage) return { ...message, readBy };
      if (localMessage.audioUrl && !isMediaRef(localMessage.audioUrl)) {
        return { ...message, audioUrl: localMessage.audioUrl, readBy };
      }
      return { ...message, readBy };
    });
    merged.push({
      ...conversation,
      messages: [...withMedia, ...unsent].sort((a, b) => a.createdAt - b.createdAt),
    });
    if (unsent.length) pending.push({ ...conversation, messages: unsent });
  }

  for (const conversation of local) {
    if (remoteIds.has(conversation.id) || deletedConversations.has(conversation.id)) continue;
    merged.push(conversation);
    pending.push(conversation);
  }

  return { merged, pending };
}

/* ---------------- الواجبات والتسليمات ---------------- */

export async function pushHomework(items: Homework[]): Promise<void> {
  if (!isOnline() || !items.length || !getApiSession()) return;
  const rows = items
    .filter((item) => Boolean(item?.id))
    .map((item) => ({ id: item.id, data: item }));
  const pending = changedRows(
    rows,
    (row) => `hw:${row.id}`,
    (row) => JSON.stringify(row.data),
  );
  if (!pending.length) return;
  try {
    await apiCall("homework.push", { rows: pending });
    markPushed(Object.fromEntries(pending.map((row) => [`hw:${row.id}`, JSON.stringify(row.data)])));
  } catch (error) {
    warn("pushHomework", error);
  }
}

export async function deleteHomeworkFromCloud(homeworkId: string): Promise<void> {
  if (!homeworkId || !isOnline() || !getApiSession()) return;
  try {
    await apiCall("homework.delete", { homeworkId });
    const cache = readPushed();
    delete cache[`hw:${homeworkId}`];
    writeLocal(PUSHED_KEY, cache);
  } catch (error) {
    warn("deleteHomeworkFromCloud", error);
  }
}

export async function pushSubmissions(items: Submission[]): Promise<void> {
  if (!isOnline() || !items.length || !getApiSession()) return;
  const rows: { id: string; data: Submission }[] = [];
  for (const item of items) {
    if (!item?.id || item.score !== undefined) continue;
    const data: Submission = { ...item };
    if (data.audioUrl && !isMediaRef(data.audioUrl)) {
      const ref = await uploadChatMedia(data.audioUrl, data.fileName ?? `submission-${item.id}`, undefined, item.homeworkId);
      if (ref) data.audioUrl = ref;
    }
    rows.push({ id: item.id, data });
  }
  const pending = changedRows(
    rows,
    (row) => `sub:${row.id}`,
    (row) => JSON.stringify({ ...row.data, audioUrl: undefined }),
  );
  if (!pending.length) return;
  try {
    await apiCall("homework.submit", { rows: pending });
    markPushed(
      Object.fromEntries(
        pending.map((row) => [
          `sub:${row.id}`,
          JSON.stringify({ ...row.data, audioUrl: undefined }),
        ]),
      ),
    );
  } catch (error) {
    warn("pushSubmissions", error);
  }
}

/** تصحيح تسليم على الخادم ثم محليًا. */
export async function gradeSubmissionInCloud(
  submissionId: string,
  score: number,
  feedback: string,
): Promise<boolean> {
  if (!isOnline() || !getApiSession()) return false;
  try {
    await apiCall("homework.grade", { submissionId, score, feedback });
    const cache = readPushed();
    Object.keys(cache)
      .filter((key) => key.startsWith("sub:"))
      .forEach((key) => delete cache[key]);
    writeLocal(PUSHED_KEY, cache);
    return true;
  } catch (error) {
    warn("gradeSubmissionInCloud", error);
    return false;
  }
}

/* ---------------- الجلسات والأجهزة ---------------- */

export type CloudSession = {
  id: string;
  deviceId?: string | null;
  platform?: string | null;
  createdAt?: string;
  lastSeenAt?: string;
  current?: boolean;
};

export type CloudDevice = {
  deviceId: string;
  issuedAt?: string;
  expiresAt?: string;
  lastUsedAt?: string;
};

export async function fetchSessions(): Promise<CloudSession[]> {
  const result = await apiCall<{ sessions: CloudSession[] }>("sessions.list");
  return result?.sessions ?? [];
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  await apiCall("sessions.revoke", { sessionId });
}

export async function revokeAllOtherSessions(): Promise<void> {
  await apiCall("sessions.revokeAll");
}

export async function fetchDevices(): Promise<CloudDevice[]> {
  const result = await apiCall<{ devices: CloudDevice[] }>("devices.list");
  return result?.devices ?? [];
}

export async function revokeDeviceById(deviceId: string): Promise<void> {
  await apiCall("devices.revoke", { deviceId });
}

/* ---------------- استعادة كلمة المرور ---------------- */

/** طلب استعادة: الرد واحد دائمًا حتى لا يُكشف وجود الحساب. */
export async function requestPasswordReset(username: string, contact: string): Promise<boolean> {
  if (!isOnline()) return false;
  try {
    await apiCall("password.reset.request", { username, contact });
    return true;
  } catch (error) {
    warn("requestPasswordReset", error);
    return false;
  }
}

/** استعادة عبر جهاز موثوق (رمز الجهاز المحفوظ من تفويض سابق). */
export async function resetPasswordWithDevice(input: {
  username: string;
  deviceId: string;
  deviceSecret: string;
  newPassword: string;
}): Promise<{ ok: boolean; code?: string }> {
  if (!isOnline()) return { ok: false, code: "NETWORK" };
  try {
    await apiCall("password.reset.device", input);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: errorCode(error) };
  }
}

export async function changePasswordInCloud(oldPassword: string, newPassword: string): Promise<string | null> {
  if (!isOnline() || !getApiSession()) return "تحتاج اتصالًا بالإنترنت لتغيير كلمة المرور.";
  try {
    await apiCall("password.change", { oldPassword, newPassword });
    return null;
  } catch (error) {
    const code = errorCode(error);
    if (code === "INVALID_CREDENTIALS") return "كلمة المرور الحالية غير صحيحة.";
    if (code === "WEAK_PASSWORD") return "كلمة المرور الجديدة قصيرة (8 أحرف على الأقل).";
    if (code === "TOO_MANY_ATTEMPTS") return "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.";
    return "تعذّر تغيير كلمة المرور. أعد المحاولة.";
  }
}

/* ---------------- المسؤول ---------------- */

export type ResetRequest = {
  id: string;
  accountId: string;
  username: string;
  contact?: string | null;
  createdAt?: string;
};

export async function adminResetRequests(): Promise<ResetRequest[]> {
  const result = await apiCall<{ requests: ResetRequest[] }>("admin.reset.requests");
  return result?.requests ?? [];
}

export async function adminIssueReset(accountId: string): Promise<{ username: string; temporaryPassword: string } | null> {
  try {
    return await apiCall<{ username: string; temporaryPassword: string }>("admin.reset.issue", { accountId });
  } catch (error) {
    warn("adminIssueReset", error);
    return null;
  }
}

export async function adminSetAccount(input: {
  accountId: string;
  status?: string;
  banned?: boolean;
  type?: string;
  rejectionReason?: string;
}): Promise<boolean> {
  try {
    await apiCall("admin.account.update", input);
    return true;
  } catch (error) {
    warn("adminSetAccount", error);
    return false;
  }
}

/* ---------------- السحب ---------------- */

type PullResult = {
  serverTime: number;
  account: any;
  accounts: any[];
  directory: any[];
  adminIds: string[];
  notifications: any[];
  links: any[];
  conversations: any[];
  messages: any[];
  homework: any[];
  submissions: any[];
  resetRequests: ResetRequest[];
  sessions: CloudSession[];
  deletions: { entity: string; id: string }[];
};

let pulling: Promise<boolean> | null = null;

/**
 * يسحب أحدث البيانات من السحابة إلى التخزين المحلي.
 * يعيد true إذا تغيّر شيء محليًا (لإعادة رسم الواجهة).
 */
export function pullCloud(): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve(false);
  if (!getApiSession()) return Promise.resolve(false);
  if (pulling) return pulling;
  pulling = (async () => {
    try {
      // نُفرِّغ أولًا عمليات الحذف والإضافة المعلّقة حتى لا يعيد السحب بيانات قديمة.
      await flushAccountDeletions();
      await flushPendingAccounts();

      const before = [
        localStorage.getItem(CLOUD_KEYS.accounts) ?? "",
        localStorage.getItem(CLOUD_KEYS.notifications) ?? "",
        localStorage.getItem(CLOUD_KEYS.teacherLinks) ?? "",
        localStorage.getItem(CLOUD_KEYS.guardianLinks) ?? "",
        localStorage.getItem(CLOUD_KEYS.homework) ?? "",
        localStorage.getItem(CLOUD_KEYS.submissions) ?? "",
        localStorage.getItem(CHAT_KEY) ?? "",
      ].join("|");

      const data = await apiCall<PullResult>("pull");

      const tombstoned = new Set(readDeletedAccounts());
      const pendingAccounts = readPendingAccounts();
      const serverDeletions = new Map<string, Set<string>>();
      for (const row of data.deletions ?? []) {
        const key = String(row.entity ?? "");
        if (!key) continue;
        const set = serverDeletions.get(key) ?? new Set<string>();
        set.add(String(row.id));
        serverDeletions.set(key, set);
      }
      for (const id of serverDeletions.get("account") ?? []) tombstoned.add(id);

      /* الحسابات: المقربون + دليل المعلمين (بلا بيانات تواصل) للمسؤول الجميع. */
      const remoteAccounts = dedupeAccounts([
        ...(data.accounts ?? []).map(accountFromRow),
        ...(data.directory ?? []).map(accountFromRow),
      ]).filter((account) => !tombstoned.has(account.id));
      const localAccounts = dedupeAccounts(readLocal<Account[]>(CLOUD_KEYS.accounts, [])).filter(
        (account) => !tombstoned.has(account.id),
      );
      for (const account of Object.values(pendingAccounts)) {
        if (!tombstoned.has(account.id) && !remoteAccounts.some((item) => item.id === account.id)) {
          remoteAccounts.push(account);
        }
      }

      /* بيانات التحقق المحلية (بصمة كلمة المرور) تبقى على الجهاز ولا تأتي من الخادم. */
      const mergedAccounts = remoteAccounts.map((account) => {
        const local = localAccounts.find((item) => item.id === account.id);
        if (!local?.passwordHash || !local?.passwordSalt) return account;
        return { ...account, passwordHash: local.passwordHash, passwordSalt: local.passwordSalt };
      });
      const localOnly = localAccounts.filter(
        (account) => !mergedAccounts.some((item) => item.id === account.id),
      );
      writeLocal(CLOUD_KEYS.accounts, dedupeAccounts([...mergedAccounts, ...localOnly]));

      /* الإشعارات: حالة "مقروء" تراكمية، والنصوص من الخادم. */
      const removedNotificationIds = readDeletedNotifications();
      for (const id of serverDeletions.get("notification") ?? []) removedNotificationIds.add(id);
      const remoteNotifications = (data.notifications ?? [])
        .map(rowToNotification)
        .filter((item) => !removedNotificationIds.has(item.id));
      const localNotifications = readLocal<AppNotification[]>(CLOUD_KEYS.notifications, []).filter(
        (item) => !removedNotificationIds.has(item.id),
      );
      const remoteNotificationIds = new Set(remoteNotifications.map((item) => item.id));
      const missingNotifications = localNotifications.filter(
        (item) => !remoteNotificationIds.has(item.id),
      );
      if (missingNotifications.length) {
        await pushNotifications(missingNotifications);
        remoteNotifications.push(...missingNotifications);
      }
      const mergedNotifications = remoteNotifications
        .map((item) => {
          const local = localNotifications.find((entry) => entry.id === item.id);
          return local?.read && !item.read ? { ...item, read: true } : item;
        })
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-300);
      writeLocal(CLOUD_KEYS.notifications, mergedNotifications);

      /* طلبات الربط. */
      const remoteLinks = rowToLinkRequests(data.links ?? []);
      const localTeacher = readLocal<TeacherLinkRequest[]>(CLOUD_KEYS.teacherLinks, []);
      const localGuardian = readLocal<GuardianLinkRequest[]>(CLOUD_KEYS.guardianLinks, []);
      const remoteLinkIds = new Set(remoteLinks.map((request) => request.id));
      const missingLinks: AnyLinkRequest[] = [...localTeacher, ...localGuardian].filter(
        (request) => !remoteLinkIds.has(request.id),
      );
      if (missingLinks.length) {
        await pushLinkRequests(missingLinks);
        remoteLinks.push(...missingLinks);
      }
      writeLocal(
        CLOUD_KEYS.teacherLinks,
        remoteLinks.filter((request): request is TeacherLinkRequest => "teacherId" in request),
      );
      writeLocal(
        CLOUD_KEYS.guardianLinks,
        remoteLinks.filter((request): request is GuardianLinkRequest => "guardianId" in request),
      );

      /* المحادثات والرسائل. */
      const remoteConversations = (data.conversations ?? []).map(rowToConversation);
      const messagesByConversation = new Map<string, ChatMessage[]>();
      for (const row of data.messages ?? []) {
        const key = String(row.conversation_id ?? "");
        if (!key) continue;
        const bucket = messagesByConversation.get(key) ?? [];
        bucket.push(rowToChatMessage(row));
        messagesByConversation.set(key, bucket);
      }
      const { merged, pending } = mergeChats(
        remoteConversations,
        messagesByConversation,
        serverDeletions.get("conversation") ?? new Set<string>(),
        serverDeletions.get("message") ?? new Set<string>(),
      );
      writeLocal(CHAT_KEY, merged);
      if (pending.length) await pushChats(pending);

      /* الواجبات والتسليمات: القاعدة مرجع، وما أُنشئ محليًا دون رفع يُحفظ ويُرفع. */
      const remoteHomework = (data.homework ?? []).filter((item) => Boolean(item?.id)) as Homework[];
      const localHomework = readLocal<Homework[]>(CLOUD_KEYS.homework, []);
      const remoteHomeworkIds = new Set(remoteHomework.map((item) => item.id));
      const offlineHomework = localHomework.filter((item) => !remoteHomeworkIds.has(item.id));
      writeLocal(CLOUD_KEYS.homework, [...remoteHomework, ...offlineHomework]);
      if (offlineHomework.length) await pushHomework(offlineHomework);

      const remoteSubmissions = (data.submissions ?? []).filter(
        (item) => Boolean(item?.id),
      ) as Submission[];
      const localSubmissions = readLocal<Submission[]>(CLOUD_KEYS.submissions, []);
      const remoteSubmissionIds = new Set(remoteSubmissions.map((item) => item.id));
      const mergedSubmissions = remoteSubmissions.map((item) => {
        const local = localSubmissions.find((entry) => entry.id === item.id);
        if (local?.audioUrl && !isMediaRef(local.audioUrl)) return { ...item, audioUrl: local.audioUrl };
        return item;
      });
      const offlineSubmissions = localSubmissions.filter(
        (item) => !remoteSubmissionIds.has(item.id),
      );
      writeLocal(CLOUD_KEYS.submissions, [...mergedSubmissions, ...offlineSubmissions]);
      if (offlineSubmissions.length) await pushSubmissions(offlineSubmissions);

      /* الوسائط المحمية: تُجلب مرة واحدة وتُخزَّن في الذاكرة لعرضها. */
      const refs = new Set<string>();
      for (const submission of mergedSubmissions) {
        if (isMediaRef(submission.audioUrl)) refs.add(submission.audioUrl!);
      }
      for (const conversation of merged) {
        for (const message of conversation.messages ?? []) {
          if (isMediaRef(message.audioUrl)) refs.add(message.audioUrl!);
        }
      }
      await Promise.all([...refs].slice(0, 12).map((ref) => resolveMediaUrl(ref)));

      /* الجلسات والأجهزة وطلبات الاستعادة (شاشة الأمان). */
      writeLocal(CLOUD_KEYS.sessions, data.sessions ?? []);
      writeLocal(CLOUD_KEYS.resetRequests, data.resetRequests ?? []);

      const after = [
        localStorage.getItem(CLOUD_KEYS.accounts) ?? "",
        localStorage.getItem(CLOUD_KEYS.notifications) ?? "",
        localStorage.getItem(CLOUD_KEYS.teacherLinks) ?? "",
        localStorage.getItem(CLOUD_KEYS.guardianLinks) ?? "",
        localStorage.getItem(CLOUD_KEYS.homework) ?? "",
        localStorage.getItem(CLOUD_KEYS.submissions) ?? "",
        localStorage.getItem(CHAT_KEY) ?? "",
      ].join("|");

      if (before !== after) {
        window.dispatchEvent(new Event(CLOUD_EVENT));
        return true;
      }
      return false;
    } catch (error) {
      if (errorCode(error) === "UNAUTHENTICATED") clearApiSession();
      warn("pullCloud", error);
      return false;
    } finally {
      pulling = null;
    }
  })();
  return pulling;
}

/** يبدأ مزامنة دورية عند عودة التركيز إلى التطبيق وكل 20 ثانية. */
export function startCloudSync(): () => void {
  let stopped = false;
  let last = 0;

  const sync = () => {
    if (stopped || document.visibilityState === "hidden") return;
    const now = Date.now();
    if (now - last < 8000) return;
    last = now;
    void pullCloud();
  };

  const timer = window.setInterval(sync, 20000);
  window.addEventListener("focus", sync);
  window.addEventListener("online", sync);
  document.addEventListener("visibilitychange", sync);
  sync();

  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener("focus", sync);
    window.removeEventListener("online", sync);
    document.removeEventListener("visibilitychange", sync);
  };
}

/** غرفة تحدي أونلاين: إنشاء أو قراءة رموز الأجزاء المشتركة (بهوية الجلسة). */
export async function challengeRoom(
  op: "create" | "get",
  data: { code: string; hostName?: string; juzs?: number[] },
): Promise<{ code?: string; juzs?: number[]; hostName?: string; status?: string } | null> {
  try {
    const { data: result, error } = await cloud.rpc("thimar_challenge_room", {
      p_token: currentToken(),
      p_op: op,
      p_data: data,
    });
    if (error || !result) return null;
    const payload = result as {
      ok?: boolean;
      code?: string;
      room?: { code: string; juzs: number[]; hostName: string; status: string } | null;
    };
    return payload.room ?? { code: payload.code };
  } catch {
    return null;
  }
}

export type { DeletionEntity };
