package app.thimar.quran;

import android.app.Activity;
import android.content.Context;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

/**
 * Persistent web-asset differential updater for the Android WebView shell.
 *
 * Downloads only changed files into application-private storage, verifies
 * size + SHA-256, and atomically commits them. The original APK assets remain
 * the safe fallback. Offline Quran models under assets/offline are never touched.
 */
public class ThimarAssetUpdater {
  private static final String TAG = "ThimarAssetUpdater";
  private static final String MANIFEST_URL = "https://thimar.freebuff.page/updates/web-manifest.json";
  private static final String BUNDLED_MANIFEST_ASSET = "www/updates/web-manifest.json";

  private final Activity activity;
  private final File webAssetsRoot;
  private final File currentDir;
  private final File stagingDir;
  private final File installedManifestFile;

  public ThimarAssetUpdater(Activity activity) {
    this.activity = activity;
    this.webAssetsRoot = new File(activity.getFilesDir(), "webassets");
    this.currentDir = new File(webAssetsRoot, "current");
    this.stagingDir = new File(webAssetsRoot, "staging");
    this.installedManifestFile = new File(webAssetsRoot, "installed-manifest.json");
  }

  @JavascriptInterface
  public void update() {
    new Thread(this::runUpdate).start();
  }

  @JavascriptInterface
  public String getInstalledVersion() {
    JSONObject m = readInstalledManifest();
    if (m == null) return "";
    return m.optString("versionName", "") + " (" + m.optInt("versionCode", 0) + ")";
  }

  private void runUpdate() {
    ensureDirs();
    try {
      JSONObject installed = readInstalledManifest();
      if (installed == null) {
        installed = readBundledManifest();
        if (installed != null) writeInstalledManifest(installed);
      }
      JSONObject remote = fetchJson(MANIFEST_URL);
      if (remote == null) {
        showToast("تعذّر جلب بيان التحديث.");
        return;
      }
      // لا نعتمد على رقم الإصدار وحده: قد تتغير موارد الويب دون رفع رقم الإصدار.
      // نقارن الملفات فعليًا، وإن لم يتغير شيء نُبلغ المستخدم بذلك بعد الفحص.
      int remoteCode = remote.optInt("versionCode", 0);
      int installedCode = (installed == null) ? 0 : installed.optInt("versionCode", 0);
      if (remoteCode < installedCode) {
        showToast("أنت تستخدم أحدث إصدار من الموارد.");
        return;
      }

      JSONArray remoteFiles = remote.optJSONArray("files");
      if (remoteFiles == null) {
        showToast("بيان التحديث غير صالح.");
        return;
      }

      Map<String, JSONObject> installedMap = new HashMap<>();
      if (installed != null) {
        JSONArray ia = installed.optJSONArray("files");
        if (ia != null) {
          for (int i = 0; i < ia.length(); i++) {
            JSONObject f = ia.optJSONObject(i);
            if (f != null) installedMap.put(f.optString("path"), f);
          }
        }
      }

      Set<String> remotePaths = new HashSet<>();
      // Clean staging
      deleteDir(stagingDir);
      stagingDir.mkdirs();

      boolean allOk = true;
      int changedCount = 0;
      for (int i = 0; i < remoteFiles.length(); i++) {
        JSONObject f = remoteFiles.optJSONObject(i);
        if (f == null) continue;
        String path = f.optString("path", "");
        if (path.isEmpty() || path.contains("..")) continue;
        remotePaths.add(path);
        long expectedBytes = f.optLong("bytes", 0);
        String expectedSha = f.optString("sha256", "").toLowerCase();
        JSONObject inst = installedMap.get(path);
        boolean unchanged = (inst != null
            && inst.optLong("bytes", -1) == expectedBytes
            && inst.optString("sha256", "").equalsIgnoreCase(expectedSha));
        if (unchanged) continue; // preserve existing file
        changedCount++;

        File target = new File(stagingDir, path);
        File parent = target.getParentFile();
        if (parent != null) parent.mkdirs();
        String url = "https://thimar.freebuff.page/" + (path.startsWith("/") ? path.substring(1) : path);
        if (!downloadAndVerify(url, target, expectedBytes, expectedSha)) {
          allOk = false;
          break;
        }
      }

      if (!allOk) {
        deleteDir(stagingDir);
        showToast("فشل تنزيل بعض الموارد؛ تم الاحتفاظ بالنسخة الحالية.");
        return;
      }

      // Commit: move staged files into current
      for (int i = 0; i < remoteFiles.length(); i++) {
        JSONObject f = remoteFiles.optJSONObject(i);
        if (f == null) continue;
        String path = f.optString("path", "");
        if (path.isEmpty() || path.contains("..")) continue;
        File staged = new File(stagingDir, path);
        if (!staged.exists()) continue; // unchanged, already in current
        File dest = new File(currentDir, path);
        File destParent = dest.getParentFile();
        if (destParent != null) destParent.mkdirs();
        if (dest.exists()) dest.delete();
        if (!staged.renameTo(dest)) {
          copyFile(staged, dest);
          staged.delete();
        }
      }

      // Handle deleted files: remove from current if not in remote
      if (installed != null) {
        JSONArray ia = installed.optJSONArray("files");
        if (ia != null) {
          for (int i = 0; i < ia.length(); i++) {
            JSONObject f = ia.optJSONObject(i);
            if (f == null) continue;
            String path = f.optString("path", "");
            if (path.isEmpty() || remotePaths.contains(path)) continue;
            File old = new File(currentDir, path);
            if (old.exists()) old.delete();
          }
        }
      }

      writeInstalledManifest(remote);
      deleteDir(stagingDir);
      if (changedCount == 0) {
        showToast("أنت تستخدم أحدث إصدار من الموارد.");
        return;
      }
      showToast("تم تحديث الموارد بنجاح.");
    } catch (Exception e) {
      Log.e(TAG, "Asset update failed", e);
      deleteDir(stagingDir);
      showToast("تعذّر تحديث الموارد: " + e.getMessage());
    }
  }

  private boolean downloadAndVerify(String url, File dest, long expectedBytes, String expectedSha) {
    HttpURLConnection conn = null;
    try {
      conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setRequestProperty("User-Agent", "ThimarAssetUpdater");
      // تجنّب الضغط (gzip/br) كي يطابق حجم الاستجابة حجم الملف الفعلي (bytes).
      conn.setRequestProperty("Accept-Encoding", "identity");
      conn.setConnectTimeout(30000);
      conn.setReadTimeout(120000);
      int code = conn.getResponseCode();
      Log.d(TAG, "download " + url + " -> HTTP " + code + " (expected " + expectedBytes + " bytes)");
      if (code != 200) return false;
      try (InputStream in = conn.getInputStream();
           OutputStream out = new FileOutputStream(dest)) {
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
      }
      if (expectedBytes > 0 && dest.length() != expectedBytes) {
        dest.delete();
        return false;
      }
      String actualSha = sha256File(dest);
      if (!actualSha.equalsIgnoreCase(expectedSha)) {
        dest.delete();
        return false;
      }
      return true;
    } catch (Exception e) {
      Log.e(TAG, "Download failed: " + url, e);
      if (dest.exists()) dest.delete();
      return false;
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  private JSONObject fetchJson(String url) {
    HttpURLConnection conn = null;
    try {
      conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setRequestProperty("User-Agent", "ThimarAssetUpdater");
      conn.setRequestProperty("Accept-Encoding", "identity");
      conn.setConnectTimeout(30000);
      conn.setReadTimeout(30000);
      int manifestCode = conn.getResponseCode();
      Log.d(TAG, "manifest fetch " + url + " -> HTTP " + manifestCode);
      if (manifestCode != 200) return null;
      StringBuilder sb = new StringBuilder();
      try (InputStream in = conn.getInputStream()) {
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) sb.append(new String(buf, 0, n, "UTF-8"));
      }
      return new JSONObject(sb.toString());
    } catch (Exception e) {
      Log.e(TAG, "fetchJson failed", e);
      return null;
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  private JSONObject readInstalledManifest() {
    try {
      if (!installedManifestFile.exists()) return null;
      return new JSONObject(readFile(installedManifestFile));
    } catch (Exception e) {
      return null;
    }
  }

  private JSONObject readBundledManifest() {
    try (InputStream in = activity.getAssets().open(BUNDLED_MANIFEST_ASSET)) {
      ByteArrayOutputStream baos = new ByteArrayOutputStream();
      byte[] buf = new byte[8192];
      int n;
      while ((n = in.read(buf)) > 0) baos.write(buf, 0, n);
      return new JSONObject(baos.toString("UTF-8"));
    } catch (Exception e) {
      return null;
    }
  }

  private void writeInstalledManifest(JSONObject m) {
    try {
      writeFile(installedManifestFile, m.toString());
    } catch (Exception ignored) {}
  }

  private void ensureDirs() {
    if (!webAssetsRoot.exists()) webAssetsRoot.mkdirs();
    if (!currentDir.exists()) currentDir.mkdirs();
  }

  /* Trusted production origin only. */
  private String buildUrl(String baseUrl, String path) {
    String p = path.startsWith("/") ? path.substring(1) : path;
    return "https://thimar.freebuff.page/" + p;
  }

  private static String readFile(File f) throws Exception {
    try (InputStream in = new FileInputStream(f)) {
      ByteArrayOutputStream baos = new ByteArrayOutputStream();
      byte[] buf = new byte[8192];
      int n;
      while ((n = in.read(buf)) > 0) baos.write(buf, 0, n);
      return baos.toString("UTF-8");
    }
  }

  private static void writeFile(File f, String content) throws Exception {
    File parent = f.getParentFile();
    if (parent != null) parent.mkdirs();
    try (OutputStream out = new FileOutputStream(f)) {
      out.write(content.getBytes("UTF-8"));
    }
  }

  private static String sha256File(File file) throws Exception {
    MessageDigest md = MessageDigest.getInstance("SHA-256");
    try (InputStream in = new FileInputStream(file)) {
      byte[] buf = new byte[65536];
      int n;
      while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
    }
    byte[] d = md.digest();
    StringBuilder sb = new StringBuilder();
    for (byte b : d) sb.append(String.format("%02x", b));
    return sb.toString();
  }

  private static void deleteDir(File dir) {
    if (dir == null || !dir.exists()) return;
    if (dir.isDirectory()) {
      File[] children = dir.listFiles();
      if (children != null) for (File c : children) deleteDir(c);
    }
    dir.delete();
  }

  private static void copyFile(File src, File dst) throws Exception {
    try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
      byte[] buf = new byte[65536];
      int n;
      while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }
  }

  private void showToast(final String msg) {
    activity.runOnUiThread(() -> Toast.makeText(activity, msg, Toast.LENGTH_LONG).show());
  }

  /**
   * Returns a File in application-private storage if an updated copy exists,
   * otherwise null (caller falls back to APK assets).
   */
  public File resolveUpdatedFile(String relativePath) {
    if (relativePath == null || relativePath.contains("..")) return null;
    String p = relativePath.startsWith("/") ? relativePath.substring(1) : relativePath;
    File f = new File(currentDir, p);
    if (f.exists() && f.isFile()) return f;
    /*
     * مسارات المانيفست لا تحمل بادئة "www/" (assets/app.js) بينما WebView يطلب
     * الأصول كـ www/assets/app.js. بدون هذا التجريب كانت الملفات المنزَّلة تُخزَّن
     * في current/assets/… ولا يجدها العرض أبدًا، فيظل التطبيق يقدّم نسخة الـAPK
     * القديمة ويظهر خطأ عدم تطابق الحجم في مسار تحديث الويب.
     */
    if (p.startsWith("www/")) {
      File alt = new File(currentDir, p.substring(4));
      if (alt.exists() && alt.isFile()) return alt;
    }
    return null;
  }
}