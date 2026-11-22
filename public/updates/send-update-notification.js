// Supabase Edge Function: إرسال إشعار "تحديث جديد" عبر FCM HTTP v1
// مرة واحدة لكل إصدار (idempotent by versionCode). Requires secrets:
//   FCM_SERVICE_ACCOUNT, THIMAR_PUSH_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional metadata source can be passed in body.metadataUrl.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const ALLOWED_ORIGINS = new Set([
  "https://thimar.freebuff.page",
  "https://site-a02c574077ed41d78e9450f109cacfd2.freebuff.page",
]);

const encoder = new TextEncoder();
let cached: { token: string; expiresAt: number } | null = null;

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
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
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`token ${response.status}`);
  const data = await response.json();
  cached = { token: data.access_token, expiresAt: now + Number(data.expires_in ?? 3600) };
  return cached.token;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://thimar.freebuff.page",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(status: number, payload: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function authorized(request: Request): boolean {
  const expected = (Deno.env.get("THIMAR_PUSH_SECRET") ?? "").trim();
  if (!expected) return false;
  const header = request.headers.get("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i += 1) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendOne(endpoint: string, bearer: string, token: string, payload: unknown, maxAttempts = 3): Promise<{ ok: boolean; invalid: boolean; attempts: number }> {
  let attempt = 0;
  let lastStatus = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) return { ok: true, invalid: false, attempts: attempt };
      lastStatus = response.status;
      // Invalid token: do not retry.
      if (response.status === 404 || response.status === 400) {
        try { await response.text(); } catch { /* ignore */ }
        return { ok: false, invalid: true, attempts: attempt };
      }
      // Rate limit / server error: retry with backoff.
      if (response.status === 429 || response.status >= 500) {
        try { await response.text(); } catch { /* ignore */ }
        if (attempt < maxAttempts) await sleep(Math.min(8000, 1000 * Math.pow(2, attempt - 1)));
        continue;
      }
      try { await response.text(); } catch { /* ignore */ }
      return { ok: false, invalid: false, attempts: attempt };
    } catch (_err) {
      if (attempt < maxAttempts) await sleep(Math.min(8000, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  return { ok: false, invalid: false, attempts: attempt };
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" }, headers);
  if (!authorized(request)) return json(401, { error: "UNAUTHORIZED" }, headers);

  const rawAccount = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";
  if (!rawAccount) return json(501, { error: "FCM_SERVICE_ACCOUNT_MISSING" }, headers);
  const account = JSON.parse(rawAccount) as ServiceAccount;

  const body = await request.json().catch(() => ({}));
  const metadataUrl = typeof body.metadataUrl === "string" ? body.metadataUrl : "https://thimar.freebuff.page/updates/android.json";
  const metadataResponse = await fetch(metadataUrl, { cache: "no-store" });
  if (!metadataResponse.ok) return json(502, { error: "METADATA_UNAVAILABLE" }, headers);
  const metadata = await metadataResponse.json();
  if (!metadata?.available || !metadata.downloadUrl || !metadata.versionCode || !metadata.sha256) {
    return json(409, { error: "INVALID_OR_UNPUBLISHED_RELEASE" }, headers);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const versionCode = Number(metadata.versionCode);
  const campaignId = `release-${versionCode}`;

  // Idempotency lock: acquire "sending" state. Never run two campaigns for the same release.
  const nowIso = new Date().toISOString();
  let existing: any = null;
  try {
    const result = await supabase.from("thimar_update_notifications").select("*").eq("version_code", versionCode).maybeSingle();
    existing = result.data;
  } catch (_e) {
    existing = null;
  }

  if (existing && existing.status === "sent") {
    return json(200, { sent: existing.sent_count ?? 0, failed: existing.failed_count ?? 0, invalid: existing.invalid_count ?? 0, versionCode, note: "ALREADY_NOTIFIED" }, headers);
  }
  if (existing && existing.status === "sending" && existing.started_at) {
    const started = new Date(existing.started_at).getTime();
    if (Date.now() - started < 5 * 60 * 1000) {
      return json(202, { versionCode, note: "CAMPAIGN_IN_PROGRESS" }, headers);
    }
  }

  // Acquire/refresh the sending lock.
  const lockPayload: any = {
    version_code: versionCode,
    version_name: metadata.versionName,
    status: "sending",
    campaign_id: campaignId,
    started_at: nowIso,
    updated_at: nowIso,
  };
  if (existing) {
    await supabase.from("thimar_update_notifications").update(lockPayload).eq("version_code", versionCode);
  } else {
    const { error: insertErr } = await supabase.from("thimar_update_notifications").insert(lockPayload);
    if (insertErr) {
      // Race: another worker acquired it.
      return json(202, { versionCode, note: "CAMPAIGN_IN_PROGRESS" }, headers);
    }
  }

  const audit = (event: string, payload: unknown) => {
    try {
      supabase.from("thimar_notification_audit").insert({ campaign_id: campaignId, version_code: versionCode, version_name: metadata.versionName, event, payload }).then(() => {}).catch(() => {});
    } catch { /* ignore */ }
  };
  audit("started", { metadataUrl, versionCode });

  try {
    const { data: tokensRows } = await supabase.from("thimar_fcm_tokens").select("token, account_id, app_version, app_version_code").eq("platform", "android");

    const history = Array.isArray(metadata.versionHistory) ? metadata.versionHistory : [];
    const codeForName = (name: any) => {
      const entry = history.find((item: any) => item?.versionName === name);
      return entry ? Number(entry.versionCode) : null;
    };
    const versionParts = (value: unknown): number[] | null => {
      const text = String(value ?? "").trim().replace(/^v/i, "");
      if (!text) return null;
      const parts = text.split(".").map((part) => Number(part));
      if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
      return parts;
    };
    const compareVersions = (a: number[], b: number[]): number => {
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    };
    const targetParts = versionParts(metadata.versionName);

    const eligibleRows = (tokensRows ?? []).filter((row: any) => {
      if (typeof row.app_version_code === "number" && Number.isFinite(row.app_version_code)) {
        return row.app_version_code < versionCode;
      }
      const installedCode = codeForName(row.app_version);
      if (installedCode !== null) return installedCode < versionCode;
      const installedParts = versionParts(row.app_version);
      if (!installedParts || !targetParts) {
        return true;
      }
      return compareVersions(installedParts, targetParts) < 0;
    });
    const tokens = [...new Set(eligibleRows.map((row: any) => row.token as string))];

    if (!tokens.length) {
      const finalPayload: any = {
        status: "no_tokens",
        sent_count: 0,
        failed_count: 0,
        invalid_count: 0,
        attempted_count: 0,
        accepted_count: 0,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        audit: { attempted: 0, accepted: 0, failed: 0, invalid: 0, note: "NO_TOKENS" },
      };
      await supabase.from("thimar_update_notifications").update(finalPayload).eq("version_code", versionCode);
      audit("finished", { note: "NO_TOKENS" });
      return json(200, { sent: 0, failed: 0, invalid: 0, attempted: 0, accepted: 0, versionCode, note: "NO_TOKENS" }, headers);
    }

    const bearer = await accessToken(account);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;

    let sent = 0;
    let failed = 0;
    const invalid: string[] = [];
    let attempted = 0;

    for (const token of tokens) {
      attempted += 1;
      const payload = {
        message: {
          token,
          data: {
            title: "تحديث جديد متاح لتطبيق ثمار",
            body: `الإصدار ${metadata.versionName} متاح الآن (${metadata.fileSize ? (metadata.fileSize / (1024 * 1024)).toFixed(1) + " MB" : ""}). اضغط هنا لمعرفة التفاصيل والتحديث.`,
            url: "thimar://settings/updates?update=1",
            tag: `thimar-update-${versionCode}`,
            versionName: String(metadata.versionName ?? ""),
            versionCode: String(versionCode),
            fileSize: String(metadata.fileSize ?? ""),
            downloadUrl: String(metadata.downloadUrl ?? ""),
            summary: String((metadata.releaseNotes?.ar?.shortDescription) ?? (metadata.releaseNotes?.en?.shortDescription) ?? ""),
            action: "update_now",
          },
          android: {
            priority: "HIGH",
            ttl: "86400s",
            collapse_key: `thimar-update-${versionCode}`,
          },
        },
      };
      const result = await sendOne(endpoint, bearer, token, payload);
      if (result.ok) sent += 1;
      else {
        failed += 1;
        if (result.invalid) invalid.push(token);
      }
    }

    if (invalid.length) {
      try { await supabase.from("thimar_fcm_tokens").delete().in("token", invalid); } catch (_e) { /* ignore */ }
    }

    const status = failed === 0 ? "sent" : (sent > 0 ? "partial" : "failed");
    const finalPayload: any = {
      status,
      sent_count: sent,
      failed_count: failed,
      invalid_count: invalid.length,
      attempted_count: attempted,
      accepted_count: sent,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      audit: {
        attempted,
        accepted: sent,
        failed,
        invalid: invalid.length,
        totalTokens: tokens.length,
        eligibleDevices: eligibleRows.length,
      },
    };
    if (status === "failed") finalPayload.error = "ALL_SENDS_FAILED";

    await supabase.from("thimar_update_notifications").update(finalPayload).eq("version_code", versionCode);
    audit("finished", { status, attempted, accepted: sent, failed, invalid: invalid.length });

    return json(200, { sent, failed, invalid: invalid.length, attempted, accepted: sent, versionCode, status }, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("thimar_update_notifications").update({
      status: "failed",
      error: message,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("version_code", versionCode);
    audit("error", { message });
    return json(500, { error: "CAMPAIGN_FAILED", message, versionCode }, headers);
  }
});