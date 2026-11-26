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
    assert.equal(manifest.includes(permission), false, `unexpected permission: ${permission}`);
  }
  assert.ok(manifest.includes("android.permission.SCHEDULE_EXACT_ALARM"));
  assert.ok(manifest.includes('android:allowBackup="false"'));
  assert.ok(manifest.includes('android:usesCleartextTraffic="false"'));
  assert.ok(manifest.includes('android:name=".AdhanBootReceiver" android:exported="false"'));
  assert.equal(manifest.includes("app.thimar.quran.OPEN_NOTIFICATION"), false);
});

test("prayer notification remains tappable without a full-screen intent", () => {
  const receiver = read("../packaging/android/app/src/main/java/app/thimar/quran/AdhanAlarmReceiver.java");
  assert.equal(receiver.includes("setFullScreenIntent("), false);
  assert.ok(receiver.includes(".setContentIntent(screen ? screenPi : appPi)"));
  assert.ok(receiver.includes("عرض شاشة الصلاة"));
});

test("WebView trusts only the exact HTTPS Thimar origin", () => {
  const activity = read("../packaging/android/app/src/main/java/app/thimar/quran/WebFallbackActivity.java");
  assert.ok(activity.includes('"https".equalsIgnoreCase(scheme)'));
  assert.ok(activity.includes("APP_HOST.equalsIgnoreCase(host"));
  assert.ok(activity.includes("uri.getUserInfo() == null"));
  assert.equal(activity.includes("host.endsWith(APP_HOST)"), false);
  assert.equal(activity.includes('startsWith("https://thimar.freebuff.page"'), false);
  assert.ok(activity.includes("WebSettings.MIXED_CONTENT_NEVER_ALLOW"));
  assert.ok(activity.includes("setAcceptThirdPartyCookies(webView, false)"));
  assert.ok(activity.includes("settings.setAllowFileAccess(false)"));
  assert.ok(activity.includes("settings.setAllowContentAccess(false)"));
});

test("WebView requires Android location permission and rejects untrusted origins", () => {
  const activity = read("../packaging/android/app/src/main/java/app/thimar/quran/WebFallbackActivity.java");
  assert.ok(activity.includes("if (!trusted)"));
  assert.ok(activity.includes("if (locationGranted)"));
  assert.ok(activity.includes("REQUEST_LOCATION_PERMISSION"));
  assert.ok(activity.includes("callback.invoke(origin, true, false)"));
  assert.ok(activity.includes("callback.invoke(origin, false, false)"));
});


test("native APK updater preserves partial bytes and validates HTTP range before appending", () => {
  const updater = read("../packaging/android/app/src/main/java/app/thimar/quran/ThimarUpdater.java");
  assert.ok(updater.includes("getFilesDir()"));
  assert.ok(updater.includes("Range"));
  assert.ok(updater.includes("If-Range"));
  assert.ok(updater.includes("Content-Range"));
  assert.ok(updater.includes("SHA-256"));
  assert.ok(updater.includes("NET_CAPABILITY_VALIDATED"));
  assert.ok(updater.includes("part.renameTo(apk)"));
  assert.ok(updater.includes("pending-updates"));
});

test("Android alarm receiver imports Build API used by version guards", () => {
  const receiver = read("../packaging/android/app/src/main/java/app/thimar/quran/AdhanAlarmReceiver.java");
  assert.ok(receiver.includes("import android.os.Build;"));
});
