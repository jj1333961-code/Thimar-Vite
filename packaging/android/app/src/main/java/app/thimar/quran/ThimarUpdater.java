package app.thimar.quran;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * جسر تحديث APK (ThimarUpdater) — يُسجَّل كـ window.ThimarUpdater.
 *
 * ينفّذ "التحديث الأصلي الآمن":
 *   1. يجلب ميتاداتا الإصدار (versionCode, downloadUrl, sha256, fileSize).
 *   2. يرفض التثبيت إذا كان الإصدار <= المثبت (منع downgrade).
 *   3. ينزّل APK إلى تخزين مؤقت (cache) — لا يحذف النسخة القديمة قبل التحقق.
 *   4. يتحقق من الحجم و SHA-256.
 *   5. يثبت عبر مثبّت الحزم القياسي (PackageInstaller / Intent ACTION_VIEW) مع
 *      FileProvider (حزمة موقَّعة). يحفظ بيانات التطبيق (standard install).
 *
 * ملاحظة: لم يُختبر في هذه البيئة (لا يوجد Android SDK). يتطلب صلاحية
 * REQUEST_INSTALL_PACKAGES على Android 8+ و FileProvider مُعدًّا في Manifest.
 */
public class ThimarUpdater {
  private static final String TAG = "ThimarUpdater";
  private final Activity activity;

  public ThimarUpdater(Activity activity) {
    this.activity = activity;
  }

  @JavascriptInterface
  public void downloadUpdate(final String metadataUrl) {
    new Thread(() -> {
      try {
        // 1. Fetch metadata
        HttpURLConnection metaConn = (HttpURLConnection) new URL(metadataUrl).openConnection();
        metaConn.setRequestProperty("User-Agent", "ThimarUpdater");
        metaConn.setConnectTimeout(30000);
        metaConn.setReadTimeout(30000);
        InputStream mis = metaConn.getInputStream();
        StringBuilder sb = new StringBuilder();
        byte[] buf = new byte[8192];
        int n;
        while ((n = mis.read(buf)) > 0) sb.append(new String(buf, 0, n, "UTF-8"));
        mis.close();
        JSONObject meta = new JSONObject(sb.toString());
        if (!meta.optBoolean("available", false)) {
          showToast("لا يوجد تحديث متاح.");
          return;
        }
        int remoteCode = meta.optInt("versionCode", 0);
        int installedCode = BuildConfig.VERSION_CODE;
        if (remoteCode <= installedCode) {
          showToast("أنت تستخدم أحدث إصدار.");
          return;
        }
        String downloadUrl = meta.optString("downloadUrl", "");
        String expectedSha = meta.optString("sha256", "").toLowerCase();
        long expectedSize = meta.optLong("fileSize", 0);
        String fileName = meta.optString("fileName", "thimar-update.apk");
        if (downloadUrl.isEmpty() || expectedSha.isEmpty()) {
          showToast("بيانات التحديث غير مكتملة.");
          return;
        }

        // 2. Download to cache dir (atomic: temp file then rename)
        File cacheDir = activity.getCacheDir();
        File outFile = new File(cacheDir, fileName);
        File tmpFile = new File(cacheDir, fileName + ".part");
        HttpURLConnection conn = (HttpURLConnection) new URL(downloadUrl).openConnection();
        conn.setRequestProperty("User-Agent", "ThimarUpdater");
        conn.setConnectTimeout(30000);
        conn.setReadTimeout(120000);
        InputStream in = conn.getInputStream();
        OutputStream out = new FileOutputStream(tmpFile);
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        long received = 0;
        byte[] buffer = new byte[65536];
        while ((n = in.read(buffer)) > 0) {
          out.write(buffer, 0, n);
          md.update(buffer, 0, n);
          received += n;
        }
        out.flush();
        out.close();
        in.close();

        // 3. Verify size + sha256
        if (expectedSize > 0 && received != expectedSize) {
          tmpFile.delete();
          showToast("حجم الملف غير متطابق.");
          return;
        }
        String actualSha = bytesToHex(md.digest());
        if (!actualSha.equalsIgnoreCase(expectedSha)) {
          tmpFile.delete();
          showToast("بصمة SHA-256 غير متطابقة.");
          return;
        }
        // Atomic replace
        if (outFile.exists()) outFile.delete();
        if (!tmpFile.renameTo(outFile)) {
          // fallback copy
          copyFile(tmpFile, outFile);
          tmpFile.delete();
        }

        // 4. Install via standard Android installer
        installApk(outFile);
      } catch (Exception e) {
        Log.e(TAG, "Update failed", e);
        showToast("تعذّر التحديث: " + e.getMessage());
      }
    }).start();
  }

  private void installApk(File apkFile) {
    try {
      Uri apkUri;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        apkUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apkFile);
      } else {
        apkUri = Uri.fromFile(apkFile);
      }
      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
      intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
      // Preserve user data: standard install (not -r? -r preserves data; ACTION_VIEW does replace keeping data).
      activity.startActivity(intent);
      showToast("جارٍ تثبيت التحديث...");
    } catch (Exception e) {
      Log.e(TAG, "Install failed", e);
      showToast("تعذّر بدء التثبيت: " + e.getMessage());
    }
  }

  private void showToast(final String msg) {
    activity.runOnUiThread(() -> Toast.makeText(activity, msg, Toast.LENGTH_LONG).show());
  }

  private static String bytesToHex(byte[] bytes) {
    StringBuilder sb = new StringBuilder();
    for (byte b : bytes) sb.append(String.format("%02x", b));
    return sb.toString();
  }

  private static void copyFile(File src, File dst) throws Exception {
    try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
      byte[] buffer = new byte[65536];
      int n;
      while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
    }
  }
}
