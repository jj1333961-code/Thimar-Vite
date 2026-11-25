/**
 * مزامنة بيانات التطبيق مع Supabase.
 *
 * التخزين المحلي (localStorage) يبقى المصدر الذي تقرأ منه الواجهة فورًا،
 * وهذه الطبقة تدفع كل تغيير إلى قاعدة البيانات وتسحب الجديد منها،
 * لتظهر الحسابات والطلبات والإشعارات بين الأجهزة.
 */
import { createClient } from "@supabase/supabase-js";
import type { Account } from "./auth";
import type {
  AppNotification,
  ChatMessage,
  Conversation,
  GuardianLinkRequest,
  TeacherLinkRequest,
} from "./appStore";

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://jbsvmpiwdwowizzfzlqr.supabase.co";

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impic3ZtcGl3ZHdvd2l6emZ6bHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NDU2NzksImV4cCI6MjEwMjAyMTY3OX0.CPq3jBruh47_ZS8i_W7FKs_dRWynrQi2znSTzHMJEQk";

export const cloud = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const CLOUD_EVENT = "thimar:cloud";

export const CLOUD_KEYS = {
  accounts: "thimar_accounts",
  notifications: "thimar.notifications.v1",
  teacherLinks: "thimar.teacherLinkRequests.v1",
  guardianLinks: "thimar.guardianLinkRequests.v1",
} as const;

/** حسابات حُذفت محليًا وينتظر حذفها من قاعدة البيانات. */
const DELETED_ACCOUNTS_KEY = "thimar.deletedAccounts.v1";
/** حسابات أُنشئت/عُدّلت محليًا وتنتظر الرفع إلى قاعدة البيانات. */
const PENDING_ACCOUNTS_KEY = "thimar.pendingAccounts.v1";
/** حسابات تأكد رفعها إلى قاعدة البيانات مرة واحدة على الأقل. */
const UPLOADED_ACCOUNTS_KEY = "thimar.uploadedAccounts.v1";

const ACCOUNTS_TABLE = "thimar_accounts";
/** آثار الحذف تُحفظ على السيرفر حتى لا تعود العناصر المحذوفة من أي جهاز آخر. */
const DELETIONS_TABLE = "thimar_deletions";

type DeletionEntity = "account" | "notification" | "message" | "conversation";

async function recordDeletion(entity: DeletionEntity, id: string): Promise<void> {
  if (!id || !isOnline()) return;
  try {
    const { error } = await cloud
      .from(DELETIONS_TABLE)
      .upsert({ entity, id, deleted_at: Date.now() }, { onConflict: "entity,id" });
    if (error) throw error;
  } catch (error) {
    warn("recordDeletion", error);
  }
}
const NOTIFICATIONS_TABLE = "thimar_notifications";
const LINKS_TABLE = "thimar_link_requests";

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}


/** لا نحاول الكتابة إلى السحابة بلا إنترنت: البيانات تُحفظ محليًا وتُرسل عند العودة. */
function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function warn(label: string, error: unknown) {
  console.warn(`Thimar cloud sync (${label}):`, error);
}

/* ---------------- الحسابات ---------------- */

export function accountToRow(account: Account) {
  return {
    id: account.id,
    type: account.type,
    full_name: account.fullName,
    username: account.username,
    // لا تُرفع كلمة المرور أبدًا؛ تُرفع البصمة والملح فقط.
    ...(account.passwordHash
      ? { password_hash: account.passwordHash, password_salt: account.passwordSalt ?? "" }
      : {}),
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

function rowToAccount(row: any): Account {
  return {
    id: row.id,
    type: row.type,
    fullName: row.full_name,
    username: row.username,
    passwordHash: row.password_hash ?? undefined,
    passwordSalt: row.password_salt ?? undefined,
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
    const username = account.username.trim().toLowerCase();
    if (!username || seenIds.has(account.id) || seenUsernames.has(username)) continue;
    seenIds.add(account.id);
    seenUsernames.add(username);
    result.push(account);
  }
  return result;
}

export async function pushAccount(account: Account): Promise<void> {
  queueAccountPush(account);
  if (!isOnline()) return;
  try {
    const { error } = await cloud
      .from(ACCOUNTS_TABLE)
      .upsert(accountToRow(account), { onConflict: "id" });
    if (error) throw error;
    removePendingAccount(account.id);
    markAccountsUploaded([account.id]);
  } catch (error) {
    warn("pushAccount", error);
  }
}

export async function pushAccounts(accounts: Account[]): Promise<void> {
  const unique = dedupeAccounts(accounts);
  if (!unique.length) return;
  unique.forEach(queueAccountPush);
  if (!isOnline()) return;
  try {
    const { error } = await cloud
      .from(ACCOUNTS_TABLE)
      .upsert(unique.map(accountToRow), { onConflict: "id" });
    if (error) throw error;
    unique.forEach((account) => removePendingAccount(account.id));
    markAccountsUploaded(unique.map((account) => account.id));
  } catch (error) {
    warn("pushAccounts", error);
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
  try {
    localStorage.setItem(DELETED_ACCOUNTS_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* ignore */
  }
}

/** يسجّل حذف حساب حتى يُنفَّذ في قاعدة البيانات عند توفر الإنترنت. */
export function queueAccountDeletion(accountId: string): void {
  if (!accountId) return;
  writeDeletedAccounts([...readDeletedAccounts(), accountId]);
  void recordDeletion("account", accountId);
  removePendingAccount(accountId);
  unmarkAccountsUploaded([accountId]);
}

export function isAccountDeleted(accountId: string): boolean {
  return readDeletedAccounts().includes(accountId);
}

async function flushAccountDeletions(): Promise<void> {
  const ids = readDeletedAccounts();
  if (!ids.length || !isOnline()) return;
  try {
    const { error } = await cloud.from(ACCOUNTS_TABLE).delete().in("id", ids);
    if (error) throw error;
    /* لا نُبقي على السيرفر أثرًا لحساب محذوف: إشعاراته ومحادثاته ورسائله. */
    const { data: conversations } = await cloud
      .from(CONVERSATIONS_TABLE)
      .select("id,created_by")
      .limit(1000);
    const owned = (conversations ?? [])
      .filter((row) => row.created_by && ids.includes(row.created_by))
      .map((row) => row.id);
    if (owned.length) {
      await cloud.from(CHAT_MESSAGES_TABLE).delete().in("conversation_id", owned);
      await cloud.from(CONVERSATIONS_TABLE).delete().in("id", owned);
    }
    await cloud.from(CHAT_MESSAGES_TABLE).delete().in("sender_id", ids);
    await cloud.from(NOTIFICATIONS_TABLE).delete().in("recipient_id", ids);
    writeDeletedAccounts(readDeletedAccounts().filter((id) => !ids.includes(id)));
  } catch (error) {
    warn("flushAccountDeletions", error);
  }
}

function readUploadedAccounts(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(UPLOADED_ACCOUNTS_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function markAccountsUploaded(ids: string[]): void {
  const uploaded = readUploadedAccounts();
  ids.forEach((id) => uploaded.add(id));
  try {
    localStorage.setItem(UPLOADED_ACCOUNTS_KEY, JSON.stringify([...uploaded]));
  } catch {
    /* ignore */
  }
}

function unmarkAccountsUploaded(ids: string[]): void {
  const uploaded = readUploadedAccounts();
  ids.forEach((id) => uploaded.delete(id));
  try {
    localStorage.setItem(UPLOADED_ACCOUNTS_KEY, JSON.stringify([...uploaded]));
  } catch {
    /* ignore */
  }
}

function readPendingAccounts(): Record<string, Account> {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_ACCOUNTS_KEY) || "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, Account>) : {};
  } catch {
    return {};
  }
}

function queueAccountPush(account: Account): void {
  if (!account?.id) return;
  const pending = readPendingAccounts();
  pending[account.id] = account;
  try {
    localStorage.setItem(PENDING_ACCOUNTS_KEY, JSON.stringify(pending));
  } catch {
    /* ignore */
  }
}

function removePendingAccount(accountId: string): void {
  const pending = readPendingAccounts();
  if (!pending[accountId]) return;
  delete pending[accountId];
  try {
    localStorage.setItem(PENDING_ACCOUNTS_KEY, JSON.stringify(pending));
  } catch {
    /* ignore */
  }
}

async function flushPendingAccounts(): Promise<void> {
  const pending = Object.values(readPendingAccounts());
  if (!pending.length || !isOnline()) return;
  try {
    const { error } = await cloud
      .from(ACCOUNTS_TABLE)
      .upsert(pending.map(accountToRow), { onConflict: "id" });
    if (error) throw error;
    pending.forEach((account) => removePendingAccount(account.id));
    markAccountsUploaded(pending.map((account) => account.id));
  } catch (error) {
    warn("flushPendingAccounts", error);
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

export async function pushNotifications(notifications: AppNotification[]): Promise<void> {
  if (!isOnline()) return;
  if (!notifications.length) return;
  try {
    const { error } = await cloud
      .from(NOTIFICATIONS_TABLE)
      .upsert(notifications.map(notificationToRow), { onConflict: "id" });
    if (error) throw error;
  } catch (error) {
    warn("pushNotifications", error);
  }
}

export async function deleteNotificationsFromCloud(ids: string[]): Promise<void> {
  if (!ids.length) return;
  /* أثر الحذف يمنع عودة الإشعار المحذوف من السحب التالي. */
  const tombstoned = readDeletedNotifications();
  ids.forEach((id) => tombstoned.add(id));
  writeDeletedNotifications(tombstoned);
  ids.forEach((id) => void recordDeletion("notification", id));
  if (!isOnline()) return;
  try {
    await cloud.from(NOTIFICATIONS_TABLE).delete().in("id", ids);
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
  try {
    localStorage.setItem(DELETED_NOTIFICATIONS_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

/* ---------------- طلبات الربط ---------------- */

type AnyLinkRequest = TeacherLinkRequest | GuardianLinkRequest;

function linkKind(request: AnyLinkRequest): "teacher" | "guardian" {
  return "teacherId" in request ? "teacher" : "guardian";
}

export async function pushLinkRequests(requests: AnyLinkRequest[]): Promise<void> {
  if (!isOnline()) return;
  const valid = requests.filter((request) => Boolean(request?.id));
  if (!valid.length) return;
  try {
    const rows = valid.map((request) => {
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
    const { error } = await cloud.from(LINKS_TABLE).upsert(rows, { onConflict: "id" });
    if (error) throw error;
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

/* ---------------- المحادثات والرسائل ---------------- */

const CHAT_KEY = "thimar.chat.v1";
const CONVERSATIONS_TABLE = "thimar_conversations";
const CHAT_MESSAGES_TABLE = "thimar_chat_messages";
/** معرّفات الرسائل التي وصلت إلى قاعدة البيانات. */
const UPLOADED_MESSAGES_KEY = "thimar.uploadedMessages.v1";
/** معرّفات رسائل حُذفت محليًا وينتظر حذفها من قاعدة البيانات. */
const DELETED_MESSAGES_KEY = "thimar.deletedMessages.v1";

function readIdSet(key: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeIdSet(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

function markMessagesUploaded(ids: string[]): void {
  if (!ids.length) return;
  const uploaded = readIdSet(UPLOADED_MESSAGES_KEY);
  ids.forEach((id) => uploaded.add(id));
  writeIdSet(UPLOADED_MESSAGES_KEY, uploaded);
}

/* نصوص الرسائل فقط تُرفع إلى القاعدة؛ ملفات الصوت والمرفقات تبقى محلية. */
function conversationToRow(conversation: Conversation) {
  return {
    id: conversation.id,
    title: conversation.title ?? "",
    is_group: Boolean(conversation.isGroup),
    member_ids: conversation.memberIds ?? [],
    admins: conversation.admins ?? [],
    muted_by: conversation.mutedBy ?? [],
    created_by: conversation.createdBy ?? null,
    created_at: Number(conversation.createdAt) || Date.now(),
    updated_at: Date.now(),
  };
}

function messageToRow(conversationId: string, message: ChatMessage) {
  const media = message.audioUrl && /^https?:/i.test(message.audioUrl) ? message.audioUrl : null;
  return {
    id: message.id,
    conversation_id: conversationId,
    sender_id: message.senderId ?? null,
    kind: message.kind ?? "text",
    text: message.text ?? null,
    duration: message.duration ?? null,
    file_name: message.fileName ?? null,
    media_url: media,
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
    mutedBy: Array.isArray(row.muted_by) ? row.muted_by : [],
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

const CHAT_MEDIA_BUCKET = "thimar-chat-media";

/**
 * يرفع رسالة صوتية أو ملفًا إلى مساحة التخزين ويعيد رابطه العام،
 * حتى يستقبله الطرف الآخر على أي جهاز ويستطيع سماعه/تحميله وعرضه.
 */
export async function uploadChatMedia(dataUrl: string, fileName: string): Promise<string | null> {
  if (!isOnline() || !dataUrl) return null;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const safeName = fileName.replace(/[^\w.\-]+/g, "_").slice(-80) || "media";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const { error } = await cloud.storage.from(CHAT_MEDIA_BUCKET).upload(path, blob, {
      contentType: blob.type || "application/octet-stream",
      upsert: false,
    });
    if (error) throw error;
    return cloud.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (error) {
    warn("uploadChatMedia", error);
    return null;
  }
}

/** يرفع المحادثات ورسائلها النصية إلى قاعدة البيانات. */
export async function pushChats(conversations: Conversation[]): Promise<void> {
  if (!isOnline() || !conversations.length) return;
  try {
    const { error: conversationError } = await cloud
      .from(CONVERSATIONS_TABLE)
      .upsert(conversations.map(conversationToRow), { onConflict: "id" });
    if (conversationError) throw conversationError;

    const rows = conversations.flatMap((conversation) =>
      (conversation.messages ?? []).map((message) => messageToRow(conversation.id, message)),
    );
    if (rows.length) {
      const { error } = await cloud
        .from(CHAT_MESSAGES_TABLE)
        .upsert(rows, { onConflict: "id" });
      if (error) throw error;
      markMessagesUploaded(rows.map((row) => row.id));
    }
    window.dispatchEvent(new Event(CLOUD_EVENT));
  } catch (error) {
    warn("pushChats", error);
  }
}

/** يحذف رسائل من قاعدة البيانات (عند حذفها في التطبيق). */
export async function deleteMessagesFromCloud(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const deleted = readIdSet(DELETED_MESSAGES_KEY);
  ids.forEach((id) => deleted.add(id));
  writeIdSet(DELETED_MESSAGES_KEY, deleted);
  ids.forEach((id) => void recordDeletion("message", id));
  if (!isOnline()) return;
  try {
    const { error } = await cloud.from(CHAT_MESSAGES_TABLE).delete().in("id", ids);
    if (error) throw error;
    const stillDeleted = readIdSet(DELETED_MESSAGES_KEY);
    ids.forEach((id) => stillDeleted.delete(id));
    writeIdSet(DELETED_MESSAGES_KEY, stillDeleted);
  } catch (error) {
    warn("deleteMessagesFromCloud", error);
  }
}

/** يحذف محادثة كاملة ورسائلها من قاعدة البيانات. */
export async function deleteConversationFromCloud(id: string): Promise<void> {
  if (!id) return;
  void recordDeletion("conversation", id);
  if (!isOnline()) return;
  try {
    const { error } = await cloud.from(CHAT_MESSAGES_TABLE).delete().eq("conversation_id", id);
    if (error) throw error;
    const { error: conversationError } = await cloud.from(CONVERSATIONS_TABLE).delete().eq("id", id);
    if (conversationError) throw conversationError;
  } catch (error) {
    warn("deleteConversationFromCloud", error);
  }
}

/** يدمج محادثات السحابة مع المحلي مع الحفاظ على الملفات المحلية. */
function mergeChats(
  remoteConversations: Conversation[],
  remoteMessagesByConversation: Map<string, ChatMessage[]>,
  serverDeletions: Map<string, Set<string>>,
): { merged: Conversation[]; pending: Conversation[] } {
  const deletedConversations = serverDeletions.get("conversation") ?? new Set<string>();
  const deletedMessages = serverDeletions.get("message") ?? new Set<string>();
  const local = readLocal<Conversation[]>(CHAT_KEY, []);
  const uploaded = readIdSet(UPLOADED_MESSAGES_KEY);
  const deleted = readIdSet(DELETED_MESSAGES_KEY);
  const merged: Conversation[] = [];
  const pending: Conversation[] = [];
  const remoteIds = new Set<string>();

  for (const conversation of remoteConversations) {
    if (deletedConversations.has(conversation.id)) continue;
    remoteIds.add(conversation.id);
    const localConversation = local.find((item) => item.id === conversation.id);
    const remote = (remoteMessagesByConversation.get(conversation.id) ?? []).filter(
      (message) => !deleted.has(message.id) && !deletedMessages.has(message.id),
    );
    const remoteMessageIds = new Set(remote.map((message) => message.id));
    const localMessages = (localConversation?.messages ?? []).filter(
      (message) => !deleted.has(message.id) && !deletedMessages.has(message.id),
    );
    /* رسائل محلية لم تُرفع بعد (أُنشئت دون إنترنت) تُحفظ وتُرفع. */
    const unsent = localMessages.filter(
      (message) => !remoteMessageIds.has(message.id) && !uploaded.has(message.id),
    );
    /* الصوت والمرفقات لا تُرفع؛ نُبقيها على الجهاز ونربطها برسالتها. */
    const withMedia = remote.map((message) => {
      const localMessage = localMessages.find((item) => item.id === message.id);
      const readBy = [
        ...new Set([...(message.readBy ?? []), ...(localMessage?.readBy ?? [])]),
      ];
      if (!localMessage) return { ...message, readBy };
      if (localMessage.audioUrl || localMessage.fileName) {
        return {
          ...message,
          audioUrl: localMessage.audioUrl,
          fileName: localMessage.fileName ?? message.fileName,
          readBy,
        };
      }
      return { ...message, readBy };
    });
    merged.push({
      ...conversation,
      messages: [...withMedia, ...unsent].sort((a, b) => a.createdAt - b.createdAt),
    });
    if (unsent.length) pending.push({ ...conversation, messages: unsent });
  }

  /* محادثة محلية لم تُرفع بعد تُضاف إلى الطابور ولا تُفقد. */
  for (const conversation of local) {
    if (remoteIds.has(conversation.id) || deletedConversations.has(conversation.id)) continue;
    merged.push(conversation);
    pending.push(conversation);
  }

  return { merged, pending };
}

/* ---------------- السحب ---------------- */

let pulling: Promise<boolean> | null = null;

/**
 * يسحب أحدث البيانات من السحابة إلى التخزين المحلي.
 * يعيد true إذا تغيّر شيء محليًا (لإعادة رسم الواجهة).
 */
export function pullCloud(): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve(false);
  if (pulling) return pulling;
  pulling = (async () => {
    try {
      // نُفرِّغ أولًا عمليات الحذف والإضافة المعلّقة حتى لا يعيد السحب بيانات قديمة.
      await flushAccountDeletions();
      await flushPendingAccounts();
      const tombstoned = new Set(readDeletedAccounts());
      const pendingAccounts = readPendingAccounts();
      const before = [
        localStorage.getItem(CLOUD_KEYS.accounts) ?? "",
        localStorage.getItem(CLOUD_KEYS.notifications) ?? "",
        localStorage.getItem(CLOUD_KEYS.teacherLinks) ?? "",
        localStorage.getItem(CLOUD_KEYS.guardianLinks) ?? "",
        localStorage.getItem(CHAT_KEY) ?? "",
      ].join("|");

      const [accountsResult, notificationsResult, linksResult, conversationsResult, messagesResult, deletionsResult] =
        await Promise.all([
          cloud.from(ACCOUNTS_TABLE).select("*"),
          cloud.from(NOTIFICATIONS_TABLE).select("*").order("created_at", { ascending: false }).limit(400),
          cloud.from(LINKS_TABLE).select("*").order("created_at", { ascending: false }).limit(400),
          cloud.from(CONVERSATIONS_TABLE).select("*").order("created_at", { ascending: false }).limit(500),
          cloud
            .from(CHAT_MESSAGES_TABLE)
            .select("*")
            .order("created_at", { ascending: true })
            .limit(5000),
          cloud.from(DELETIONS_TABLE).select("*").limit(2000),
        ]);

      if (accountsResult.error) throw accountsResult.error;
      if (notificationsResult.error) throw notificationsResult.error;
      if (linksResult.error) throw linksResult.error;
      if (conversationsResult.error) throw conversationsResult.error;
      if (messagesResult.error) throw messagesResult.error;
      if (deletionsResult.error) throw deletionsResult.error;

      /* آثار الحذف من كل الأجهزة: لا تعود إليها أي عناصر محذوفة. */
      const serverDeletions = new Map<string, Set<string>>();
      for (const row of deletionsResult.data ?? []) {
        const entity = String(row.entity ?? "");
        if (!entity) continue;
        const set = serverDeletions.get(entity) ?? new Set<string>();
        set.add(String(row.id));
        serverDeletions.set(entity, set);
      }
      for (const id of serverDeletions.get("account") ?? []) tombstoned.add(id);

      const remoteAccounts = dedupeAccounts((accountsResult.data ?? []).map(rowToAccount)).filter(
        (account) => !tombstoned.has(account.id),
      );
      const localAccounts = dedupeAccounts(readLocal<Account[]>(CLOUD_KEYS.accounts, [])).filter(
        (account) => !tombstoned.has(account.id),
      );
      const remoteIds = new Set(remoteAccounts.map((account) => account.id));
      const remoteUsernames = new Set(
        remoteAccounts.map((account) => account.username.trim().toLowerCase()),
      );

      // لا نعيد رفع أي حساب حُذف محليًا. الحسابات التي أُنشئت دون إنترنت
      // محفوظة في طابور الرفع ولا تُفقد.
      for (const account of Object.values(pendingAccounts)) {
        if (!tombstoned.has(account.id)) remoteAccounts.push(account);
      }

      // حساب محلي لم يُرفع بعد (أُنشئ دون إنترنت) يُحفظ ويُضاف إلى طابور الرفع.
      // أما حساب سبق رفعه وغاب عن القاعدة فقد حُذف من السحابة ويُزال محليًا.
      const uploaded = readUploadedAccounts();
      const localOnly = localAccounts.filter(
        (account) => !remoteIds.has(account.id) && !uploaded.has(account.id),
      );
      localOnly.forEach(queueAccountPush);
      remoteAccounts.push(...localOnly);

      // لا نُفقد حساب المسؤول المحلي إن لم يكن في القاعدة.
      const adminLocal = localAccounts.find((account) => account.type === "admin");
      const mergedAccounts = dedupeAccounts(
        adminLocal && !remoteUsernames.has(adminLocal.username.trim().toLowerCase())
          ? [...remoteAccounts, adminLocal]
          : remoteAccounts,
      ).filter((account) => !tombstoned.has(account.id));

      // القاعدة هي المرجع: الحساب المحذوف من السحابة يُزال محليًا أيضًا.
      localStorage.setItem(CLOUD_KEYS.accounts, JSON.stringify(mergedAccounts));

      const removedNotificationIds = readDeletedNotifications();
      for (const id of serverDeletions.get("notification") ?? []) removedNotificationIds.add(id);
      const remoteNotifications = (notificationsResult.data ?? [])
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
      if (remoteNotifications.length || localNotifications.length) {
        const merged = remoteNotifications
          .slice()
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(-300);
        localStorage.setItem(CLOUD_KEYS.notifications, JSON.stringify(merged));
      }

      const remoteLinks = rowToLinkRequests(linksResult.data ?? []);
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
      if (remoteLinks.length || localTeacher.length || localGuardian.length) {
        const teacherLinks = remoteLinks.filter(
          (request): request is TeacherLinkRequest => "teacherId" in request,
        );
        const guardianLinks = remoteLinks.filter(
          (request): request is GuardianLinkRequest => "guardianId" in request,
        );
        localStorage.setItem(CLOUD_KEYS.teacherLinks, JSON.stringify(teacherLinks));
        localStorage.setItem(CLOUD_KEYS.guardianLinks, JSON.stringify(guardianLinks));
      }

      /* المحادثات والرسائل: القاعدة مرجع، والوسائط المحلية تبقى بلا رفع. */
      const remoteConversations = (conversationsResult.data ?? []).map(rowToConversation);
      const messagesByConversation = new Map<string, ChatMessage[]>();
      for (const row of messagesResult.data ?? []) {
        const key = String(row.conversation_id ?? "");
        if (!key) continue;
        const bucket = messagesByConversation.get(key) ?? [];
        bucket.push(rowToChatMessage(row));
        messagesByConversation.set(key, bucket);
      }
      const { merged, pending } = mergeChats(
        remoteConversations,
        messagesByConversation,
        serverDeletions,
      );
      localStorage.setItem(CHAT_KEY, JSON.stringify(merged));
      if (pending.length) await pushChats(pending);

      const after = [
        localStorage.getItem(CLOUD_KEYS.accounts) ?? "",
        localStorage.getItem(CLOUD_KEYS.notifications) ?? "",
        localStorage.getItem(CLOUD_KEYS.teacherLinks) ?? "",
        localStorage.getItem(CLOUD_KEYS.guardianLinks) ?? "",
        localStorage.getItem(CHAT_KEY) ?? "",
      ].join("|");

      if (before !== after) {
        window.dispatchEvent(new Event(CLOUD_EVENT));
        return true;
      }
      return false;
    } catch (error) {
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
