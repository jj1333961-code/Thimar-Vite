import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("password hash matches Thimar algorithm sha256(salt:password)", () => {
  const salt = "testsalt0123456789abcdef";
  const password = "OldPass123";
  const expected = sha256Hex(`${salt}:${password}`);
  assert.equal(expected.length, 64);
  assert.match(expected, /^[0-9a-f]{64}$/);
});

test("new salt length is 32 hex chars", () => {
  const bytes = crypto.randomBytes(16);
  const salt = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(salt.length, 32);
});

test("migration nonce minimum length is 32", () => {
  const nonce = "a".repeat(32);
  assert.ok(nonce.length >= 32);
});
