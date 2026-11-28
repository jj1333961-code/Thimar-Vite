package app.thimar.quran;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * تحديث التطبيق عبر المتصفح فقط.
 *
 * لماذا لا يُنزَّل APK داخل التطبيق ولا يُشغَّل مُثبّت من داخله؟
 * لأن طلب الإذن REQUEST_INSTALL_PACKAGES («تثبيت تطبيقات غير معروفة») هو أحد
 * أقوى أسباب تصنيف Play Protect للتطبيقات المثبَّتة من خارج المتجر كتطبيقات
 * ضارة/خطرة، إضافة إلى أنه يجعل التطبيق مسؤولًا عن كتابة ملفات قابلة للتنفيذ.
 *
 * بدلًا من ذلك: نتحقّق من بيانات الإصدار من مصدر ثمار الثابت، ونتأكد أن رابط
 * التنزيل رابط إصدار رسمي على HTTPS، ثم نسلّمه لمتصفح النظام. المتصفح هو من
 * ينزّل الملف ويتحقّق منه، ونظام أندرويد هو من يفرض تطابق توقيع الحزمة عند
 * الترقية. لا يكتب ثمار أي APK ولا يفتح أي مُثبّت ولا يحتاج أي إذن خاص.
 */
public class ThimarUpdater {
  private static final String TAG = "ThimarUpdater";
  private static final String META_URL = "https://thimar.freebuff.page/updates/android.json";
  private static final String META_PATH = "/updates/android.json";
  private static final String SITE_ORIGIN = "https://thimar.freebuff.page";
  /** قناة الإصدار الرسمية الوحيدة لملف APK. */
  private static final String RELEASE_PREFIX =
      "https://github.com/jj1333961-code/Thimar-Vite/releases/download/";

  private final Activity activity;
  private volatile boolean running = false;

  public ThimarUpdater(Activity activity) { this.activity = activity; }

  /**
   * يقبل العنوان المطلق الرسمي والمسار النسبي نفسه فقط. الويب يمرّر عنوانًا
   * مطلقًا، لكن الإصدارات القديمة تمرّر "/updates/android.json".
   */
  private static boolean isTrustedMetadataSource(String metadataUrl) {
    if (metadataUrl == null) return false;
    String value = metadataUrl.trim();
    if (META_URL.equals(value) || META_PATH.equals(value)) return true;
    return value.startsWith(SITE_ORIGIN + META_PATH);
  }

  /**
   * رابط التنزيل يجب أن يكون HTTPS وأحد مسارين فقط:
   * قناة الإصدارات الرسمية، أو نطاق ثمار نفسه. لا روابط خارجية ولا http.
   */
  private static boolean isTrustedDownloadUrl(String url) {
    if (url == null) return false;
    String value = url.trim();
    if (!value.startsWith("https://")) return false;
    return value.startsWith(RELEASE_PREFIX) || value.startsWith(SITE_ORIGIN + "/");
  }

  /** توقيع الجسر: هذه النسخة لا تثبّت حزمًا، بل تفتح صفحة التنزيل. */
  @JavascriptInterface
  public boolean opensBrowserForUpdates() { return true; }

  /** لم يعد مطلوبًا؛ تُرك للتوافق مع واجهات قديمة محفوظة في الكاش. */
  @JavascriptInterface
  public boolean canInstallPackages() { return true; }

  @JavascriptInterface
  public void openUpdatePage(final String metadataUrl) {
    if (!isTrustedMetadataSource(metadataUrl)) {
      showToast("مصدر بيانات التحديث غير موثوق.");
      return;
    }
    if (running) { showToast("جارٍ فتح صفحة التحديث…"); return; }
    running = true;
    new Thread(() -> {
      try {
        JSONObject meta = fetchMetadata();
        if (!meta.optBoolean("available", false)) { showToast("لا يوجد تحديث متاح."); return; }
        int remoteCode = meta.optInt("versionCode", 0);
        if (remoteCode <= BuildConfig.VERSION_CODE) { showToast("أنت تستخدم أحدث إصدار."); return; }
        String url = meta.optString("downloadUrl", "");
        if (!isTrustedDownloadUrl(url)) {
          Log.w(TAG, "Refusing untrusted download URL");
          showToast("رابط التحديث غير موثوق. لم يُفتح.");
          return;
        }
        openInBrowser(url);
      } catch (Exception e) {
        Log.w(TAG, "Update page hand-off failed", e);
        showToast("تعذّر فتح صفحة التحديث. تحقّق من الاتصال ثم أعد المحاولة.");
      } finally {
        running = false;
      }
    }, "ThimarUpdateHandoff").start();
  }

  private void openInBrowser(String url) {
    try {
      Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      activity.startActivity(intent);
      showToast("جارٍ تنزيل التحديث في المتصفح. ثبّته من إشعار التنزيل.");
    } catch (Exception e) {
      Log.e(TAG, "Cannot open browser", e);
      showToast("لا يوجد متصفح على الجهاز لفتح صفحة التحديث.");
    }
  }

  private JSONObject fetchMetadata() throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(META_URL).openConnection();
    c.setConnectTimeout(15000);
    c.setReadTimeout(20000);
    c.setRequestProperty("Cache-Control", "no-cache");
    c.setRequestProperty("User-Agent", "ThimarUpdater/3");
    if (!"https".equalsIgnoreCase(c.getURL().getProtocol())) throw new java.io.IOException("HTTPS required");
    try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] b = new byte[8192];
      int n;
      long total = 0;
      while ((n = in.read(b)) != -1) {
        total += n;
        if (total > 512 * 1024) throw new java.io.IOException("Metadata too large");
        out.write(b, 0, n);
      }
      return new JSONObject(out.toString("UTF-8"));
    } finally {
      c.disconnect();
    }
  }

  private void showToast(final String msg) {
    activity.runOnUiThread(() -> Toast.makeText(activity, msg, Toast.LENGTH_LONG).show());
  }
}
