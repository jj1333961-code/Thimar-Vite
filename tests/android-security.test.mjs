import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Android manifest excludes unnecessary special-access permissions", () => {
  const manifest = read("../packaging/android/app/src/main/AndroidManifest.xml");
  for (const permission of [
    "android.permission.SYSTEM_ALERT_WINDOW",
    "android.permission.USE_FULL_SCREEN_INTENT",
    "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
    "android.permission.DISABLE_KEYGUARD",
    "android.permission.USE_EXACT_ALARM",
  ]) {
    assert.doesNotMatch(manifest, new RegExp(permission.replaceAll(".", "\\.")), `unexpected permission: ${permission}`);
  }
  assert.match(manifest, /android.permission.SCHEDULE_EXACT_ALARM/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
});

test("prayer notification remains tappable without a full-screen intent", () => {
  const receiver = read("../packaging/android/app/src/main/java/app/thimar/quran/AdhanAlarmReceiver.java");
  assert.doesNotMatch(receiver, /setFullScreenIntent\\s*\\(/);
  assert.match(receiver, /\\.setContentIntent\\(screen \\? screenPi : appPi\\)/);
  assert.match(receiver, /عرض شاشة الصلاة/);
});

test("WebView trusts only the exact HTTPS Thimar origin", () => {
  const activity = read("../packaging/android/app/src/main/java/app/thimar/quran/WebFallbackActivity.java");
  assert.match(activity, /"https"\\.equalsIgnoreCase\\(scheme\\)/);
  assert.match(activity, /APP_HOST\\.equalsIgnoreCase\\(host/);
  assert.match(activity, /uri\\.getUserInfo\\(\\) == null/);
  assert.doesNotMatch(activity, /host\\.endsWith\\(APP_HOST\\)/);
  assert.doesNotMatch(activity, /startsWith\\("https:\\/\\/thimar\\.freebuff\\.page"/);
  assert.match(activity, /MIXED_CONTENT_NEVER_ALLOW/);
  assert.match(activity, /setAcceptThirdPartyCookies\\(webView, false\\)/);
});

test("WebView requires Android location permission and rejects untrusted origins", () => {
  const activity = read("../packaging/android/app/src/main/java/app/thimar/quran/WebFallbackActivity.java");
  assert.match(activity, /if \\(!trusted\\)/);
  assert.match(activity, /if \\(locationGranted\\)/);
  assert.match(activity, /REQUEST_LOCATION_PERMISSION/);
  assert.match(activity, /callback\\.invoke\\(origin, true, false\\)/);
  assert.match(activity, /callback\\.invoke\\(origin, false, false\\)/);
  assert.doesNotMatch(activity, /callback\\.invoke\\(origin, true, false\\);\\s*\\}/);
});
