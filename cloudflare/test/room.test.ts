import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import type { Env } from "../src/env";

const ROOM = "room-do-1";

type Frame = Record<string, unknown>;

/** قارئ مُخزَّن الإطارات: لا تُفقد رسالة تصل قبل بدء الانتظار. */
class Reader {
  #queue: Frame[] = [];
  #waiters: Array<(value: Frame) => void> = [];

  constructor(socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const value = JSON.parse(String(event.data)) as Frame;
      const waiter = this.#waiters.shift();
      if (waiter) waiter(value);
      else this.#queue.push(value);
    });
  }

  next(timeoutMs = 2000): Promise<Frame> {
    const queued = this.#queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WS_TIMEOUT")), timeoutMs);
      this.#waiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }
}

function stubFor(roomId: string): DurableObjectStub {
  const namespace = (env as unknown as Env).CALL_ROOMS;
  return namespace.get(namespace.idFromName(roomId));
}

async function join(stub: DurableObjectStub, uid: string) {
  const response = await stub.fetch(
    new Request("https://room.internal/ws", {
      headers: { Upgrade: "websocket", "X-Thimar-User": uid, "X-Thimar-Room": ROOM },
    }),
  );
  const socket = response.webSocket as WebSocket | null;
  if (response.status === 101 && socket) socket.accept();
  return { socket: socket as WebSocket, reader: socket ? new Reader(socket) : null, response };
}

describe("CallRoom", () => {
  it("يرفض الطلب غير المرفوع إلى WebSocket", async () => {
    const response = await stubFor(ROOM).fetch(new Request("https://room.internal/ws"));
    expect(response.status).toBe(426);
  });

  it("يعلن الحضور ويوزّع الإشارة على الطرف الآخر فقط", async () => {
    const stub = stubFor(`${ROOM}-fanout`);
    const a = await join(stub, "alice");
    const b = await join(stub, "bob");
    expect(a.response.status).toBe(101);
    expect(b.response.status).toBe(101);

    const welcomeA = await a.reader!.next();
    expect(welcomeA.type).toBe("welcome");
    expect(welcomeA.roomId).toBe(ROOM);
    const presenceA = await a.reader!.next();
    expect(presenceA.type).toBe("presence");

    const welcomeB = await b.reader!.next();
    expect(welcomeB.uid).toBe("bob");
    const presenceB = await b.reader!.next();
    expect(presenceB.participants).toContain("alice");
    expect(presenceB.participants).toContain("bob");
    expect(presenceB.max).toBe(10);

    // alice تستقبل إعلان انضمام bob
    const joinedNotice = await a.reader!.next();
    expect(joinedNotice.type).toBe("presence");

    a.socket.send(JSON.stringify({ type: "signal", to: "bob", msgId: "m-1", payload: { kind: "offer" } }));
    const received = await b.reader!.next();
    expect(received).toMatchObject({ type: "signal", from: "alice", to: "bob", msgId: "m-1" });
    const ack = await a.reader!.next();
    expect(ack).toMatchObject({ type: "ack", msgId: "m-1" });

    a.socket.close(1000, "done");
    b.socket.close(1000, "done");
  });

  it("لا يكرر الإشارة عند إعادة إرسال نفس المعرّف", async () => {
    const stub = stubFor(`${ROOM}-dedupe`);
    const a = await join(stub, "alice");
    const b = await join(stub, "bob");
    await a.reader!.next();
    await a.reader!.next();
    await a.reader!.next();
    await b.reader!.next();
    await b.reader!.next();

    a.socket.send(JSON.stringify({ type: "signal", to: "bob", msgId: "dup-1", payload: 1 }));
    expect((await b.reader!.next()).msgId).toBe("dup-1");
    expect((await a.reader!.next()).type).toBe("ack");

    a.socket.send(JSON.stringify({ type: "signal", to: "bob", msgId: "dup-1", payload: 2 }));
    const secondAck = await a.reader!.next();
    expect(secondAck).toMatchObject({ type: "ack", msgId: "dup-1", duplicate: true });

    a.socket.close();
    b.socket.close();
  });

  it("يرفض المشارك الحادي عشر ويقبل عشرة", async () => {
    const stub = stubFor(`${ROOM}-cap`);
    const sockets: WebSocket[] = [];
    for (let index = 0; index < 10; index += 1) {
      const { socket, response } = await join(stub, `user-${index}`);
      expect(response.status).toBe(101);
      sockets.push(socket);
    }
    const extra = await join(stub, "user-10");
    expect(extra.response.status).toBe(409);
    expect(((await extra.response.json()) as Record<string, unknown>).error).toBe("ROOM_FULL");

    const state = await stub.describe();
    expect(state.participants).toHaveLength(10);
    expect(state.max).toBe(10);
    sockets.forEach((socket) => socket.close());
  });

  it("يسمح بإعادة اتصال نفس المستخدم دون تجاوز الحد", async () => {
    const stub = stubFor(`${ROOM}-reconnect`);
    const first = await join(stub, "solo");
    expect(first.response.status).toBe(101);
    const second = await join(stub, "solo");
    expect(second.response.status).toBe(101);
    const state = await stub.describe();
    expect(state.participants).toEqual(["solo"]);
    first.socket.close();
    second.socket.close();
  });

  it("يرفض الرسائل التالفة والكبيرة ويجيب على ping", async () => {
    const stub = stubFor(`${ROOM}-bad`);
    const { socket, reader } = await join(stub, "alice");
    await reader!.next();
    await reader!.next();

    socket.send("not-json");
    expect(await reader!.next()).toMatchObject({ type: "error", code: "INVALID_JSON" });

    socket.send(JSON.stringify({ type: "signal", to: "bob", msgId: "x", payload: "y".repeat(40 * 1024) }));
    expect(await reader!.next()).toMatchObject({ type: "error", code: "MESSAGE_TOO_LARGE" });

    socket.send(JSON.stringify({ type: "ping" }));
    const pong = await reader!.next();
    expect(pong.type).toBe("pong");
    expect(typeof pong.t).toBe("number");

    socket.send(JSON.stringify({ type: "signal", to: "ghost", msgId: "g-1", payload: 1 }));
    expect(await reader!.next()).toMatchObject({ type: "error", code: "PEER_NOT_IN_ROOM", msgId: "g-1" });

    socket.close();
  });
});
