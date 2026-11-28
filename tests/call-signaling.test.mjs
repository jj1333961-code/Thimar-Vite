// اختبارات وحدة لناقل إشارات المكالمة فوق Supabase Broadcast.
// تُشغَّل بـ: node --test tests/call-signaling.test.mjs
//
// تغطّي الأعطال التي كانت تُسقط المكالمات في الإنتاج:
//  - إرسال أول عرض SDP قبل اكتمال الاشتراك (كان يُهمل بلا أثر).
//  - رسائل مكرّرة بعد إعادة المحاولة، وصدى رسائلنا.
//  - سقوط القناة ثم إعادة الاشتراك واستئناف الطابور.
//  - اشتراك لا يكتمل أبدًا (مهلة) بلا تعافٍ.

import { test } from "node:test";
import assert from "node:assert/strict";

import { BroadcastSignaling, signalingBackoff, SUBSCRIBE_TIMEOUT_MS } from "../src/lib/broadcastSignaling.ts";

class FakeChannel {
  constructor(name) {
    this.name = name;
    this.handlers = [];
    this.sent = [];
    this.subscribed = false;
    this.closed = false;
    this.statusCallback = null;
  }

  on(_type, _filter, callback) {
    this.handlers.push(callback);
    return this;
  }

  subscribe(callback) {
    this.statusCallback = callback;
    return this;
  }

  send(frame) {
    if (!this.subscribed) throw new Error("tried to push before joining");
    this.sent.push(frame);
    return Promise.resolve({ status: "ok" });
  }

  unsubscribe() {
    this.closed = true;
    return Promise.resolve();
  }

  join() {
    this.subscribed = true;
    this.statusCallback?.("SUBSCRIBED");
  }

  fail(status = "CHANNEL_ERROR") {
    this.subscribed = false;
    this.statusCallback?.(status);
  }

  emit(payload) {
    for (const handler of this.handlers) handler({ payload });
  }
}

function makeScheduler() {
  let nextId = 0;
  const tasks = new Map();
  return {
    schedule(callback) {
      nextId += 1;
      tasks.set(nextId, callback);
      return nextId;
    },
    cancel(id) {
      tasks.delete(id);
    },
    run() {
      const pending = [...tasks.values()];
      tasks.clear();
      for (const callback of pending) callback();
    },
    get pending() {
      return tasks.size;
    },
  };
}

function makeBus({ selfId = "self", onSignal = () => undefined, onState = () => undefined, scheduler } = {}) {
  const channels = [];
  const state = { channels };
  const bus = new BroadcastSignaling({
    channelName: "thimar-call-test",
    selfId,
    createChannel: (name) => {
      const channel = new FakeChannel(name);
      channels.push(channel);
      return channel;
    },
    onSignal,
    onState,
    schedule: (callback) => scheduler.schedule(callback),
    cancel: (id) => scheduler.cancel(id),
  });
  state.bus = bus;
  return state;
}

test("أول عرض قبل اكتمال الاشتراك يُحفظ ويُرسل بعد SUBSCRIBED", () => {
  const scheduler = makeScheduler();
  const { bus, channels } = makeBus({ scheduler });
  bus.connect();
  assert.equal(channels.length, 1);

  bus.send({ kind: "offer", from: "self", callId: "c1", sdp: { type: "offer", sdp: "v=0" } });
  assert.equal(channels[0].sent.length, 0, "لا إرسال قبل الاشتراك");
  assert.equal(bus.pending, 1);

  channels[0].join();
  assert.equal(channels[0].sent.length, 1);
  assert.equal(channels[0].sent[0].payload.kind, "offer");
  assert.equal(typeof channels[0].sent[0].payload.msgId, "string");
  assert.equal(bus.pending, 0);
});

test("الرسائل المكرّرة تُسلَّم مرة واحدة وصدى رسائلنا يُتجاهل", () => {
  const scheduler = makeScheduler();
  const received = [];
  const { bus, channels } = makeBus({ scheduler, onSignal: (signal) => received.push(signal) });
  bus.connect();
  channels[0].join();

  const frame = { kind: "ice", from: "peer", callId: "c1", candidate: { candidate: "a" }, msgId: "peer-1" };
  channels[0].emit(frame);
  channels[0].emit(frame);
  channels[0].emit({ kind: "offer", from: "self", callId: "c1", sdp: {}, msgId: "self-1" });

  assert.equal(received.length, 1);
  assert.equal(received[0].kind, "ice");
  bus.close();
});

test("سقوط القناة يعيد الاشتراك ويستأنف الطابور", () => {
  const scheduler = makeScheduler();
  const states = [];
  const { bus, channels } = makeBus({ scheduler, onState: (state) => states.push(state) });
  bus.connect();
  channels[0].join();
  // الحالة الابتدائية هي "connecting" بلا إشعار، فيبدأ السجل بـ"open".
  assert.deepEqual(states, ["open"]);

  channels[0].fail("CHANNEL_ERROR");
  assert.equal(channels[0].closed, true);

  bus.send({ kind: "ice", from: "self", callId: "c1", candidate: { candidate: "b" } });
  assert.equal(bus.pending, 1, "الإشارة تنتظر إعادة الاتصال");

  scheduler.run();
  assert.equal(channels.length, 2, "قناة جديدة بعد التراجع");
  channels[1].join();

  assert.equal(channels[1].sent.length, 1);
  assert.equal(bus.pending, 0);
  assert.deepEqual(states, ["open", "reconnecting", "open"]);
  bus.close();
});

test("اشتراك لا يكتمل خلال المهلة يُعاد إنشاؤه بدل التعليق", () => {
  const scheduler = makeScheduler();
  const { bus, channels } = makeBus({ scheduler });
  bus.connect();
  assert.equal(channels.length, 1);

  scheduler.run(); // مهلة الاشتراك
  assert.equal(channels[0].closed, true);
  scheduler.run(); // إعادة المحاولة
  assert.equal(channels.length, 2);

  channels[1].join();
  assert.equal(bus.state, "open");
  bus.close();
});

test("الإغلاق يوقف الإرسال ويُغلق القناة", () => {
  const scheduler = makeScheduler();
  const { bus, channels } = makeBus({ scheduler });
  bus.connect();
  channels[0].join();
  bus.close();

  assert.equal(channels[0].closed, true);
  assert.equal(bus.state, "closed");
  const before = channels[0].sent.length;
  bus.send({ kind: "hangup", from: "self", callId: "c1" });
  assert.equal(channels[0].sent.length, before);
  assert.equal(bus.pending, 0);
});

test("التراجع الأُسّي محدود بين 500ms و18s", () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const delay = signalingBackoff(attempt, () => 0.5);
    assert.ok(delay >= 500 && delay <= 18_000, `attempt ${attempt} => ${delay}`);
  }
  assert.equal(SUBSCRIBE_TIMEOUT_MS, 8_000);
});
