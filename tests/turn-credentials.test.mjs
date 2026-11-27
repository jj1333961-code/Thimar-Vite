// اختبارات وحدة لدالة thimar-turn بعد نقلها إلى بيانات اعتماد قصيرة العمر.
// تُشغَّل بـ: node --test tests/turn-credentials.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { handleTurnRequest } from "../supabase/functions/thimar-turn/index.ts";
import { clampTtl, mintTurnCredentials, sanitizeTurnUser } from "../supabase/functions/_shared/turn.ts";

const SESSION_SECRET = "test-session-secret-not-real";
const TURN_SECRET = "test-turn-shared-secret-not-real";
const ORIGIN = "https://thimar.freebuff.page";

const encoder = new TextEncoder();

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

async function sessionToken({ sub = "user-a", scope = "session", expOffset = 600, secret = SESSION_SECRET } = {}) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ sub, scope, exp: Math.floor(Date.now() / 1000) + expOffset }));
  const signature = b64url(await sign(secret, `${header}.${payload}`));
  return `${header}.${payload}.${signature}`;
}

function makeEnv(overrides = {}) {
  const values = {
    SESSION_SIGNING_SECRET: SESSION_SECRET,
    EXPRESSTURN_SECRET: TURN_SECRET,
    EXPRESSTURN_TTL_SECONDS: "3600",
    ...overrides,
  };
  return (name) => values[name] ?? "";
}

function turnRequest({ token, origin = ORIGIN, search = "" } = {}) {
  const headers = { Origin: origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://example.supabase.co/functions/v1/thimar-turn${search}`, { method: "GET", headers });
}

async function expectHmac(secret, username, credential) {
  const { credential: expected } = await mintTurnCredentials({ secret, userId: "probe", ttlSeconds: 300 });
  assert.equal(typeof expected, "string");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(username));
  assert.equal(credential, Buffer.from(new Uint8Array(digest)).toString("base64"));
}

test("بلا رمز جلسة: 401 ولا تُعاد أي بيانات اعتماد", async () => {
  const res = await handleTurnRequest(turnRequest(), makeEnv());
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "AUTH_REQUIRED");
  assert.equal(body.iceServers, undefined);
});

test("مفتاح anon أو رمز غير موقّع لا يُقبل", async () => {
  const anon = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.not-a-signature";
  const res = await handleTurnRequest(turnRequest({ token: anon }), makeEnv());
  assert.equal(res.status, 401);
});

test("رمز منتهٍ أو موقّع بمفتاح آخر: 401", async () => {
  const expired = await sessionToken({ expOffset: -5 });
  assert.equal((await handleTurnRequest(turnRequest({ token: expired }), makeEnv())).status, 401);
  const forged = await sessionToken({ secret: "another-secret" });
  assert.equal((await handleTurnRequest(turnRequest({ token: forged }), makeEnv())).status, 401);
});

test("رمز بنطاق غير session (مثل scope=admin) مرفوض", async () => {
  const token = await sessionToken({ scope: "admin" });
  assert.equal((await handleTurnRequest(turnRequest({ token }), makeEnv())).status, 401);
});

test("جلسة صالحة: بيانات اعتماد قصيرة العمر مرتبطة بهوية المستخدم", async () => {
  const token = await sessionToken({ sub: "user-42" });
  const res = await handleTurnRequest(turnRequest({ token }), makeEnv());
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.providers.includes("expressturn"), true);
  const relay = body.iceServers.find((server) =>
    (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => url.startsWith("turn:") || url.startsWith("turns:")),
  );
  assert.ok(relay, "يجب أن تُعاد بيانات مُرحّل TURN");
  assert.ok(relay.username.startsWith(""), "username موجود");

  const [expiryRaw, user] = relay.username.split(":");
  const expiry = Number(expiryRaw);
  assert.equal(user, "user-42");
  assert.ok(Number.isFinite(expiry));
  const now = Math.floor(Date.now() / 1000);
  assert.ok(expiry > now, "تاريخ الانتهاء في المستقبل");
  assert.ok(expiry - now <= 3600 + 5, "TTL لا يتجاوز المسموح");
  assert.equal(body.ttl, 3600);
  await expectHmac(TURN_SECRET, relay.username, relay.credential);
});

test("لا يُسرَّب المفتاح المشترك ولا بيانات دائمة في الاستجابة", async () => {
  const token = await sessionToken();
  const res = await handleTurnRequest(turnRequest({ token }), makeEnv({ EXPRESSTURN_USERNAME: "static-user", EXPRESSTURN_CREDENTIAL: "static-pass" }));
  const text = await res.text();
  assert.equal(text.includes(TURN_SECRET), false);
  assert.equal(text.includes("static-user"), false);
  assert.equal(text.includes("static-pass"), false);
  assert.equal(text.includes("static"), false);
});

test("بلا مفتاح مشترك: 503 صريح لا احتياطي دائم", async () => {
  const token = await sessionToken();
  const res = await handleTurnRequest(
    turnRequest({ token }),
    makeEnv({ EXPRESSTURN_SECRET: "", EXPRESSTURN_USERNAME: "static-user", EXPRESSTURN_CREDENTIAL: "static-pass" }),
  );
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "TURN_NOT_CONFIGURED");
});

test("بلا سر جلسة على الخادم: 503", async () => {
  const token = await sessionToken();
  const res = await handleTurnRequest(turnRequest({ token }), makeEnv({ SESSION_SIGNING_SECRET: "" }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "SESSION_NOT_CONFIGURED");
});

test("CORS: يعكس الأصل المسموح فقط", async () => {
  const token = await sessionToken();
  const allowed = await handleTurnRequest(turnRequest({ token }), makeEnv());
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(allowed.headers.get("Cache-Control"), "no-store");

  const foreign = await handleTurnRequest(turnRequest({ token, origin: "https://evil.example" }), makeEnv());
  assert.equal(foreign.headers.get("Access-Control-Allow-Origin"), null);
});

test("تعقيم اسم المستخدم وحدود TTL", async () => {
  assert.equal(sanitizeTurnUser("a:b c/../d"), "a_b_c_.._d");
  assert.equal(sanitizeTurnUser(""), "user");
  assert.equal(clampTtl(10), 300);
  assert.equal(clampTtl(99999), 7200);
  assert.equal(clampTtl("abc"), 3600);
});

test("مفاتيح مختلفة تعطي توقيعات مختلفة", async () => {
  const a = await mintTurnCredentials({ secret: "s1", userId: "u", ttlSeconds: 600, nowMs: 1_700_000_000_000 });
  const b = await mintTurnCredentials({ secret: "s2", userId: "u", ttlSeconds: 600, nowMs: 1_700_000_000_000 });
  assert.equal(a.username, b.username);
  assert.notEqual(a.credential, b.credential);
  assert.equal(a.expiresAt, 1_700_000_000 + 600);
});
