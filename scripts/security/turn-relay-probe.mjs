#!/usr/bin/env node
/**
 * مسبار TURN حقيقي (RFC 5766 Allocate) — يثبت أو ينفي أن بيانات الاعتماد
 * تعمل على شبكة هذا الجهاز، عبر UDP وTCP، ويعيد عنوان الترحيل الممنوح.
 *
 * الاستخدام:
 *   node scripts/security/turn-relay-probe.mjs --host relay1.expressturn.com \
 *     --user <username> --pass <credential> [--ports 3478,443] [--transport udp,tcp]
 *
 * لا يطبع كلمة المرور. يعيد رمز خروج 0 إذا نجح تخصيص واحد على الأقل.
 */
import dgram from "node:dgram";
import net from "node:net";
import crypto from "node:crypto";

const MAGIC = 0x2112a442;
const ATTR = {
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  REALM: 0x0014,
  NONCE: 0x0015,
  XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019,
};
const ALLOCATE = 0x0003;
const SUCCESS = 0x0103;
const ERROR = 0x0113;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--")) continue;
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function attr(type, value) {
  const pad = (4 - (value.length % 4)) % 4;
  const buf = Buffer.alloc(4 + value.length + pad);
  buf.writeUInt16BE(type, 0);
  buf.writeUInt16BE(value.length, 2);
  value.copy(buf, 4);
  return buf;
}

function str(text) {
  return Buffer.from(text, "utf8");
}

function buildMessage(type, transactionId, attributes, integrityKey) {
  let body = Buffer.concat(attributes);
  if (integrityKey) {
    // طول الرسالة في حساب HMAC يشمل سمة MESSAGE-INTEGRITY (24 بايت).
    const header = Buffer.alloc(20);
    header.writeUInt16BE(type, 0);
    header.writeUInt16BE(body.length + 24, 2);
    header.writeUInt32BE(MAGIC, 4);
    transactionId.copy(header, 8);
    const hmac = crypto.createHmac("sha1", integrityKey).update(Buffer.concat([header, body])).digest();
    body = Buffer.concat([body, attr(ATTR.MESSAGE_INTEGRITY, hmac)]);
  }
  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(body.length, 2);
  header.writeUInt32BE(MAGIC, 4);
  transactionId.copy(header, 8);
  return Buffer.concat([header, body]);
}

function parseAttributes(buffer) {
  const attributes = {};
  let offset = 20;
  while (offset + 4 <= buffer.length) {
    const type = buffer.readUInt16BE(offset);
    const length = buffer.readUInt16BE(offset + 2);
    const value = buffer.subarray(offset + 4, offset + 4 + length);
    attributes[type] = value;
    offset += 4 + length + ((4 - (length % 4)) % 4);
  }
  return attributes;
}

function xorAddress(value) {
  const port = value.readUInt16BE(2) ^ (MAGIC >>> 16);
  const family = value[1];
  if (family === 0x01) {
    const raw = Buffer.from(value.subarray(4, 8));
    const cookie = Buffer.alloc(4);
    cookie.writeUInt32BE(MAGIC, 0);
    for (let i = 0; i < 4; i += 1) raw[i] ^= cookie[i];
    return `${raw.join(".")}:${port}`;
  }
  const raw = Buffer.from(value.subarray(4, 20));
  const cookie = Buffer.alloc(16);
  cookie.writeUInt32BE(MAGIC, 0);
  transactionIdBytes.copy(cookie, 4);
  for (let i = 0; i < 16; i += 1) raw[i] ^= cookie[i];
  return `[${raw.toString("hex").match(/.{4}/g).join(":")}]:${port}`;
}

let transactionIdBytes = Buffer.alloc(12);

function errorText(value) {
  const code = value[2] & 0x07;
  const reason = value.subarray(4).toString("utf8");
  return `${code * 100 + (value[3] ?? 0)} ${reason}`;
}

async function transact(send, receive, message, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs);
    receive((data) => {
      if (data.length < 20) return;
      if (data.readUInt32BE(4) !== MAGIC) return;
      if (!data.subarray(8, 20).equals(message.subarray(8, 20))) return;
      clearTimeout(timer);
      resolve(data);
    });
    send(message).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function allocateUdp(host, port, user, pass) {
  const socket = dgram.createSocket("udp4");
  let handler = null;
  socket.on("message", (data) => handler?.(data));
  const receive = (cb) => {
    handler = cb;
  };
  const send = (buf) =>
    new Promise((resolve, reject) => socket.send(buf, port, host, (err) => (err ? reject(err) : resolve())));
  await new Promise((resolve) => socket.bind(0, resolve));

  try {
    transactionIdBytes = crypto.randomBytes(12);
    const transport = Buffer.alloc(4);
    transport[0] = 17;
    const first = buildMessage(ALLOCATE, transactionIdBytes, [attr(ATTR.REQUESTED_TRANSPORT, transport)]);
    const challenge = await transact(send, receive, first);
    const attrs = parseAttributes(challenge);
    if (challenge.readUInt16BE(0) !== ERROR) throw new Error(`unexpected ${challenge.readUInt16BE(0).toString(16)}`);
    const realm = attrs[ATTR.REALM]?.toString("utf8");
    const nonce = attrs[ATTR.NONCE];
    if (!realm || !nonce) throw new Error(`no-challenge ${errorText(attrs[ATTR.ERROR_CODE] ?? Buffer.alloc(4))}`);

    const key = crypto.createHash("md5").update(`${user}:${realm}:${pass}`).digest();
    transactionIdBytes = crypto.randomBytes(12);
    const authenticated = buildMessage(
      ALLOCATE,
      transactionIdBytes,
      [
        attr(ATTR.REQUESTED_TRANSPORT, transport),
        attr(ATTR.USERNAME, str(user)),
        attr(ATTR.REALM, str(realm)),
        attr(ATTR.NONCE, nonce),
      ],
      key,
    );
    const response = await transact(send, receive, authenticated);
    const type = response.readUInt16BE(0);
    const resultAttrs = parseAttributes(response);
    if (type === ERROR) throw new Error(`allocate-rejected ${errorText(resultAttrs[ATTR.ERROR_CODE] ?? Buffer.alloc(4))}`);
    const relayed = resultAttrs[ATTR.XOR_RELAYED_ADDRESS];
    return { transport: "udp", relayed: relayed ? xorAddress(relayed) : null, realm: Boolean(realm) };
  } finally {
    socket.close();
  }
}

async function allocateTcp(host, port, user, pass) {
  const socket = net.connect({ host, port });
  socket.setNoDelay(true);
  // اتصال TCP قد يتعلّق بلا خطأ على شبكات تحجب المنفذ؛ نسقطه صريحًا.
  socket.setTimeout(6000, () => socket.destroy(new Error("CONNECT_TIMEOUT")));
  const chunks = [];
  let pending = null;
  let buffer = Buffer.alloc(0);
  socket.on("data", (data) => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 20) {
      const length = buffer.readUInt16BE(2);
      if (buffer.length < 20 + length) break;
      const frame = buffer.subarray(0, 20 + length);
      buffer = buffer.subarray(20 + length);
      pending?.(frame);
    }
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const receive = (cb) => {
    pending = cb;
  };
  const send = async (buf) => {
    await new Promise((resolve, reject) => socket.write(buf, (err) => (err ? reject(err) : resolve())));
  };
  try {
    transactionIdBytes = crypto.randomBytes(12);
    const transport = Buffer.alloc(4);
    transport[0] = 17;
    const first = buildMessage(ALLOCATE, transactionIdBytes, [attr(ATTR.REQUESTED_TRANSPORT, transport)]);
    const challenge = await transact(send, receive, first);
    const attrs = parseAttributes(challenge);
    if (challenge.readUInt16BE(0) !== ERROR) throw new Error(`unexpected ${challenge.readUInt16BE(0).toString(16)}`);
    const realm = attrs[ATTR.REALM]?.toString("utf8");
    const nonce = attrs[ATTR.NONCE];
    if (!realm || !nonce) throw new Error(`no-challenge ${errorText(attrs[ATTR.ERROR_CODE] ?? Buffer.alloc(4))}`);

    const key = crypto.createHash("md5").update(`${user}:${realm}:${pass}`).digest();
    transactionIdBytes = crypto.randomBytes(12);
    const authenticated = buildMessage(
      ALLOCATE,
      transactionIdBytes,
      [
        attr(ATTR.REQUESTED_TRANSPORT, transport),
        attr(ATTR.USERNAME, str(user)),
        attr(ATTR.REALM, str(realm)),
        attr(ATTR.NONCE, nonce),
      ],
      key,
    );
    const response = await transact(send, receive, authenticated);
    const type = response.readUInt16BE(0);
    const resultAttrs = parseAttributes(response);
    if (type === ERROR) throw new Error(`allocate-rejected ${errorText(resultAttrs[ATTR.ERROR_CODE] ?? Buffer.alloc(4))}`);
    const relayed = resultAttrs[ATTR.XOR_RELAYED_ADDRESS];
    return { transport: "tcp", relayed: relayed ? xorAddress(relayed) : null, realm: true };
  } finally {
    socket.destroy();
  }
}

const args = parseArgs(process.argv.slice(2));
const host = args.host ?? "relay1.expressturn.com";
const user = args.user;
const pass = args.pass;
const ports = (args.ports ?? "3478").split(",").map((value) => Number(value.trim()));
const transports = (args.transport ?? "udp,tcp").split(",").map((value) => value.trim());

if (!user || !pass) {
  console.error("missing --user/--pass");
  process.exit(2);
}

const results = [];
for (const transport of transports) {
  for (const port of ports) {
    const label = `${transport}:${host}:${port}`;
    const started = Date.now();
    try {
      const value = transport === "udp" ? await allocateUdp(host, port, user, pass) : await allocateTcp(host, port, user, pass);
      results.push({ label, ok: true, ms: Date.now() - started, relayed: value.relayed, realm: value.realm });
    } catch (error) {
      results.push({ label, ok: false, ms: Date.now() - started, error: String(error.message ?? error) });
    }
  }
}

const ok = results.filter((result) => result.ok).length;
console.log(JSON.stringify({ host, user_len: user.length, ports, transports, ok, total: results.length, results }, null, 2));
process.exit(ok > 0 ? 0 : 1);
