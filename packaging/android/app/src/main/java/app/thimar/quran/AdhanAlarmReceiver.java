package app.thimar.quran;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class AdhanAlarmReceiver extends BroadcastReceiver {
  private static final String CHANNEL_ID = "thimar_adhan_channel";
  private static final int SCREEN_REQUEST_CODE = 4000;
  private static final int ACTION_REQUEST_CODE = 4001;

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
    String todayKey = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()) + "-" + prayer;
    if (todayKey.equals(AdhanScheduler.prefs(context).getString(AdhanScheduler.KEY_LAST_PLAYED, ""))) {
      return;
    }
    AdhanScheduler.prefs(context).edit().putString(AdhanScheduler.KEY_LAST_PLAYED, todayKey).apply();

    // Wake lock قصير يكفي لبناء الشاشة وتشغيل الأذان.
    PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
    PowerManager.WakeLock wl = null;
    if (pm != null) {
      wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "thimar:adhan");
      wl.acquire(60 * 1000L);
    }

    ensureChannel(context);

    // شاشة الصلاة: تُعرض من الإشعار (ملء الشاشة)، وبنقرة عليه عندما يتعذّر ذلك.
    Intent screenIntent = new Intent(context, AdhanScreenActivity.class);
    screenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
        | Intent.FLAG_ACTIVITY_CLEAR_TOP
        | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    screenIntent.putExtra("prayer", prayer);
    if (name != null) screenIntent.putExtra("name", name);
    if (time != null) screenIntent.putExtra("time", time);
    PendingIntent screenPi = PendingIntent.getActivity(context, SCREEN_REQUEST_CODE, screenIntent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    PendingIntent actionPi = PendingIntent.getActivity(context, ACTION_REQUEST_CODE, screenIntent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    PendingIntent appPi = PendingIntent.getActivity(context, ACTION_REQUEST_CODE + 100,
        new Intent(context, WebFallbackActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
        .setContentTitle("حان وقت " + (name == null ? prayer : name))
        .setContentText("الوقت: " + (time == null ? "" : time))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setContentIntent(screen ? screenPi : appPi)
        .setAutoCancel(true);
    if (screen) {
      /* ملء الشاشة: يعمل على شاشة القفل ويعود إلى إشعار عادي عند عدم توفّر الإذن. */
      builder.setFullScreenIntent(screenPi, true)
          .addAction(0, "عرض شاشة الصلاة", actionPi);
    }

    /*
     * لا نحاول فتح النشاط من الخلفية: أندرويد يمنعه منذ 10، وقد يُسقِط الإشعار
     * معه. الإشعار يحمل زرًا صريحًا لفتح شاشة الصلاة، ويُفتح بالنقر أيضًا.
     */
    if (!NotificationHelper.canPost(context)) {
      LaunchLog.add(context, "إشعار وقت الصلاة لم يُعرض: إذن الإشعارات غير ممنوح");
    } else {
      NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null) {
        try {
          nm.notify((int) System.currentTimeMillis(), builder.build());
        } catch (SecurityException error) {
          LaunchLog.add(context, "تعذّر عرض إشعار وقت الصلاة: " + error.getMessage());
        }
      }
    }

    // تشغيل الصوت (إن وُجد وكان مفعّلًا).
    if (sound && url != null && !url.trim().isEmpty()) {
      try {
        MediaPlayer player = new MediaPlayer();
        player.setAudioAttributes(new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build());
        player.setVolume(volume, volume);
        if (url.startsWith("http")) {
          player.setDataSource(url);
        } else {
          player.setDataSource(context, Uri.parse(url));
        }
        player.setOnCompletionListener(MediaPlayer::release);
        player.setOnErrorListener((mp, what, extra) -> { mp.release(); return true; });
        player.prepareAsync();
        player.setOnPreparedListener(MediaPlayer::start);
      } catch (Exception e) {
        // تجاهل — الإشعار كافٍ.
      }
    }

    if (wl != null && wl.isHeld()) wl.release();

    /*
     * إعادة الجدولة فورًا بعد كل صلاة: لا نعتمد فقط على منبه منتصف الليل
     * (قد يفقده مانع البطارية)، فتظل صلاة الغد مجدولة على أي حال.
     */
    try {
      AdhanScheduler.scheduleAll(context);
    } catch (Exception ignored) {
      // الجدولة الحالية تبقى صالحة.
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
