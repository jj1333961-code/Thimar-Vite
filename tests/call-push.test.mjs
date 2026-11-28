// اختبارات وحدة لإشعار المكالمة الواردة (FCM) الذي يرسله الخادم عند الرنين.
// تُشغَّل بـ: node --test tests/call-push.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  incomingCallTag,
  incomingCallText,
  incomingCallUrl,
  notifyIncomingCall,
} from "../supabase/functions/_shared/callPush.ts";

const SUPABASE_URL = "https://project.supabase.co";
const SECRET = "test-push-secret-not-real";

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { impl, calls };
}

test("يرسل إشعار الرنين إلى جهاز المستقبِل برابط المكالمة ووسمها", async () => {
  const { impl, calls } = fakeFetch(() => new Response(JSON.stringify({ sent: 1 }), { status: 200 }));
  const result = await notifyIncomingCall({
    supabaseUrl: SUPABASE_URL,
    secret: SECRET,
    calleeId: "callee-1",
    callId: "call-42",
    callerName: "أحمد",
    mode: "audio",
    fetchImpl: impl,
  });
  assert.deepEqual(result, { sent: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${SUPABASE_URL}/functions/v1/send-push`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SECRET}`);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.accountIds, ["callee-1"]);
  assert.equal(body.url, "/messages?incoming=call-42");
  assert.equal(body.tag, "call-call-42");
  assert.equal(body.title, "مكالمة صوتية واردة");
  assert.match(body.body, /أحمد/);
});

test("بلا سر مشترك لا يُرسل أي طلب إشعار", async () => {
  const { impl, calls } = fakeFetch(() => new Response("{}", { status: 200 }));
  const result = await notifyIncomingCall({
    supabaseUrl: SUPABASE_URL,
    secret: "",
    calleeId: "callee-1",
    callId: "call-1",
    callerName: "",
    mode: "video",
    fetchImpl: impl,
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "NO_SECRET");
  assert.equal(calls.length, 0);
});

test("فشل الإرسال لا يرمي استثناء ولا يُفشل المكالمة", async () => {
  const rejected = await notifyIncomingCall({
    supabaseUrl: SUPABASE_URL,
    secret: SECRET,
    calleeId: "callee-1",
    callId: "call-2",
    callerName: "",
    mode: "audio",
    fetchImpl: async () => new Response("nope", { status: 500 }),
  });
  assert.deepEqual(rejected, { sent: false, reason: "REJECTED" });

  const offline = await notifyIncomingCall({
    supabaseUrl: SUPABASE_URL,
    secret: SECRET,
    calleeId: "callee-1",
    callId: "call-3",
    callerName: "",
    mode: "audio",
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.deepEqual(offline, { sent: false, reason: "NETWORK" });
});

test("الرابط مسار داخلي فقط ولا يحمل بيانات حساسة", () => {
  const url = incomingCallUrl("call/with space");
  assert.ok(url.startsWith("/messages?incoming="));
  assert.ok(!url.includes("http"));
  assert.ok(!url.includes("token"));
});

test("وسم الإشعار ثابت لكل مكالمة ومختلف بين المكالمات (منع التكرار)", () => {
  assert.equal(incomingCallTag("abc"), incomingCallTag("abc"));
  assert.notEqual(incomingCallTag("abc"), incomingCallTag("abd"));
  assert.ok(incomingCallTag("x".repeat(200)).length <= 80);
});

test("نص الإشعار يفرّق بين الصوت والفيديو", () => {
  assert.equal(incomingCallText("video", "سارة").title, "مكالمة فيديو واردة");
  assert.equal(incomingCallText("audio", "").body, "يتصل بك الآن");
});

test("دالة المكالمات تُرسل الرنين، والتطبيق يفتح شاشة المكالمة من الإشعار", () => {
  const edge = readFileSync(new URL("../supabase/functions/thimar-calls/index.ts", import.meta.url), "utf8");
  assert.match(edge, /notifyIncomingCall\(/);
  assert.match(edge, /secret: \(Deno\.env\.get\("THIMAR_PUSH_SECRET"\)/);

  const host = readFileSync(new URL("../src/components/dashboard/IncomingCallHost.tsx", import.meta.url), "utf8");
  assert.match(host, /thimar:push-open/);
  assert.match(host, /searchParams\.get\("incoming"\)/);
  assert.match(host, /callServer\("pending"/);
});
