package app.thimar.quran;

import android.content.Context;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;

public class AdhanBridge {
  private final Context context;

  public AdhanBridge(Context context) {
    this.context = context.getApplicationContext();
  }

  @JavascriptInterface
  public void scheduleAdhan(String json) {
    try {
      JSONObject obj = new JSONObject(json);
      if (obj.has("times")) {
        AdhanScheduler.saveTimes(context, obj.getJSONObject("times"));
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
      if (obj.has("urls")) {
        AdhanScheduler.saveUrls(context, obj.getJSONObject("urls"));
      }
      AdhanScheduler.scheduleAll(context);
      if (screen) ensurePrayerScreenPermissionOnce();
    } catch (Exception e) {
      // تجاهل — لا نريد كسر الواجهة.
    }
  }

  /**
   * شاشة وقت الصلاة تحتاج إذن «ملء الشاشة» على أندرويد 14+.
   * يُطلب مرة واحدة عند تفعيل الأذان فقط، بلا أي إزعاج متكرر.
   */
  private void ensurePrayerScreenPermissionOnce() {
    if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return;
    try {
      android.app.NotificationManager nm =
          (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null && nm.canUseFullScreenIntent()) return;
      android.content.SharedPreferences prefs = AdhanScheduler.prefs(context);
      if (prefs.getBoolean("screen_permission_asked", false)) return;
      prefs.edit().putBoolean("screen_permission_asked", true).apply();
      android.content.Intent intent = new android.content.Intent(
          android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
      intent.setData(android.net.Uri.parse("package:" + context.getPackageName()));
      intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
    } catch (Exception ignored) {
      // تبقى الشاشة تعمل حيث يسمح النظام؛ الإشعار يغطي بقية الحالات.
    }
  }

  @JavascriptInterface
  public void cancelAdhan() {
    AdhanScheduler.cancelAll(context);
  }
}
