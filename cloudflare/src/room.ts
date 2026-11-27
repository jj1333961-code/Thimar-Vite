import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

/**
 * غرفة مكالمة واحدة = كائن Durable Object واحد.
 * يحفظ الحضور ويوزّع الإشارات دون أن يرى الخادم محتوى الوسائط.
 * الحد الأقصى 10 مشاركين، ويُرفض الحادي عشر صريحًا.
 */

const DEFAULT_MAX_PARTICIPANTS = 10;
const MAX_MESSAGE_BYTES = 32 * 1024;
const DEDUPE_LIMIT = 512;

type Attachment = { uid: string; roomId: string; joinedAt: number };

type ClientMessage =
  | { type: "ping" }
  | { type: "presence" }
  | { type: "signal"; to?: string; msgId: string; payload: unknown };

export class CallRoom extends DurableObject<Env> {
  #revision = 0;
  #seen: string[] = [];

  #maxParticipants(): number {
    const configured = Number(this.env.ROOM_MAX_PARTICIPANTS ?? "");
    return Number.isFinite(configured) && configured > 0 && configured <= 10 ? configured : DEFAULT_MAX_PARTICIPANTS;
  }

  #attachment(socket: WebSocket): Attachment | null {
    try {
      return (socket.deserializeAttachment() as Attachment | null) ?? null;
    } catch {
      return null;
    }
  }

  #participants(): string[] {
    const uids = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.#attachment(socket);
      if (attachment?.uid) uids.add(attachment.uid);
    }
    return [...uids];
  }

  #send(socket: WebSocket, message: unknown): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      /* العميل断开 بينما كنا نرسل — الحضور سيُحدَّث عند إغلاقه. */
    }
  }

  #broadcast(message: unknown, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      this.#send(socket, message);
    }
  }

  #presence(socket?: WebSocket): void {
    this.#revision += 1;
    const message = {
      type: "presence" as const,
      participants: this.#participants(),
      revision: this.#revision,
      max: this.#maxParticipants(),
    };
    if (socket) this.#send(socket, message);
    else this.#broadcast(message);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: "EXPECTED_WEBSOCKET" }, { status: 426 });
    }
    const uid = request.headers.get("X-Thimar-User") ?? "";
    const roomId = request.headers.get("X-Thimar-Room") ?? "";
    if (!uid || !roomId) return Response.json({ error: "MISSING_IDENTITY" }, { status: 400 });

    const existing = this.ctx.getWebSockets();
    const alreadyIn = existing.some((socket) => this.#attachment(socket)?.uid === uid);
    // إعادة الاتصال من نفس المستخدم لا تُحسب مشاركًا جديدًا (نافذة الهجرة).
    if (!alreadyIn && existing.length >= this.#maxParticipants()) {
      return Response.json({ error: "ROOM_FULL", max: this.#maxParticipants() }, { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ uid, roomId, joinedAt: Date.now() } satisfies Attachment);

    this.#send(server, {
      type: "welcome",
      uid,
      roomId,
      participants: this.#participants(),
      max: this.#maxParticipants(),
      revision: this.#revision,
    });
    this.#presence();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") {
      this.#send(socket, { type: "error", code: "BINARY_UNSUPPORTED" });
      return;
    }
    if (message.length > MAX_MESSAGE_BYTES) {
      this.#send(socket, { type: "error", code: "MESSAGE_TOO_LARGE" });
      return;
    }
    const attachment = this.#attachment(socket);
    if (!attachment) {
      this.#send(socket, { type: "error", code: "NOT_JOINED" });
      return;
    }

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(message) as ClientMessage;
    } catch {
      this.#send(socket, { type: "error", code: "INVALID_JSON" });
      return;
    }

    if (parsed.type === "ping") {
      this.#send(socket, { type: "pong", t: Date.now() });
      return;
    }
    if (parsed.type === "presence") {
      this.#presence(socket);
      return;
    }
    if (parsed.type === "signal") {
      if (typeof parsed.msgId !== "string" || !parsed.msgId || parsed.msgId.length > 120) {
        this.#send(socket, { type: "error", code: "INVALID_MSG_ID" });
        return;
      }
      // إعادة المحاولة بعد انقطاع لا تُكرّر الإشارة على الطرف الآخر.
      if (this.#seen.includes(parsed.msgId)) {
        this.#send(socket, { type: "ack", msgId: parsed.msgId, duplicate: true });
        return;
      }
      this.#seen.push(parsed.msgId);
      if (this.#seen.length > DEDUPE_LIMIT) this.#seen.shift();

      const outgoing = {
        type: "signal",
        from: attachment.uid,
        to: parsed.to,
        msgId: parsed.msgId,
        payload: parsed.payload,
      };
      if (parsed.to) {
        let delivered = false;
        for (const peer of this.ctx.getWebSockets()) {
          if (this.#attachment(peer)?.uid !== parsed.to) continue;
          this.#send(peer, outgoing);
          delivered = true;
        }
        if (!delivered) this.#send(socket, { type: "error", code: "PEER_NOT_IN_ROOM", msgId: parsed.msgId });
      } else {
        this.#broadcast(outgoing, socket);
      }
      this.#send(socket, { type: "ack", msgId: parsed.msgId });
      return;
    }

    this.#send(socket, { type: "error", code: "UNKNOWN_TYPE" });
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    try {
      socket.close(code, reason);
    } catch {
      /* مُغلق مسبقًا. */
    }
    this.#presence();
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    try {
      socket.close(1011, "socket error");
    } catch {
      /* ignore */
    }
    this.#presence();
  }

  /** يُستخدم في الاختبارات ولوحة التشخيص: حالة الغرفة بلا محتوى وسائط. */
  async describe(): Promise<{ participants: string[]; max: number; revision: number }> {
    return { participants: this.#participants(), max: this.#maxParticipants(), revision: this.#revision };
  }
}
