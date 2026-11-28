package app.thimar.quran;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Resumable, integrity-checked APK updater.
 * Partial bytes and validator metadata live in app-private persistent storage.
 * HTTP Range + If-Range is used only when the server confirms the same entity.
 */
public class ThimarUpdater {
  private static final String TAG = "ThimarUpdater";
  private static final String PREFS = "thimar_resumable_update";
  private static final String META_URL = "https://thimar.freebuff.page/updates/android.json";
  private static final String META_PATH = "/updates/android.json";
  private static final String SITE_ORIGIN = "https://thimar.freebuff.page";
  private final Activity activity;
  private volatile boolean running = false;

  public ThimarUpdater(Activity activity) { this.activity = activity; }

  /**
   * يقبل العنوان المطلق الرسمي والمسار النسبي نفسه فقط. الويب يمرّر عنوانًا
   * مطلقًا، لكن الإصدارات القديمة تمرّر "/updates/android.json"، وقد كان ذلك
   * يُرفض فتظهر للمستخدم رسالة فشل التحديث بلا سبب واضح.
   */
  private static boolean isTrustedMetadataSource(String metadataUrl) {
    if (metadataUrl == null) return false;
    String value = metadataUrl.trim();
    if (META_URL.equals(value) || META_PATH.equals(value)) return true;
    return value.startsWith(SITE_ORIGIN + META_PATH);
  }

  /** هل يسمح النظام لثمار بتثبيت تحديث APK؟ (Android 8+) */
  @JavascriptInterface
  public boolean canInstallPackages() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
    try { return activity.getPackageManager().canRequestPackageInstalls(); }
    catch (Exception e) { return false; }
  }

  /** فتح شاشة «تثبيت تطبيقات غير معروفة» لهذا التطبيق. */
  @JavascriptInterface
  public void openInstallPermissionSettings() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    try {
      Intent intent = new Intent(
          android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:" + activity.getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      activity.startActivity(intent);
    } catch (Exception e) {
      Log.e(TAG, "Cannot open unknown-sources settings", e);
      showToast("افتح إعدادات الهاتف ثم «تثبيت تطبيقات غير معروفة» واسمح لثمار.");
    }
  }

  @JavascriptInterface
  public synchronized void downloadUpdate(final String metadataUrl) {
    if (running) { showToast("التنزيل جارٍ بالفعل."); return; }
    if (!isTrustedMetadataSource(metadataUrl)) { showToast("مصدر بيانات التحديث غير موثوق."); return; }
    running = true;
    new Thread(() -> {
      try { downloadAndInstall(); }
      catch (Exception e) {
        Log.e(TAG, "Update paused/failed; partial file is preserved", e);
        showToast("توقف التنزيل مؤقتًا. سيُستكمل من موضعه عند عودة الاتصال أو إعادة المحاولة.");
      } finally { running = false; }
    }, "ThimarResumableUpdater").start();
  }

  private void downloadAndInstall() throws Exception {
    JSONObject meta = fetchMetadata();
    if (!meta.optBoolean("available", false)) { showToast("لا يوجد تحديث متاح."); return; }
    int remoteCode = meta.optInt("versionCode", 0);
    if (remoteCode <= BuildConfig.VERSION_CODE) { showToast("أنت تستخدم أحدث إصدار."); return; }
    String url = meta.optString("downloadUrl", "");
    String sha = meta.optString("sha256", "").toLowerCase();
    long size = meta.optLong("fileSize", 0);
    String name = meta.optString("fileName", "thimar-update.apk").replaceAll("[^A-Za-z0-9._-]", "_");
    if (!url.startsWith("https://") || !sha.matches("[a-f0-9]{64}") || size <= 0 || name.isEmpty())
      throw new IOException("Invalid release metadata");

    File dir = new File(activity.getFilesDir(), "pending-updates");
    if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create private update directory");
    File part = new File(dir, name + ".part");
    File apk = new File(dir, name);
    File state = new File(dir, name + ".state");
    String identity = url + "|" + remoteCode + "|" + size + "|" + sha;
    android.content.SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    String savedIdentity = prefs.getString("identity", "");
    if (!identity.equals(savedIdentity)) {
      part.delete(); state.delete();
      prefs.edit().putString("identity", identity).apply();
    }
    String etag = readText(state);
    if (part.length() > size) { part.delete(); state.delete(); etag = ""; }

    showToast(part.length() > 0 ? "استكمال تنزيل التحديث من آخر نقطة محفوظة…" : "بدء تنزيل التحديث…");
    while (part.length() < size) {
      waitForInternet();
      long offset = part.length();
      HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
      c.setRequestProperty("User-Agent", "ThimarUpdater/2");
      if (offset > 0) {
        c.setRequestProperty("Range", "bytes=" + offset + "-");
        if (!etag.isEmpty()) c.setRequestProperty("If-Range", etag);
      }
      c.setConnectTimeout(20000);
      c.setReadTimeout(30000);
      try {
        int code = c.getResponseCode();
        String responseTag = c.getHeaderField("ETag");
        if (offset > 0 && code == 206) {
          String range = c.getHeaderField("Content-Range");
          if (range == null || !range.startsWith("bytes " + offset + "-"))
            throw new IOException("Invalid Content-Range; refusing to append");
          if (!etag.isEmpty() && responseTag != null && !etag.equals(responseTag))
            throw new IOException("Remote file changed; refusing to append");
        } else if (code == 200) {
          // Server ignored Range or entity changed: restart safely from byte zero.
          offset = 0;
          try (FileOutputStream reset = new FileOutputStream(part, false)) { reset.flush(); }
        } else if (code == 416 && part.length() == size) {
          break;
        } else {
          throw new IOException("Unexpected HTTP " + code);
        }
        if (responseTag != null && !responseTag.isEmpty()) writeText(state, responseTag);
        try (InputStream in = c.getInputStream();
             RandomAccessFile out = new RandomAccessFile(part, "rw")) {
          out.seek(offset);
          byte[] buffer = new byte[65536];
          int n;
          while ((n = in.read(buffer)) != -1) {
            if (!isOnline()) throw new IOException("Network lost; keeping partial bytes");
            out.write(buffer, 0, n);
            if (out.length() > size) throw new IOException("Downloaded file exceeds declared size");
          }
          out.getFD().sync();
        }
      } catch (IOException e) {
        Log.w(TAG, "Download interrupted; retrying with Range", e);
        waitForInternet();
      } finally { c.disconnect(); }
    }

    if (part.length() != size) throw new IOException("Downloaded size mismatch");
    showToast("اكتمل التنزيل، جارٍ التحقق من سلامة الملف…");
    String actual = sha256(part);
    if (!actual.equals(sha)) {
      part.delete(); state.delete();
      throw new IOException("SHA-256 mismatch; unsafe file discarded");
    }
    if (apk.exists() && !apk.delete()) throw new IOException("Cannot replace old update");
    if (!part.renameTo(apk)) throw new IOException("Cannot finalize verified APK");
    state.delete();
    installApk(apk);
  }

  private JSONObject fetchMetadata() throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(META_URL).openConnection();
    c.setConnectTimeout(15000); c.setReadTimeout(20000);
    c.setRequestProperty("Cache-Control", "no-cache");
    try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] b = new byte[8192]; int n;
      while ((n = in.read(b)) != -1) out.write(b, 0, n);
      return new JSONObject(out.toString("UTF-8"));
    } finally { c.disconnect(); }
  }

  private boolean isOnline() {
    ConnectivityManager cm = (ConnectivityManager) activity.getSystemService(Context.CONNECTIVITY_SERVICE);
    if (cm == null) return false;
    Network n = cm.getActiveNetwork();
    NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
    return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
  }

  private void waitForInternet() throws InterruptedException {
    while (!isOnline()) {
      showToast("لا يوجد اتصال بالإنترنت. تم حفظ تقدم التنزيل وسنستكمل تلقائيًا عند عودة الاتصال.");
      Thread.sleep(5000);
    }
  }

  private static String readText(File f) {
    if (!f.exists()) return "";
    try (FileInputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] b = new byte[1024]; int n; while ((n=in.read(b))!=-1) out.write(b,0,n);
      return out.toString("UTF-8").trim();
    } catch (Exception e) { return ""; }
  }
  private static void writeText(File f, String value) throws Exception {
    try (FileOutputStream out = new FileOutputStream(f, false)) { out.write(value.getBytes("UTF-8")); out.getFD().sync(); }
  }
  private static String sha256(File f) throws Exception {
    MessageDigest md = MessageDigest.getInstance("SHA-256");
    try (InputStream in = new FileInputStream(f)) {
      byte[] b = new byte[65536]; int n; while ((n=in.read(b))!=-1) md.update(b,0,n);
    }
    StringBuilder s = new StringBuilder();
    for (byte b : md.digest()) s.append(String.format("%02x", b & 0xff));
    return s.toString();
  }

  private void installApk(File apk) {
    if (!canInstallPackages()) {
      showToast("ثبّت الملف: يجب السماح لثمار بتثبيت التحديث من إعدادات الهاتف.");
      openInstallPermissionSettings();
      return;
    }
    try {
      Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(uri, "application/vnd.android.package-archive");
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
      activity.startActivity(intent);
      showToast("تم التحقق من التحديث. جارٍ فتح مُثبّت Android…");
    } catch (Exception e) { Log.e(TAG, "Install failed", e); showToast("تعذّر بدء التثبيت: " + e.getMessage()); }
  }
  private void showToast(final String msg) {
    activity.runOnUiThread(() -> Toast.makeText(activity, msg, Toast.LENGTH_LONG).show());
  }
}
