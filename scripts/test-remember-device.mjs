import test from "node:test";
import assert from "node:assert/strict";
import {
  clearRememberedDevice,
  getRememberedAccountId,
  rememberThisDevice,
} from "../src/lib/rememberedDevice.mjs";

function installStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  return values;
}

test("remember-this-device is explicit opt-in and survives only when selected", async (t) => {
  await t.test("no saved account by default", () => {
    installStorage();
    assert.equal(getRememberedAccountId(), null);
  });
  await t.test("checking remember stores the selected account id", () => {
    const values = installStorage();
    rememberThisDevice("account-123");
    assert.equal(values.get("thimar_remembered"), "account-123");
    assert.equal(getRememberedAccountId(), "account-123");
  });
  await t.test("unchecking remember clears an earlier choice", () => {
    installStorage();
    rememberThisDevice("old-account");
    clearRememberedDevice();
    assert.equal(getRememberedAccountId(), null);
  });
  await t.test("empty account ids never create a remembered session", () => {
    installStorage();
    rememberThisDevice("   ");
    assert.equal(getRememberedAccountId(), null);
  });
  await t.test("unavailable browser storage does not throw", () => {
    globalThis.localStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    };
    assert.doesNotThrow(() => rememberThisDevice("account-123"));
    assert.doesNotThrow(() => clearRememberedDevice());
    assert.equal(getRememberedAccountId(), null);
  });
});
