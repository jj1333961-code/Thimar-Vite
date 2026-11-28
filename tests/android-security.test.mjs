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


test("app never requests package-install permission or installs APKs itself", () => {
  const manifest = read("../packaging/android/app/src/main/AndroidManifest.xml");
  assert.equal(manifest.includes("android.permission.REQUEST_INSTALL_PACKAGES"), false);
  const updater = read("../packaging/android/app/src/main/java/app/thimar/quran/ThimarUpdater.java");
  assert.equal(updater.includes("PackageInstaller"), false);
  assert.equal(updater.includes("FileProvider"), false);
  assert.equal(updater.includes("application/vnd.android.package-archive"), false);
  assert.equal(updater.includes("canRequestPackageInstalls"), false);
});

test("update flow hands a verified official URL to the system browser only", () => {
  const updater = read("../packaging/android/app/src/main/java/app/thimar/quran/ThimarUpdater.java");
  assert.ok(updater.includes("openUpdatePage"));
  assert.ok(updater.includes("RELEASE_PREFIX"));
  assert.ok(updater.includes("isTrustedDownloadUrl"));
  assert.ok(updater.includes('value.startsWith("https://")'));
  assert.ok(updater.includes("Intent.ACTION_VIEW"));
  assert.ok(updater.includes("BuildConfig.VERSION_CODE"));
});

test("network security config forbids cleartext and user-installed CAs", () => {
  const config = read("../packaging/android/app/src/main/res/xml/network_security_config.xml");
  assert.ok(config.includes('cleartextTrafficPermitted="false"'));
  assert.ok(config.includes('<certificates src="system" />'));
  assert.equal(config.includes('src="user"'), false);
  const manifest = read("../packaging/android/app/src/main/AndroidManifest.xml");
  assert.ok(manifest.includes('android:networkSecurityConfig="@xml/network_security_config"'));
});

test("WebView cancels untrusted TLS certificates explicitly", () => {
  const activity = read("../packaging/android/app/src/main/java/app/thimar/quran/WebFallbackActivity.java");
  assert.ok(activity.includes("onReceivedSslError"));
  assert.ok(activity.includes("handler.cancel()"));
  assert.equal(activity.includes("handler.proceed()"), false);
  assert.ok(activity.includes("settings.setSaveFormData(false)"));
});

test("Android alarm receiver imports Build API used by version guards", () => {
  const receiver = read("../packaging/android/app/src/main/java/app/thimar/quran/AdhanAlarmReceiver.java");
  assert.ok(receiver.includes("import android.os.Build;"));
});
