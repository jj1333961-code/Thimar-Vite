package app.thimar.quran;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * إنشاء قناة الإشعارات وعرضها — يستخدمه {@link ThimarMessagingService} في المقدمة،
 * ويستخدمه نظام أندرويد تلقائيًا في الخلفية عبر قناة Firestore الافتراضية.
 */
public final class NotificationHelper {
  public static final String CHANNEL_ID = "thimar_notifications";
  public static final String CHANNEL_NAME = "إشعارات ثمار";
  public static final String EXTRA_URL = "thimar_url";
  public static final String OPEN_ACTION = "app.thimar.quran.OPEN_NOTIFICATION";

  private static final int COLOR = 0xFF0F5F4E;

  private NotificationHelper() {}

  /** قناة واحدة ثابتة: صوت النظام، اهتزاز، وإظهار على شاشة القفل. */
  public static void ensureChannel(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager =
        (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (manager == null) return;
    NotificationChannel existing = manager.getNotificationChannel(CHANNEL_ID);
    if (existing != null) return;

    NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("الرسائل والتذكيرات والأذان ونتائج الاختبارات");
    channel.enableVibration(true);
    channel.setVibrationPattern(new long[] {0, 250, 150, 250});
    channel.enableLights(true);
    channel.setLightColor(COLOR);
    channel.setShowBadge(true);
    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
    if (sound != null) {
      AudioAttributes attributes = new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build();
      channel.setSound(sound, attributes);
    }
    manager.createNotificationChannel(channel);
  }

  /** هل يستطيع التطبيق إظهار إشعارات الآن (أندرويد 13+ يطلب إذنًا صريحًا)؟ */
  public static boolean canPost(Context context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      return ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS)
          == PackageManager.PERMISSION_GRANTED;
    }
    return NotificationManagerCompat.from(context).areNotificationsEnabled();
  }

  /** يفتح صفحة إعدادات إشعارات التطبيق في النظام. */
  public static void openSettings(Context context) {
    try {
      Intent intent = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);
      intent.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.getPackageName());
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
    } catch (Exception ignored) {
      /* بعض الأجهزة لا تدعم الشاشة المباشرة. */
    }
  }

  /** يعرض إشعارًا يفتح الصفحة المطلوبة عند الضغط. */
  public static void show(Context context, String title, String body, String url, String tag) {
    ensureChannel(context);
    if (!canPost(context)) {
      LaunchLog.add(context, "إشعار لم يُعرض: إذن الإشعارات غير ممنوح");
      return;
    }
    String target = normalizeUrl(url);
    String text = body == null || body.trim().isEmpty() ? "" : body.trim();

    Intent intent = new Intent(context, WebFallbackActivity.class);
    intent.setAction(OPEN_ACTION);
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    intent.putExtra(EXTRA_URL, target);
    intent.setData(Uri.parse("thimar://open?path=" + Uri.encode(target)));

    int requestCode = (tag + target).hashCode();
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent pending = PendingIntent.getActivity(context, requestCode, intent, flags);

    NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_thimar)
        .setColor(COLOR)
        .setContentTitle(title == null || title.trim().isEmpty() ? "ثمار" : title.trim())
        .setContentText(text)
        .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
        .setAutoCancel(true)
        .setOnlyAlertOnce(false)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setContentIntent(pending)
        .setWhen(System.currentTimeMillis())
        .setShowWhen(true);

    try {
      NotificationManagerCompat.from(context).notify(requestCode, builder.build());
      LaunchLog.add(context, "إشعار معروض: " + title + " ← " + target);
    } catch (SecurityException error) {
      LaunchLog.add(context, "فشل عرض الإشعار: " + error.getMessage());
    }
  }

  /** يحوّل رابط الإشعار إلى مسار داخلي آمن. */
  static String normalizeUrl(String url) {
    if (url == null || url.trim().isEmpty()) return "/";
    String value = url.trim();
    if (value.startsWith("https://thimar.freebuff.page")) {
      value = value.substring("https://thimar.freebuff.page".length());
    }
    if (value.startsWith("thimar://")) {
      int index = value.indexOf("path=");
      value = index >= 0 ? Uri.decode(value.substring(index + 5)) : "/";
    }
    if (!value.startsWith("/")) value = "/" + value;
    return value;
  }
}
