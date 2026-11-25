package app.thimar.quran;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class AdhanAlarmReceiver extends BroadcastReceiver {
  private static final String CHANNEL_ID = "thimar_adhan_channel";
  private static final int SCREEN_REQUEST_CODE = 4000;
  private static final int ACTION_REQUEST_CODE = 4001;
  private static final String[] PRAYER_KEYS = { "fajr", "dhuhr", "asr", "maghrib", "isha" };

  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null) return;
    String prayer = intent.getStringExtra("prayer");
    String name = intent.getStringExtra("name");
    String time = intent.getStringExtra("time");
    String url = intent.getStringExtra("url");
    float volume = intent.getFloatExtra("volume", 0.9f);
    /* إعدادان مستقلان: الصوت والشاشة لا يُعطّل أحدهما الآخر. */
    boolean sound = intent.getBooleanExtra("sound", true);
    boolean screen = intent.getBooleanExtra("screen", true);
    if (prayer == null) return;

    /*
     * منع تكرار تشغيل نفس الصلاة في نفس اليوم (وبالتالي شاشة واحدة لكل صلاة).
     * لا نستخدم java.time هنا لأن minSdk هو 23 وjava.time متاح من 26 دون desugaring.
     */
    boolean force = intent.getBooleanExtra("force", false);
    String todayKey = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()) + "-" + prayer;
    String lastPlayed = AdhanScheduler.prefs(context).getString(AdhanScheduler.KEY_LAST_PLAYED, "");
    long lastPlayedAt = AdhanScheduler.prefs(context).getLong(AdhanScheduler.KEY_LAST_PLAYED_AT, 0);
    /*
     * منع التكرار: نفس الصلاة في نفس اليوم تُعرض مرة واحدة، وأي إعادة خلال
     * دقيقتين من المحاولة السابقة تُهمَل (يمنع أذانين متزامنين عند تكرار المنبه).
     * المحاولة القسرية (زر التجربة) تتجاوز الفحصين.
     */
    if (!force && todayKey.equals(lastPlayed)) {
      LaunchLog.add(context, "AdhanAlarmReceiver: تم تجاهل " + prayer + " (شُغِّل مسبقًا اليوم)");
      return;
    }
    if (!force && System.currentTimeMillis() - lastPlayedAt < 120_000L) {
      LaunchLog.add(context, "AdhanAlarmReceiver: تم تجاهل " + prayer + " (منبه مكرر خلال دقيقتين)");
      return;
    }

    // Wake lock قصير يكفي لبناء الشاشة وتشغيل الأذان.
    PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
    PowerManager.WakeLock wl = null;
    if (pm != null) {
      wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "thimar:adhan");
      wl.acquire(10 * 60 * 1000L);
    }

    ensureChannel(context);

    // شاشة الصلاة: تُعرض من الإشعار (ملء الشاشة)، وبنقرة عليه عندما يتعذّر ذلك.
    Intent screenIntent = new Intent(context, AdhanScreenActivity.class);
    screenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
        | Intent.FLAG_ACTIVITY_CLEAR_TOP
        | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    String shownTime = time == null ? "" : time.trim();
    if (shownTime.isEmpty()) {
      shownTime = new SimpleDateFormat("HH:mm", Locale.US).format(new Date());
    }
    String today = new SimpleDateFormat("EEEE، d MMMM yyyy", new Locale("ar")).format(new Date());
    String title = "حان وقت " + (name == null ? prayer : name);
    String details = "الوقت: " + shownTime + " • " + today;

    screenIntent.putExtra("prayer", prayer);
    if (name != null) screenIntent.putExtra("name", name);
    screenIntent.putExtra("time", shownTime);
    screenIntent.putExtra("url", url);
    screenIntent.putExtra("volume", volume);
    screenIntent.putExtra("sound", sound);
    PendingIntent screenPi = PendingIntent.getActivity(context, SCREEN_REQUEST_CODE, screenIntent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    PendingIntent actionPi = PendingIntent.getActivity(context, ACTION_REQUEST_CODE, screenIntent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    PendingIntent appPi = PendingIntent.getActivity(context, ACTION_REQUEST_CODE + 100,
        new Intent(context, WebFallbackActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
        .setContentTitle(title)
        .setContentText(details)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setContentIntent(screen ? screenPi : appPi)
        .setAutoCancel(true);

    /* صورة الصلاة داخل الإشعار نفسه: تظهر على شاشة القفل حتى لو مَنع النظام ملء الشاشة. */
    Bitmap picture = prayerImage(context, prayer);
    if (picture != null) {
      builder.setLargeIcon(picture);
      builder.setStyle(new NotificationCompat.BigPictureStyle()
          .bigPicture(picture)
          .bigLargeIcon((Bitmap) null)
          .setBigContentTitle(title)
          .setSummaryText(details));
    } else {
      builder.setStyle(new NotificationCompat.BigTextStyle().bigText(details));
    }
    if (screen) {
      /* ملء الشاشة: يعمل على شاشة القفل ويعود إلى إشعار عادي عند عدم توفّر الإذن. */
      builder.setFullScreenIntent(screenPi, true)
          .addAction(0, "عرض شاشة الصلاة", actionPi);
      if (Build.VERSION.SDK_INT >= 34) {
        NotificationManager permissionCheck =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (permissionCheck != null && !permissionCheck.canUseFullScreenIntent()) {
          LaunchLog.add(context,
              "شاشة الصلاة: إذن ملء الشاشة غير ممنوح — يظهر إشعار بالصورة ويمكن فتح الشاشة بالضغط");
        }
      }
    }

    /*
     * لا نطلب SYSTEM_ALERT_WINDOW ولا نحاول تجاوز قيود تشغيل الأنشطة من الخلفية.
     * يعتمد العرض التلقائي على Full-screen notification عندما يسمح أندرويد،
     * وإلا يبقى إشعار وقت الصلاة قابلًا للضغط لفتح شاشة الصلاة.
     */

    boolean posted = false;
    if (!NotificationHelper.canPost(context)) {
      LaunchLog.add(context, "إشعار وقت الصلاة لم يُعرض: إذن الإشعارات غير ممنوح");
    } else {
      NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null) {
        try {
          nm.notify(notificationId(prayer), builder.build());
          posted = true;
          LaunchLog.add(context, "إشعار وقت الصلاة معروض: " + prayer);
        } catch (SecurityException error) {
          LaunchLog.add(context, "تعذّر عرض إشعار وقت الصلاة: " + error.getMessage());
        }
      }
    }

    // تشغيل الصوت عبر خدمة أمامية: يستمر والتطبيق مغلق، ويُوقف من الشاشة/الإشعار.
    if (sound && url != null && !url.trim().isEmpty()) {
      try {
        Intent service = AdhanService.startIntent(context, prayer, name, shownTime, url, volume);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(service);
        } else {
          context.startService(service);
        }
      } catch (Exception error) {
        LaunchLog.add(context, "تعذّر بدء خدمة الأذان: " + error.getMessage());
      }
    }

    /* نُعلّم «تم التشغيل» فقط عند نجاح عرض الإشعار أو بدء الصوت،
       حتى تتمكن المحاولة التالية (إن فشلت) من إعادة التشغيل. */
    if (posted || (sound && url != null && !url.trim().isEmpty())) {
      AdhanScheduler.prefs(context).edit()
          .putString(AdhanScheduler.KEY_LAST_PLAYED, todayKey)
          .putLong(AdhanScheduler.KEY_LAST_PLAYED_AT, System.currentTimeMillis())
          .apply();
    }

    if (wl != null && wl.isHeld()) wl.release();

    /*
     * إعادة الجدولة فورًا بعد كل صلاة: لا نعتمد فقط على منبه منتصف الليل
     * (قد يفقده مانع البطارية)، فتظل صلاة الغد مجدولة على أي حال.
     */
    try {
      AdhanScheduler.scheduleAll(context, true);
    } catch (Exception ignored) {
      // الجدولة الحالية تبقى صالحة.
    }

    /* تحديث النسخ المحلية في الخلفية استعدادًا للمرة القادمة (بلا شبكة = لا شيء). */
    try {
      AdhanAssets.syncAsync(context);
    } catch (Exception ignored) {
      // الملفات الحالية كافية.
    }
  }

  /** رقم إشعار ثابت لكل صلاة: إعادة المحاولة تستبدل الإشعار بدل تكراره. */
  private static int notificationId(String prayer) {
    String key = prayer == null ? "" : prayer.trim().toLowerCase(Locale.US);
    for (int i = 0; i < PRAYER_KEYS.length; i++) {
      if (PRAYER_KEYS[i].equals(key)) return 4200 + i;
    }
    return 4299;
  }

  /** يقرأ صورة الصلاة المحمّلة أو المضمَّنة (دون شبكة) لعرضها داخل الإشعار. */
  private static Bitmap prayerImage(Context context, String prayer) {
    String key = prayer == null ? "" : prayer.trim().toLowerCase(Locale.US);
    File local = AdhanAssets.imageFile(context, key);
    if (local != null) {
      try {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(local.getAbsolutePath(), bounds);
        int widest = Math.max(bounds.outWidth, bounds.outHeight);
        int sample = 1;
        while (widest > 0 && widest / sample > 1080) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap bitmap = BitmapFactory.decodeFile(local.getAbsolutePath(), options);
        if (bitmap != null) return bitmap;
      } catch (Exception ignored) {
        // نرجع إلى الأصل المضمَّن.
      }
    }
    boolean known = false;
    for (String item : PRAYER_KEYS) {
      if (item.equals(key)) {
        known = true;
        break;
      }
    }
    String path = known ? "www/adhan/prayer/" + key + ".jpg" : "www/images/prayer-card.jpg";
    try {
      BitmapFactory.Options bounds = new BitmapFactory.Options();
      bounds.inJustDecodeBounds = true;
      InputStream head = context.getAssets().open(path);
      try {
        BitmapFactory.decodeStream(head, null, bounds);
      } finally {
        head.close();
      }
      int widest = Math.max(bounds.outWidth, bounds.outHeight);
      int sample = 1;
      while (widest > 0 && widest / sample > 1080) sample *= 2;

      BitmapFactory.Options options = new BitmapFactory.Options();
      options.inSampleSize = sample;
      InputStream data = context.getAssets().open(path);
      try {
        return BitmapFactory.decodeStream(data, null, options);
      } finally {
        data.close();
      }
    } catch (Exception error) {
      return null;
    }
  }

  private void ensureChannel(Context context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm == null) return;
      NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
      if (existing == null) {
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "الأذان", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("إشعارات أوقات الصلاة والأذان");
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        channel.enableVibration(true);
        nm.createNotificationChannel(channel);
      }
    }
  }
}
