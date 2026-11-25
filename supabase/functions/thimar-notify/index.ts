// Supabase Edge Function: thimar-notify
// Sends real FCM notifications for chat messages and teacher homework.
// The sender is authenticated by the FCM token already bound to their account
// through the existing secure device-authorization flow. The client never sees
// the Firebase service account or any server secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
type Json = Record<string, unknown>;

const ALLOWED_ORIGINS = new Set([
  "https://thimar.freebuff.page",
  "http://localhost:3000",
  "http://localhost:5173",
]);
const CHANNEL_ID = "thimar_notifications";
const CLICK_ACTION = "app.thimar.quran.OPEN_NOTIFICATION";
const MAX_RECIPIENTS = 500;
const MAX_PER_MINUTE = 60;

const encoder = new TextEncoder();
let cached: { token: string; expiresAt: number } | null = null;
const buckets = new Map<string, number[]>();

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://thimar.freebuff.page",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin",
  };
}

function json(status: number, payload: Json, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) return cached.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`FCM_TOKEN_${response.status}`);
  const data = await response.json();
  cached = { token: String(data.access_token ?? ""), expiresAt: now + Number(data.expires_in ?? 3600) };
  return cached.token;
}

function rateLimited(accountId: string): boolean {
  const now = Date.now();
  const hits = (buckets.get(accountId) ?? []).filter((time) => now - time < 60_000);
  if (hits.length >= MAX_PER_MINUTE) {
    buckets.set(accountId, hits);
    return true;
  }
  hits.push(now);
  buckets.set(accountId, hits);
  return false;
}

function sameMembers(conversation: unknown, senderId: string, recipients: string[]): boolean {
  if (!Array.isArray(conversation)) return false;
  const members = new Set(conversation.map((value) => String(value)));
  return members.has(senderId) && recipients.every((id) => members.has(id));
}

/**
 * يقبل حساب الخدمة كـ JSON خام أو Base64، ويعالج المفاتيح المحفوظة بـ\n
 * مزدوجة (شائع عند لصق JSON في أسرار Supabase).
 */
function parseServiceAccount(raw: string): ServiceAccount | null {
  let value = raw.trim();
  if (!value) return null;
  try {
    if (!value.startsWith("{")) {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      value = atob(normalized);
    }
  } catch {
    return null;
  }
  try {
    let parsed: unknown = JSON.parse(value);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed || typeof parsed !== "object") return null;
    const account = parsed as ServiceAccount;
    if (typeof account.private_key === "string") {
      account.private_key = account.private_key.replace(/\\n/g, "\n");
    }
    if (!account.project_id || !account.client_email || !account.private_key) return null;
    return account;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  const headers = cors(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers });

  const rawAccount = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";
  const account = parseServiceAccount(rawAccount);
  if (request.method === "GET") {
    return json(200, { ok: true, fcmConfigured: Boolean(account) }, headers);
  }
  if (request.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" }, headers);
  if (!rawAccount.trim()) return json(501, { error: "FCM_NOT_CONFIGURED" }, headers);
  if (!account) return json(500, { error: "FCM_SERVICE_ACCOUNT_INVALID" }, headers);

  const body = await request.json().catch(() => ({}));
  const senderId = text(body.senderId, 128);
  const senderToken = text(body.senderToken, 4096);
  const kind = text(body.kind, 24);
  const conversationId = text(body.conversationId, 128);
  const recipientIds = Array.isArray(body.recipientIds)
    ? [...new Set(body.recipientIds.map((value: unknown) => text(value, 128)).filter(Boolean))].slice(0, MAX_RECIPIENTS)
    : [];
  const title = text(body.title, 120) || "ثمار";
  const message = text(body.body, 300);
  const url = text(body.url, 500).startsWith("/") ? text(body.url, 500) : "/";
  const tag = text(body.tag, 80) || "thimar";

  if (!senderId || !senderToken || !recipientIds.length || !["chat", "homework"].includes(kind)) {
    return json(400, { error: "INVALID_ARGUMENT" }, headers);
  }
  if (rateLimited(senderId)) return json(429, { error: "RATE_LIMITED" }, headers);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // الهوية: الرمز يجب أن يكون مربوطًا فعليًا بالحساب المرسل.
  const { data: tokenRow } = await supabase
    .from("thimar_fcm_tokens")
    .select("account_id")
    .eq("token", senderToken)
    .maybeSingle();
  if (!tokenRow || tokenRow.account_id !== senderId) {
    return json(403, { error: "SENDER_NOT_VERIFIED" }, headers);
  }

  const { data: sender } = await supabase
    .from("thimar_accounts")
    .select("id,type,status,banned")
    .eq("id", senderId)
    .maybeSingle();
  if (!sender || sender.banned === true || sender.status !== "active") {
    return json(403, { error: "SENDER_NOT_ACTIVE" }, headers);
  }

  if (kind === "chat") {
    if (!conversationId) return json(400, { error: "MISSING_CONVERSATION" }, headers);
    const { data: conversation } = await supabase
      .from("thimar_conversations")
      .select("member_ids")
      .eq("id", conversationId)
      .maybeSingle();
    if (!sameMembers(conversation?.member_ids, senderId, recipientIds)) {
      return json(403, { error: "NOT_A_CONVERSATION_MEMBER" }, headers);
    }
  } else {
    // المهمات: المعلم يرسل لطلابه المرتبطين به فقط، والمسؤول يمكنه إرسال تنبيه.
    if (sender.type !== "admin" && sender.type !== "teacher") {
      return json(403, { error: "NOT_A_TEACHER" }, headers);
    }
    if (sender.type === "teacher") {
      const { data: students } = await supabase
        .from("thimar_accounts")
        .select("id,student")
        .in("id", recipientIds);
      const linked = new Set(
        (students ?? [])
          .filter((row) => {
            const profile = row.student as { teacherAccountId?: string; teacherId?: string } | null;
            return profile?.teacherAccountId === senderId || profile?.teacherId === senderId;
          })
          .map((row) => row.id as string),
      );
      if (!recipientIds.every((id) => linked.has(id))) {
        return json(403, { error: "RECIPIENT_NOT_LINKED" }, headers);
      }
    }
  }

  const { data: tokenRows } = await supabase
    .from("thimar_fcm_tokens")
    .select("token")
    .in("account_id", recipientIds);
  const tokens = [...new Set((tokenRows ?? []).map((row) => String(row.token)).filter(Boolean))];
  if (!tokens.length) return json(200, { sent: 0, failed: 0, note: "NO_TOKENS" }, headers);

  const bearer = await accessToken(account);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  let sent = 0;
  let failed = 0;
  const stale: string[] = [];

  await Promise.all(tokens.map(async (token) => {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body: message },
            data: { title, body: message, url, tag, kind },
            android: {
              priority: "HIGH",
              ttl: "86400s",
              collapse_key: tag,
              notification: {
                channel_id: CHANNEL_ID,
                icon: "ic_stat_thimar",
                color: "#0F5F4E",
                sound: "default",
                default_vibrate_timings: true,
                tag,
                click_action: CLICK_ACTION,
                visibility: "PUBLIC",
              },
            },
            apns: {
              headers: { "apns-priority": "10", "apns-push-type": "alert" },
              payload: {
                aps: {
                  alert: { title, body: message },
                  sound: "default",
                  "thread-id": tag,
                  "content-available": 1,
                },
              },
            },
          },
        }),
      });
      if (response.ok) sent += 1;
      else {
        failed += 1;
        if (response.status === 400 || response.status === 404) stale.push(token);
      }
    } catch {
      failed += 1;
    }
  }));

  if (stale.length) {
    await supabase.from("thimar_fcm_tokens").delete().in("token", stale);
  }

  return json(200, { sent, failed }, headers);
});
