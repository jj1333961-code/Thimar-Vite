package app.thimar.quran;

import android.content.Context;
import android.content.Intent;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * تشغيل تجربة الأذان من نفس المسار الحقيقي (منبه/إشعار/شاشة/صوت)،
 * حتى يختبر المستخدم ما سيحدث فعلًا في وقت الصلاة.
 */
public final class AdhanTest {
  private AdhanTest() {}

  public static void trigger(Context context, String prayer) {
    String key = prayer == null || prayer.trim().isEmpty() ? "Fajr" : prayer.trim();
    String time = new SimpleDateFormat("HH:mm", Locale.US).format(new Date());
    android.content.SharedPreferences prefs = AdhanScheduler.prefs(context);
    String url = AdhanScheduler.urlFor(context, key, prefs.getString(AdhanScheduler.KEY_DEFAULT_URL, ""));
    Intent intent = new Intent(context, AdhanAlarmReceiver.class);
    intent.putExtra("prayer", key);
    intent.putExtra("name", AdhanBridge.arabicName(key));
    intent.putExtra("time", time);
    intent.putExtra("url", url);
    intent.putExtra("volume", prefs.getFloat(AdhanScheduler.KEY_VOLUME, 0.9f));
    intent.putExtra("sound", prefs.getBoolean(AdhanScheduler.KEY_MASTER, true));
    intent.putExtra("screen", prefs.getBoolean(AdhanScheduler.KEY_SCREEN, true));
    intent.putExtra("force", true);
    try {
      context.sendBroadcast(intent);
      LaunchLog.add(context, "تجربة الأذان: أُرسل " + key + " (صوت="
          + prefs.getBoolean(AdhanScheduler.KEY_MASTER, true) + ")");
    } catch (Exception error) {
      LaunchLog.add(context, "تعذّر إرسال تجربة الأذان: " + error.getMessage());
    }
  }

  /** يفتح شاشة الصلاة مباشرة (اختبار الشكل والأزرار دون منبه). */
  public static void openScreen(Context context, String prayer) {
    try {
      String key = prayer == null || prayer.trim().isEmpty() ? "Fajr" : prayer.trim();
      Intent intent = AdhanBridge.screenIntent(context, key);
      intent.putExtra("time", new SimpleDateFormat("HH:mm", Locale.US).format(new Date()));
      intent.putExtra("sound", false);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
    } catch (Exception error) {
      LaunchLog.add(context, "تعذّر فتح شاشة الصلاة: " + error.getMessage());
    }
  }
}
