// Real TURN allocate probe. Explicit host/port/transport, no credential output.
import dgram from "node:dgram";
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

const MAGIC = 0x2112a442;
const A = {
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  REALM: 0x0014,
  NONCE: 0x0015,
  XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019,
  XOR_MAPPED_ADDRESS: 0x0020,
  LIFETIME: 0x000d,
  SOFTWARE: 0x8022,
};

const pad4 = (n) => (4 - (n % 4)) % 4;

function attr(type, value) {
  const h = Buffer.alloc(4);
  h.writeUInt16BE(type, 0);
  h.writeUInt16BE(value.length, 2);
  const p = pad4(value.length);
  return Buffer.concat([h, value, p ? Buffer.alloc(p) : Buffer.alloc(0)]);
}

function msg(type, tx, attrs) {
  const body = Buffer.concat(attrs);
  const h = Buffer.alloc(20);
  h.writeUInt16BE(type, 0);
  h.writeUInt16BE(body.length, 2);
  h.writeUInt32BE(MAGIC, 4);
  tx.copy(h, 8);
  return Buffer.concat([h, body]);
}

function parse(buf) {
  const out = { type: buf.readUInt16BE(0), attrs: {} };
  let o = 20;
  while (o + 4 <= buf.length) {
    const t = buf.readUInt16BE(o);
    const l = buf.readUInt16BE(o + 2);
    out.attrs[t] = buf.subarray(o + 4, o + 4 + l);
    o += 4 + l + pad4(l);
  }
  return out;
}

function xorAddr(v) {
  if (!v || v.length < 8 || v[1] !== 0x01) return null;
  const port = v.readUInt16BE(2) ^ (MAGIC >> 16);
  const ip = [...v.subarray(4, 8)].map((b, i) => b ^ ((MAGIC >> (24 - i * 8)) & 0xff)).join(".");
  return `${ip}:${port}`;
}

function integrity(key, packet) {
  const head = Buffer.from(packet.subarray(0, 20));
  head.writeUInt16BE(packet.length - 20 + 24, 2);
  return crypto.createHmac("sha1", key).update(Buffer.concat([head, packet.subarray(20)])).digest();
}

function allocate(tx, user, realm, nonce, key) {
  const attrs = [attr(A.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0]))];
  const lt = Buffer.alloc(4);
  lt.writeUInt32BE(600, 0);
  attrs.push(attr(A.LIFETIME, lt));
  if (!user) return msg(0x0003, tx, attrs);
  attrs.push(attr(A.USERNAME, Buffer.from(user)));
  attrs.push(attr(A.REALM, Buffer.from(realm)));
  attrs.push(attr(A.NONCE, Buffer.from(nonce)));
  const plain = msg(0x0003, tx, attrs);
  return msg(0x0003, tx, [...attrs, attr(A.MESSAGE_INTEGRITY, integrity(key, plain))]);
}

const keyFor = (u, r, p) => crypto.createHash("md5").update(`${u}:${r}:${p}`).digest();

// ---- transport helpers -------------------------------------------------
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r({ ok: false, error: "TIMEOUT" }), ms))]);
}

function udpRound(host, port, payload, ms = 4000) {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    const done = (r) => {
      try { s.close(); } catch {}
      resolve(r);
    };
    s.on("message", (m) => done({ ok: true, data: m }));
    s.on("error", (e) => done({ ok: false, error: e.code || e.message }));
    s.send(payload, port, host, (e) => e && done({ ok: false, error: e.code || e.message }));
    setTimeout(() => done({ ok: false, error: "TIMEOUT" }), ms);
  });
}

function connectOnce(host, port, useTls, ms = 6000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const s = useTls ? tls.connect({ host, port, servername: host }) : net.connect({ port, host });
    s.once(useTls ? "secureConnect" : "connect", () => finish({ ok: true, socket: s }));
    s.once("error", (e) => { try { s.destroy(); } catch {} finish({ ok: false, error: e.code || e.message }); });
    setTimeout(() => { try { s.destroy(); } catch {} finish({ ok: false, error: "TIMEOUT" }); }, ms);
  });
}

function tcpRound(host, port, useTls, payload, ms = 8000) {
  return new Promise(async (resolve) => {
    const c = await connectOnce(host, port, useTls);
    if (!c.ok) return resolve(c);
    const s = c.socket;
    const done = (r) => { try { s.destroy(); } catch {} resolve(r); };
    let buf = Buffer.alloc(0);
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 20 && buf.length >= 20 + buf.readUInt16BE(2)) {
        done({ ok: true, data: buf.subarray(0, 20 + buf.readUInt16BE(2)) });
      }
    });
    s.on("error", (e) => done({ ok: false, error: e.code || e.message }));
    s.write(payload);
    setTimeout(() => done({ ok: false, error: "TIMEOUT" }), ms);
  });
}

// ---- test --------------------------------------------------------------
async function probeStream({ host, port, useTls, username, credential, stunOnly }) {
  const out = { host, port, transport: useTls ? "tls" : "tcp", reachable: false, challenged: false, allocated: false, relay: null, error: null, code: null };
  const c = await connectOnce(host, port, useTls);
  if (!c.ok) { out.error = c.error; return out; }
  out.reachable = true;
  const s = c.socket;
  let buf = Buffer.alloc(0);
  let waiter = null;
  s.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 20) {
      const len = buf.readUInt16BE(2);
      if (buf.length < 20 + len) break;
      const packet = buf.subarray(0, 20 + len);
      buf = buf.subarray(20 + len);
      if (waiter) { const w = waiter; waiter = null; w({ ok: true, data: packet }); }
    }
  });
  s.on("error", (e) => { if (waiter) { const w = waiter; waiter = null; w({ ok: false, error: e.code || e.message }); } });
  const exchange = (payload, ms) => new Promise((resolve) => {
    waiter = resolve;
    s.write(payload);
    setTimeout(() => { if (waiter === resolve) { waiter = null; resolve({ ok: false, error: "TIMEOUT" }); } }, ms);
  });
  try {
    if (stunOnly) {
      const tx = crypto.randomBytes(12);
      tx[0] &= 0x3f;
      const r = await exchange(msg(0x0001, tx, []), 5000);
      if (!r.ok) { out.error = r.error; return out; }
      const p = parse(r.data);
      out.mapped = xorAddr(p.attrs[A.XOR_MAPPED_ADDRESS]);
      return out;
    }
    const tx1 = crypto.randomBytes(12);
    tx1[0] &= 0x3f;
    const r1 = await exchange(allocate(tx1), 6000);
    if (!r1.ok) { out.error = r1.error; return out; }
    let p = parse(r1.data);
    const code1 = readCode(p);
    if (p.type === 0x0113 && code1 === 401) {
      out.challenged = true;
      const realm = p.attrs[A.REALM]?.toString() ?? "";
      const nonce = p.attrs[A.NONCE]?.toString() ?? "";
      if (!username || !credential) { out.error = "NO_CREDENTIALS"; return out; }
      const tx2 = crypto.randomBytes(12);
      tx2[0] &= 0x3f;
      const r2 = await exchange(allocate(tx2, username, realm, nonce, keyFor(username, realm, credential)), 6000);
      if (!r2.ok) { out.error = r2.error; return out; }
      p = parse(r2.data);
    } else if (p.type === 0x0113) {
      out.code = code1;
    }
    if (p.type === 0x0103) {
      out.allocated = true;
      out.relay = xorAddr(p.attrs[A.XOR_RELAYED_ADDRESS]);
      out.mapped = xorAddr(p.attrs[A.XOR_MAPPED_ADDRESS]);
    } else if (p.type === 0x0113) {
      out.code = readCode(p);
      out.error = `ERROR_${out.code}`;
    } else {
      out.error = `UNEXPECTED_0x${p.type.toString(16)}`;
    }
  } finally {
    try { s.destroy(); } catch {}
  }
  return out;
}

function readCode(p) {
  const ec = p.attrs[A.ERROR_CODE];
  return ec && ec.length >= 4 ? (ec[2] & 0x07) * 100 + ec[3] : null;
}

async function probe({ host, port, transport, username, credential, stunOnly }) {
  if (transport !== "udp") {
    return probeStream({ host, port, useTls: transport === "tls", username, credential, stunOnly });
  }
  const out = { host, port, transport, reachable: false, challenged: false, allocated: false, relay: null, error: null, code: null };
  const round = (p, ms) => udpRound(host, port, p, ms);
  const type = stunOnly ? 0x0001 : 0x0003;

  if (stunOnly) {
    const tx = crypto.randomBytes(12);
    tx[0] &= 0x3f;
    const r = await withTimeout(round(msg(type, tx, []), 4000), 6000);
    out.reachable = r.ok;
    if (r.ok) {
      const p = parse(r.data);
      out.mapped = xorAddr(p.attrs[A.XOR_MAPPED_ADDRESS]);
      out.software = p.attrs[A.SOFTWARE]?.toString() ?? null;
    } else out.error = r.error;
    return out;
  }

  const tx1 = crypto.randomBytes(12);
  tx1[0] &= 0x3f;
  const r1 = await withTimeout(round(allocate(tx1), 5000), 7000);
  if (!r1.ok) { out.error = r1.error; return out; }
  out.reachable = true;
  let p = parse(r1.data);

  if (p.type === 0x0113) {
    const ec = p.attrs[A.ERROR_CODE];
    if (ec && ec.length >= 4) out.code = (ec[2] & 0x07) * 100 + ec[3];
  }
  if ((p.type === 0x0113 && out.code === 401) || p.type === 0x0101) {
    out.challenged = true;
    const realm = p.attrs[A.REALM]?.toString() ?? "";
    const nonce = p.attrs[A.NONCE]?.toString() ?? "";
    if (!username || !credential) { out.error = "NO_CREDENTIALS"; return out; }
    const tx2 = crypto.randomBytes(12);
    tx2[0] &= 0x3f;
    const r2 = await withTimeout(round(allocate(tx2, username, realm, nonce, keyFor(username, realm, credential)), 5000), 7000);
    if (!r2.ok) { out.error = r2.error; return out; }
    p = parse(r2.data);
  }
  if (p.type === 0x0103) {
    out.allocated = true;
    out.relay = xorAddr(p.attrs[A.XOR_RELAYED_ADDRESS]);
    out.mapped = xorAddr(p.attrs[A.XOR_MAPPED_ADDRESS]);
  } else if (p.type === 0x0113) {
    const ec = p.attrs[A.ERROR_CODE];
    if (ec && ec.length >= 4) out.code = (ec[2] & 0x07) * 100 + ec[3];
    out.error = `ERROR_${out.code}`;
  } else {
    out.error = `UNEXPECTED_0x${p.type.toString(16)}`;
  }
  return out;
}

const targets = JSON.parse(process.argv[2]);
for (const t of targets) {
  const r = await probe(t);
  console.log(JSON.stringify({ label: t.label, ...r }));
}
process.exit(0);
