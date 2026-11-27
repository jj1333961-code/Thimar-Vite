package app.thimar.quran;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

/**
 * أذونات نظام أندرويد اللازمة لشاشة الصلاة والأذان:
 *  - إشعارات (أندرويد 13+).
 *  - المنبهات الدقيقة (أندرويد 12+).
 *
 * كل إذن يُشرح في شاشة الإعدادات ويُفتح بطلب صريح من المستخدم — لا نفتح
 * شاشات النظام تلقائيًا عند كل جدولة. لا نتجاوز أي قيد أمني في أندرويد.
 */
public final class AdhanPermissions {
  public static final int REQUEST_NOTIFICATIONS = 7101;
  private static final String PREFS = "thimar_adhan_permissions";

  private AdhanPermissions() {}

  public static boolean canScheduleExact(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
    AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    return am != null && am.canScheduleExactAlarms();
  }

  public static boolean notificationsEnabled(Context context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      return ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS)
          == PackageManager.PERMISSION_GRANTED;
    }
    NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    return nm != null && nm.areNotificationsEnabled();
  }

  /** JSON يصف حالة كل إذن — بلا أي بيانات حساسة. */
  public static JSONObject status(Context context) {
    JSONObject json = new JSONObject();
    try {
      json.put("notifications", notificationsEnabled(context));
      json.put("exactAlarms", canScheduleExact(context));
      json.put("android", Build.VERSION.SDK_INT);
      json.put("screenOnWhenLocked", true);
      /* إذن العرض فوق التطبيقات: به تُفتح شاشة الأذان تلقائيًا من الخلفية. */
      json.put("overlay", FloatingOverlayService.canDrawOverlays(context));
      json.put("volumeKeyMute",
          AdhanScheduler.prefs(context).getBoolean(AdhanScheduler.KEY_VOLUME_KEY_MUTE, true));
    } catch (Exception ignored) {
      // تبقى القيم الافتراضية.
    }
    return json;
  }

  /** يطلب إذن الإشعارات وقت التشغيل (أندرويد 13+) — يجب أن يُستدعى من نشاط. */
  public static void requestNotifications(Activity activity) {
    if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
    if (notificationsEnabled(activity)) return;
    try {
      ActivityCompat.requestPermissions(activity,
          new String[] { android.Manifest.permission.POST_NOTIFICATIONS },
          REQUEST_NOTIFICATIONS);
    } catch (Exception ignored) {
      openSettings(activity, "notifications");
    }
  }

  /** يفتح شاشة إعداد النظام المناسبة لمفتاح معيّن. */
  public static void openSettings(Context context, String key) {
    String name = key == null ? "" : key;
    switch (name) {
      case "notifications":
        open(context, new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName()));
        return;
      case "exactAlarms":
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          open(context, new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
              .setData(Uri.parse("package:" + context.getPackageName())));
        }
        return;
      case "overlay":
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          open(context, new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
              .setData(Uri.parse("package:" + context.getPackageName())));
        }
        return;
      default:
        open(context, new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName()));
    }
  }

  /** يفتح شاشات الأذونات الناقصة مرة واحدة لكل إذن (يُستدعى من زر الإعداد). */
  public static void requestMissing(Context context) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    if (!notificationsEnabled(context)) {
      openSettings(context, "notifications");
      return;
    }
    if (!canScheduleExact(context) && !prefs.getBoolean("asked_exact", false)) {
      prefs.edit().putBoolean("asked_exact", true).apply();
      openSettings(context, "exactAlarms");
      return;
    }
  }

  private static void open(Context context, Intent intent) {
    try {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
    } catch (Exception ignored) {
      // بعض الأجهزة لا تعرض هذه الشاشات؛ يبقى الإشعار بديلًا.
    }
  }
}
