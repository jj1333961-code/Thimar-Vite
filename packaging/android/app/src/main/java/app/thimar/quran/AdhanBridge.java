package app.thimar.quran;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.util.Locale;

/**
 * جسر الواجهة مع أذان أندرويد الأصلي:
 * الجدولة، حالة الأذونات، تنزيل الصور والأصوات للاستخدام دون إنترنت،
 * والتجربة الفورية. لا يكشف أي سر أو بيانات مستخدم.
 */
public class AdhanBridge {
  private static final String[] PRAYER_NAMES = { "الفجر", "الظهر", "العصر", "المغرب", "العشاء" };

  private final Context context;
  private final Activity activity;

  public AdhanBridge(Context context) {
    this.context = context.getApplicationContext();
    this.activity = context instanceof Activity ? (Activity) context : null;
  }

  @JavascriptInterface
  public void scheduleAdhan(String json) {
    try {
      JSONObject obj = new JSONObject(json);
      if (obj.has("times")) {
        AdhanScheduler.saveTimes(context, obj.getJSONObject("times"));
      }
      if (obj.has("imageUrls")) {
        AdhanAssets.saveImageUrls(context, obj.optJSONObject("imageUrls"));
      }
      boolean master = obj.optBoolean("master", true);
      boolean screen = obj.optBoolean("screen", true);
      boolean fajr = obj.optBoolean("fajr", true);
      boolean dhuhr = obj.optBoolean("dhuhr", true);
      boolean asr = obj.optBoolean("asr", true);
      boolean maghrib = obj.optBoolean("maghrib", true);
      boolean isha = obj.optBoolean("isha", true);
      String defaultUrl = obj.optString("defaultUrl", "");
      float volume = (float) obj.optDouble("volume", 0.9);
      AdhanScheduler.saveSettings(context, master, screen, fajr, dhuhr, asr, maghrib, isha, defaultUrl, volume);
      /* خيارات شاشة الأذان: كتم بزر الصوت، والمدينة واللغة والسمة. */
      AdhanScheduler.savePresentation(context,
          obj.optBoolean("volumeKeyMute", true),
          obj.optString("city", ""),
          obj.optString("lang", "ar"),
          obj.optString("theme", ""));
      if (obj.has("urls")) {
        AdhanScheduler.saveUrls(context, obj.getJSONObject("urls"));
      }
      AdhanScheduler.scheduleAll(context);
      /* تنزيل/تحديث الصور والأصوات في الخلفية (لا يتكرر إن كانت محفوظة). */
      AdhanAssets.syncAsync(context);
    } catch (Exception e) {
      LaunchLog.add(context, "AdhanBridge.scheduleAdhan: " + e.getMessage());
    }
  }

  /** ينزّل صور الصلوات والأذان المحدد إلى التخزين الدائم. يعيد الحالة مباشرة. */
  @JavascriptInterface
  public String syncAdhanAssets(String json) {
    try {
      JSONObject obj = new JSONObject(json == null || json.trim().isEmpty() ? "{}" : json);
      if (obj.has("imageUrls")) {
        AdhanAssets.saveImageUrls(context, obj.optJSONObject("imageUrls"));
      }
      if (obj.has("urls")) {
        AdhanScheduler.saveUrls(context, obj.getJSONObject("urls"));
      }
      if (obj.has("defaultUrl")) {
        AdhanScheduler.prefs(context).edit()
            .putString(AdhanScheduler.KEY_DEFAULT_URL, obj.optString("defaultUrl", "")).apply();
      }
      AdhanAssets.syncAsync(context);
      return AdhanAssets.status(context).toString();
    } catch (Exception e) {
      return "{\"error\":\"" + safeMessage(e) + "\"}";
    }
  }

  /** حالة شاملة: الأذونات + الملفات المحلية + المنبهات المجدولة. */
  @JavascriptInterface
  public String getAdhanStatus() {
    JSONObject json = new JSONObject();
    try {
      json.put("permissions", AdhanPermissions.status(context));
      json.put("assets", AdhanAssets.status(context));
      json.put("scheduled", new JSONObject(
          AdhanScheduler.prefs(context).getString(AdhanScheduler.KEY_SCHEDULED, "{}")));
      json.put("lastPlayed", AdhanScheduler.prefs(context).getString(AdhanScheduler.KEY_LAST_PLAYED, ""));
      json.put("volume", AdhanScheduler.prefs(context).getFloat(AdhanScheduler.KEY_VOLUME, 0.9f));
      json.put("volumeKeyMute",
          AdhanScheduler.prefs(context).getBoolean(AdhanScheduler.KEY_VOLUME_KEY_MUTE, true));
      json.put("assetsBytes", AdhanAssets.totalBytes(context));
      json.put("android", Build.VERSION.SDK_INT);
    } catch (Exception e) {
      try {
        json.put("error", safeMessage(e));
      } catch (Exception ignored) {
        // لا شيء.
      }
    }
    return json.toString();
  }

  /** يفتح شاشات الأذونات الناقصة (بديل قديم). */
  @JavascriptInterface
  public void requestAdhanPermissions() {
    if (activity != null && !AdhanPermissions.notificationsEnabled(context)) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        AdhanPermissions.requestNotifications(activity);
        return;
      }
    }
    AdhanPermissions.requestMissing(context);
  }

  /** يطلب إذن إشعارات وقت التشغيل (أندرويد 13+) من نشاط الويب. */
  @JavascriptInterface
  public void requestNotificationPermission() {
    if (activity != null) {
      AdhanPermissions.requestNotifications(activity);
    }
  }

  /** يفتح إعداد نظام محدد: notifications/fullScreenIntent/exactAlarms/batteryUnrestricted/overlay. */
  @JavascriptInterface
  public void openAdhanPermission(String key) {
    AdhanPermissions.openSettings(context, key);
  }

  /** يشغّل دورة الأذان الكاملة الآن (اختبار): منبه ← إشعار ← شاشة ← صوت. */
  @JavascriptInterface
  public void testAdhan(String prayer) {
    LaunchLog.add(context, "AdhanBridge: تجربة أذان " + prayer);
    AdhanTest.trigger(context, prayer);
  }

  @JavascriptInterface
  public void cancelAdhan() {
    AdhanScheduler.cancelAll(context);
  }

  private static String safeMessage(Exception error) {
    String message = error.getMessage();
    if (message == null) message = "error";
    return message.replace("\"", "'").replace("\n", " ");
  }

  /** أسماء الصلوات العربية بالترتيب (يُستخدمها الاختبار). */
  static String arabicName(String prayer) {
    if (prayer == null) return PRAYER_NAMES[0];
    for (int i = 0; i < PRAYER_NAMES.length; i++) {
      String key = i == 0 ? "fajr" : i == 1 ? "dhuhr" : i == 2 ? "asr" : i == 3 ? "maghrib" : "isha";
      if (key.equals(prayer.trim().toLowerCase(Locale.US))) return PRAYER_NAMES[i];
    }
    return PRAYER_NAMES[0];
  }

  /** يفتح شاشة الصلاة مباشرة (للتجربة من التشخيص دون انتظار المنبه). */
  static Intent screenIntent(Context context, String prayer) {
    Intent intent = new Intent(context, AdhanScreenActivity.class);
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
        | Intent.FLAG_ACTIVITY_CLEAR_TOP
        | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    String key = prayer == null ? "Fajr" : prayer;
    intent.putExtra("prayer", key);
    intent.putExtra("name", arabicName(key));
    return intent;
  }
}
