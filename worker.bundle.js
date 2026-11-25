// freebuff-sites-build/push.js
var SUPABASE_URL = "https://jbsvmpiwdwowizzfzlqr.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impic3ZtcGl3ZHdvd2l6emZ6bHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NDU2NzksImV4cCI6MjEwMjAyMTY3OX0.CPq3jBruh47_ZS8i_W7FKs_dRWynrQi2znSTzHMJEQk";
var TABLE = "thimar_push_subscriptions";
var VAPID_SUBJECT = "mailto:support@thimar.app";
var PRAYERS = [
  ["Fajr", "\u0627\u0644\u0641\u062C\u0631"],
  ["Dhuhr", "\u0627\u0644\u0638\u0647\u0631"],
  ["Asr", "\u0627\u0644\u0639\u0635\u0631"],
  ["Maghrib", "\u0627\u0644\u0645\u063A\u0631\u0628"],
  ["Isha", "\u0627\u0644\u0639\u0634\u0627\u0621"]
];
var SITE_ORIGIN = "https://thimar.freebuff.page";
var PRAYER_ART = {
  Fajr: { image: "/adhan/prayer/fajr.jpg", phrase: "\u0628\u0648\u0631\u0643 \u0641\u064A\u0645\u0646 \u0628\u0643\u0651\u0631 \u2014 \u0635\u0644\u0627\u0629 \u0627\u0644\u0641\u062C\u0631 \u0646\u0648\u0631 \u064A\u0628\u062F\u0623 \u0628\u0647 \u064A\u0648\u0645\u0643" },
  Dhuhr: { image: "/adhan/prayer/dhuhr.jpg", phrase: "\u062A\u0648\u0642\u0651\u0641 \u0639\u0646 \u0627\u0644\u062F\u0646\u064A\u0627 \u0644\u062D\u0638\u0629\u2026 \u0644\u0635\u0644\u0627\u062A\u0643 \u0633\u0643\u064A\u0646\u0629 \u062A\u0639\u064A\u062F \u062A\u0631\u062A\u064A\u0628 \u064A\u0648\u0645\u0643" },
  Asr: { image: "/adhan/prayer/asr.jpg", phrase: "\u062D\u0627\u0641\u0638 \u0639\u0644\u0649 \u0627\u0644\u0639\u0635\u0631\u2026 \u0641\u0647\u064A \u0635\u0644\u0627\u0629 \u0645\u0646 \u062A\u0631\u0643\u0647\u0627 \u062D\u0628\u0637 \u0639\u0645\u0644\u0647" },
  Maghrib: { image: "/adhan/prayer/maghrib.jpg", phrase: "\u0644\u062D\u0638\u0629 \u063A\u0631\u0648\u0628\u2026 \u0630\u0646\u0648\u0628 \u062A\u063A\u064A\u0628 \u0645\u0639 \u062F\u0639\u0627\u0621 \u0627\u0644\u0645\u063A\u0631\u0628" },
  Isha: { image: "/adhan/prayer/isha.jpg", phrase: "\u0627\u062E\u062A\u0645 \u064A\u0648\u0645\u0643 \u0628\u0627\u0644\u0639\u0634\u0627\u0621\u2026 \u0648\u0627\u0628\u062F\u0623 \u0644\u064A\u0644\u0643 \u0645\u0637\u0645\u0626\u0646\u064B\u0627" }
};
var DAILY_MESSAGES = [
  "\u0627\u0642\u0631\u0623 \u0634\u064A\u0626\u0627\u064B \u0645\u0646 \u0627\u0644\u0642\u0631\u0622\u0646 \u0627\u0644\u064A\u0648\u0645 \u2014 \u062D\u062A\u0649 \u0622\u064A\u0629 \u0648\u0627\u062D\u062F\u0629 \u062A\u0636\u064A\u0621 \u064A\u0648\u0645\u0643.",
  "\u0627\u0642\u0631\u0623 \u062D\u062F\u064A\u062B \u0627\u0644\u064A\u0648\u0645 \u0648\u062A\u0623\u0645\u0644 \u0641\u064A \u0645\u0639\u0646\u0627\u0647.",
  "\u0644\u0627 \u062A\u0646\u0633\u064E \u062D\u0641\u0638 \u0634\u064A\u0621 \u0645\u0646 \u062A\u062D\u0641\u0629 \u0627\u0644\u0623\u0637\u0641\u0627\u0644 \u0627\u0644\u064A\u0648\u0645.",
  "\u0631\u0627\u062C\u0639 \u062D\u0641\u0638\u0643 \u0627\u0644\u064A\u0648\u0645: \u0622\u064A\u0629 \u0623\u0648 \u0633\u0648\u0631\u0629.",
  "\u0623\u062A\u0645\u0645 \u062C\u0632\u0621\u0627\u064B \u0645\u0646 \u0627\u0644\u0642\u0631\u0622\u0646 \u0623\u0648 \u0622\u064A\u0629 \u2014 \u0627\u0644\u0645\u062F\u0627\u0648\u0645\u0629 \u0647\u064A \u0627\u0644\u0633\u0631.",
  "\u0627\u0643\u062A\u0634\u0641 \u0643\u0644 \u062C\u062F\u064A\u062F \u0641\u064A \u062A\u0637\u0628\u064A\u0642 \u062B\u0645\u0627\u0631 \u2014 \u0632\u064A\u0627\u0631\u0629 \u0633\u0631\u064A\u0639\u0629 \u062A\u0643\u0641\u064A.",
  "\u0627\u0642\u0631\u0623 \u062D\u062F\u064A\u062B\u0627\u064B \u0648\u0634\u0627\u0631\u0643\u0647 \u0645\u0639 \u0645\u0646 \u062A\u062D\u0628."
];
function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
function bytesToBase64Url(bytes) {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 1) raw += String.fromCharCode(bytes[i]);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
function utf8(text) {
  return new TextEncoder().encode(text);
}
function uint32be(value) {
  return new Uint8Array([
    value >>> 24 & 255,
    value >>> 16 & 255,
    value >>> 8 & 255,
    value & 255
  ]);
}
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}
var cachedVapid = null;
async function vapidKeys(env) {
  if (cachedVapid) return cachedVapid;
  const raw = String(env?.VAPID_PRIVATE_KEY ?? "").trim();
  if (!raw) return null;
  let jwk;
  try {
    jwk = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!jwk || !jwk.x || !jwk.y || !jwk.d) return null;
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const x = base64UrlToBytes(jwk.x);
  const y = base64UrlToBytes(jwk.y);
  const publicBytes = new Uint8Array(65);
  publicBytes[0] = 4;
  publicBytes.set(x, 1);
  publicBytes.set(y, 33);
  cachedVapid = { privateKey, publicKey: bytesToBase64Url(publicBytes) };
  return cachedVapid;
}
async function vapidHeaders(endpoint, env) {
  const keys = await vapidKeys(env);
  if (!keys) return null;
  const header = bytesToBase64Url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToBase64Url(
    utf8(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1e3) + 12 * 3600,
        sub: VAPID_SUBJECT
      })
    )
  );
  const signingInput = `${header}.${claims}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      utf8(signingInput)
    )
  );
  return {
    Authorization: `vapid t=${signingInput}.${bytesToBase64Url(signature)}, k=${keys.publicKey}`,
    TTL: "86400",
    Urgency: "high"
  };
}
async function encryptPayload(subscription, payloadBytes) {
  const keys = subscription?.keys ?? {};
  const uaPublic = base64UrlToBytes(keys.p256dh);
  const authSecret = base64UrlToBytes(keys.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) {
    throw new Error("INVALID_SUBSCRIPTION_KEYS");
  }
  const serverKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const serverPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeys.publicKey)
  );
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, serverKeys.privateKey, 256)
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concatBytes(utf8("WebPush: info"), new Uint8Array([0]), uaPublic, serverPublic);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const contentEncryptionKey = await hkdf(
    salt,
    ikm,
    concatBytes(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])),
    16
  );
  const nonce = await hkdf(
    salt,
    ikm,
    concatBytes(utf8("Content-Encoding: nonce"), new Uint8Array([0])),
    12
  );
  const aesKey = await crypto.subtle.importKey(
    "raw",
    contentEncryptionKey,
    "AES-GCM",
    false,
    ["encrypt"]
  );
  const plaintext = concatBytes(payloadBytes, new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext)
  );
  const recordSize = uint32be(4096);
  const idLength = new Uint8Array([serverPublic.length]);
  return concatBytes(salt, recordSize, idLength, serverPublic, ciphertext);
}
async function db(env, path, init = {}) {
  const base = String(env?.SUPABASE_URL || SUPABASE_URL).replace(/\/+$/, "");
  const key = String(env?.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY);
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init.headers ?? {}
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`DB ${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
async function removeSubscription(env, id) {
  try {
    await db(env, `${TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  } catch {
  }
}
async function updateState(env, id, patch) {
  try {
    await db(env, `${TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ...patch, updated_at: Date.now() })
    });
  } catch {
  }
}
async function sendToSubscription(env, subscription, payload) {
  const headers = await vapidHeaders(subscription.endpoint, env);
  if (!headers) return { ok: false, reason: "NO_VAPID_KEYS" };
  let body;
  try {
    body = await encryptPayload(
      { keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      utf8(JSON.stringify(payload))
    );
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "ENCRYPT_FAILED" };
  }
  try {
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream"
      },
      body,
      signal: AbortSignal.timeout(1e4)
    });
    if (response.ok) return { ok: true, status: response.status };
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    return {
      ok: false,
      status: response.status,
      gone: response.status === 404 || response.status === 410,
      reason: detail || `HTTP_${response.status}`
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "NETWORK_ERROR" };
  }
}
async function sendToAccounts(env, accountIds, payload) {
  const ids = [...new Set((accountIds ?? []).filter((id) => typeof id === "string" && id))];
  if (!ids.length) return { ok: false, reason: "NO_ACCOUNTS", sent: 0 };
  let subscriptions = [];
  try {
    const filter = `account_id=in.(${ids.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})`;
    subscriptions = await db(env, `${TABLE}?select=*&${encodeURIComponent(filter)}`, {
      method: "GET"
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "DB_ERROR", sent: 0 };
  }
  let sent = 0;
  let failed = 0;
  let lastError = null;
  for (const subscription of subscriptions ?? []) {
    const result = await sendToSubscription(env, subscription, payload);
    if (result.ok) {
      sent += 1;
      continue;
    }
    failed += 1;
    lastError = { status: result.status ?? 0, reason: result.reason ?? "UNKNOWN" };
    if (result.gone) await removeSubscription(env, subscription.id);
  }
  let native = { ok: false, configured: false, sent: 0, failed: 0, devices: 0 };
  try {
    native = await sendFcmToAccounts(env, ids, payload);
  } catch (error) {
    native = {
      ok: false,
      configured: true,
      sent: 0,
      failed: 0,
      devices: 0,
      reason: error instanceof Error ? error.message : "FCM_ERROR"
    };
  }
  return {
    ok: sent + (native.sent ?? 0) > 0,
    sent,
    failed,
    devices: (subscriptions ?? []).length,
    lastError,
    fcm: native
  };
}
var FCM_CHANNEL = "thimar_notifications";
var FCM_CLICK_ACTION = "app.thimar.quran.OPEN_NOTIFICATION";
var FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
var fcmCache = { email: null, token: null, expiresAt: 0 };
function fcmServiceAccount(env) {
  const raw = String(env?.FCM_SERVICE_ACCOUNT ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}
function serviceRoleKey(env) {
  return String(env?.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() || null;
}
function pushSecret(env) {
  return String(env?.THIMAR_PUSH_SECRET ?? "").trim() || null;
}
async function readTokens(env, accountIds) {
  const ids = [...new Set((accountIds ?? []).filter((id) => typeof id === "string" && id))];
  const serviceKey = serviceRoleKey(env);
  const secret = pushSecret(env);
  let serviceError = null;
  if (serviceKey && (ids.length || !secret)) {
    try {
      const filter = ids.length ? `&account_id=in.(${ids.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})` : "&limit=500";
      const rows2 = await db(env, `thimar_fcm_tokens?select=token${filter}`, {
        method: "GET",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
      });
      return { rows: Array.isArray(rows2) ? rows2 : [], source: "service_role" };
    } catch (error) {
      serviceError = error instanceof Error ? error.message : "SERVICE_KEY_FAILED";
    }
  }
  if (!secret) {
    throw new Error(serviceError ?? "PUSH_TOKEN_SOURCE_MISSING");
  }
  const rows = await db(env, "rpc/thimar_push_tokens", {
    method: "POST",
    body: JSON.stringify(ids.length ? { p_secret: secret, p_account_ids: ids } : { p_secret: secret })
  });
  return { rows: Array.isArray(rows) ? rows : [], source: "secret_rpc", serviceError };
}
async function pruneTokens(env, tokens) {
  if (!tokens.length) return 0;
  const serviceKey = serviceRoleKey(env);
  if (serviceKey) {
    try {
      const filter = `token=in.(${tokens.map((token) => `"${token.replace(/"/g, "")}"`).join(",")})`;
      await db(env, `thimar_fcm_tokens?${filter}`, {
        method: "DELETE",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
      });
      return tokens.length;
    } catch {
    }
  }
  const secret = pushSecret(env);
  if (!secret) return 0;
  try {
    const removed = await db(env, "rpc/thimar_prune_fcm_tokens", {
      method: "POST",
      body: JSON.stringify({ p_secret: secret, p_tokens: tokens })
    });
    return Number(removed) || 0;
  } catch {
    return 0;
  }
}
function b64urlBytes(bytes) {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 1) raw += String.fromCharCode(bytes[i]);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlText(text) {
  return b64urlBytes(new TextEncoder().encode(text));
}
function pemToDer(pem) {
  const body = String(pem).replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
async function fcmAccessToken(account) {
  const now = Math.floor(Date.now() / 1e3);
  if (fcmCache.token && fcmCache.email === account.client_email && fcmCache.expiresAt > now + 60) {
    return fcmCache.token;
  }
  const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(
    JSON.stringify({
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    })
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`)
  );
  const assertion = `${header}.${claims}.${b64urlBytes(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }),
    signal: AbortSignal.timeout(1e4)
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`FCM_TOKEN_${response.status}:${detail}`);
  }
  const data = await response.json();
  fcmCache = {
    email: account.client_email,
    token: data.access_token,
    expiresAt: now + Number(data.expires_in ?? 3600)
  };
  return data.access_token;
}
function fcmBody(token, payload) {
  return JSON.stringify({
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      data: {
        title: payload.title,
        body: payload.body,
        url: payload.url,
        tag: payload.tag
      },
      android: {
        priority: "HIGH",
        ttl: "86400s",
        collapse_key: payload.tag,
        notification: {
          channel_id: FCM_CHANNEL,
          icon: "ic_stat_thimar",
          color: "#0F5F4E",
          sound: "default",
          default_vibrate_timings: true,
          tag: payload.tag,
          click_action: FCM_CLICK_ACTION,
          visibility: "PUBLIC"
        }
      },
      apns: {
        headers: { "apns-priority": "10", "apns-push-type": "alert" },
        payload: {
          aps: {
            alert: { title: payload.title, body: payload.body },
            sound: "default",
            "thread-id": payload.tag,
            "content-available": 1
          }
        }
      }
    }
  });
}
async function sendFcmToAccounts(env, accountIds, payload) {
  const account = fcmServiceAccount(env);
  if (!account || !serviceRoleKey(env) && !pushSecret(env)) {
    return {
      ok: false,
      configured: false,
      reason: !account ? "FCM_SERVICE_ACCOUNT_MISSING" : "PUSH_TOKEN_SOURCE_MISSING",
      sent: 0,
      failed: 0,
      devices: 0
    };
  }
  const ids = [...new Set((accountIds ?? []).filter((id) => typeof id === "string" && id))];
  if (!ids.length) return { ok: false, configured: true, reason: "NO_ACCOUNTS", sent: 0, failed: 0, devices: 0 };
  let rows = [];
  let source = null;
  try {
    const read = await readTokens(env, ids);
    rows = read.rows;
    source = read.source;
  } catch (error) {
    return {
      ok: false,
      configured: true,
      reason: error instanceof Error ? error.message : "DB_ERROR",
      sent: 0,
      failed: 0,
      devices: 0
    };
  }
  const tokens = [...new Set(rows.map((row) => row?.token).filter(Boolean))];
  if (!tokens.length) return { ok: false, configured: true, reason: "NO_TOKENS", sent: 0, failed: 0, devices: 0 };
  let accessToken;
  try {
    accessToken = await fcmAccessToken(account);
  } catch (error) {
    return {
      ok: false,
      configured: true,
      reason: error instanceof Error ? error.message : "FCM_AUTH_FAILED",
      sent: 0,
      failed: 0,
      devices: tokens.length
    };
  }
  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  const stale = [];
  let sent = 0;
  let failed = 0;
  let lastError = null;
  for (const token of tokens) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: fcmBody(token, payload),
        signal: AbortSignal.timeout(1e4)
      });
      if (response.ok) {
        sent += 1;
        continue;
      }
      failed += 1;
      const detail = (await response.text().catch(() => "")).slice(0, 240);
      lastError = { status: response.status, reason: detail };
      if (response.status === 404 || detail.includes("UNREGISTERED") || detail.includes("INVALID_ARGUMENT")) {
        stale.push(token);
      }
    } catch (error) {
      failed += 1;
      lastError = { status: 0, reason: error instanceof Error ? error.message : "NETWORK_ERROR" };
    }
  }
  const removed = stale.length ? await pruneTokens(env, stale) : 0;
  return {
    ok: sent > 0,
    configured: true,
    tokenSource: source,
    sent,
    failed,
    devices: tokens.length,
    removed,
    lastError
  };
}
var formatters = /* @__PURE__ */ new Map();
function localParts(timezone) {
  const zone = typeof timezone === "string" && timezone ? timezone : "UTC";
  let formatter = formatters.get(zone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    } catch {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    }
    formatters.set(zone, formatter);
  }
  const parts = {};
  for (const part of formatter.formatToParts(/* @__PURE__ */ new Date())) parts[part.type] = part.value;
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hours: Number(parts.hour) % 24,
    minutes: Number(parts.minute)
  };
}
function minutesOf(value) {
  const match = /(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
var timingsCache = /* @__PURE__ */ new Map();
async function timingsFor(subscription, dateKey) {
  const cacheKey = `${subscription.id}:${dateKey}`;
  if (timingsCache.has(cacheKey)) return timingsCache.get(cacheKey);
  const [year, month, day] = dateKey.split("-");
  const timezone = subscription.timezone || "UTC";
  const url = `https://api.aladhan.com/v1/timings/${day}-${month}-${year}?latitude=${subscription.latitude}&longitude=${subscription.longitude}&method=${Number(subscription.prayer_method) || 4}&timezonestring=${encodeURIComponent(timezone)}`;
  let timings = null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8e3) });
    if (response.ok) {
      const data = await response.json();
      timings = data?.data?.timings ?? null;
    }
  } catch {
    timings = null;
  }
  timingsCache.set(cacheKey, timings);
  return timings;
}
async function runTick(env) {
  let subscriptions;
  try {
    subscriptions = await db(env, `${TABLE}?select=*&limit=2000`, { method: "GET" });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "DB_ERROR" };
  }
  const summary = { checked: 0, sent: 0, failed: 0, removed: 0 };
  for (const subscription of subscriptions ?? []) {
    summary.checked += 1;
    try {
      const local = localParts(subscription.timezone);
      const nowMinutes = local.hours * 60 + local.minutes;
      if (subscription.adhan_enabled && typeof subscription.latitude === "number" && typeof subscription.longitude === "number") {
        const timings = await timingsFor(subscription, local.dateKey);
        if (timings) {
          for (const [key, label] of PRAYERS) {
            const prayerMinutes = minutesOf(timings[key]);
            if (prayerMinutes === null) continue;
            const dedupe = `${local.dateKey}-${key}`;
            if (subscription.last_adhan_key === dedupe) continue;
            if (nowMinutes < prayerMinutes || nowMinutes > prayerMinutes + 9) continue;
            const art = PRAYER_ART[key];
            const result = await sendToSubscription(env, subscription, {
              title: `\u062D\u0627\u0646 \u0648\u0642\u062A \u0635\u0644\u0627\u0629 ${label}`,
              body: art.phrase,
              url: "/",
              tag: `adhan-${dedupe}`,
              image: `${SITE_ORIGIN}${art.image}`
            });
            if (result.gone) {
              await removeSubscription(env, subscription.id);
              summary.removed += 1;
              break;
            }
            if (result.ok) {
              subscription.last_adhan_key = dedupe;
              summary.sent += 1;
              await updateState(env, subscription.id, { last_adhan_key: dedupe });
            } else {
              summary.failed += 1;
            }
          }
        }
      }
      if (subscription.daily_enabled && local.hours === 19 && local.minutes < 5 && subscription.last_daily_date !== local.dateKey) {
        const message = DAILY_MESSAGES[local.dateKey.length % DAILY_MESSAGES.length];
        const result = await sendToSubscription(env, subscription, {
          title: "\u062A\u0630\u0643\u064A\u0631 \u062B\u0645\u0627\u0631",
          body: message,
          url: "/",
          tag: `daily-${local.dateKey}`
        });
        if (result.gone) {
          await removeSubscription(env, subscription.id);
          summary.removed += 1;
        } else if (result.ok) {
          subscription.last_daily_date = local.dateKey;
          summary.sent += 1;
          await updateState(env, subscription.id, { last_daily_date: local.dateKey });
        } else {
          summary.failed += 1;
        }
      }
    } catch {
      summary.failed += 1;
    }
  }
  return { ok: true, ...summary };
}
function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
var SEND_WINDOW_MS = 6e4;
var SEND_LIMIT = 40;
var sendHits = /* @__PURE__ */ new Map();
function sendGuard(request, env) {
  const allowed = String(env?.APP_ORIGIN ?? "https://thimar.freebuff.page").replace(/\/+$/, "");
  const source = request.headers.get("Origin") || request.headers.get("Referer") || "";
  if (source && !source.startsWith(allowed)) {
    return jsonResponse(403, { error: "ORIGIN_NOT_ALLOWED" });
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const recent = (sendHits.get(ip) || []).filter((at) => now - at < SEND_WINDOW_MS);
  if (recent.length >= SEND_LIMIT) {
    return jsonResponse(429, { error: "TOO_MANY_REQUESTS" });
  }
  recent.push(now);
  sendHits.set(ip, recent);
  if (sendHits.size > 5e3) sendHits.clear();
  return null;
}
async function handlePush(request, env, url) {
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/push/")) return null;
  if (pathname === "/api/push/key") {
    const keys = await vapidKeys(env);
    if (!keys) return jsonResponse(503, { error: "PUSH_NOT_CONFIGURED" });
    return jsonResponse(200, { publicKey: keys.publicKey });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (pathname === "/api/push/health") {
    if (request.method !== "GET") return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    const account = fcmServiceAccount(env);
    const serviceKey = serviceRoleKey(env);
    const raw = String(env?.FCM_SERVICE_ACCOUNT ?? "").trim();
    const report = {
      fcm: {
        serviceAccount: account ? "ok" : raw ? "invalid" : "missing",
        projectId: account?.project_id ?? null,
        clientEmail: account?.client_email ? account.client_email.replace(/^([^@]{2})[^@]*/, "$1***") : null,
        oauth: account ? "not_attempted" : "skipped",
        oauthError: null
      },
      supabase: {
        serviceRoleKey: serviceKey ? "present" : "missing",
        tokenSource: serviceKey ? "service_role" : pushSecret(env) ? "secret_rpc" : "none",
        tokensReadable: null,
        tokens: null,
        error: null
      }
    };
    if (account) {
      try {
        await fcmAccessToken(account);
        report.fcm.oauth = "ok";
      } catch (error) {
        report.fcm.oauth = "failed";
        report.fcm.oauthError = String(error?.message ?? error).slice(0, 200);
      }
    }
    if (report.supabase.tokenSource !== "none") {
      try {
        const read = await readTokens(env, []);
        report.supabase.tokenSource = read.source;
        report.supabase.tokensReadable = true;
        report.supabase.tokens = read.rows.length;
        if (read.serviceError) {
          report.supabase.serviceKeyError = String(read.serviceError).slice(0, 160);
        }
      } catch (error) {
        report.supabase.tokensReadable = false;
        report.supabase.error = String(error?.message ?? error).slice(0, 200);
      }
    }
    return jsonResponse(200, report);
  }
  if (pathname === "/api/push/send" || pathname === "/api/push/test") {
    if (request.method !== "POST") return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    const blocked = sendGuard(request, env);
    if (blocked) return blocked;
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: "INVALID_JSON" });
    }
    const accountIds = Array.isArray(body?.accountIds) ? body.accountIds : body?.accountId ? [body.accountId] : [];
    if (!accountIds.length) return jsonResponse(400, { error: "ACCOUNT_REQUIRED" });
    const payload = {
      title: String(body?.title ?? "\u062B\u0645\u0627\u0631").slice(0, 120),
      body: String(body?.body ?? "\u0644\u062F\u064A\u0643 \u062A\u062D\u062F\u064A\u062B \u062C\u062F\u064A\u062F \u0641\u064A \u062B\u0645\u0627\u0631.").slice(0, 300),
      url: typeof body?.url === "string" && body.url.startsWith("/") ? body.url : "/",
      tag: String(body?.tag ?? "thimar-external").slice(0, 80)
    };
    const result = await sendToAccounts(env, accountIds, payload);
    return jsonResponse(
      result.sent + (result.fcm?.sent ?? 0) > 0 ? 200 : 502,
      result
    );
  }
  if (pathname === "/api/push/tick") {
    if (request.method !== "POST" && request.method !== "GET") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    const cronSecret = pushSecret(env);
    const provided = request.headers.get("x-thimar-tick") || "";
    if (!cronSecret || provided !== cronSecret) {
      return jsonResponse(403, { error: "FORBIDDEN" });
    }
    const result = await runTick(env);
    return jsonResponse(result.ok ? 200 : 500, result);
  }
  return jsonResponse(404, { error: "NOT_FOUND" });
}

// worker.js
var GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
var DEFAULT_MODEL = "gemini-3.5-flash";
var MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-3.8-flash"];
function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/push/")) {
      const handled = await handlePush(request, env, url);
      if (handled) return handled;
    }
    if (url.pathname === "/api/ai/health") {
      const key = env.AI_API_KEY || env.GEMINI_API_KEY;
      return json(200, {
        configured: Boolean(key),
        model: DEFAULT_MODEL,
        models: MODELS
      });
    }
    if (url.pathname === "/api/ai/chat") {
      if (request.method === "OPTIONS") {
        return new Response("ok", {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS"
          }
        });
      }
      if (request.method !== "POST") {
        return json(405, { error: "METHOD_NOT_ALLOWED" });
      }
      const key = env.AI_API_KEY || env.GEMINI_API_KEY;
      if (!key) {
        return json(501, { error: "AI_NOT_CONFIGURED" });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json(400, { error: "INVALID_JSON" });
      }
      if (!Array.isArray(body?.messages) || body.messages.length === 0) {
        return json(400, { error: "MESSAGES_REQUIRED" });
      }
      const upstream = await fetch(`${GEMINI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "x-goog-api-key": key
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: body.messages,
          temperature: Math.min(1, Math.max(0, body.temperature ?? 0.4)),
          max_tokens: Math.min(1200, Math.max(64, body.max_tokens ?? 500))
        })
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        return json(502, {
          error: "UPSTREAM_ERROR",
          status: upstream.status,
          detail: text.slice(0, 500)
        });
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return json(502, { error: "INVALID_UPSTREAM_RESPONSE" });
      }
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return json(502, { error: "EMPTY_AI_RESPONSE" });
      }
      return json(200, { content, model: data?.model || DEFAULT_MODEL });
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  worker_default as default
};
