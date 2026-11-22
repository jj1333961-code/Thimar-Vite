package app.thimar.quran;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONObject;
import java.util.Calendar;

/**
 * جدولة الأذان محليًا (Android) — لا تعتمد على مؤقّتات JavaScript.
 */
public class AdhanScheduler {
  private static final String PREFS = "thimar_adhan";
  public static final String KEY_TIMES = "times_json";
  public static final String KEY_MASTER = "master_enabled";
  /** شاشة وقت الصلاة مستقلة عن صوت الأذان. */
  public static final String KEY_SCREEN = "screen_enabled";
  public static final String KEY_FAJR = "fajr_enabled";
  public static final String KEY_DHUHR = "dhuhr_enabled";
  public static final String KEY_ASR = "asr_enabled";
  public static final String KEY_MAGHRIB = "maghrib_enabled";
  public static final String KEY_ISHA = "isha_enabled";
  public static final String KEY_DEFAULT_URL = "default_url";
  public static final String KEY_URLS = "urls_json";
  public static final String KEY_VOLUME = "volume";
  public static final String KEY_LAST_PLAYED = "last_played";

  private static final String[] PRAYERS = {"Fajr","Dhuhr","Asr","Maghrib","Isha"};
  private static final String[] AR_NAMES = {"الفجر","الظهر","العصر","المغرب","العشاء"};

  public static SharedPreferences prefs(Context c) {
    return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public static void saveTimes(Context c, JSONObject times) {
    prefs(c).edit().putString(KEY_TIMES, times.toString()).apply();
  }

  public static void saveSettings(Context c, boolean master, boolean screen, boolean fajr, boolean dhuhr, boolean asr, boolean maghrib, boolean isha, String defaultUrl, float volume) {
    prefs(c).edit()
      .putBoolean(KEY_MASTER, master)
      .putBoolean(KEY_SCREEN, screen)
      .putBoolean(KEY_FAJR, fajr)
      .putBoolean(KEY_DHUHR, dhuhr)
      .putBoolean(KEY_ASR, asr)
      .putBoolean(KEY_MAGHRIB, maghrib)
      .putBoolean(KEY_ISHA, isha)
      .putString(KEY_DEFAULT_URL, defaultUrl)
      .putFloat(KEY_VOLUME, volume)
      .apply();
  }

  public static void saveUrls(Context c, JSONObject urls) {
    prefs(c).edit().putString(KEY_URLS, urls.toString()).apply();
  }

  public static String urlFor(Context c, String prayer, String fallback) {
    try {
      String raw = prefs(c).getString(KEY_URLS, null);
      if (raw != null) {
        JSONObject o = new JSONObject(raw);
        String v = o.optString(prayer, null);
        if (v != null && !v.trim().isEmpty()) return v;
      }
    } catch (Exception ignored) {}
    return fallback;
  }

  public static void cancelAll(Context c) {
    AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    for (int i = 0; i < PRAYERS.length; i++) {
      Intent intent = new Intent(c, AdhanAlarmReceiver.class);
      PendingIntent pi = PendingIntent.getBroadcast(c, 1000 + i, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      if (am != null) am.cancel(pi);
      pi.cancel();
    }
  }

  public static void scheduleAll(Context c) {
    SharedPreferences p = prefs(c);
    boolean sound = p.getBoolean(KEY_MASTER, true);
    boolean screen = p.getBoolean(KEY_SCREEN, true);
    /* لا جدولة إلا إذا كان الصوت أو الشاشة مطلوبًا — كل واحد مستقل عن الآخر. */
    if (!sound && !screen) {
      cancelAll(c);
      return;
    }
    String timesJson = p.getString(KEY_TIMES, null);
    if (timesJson == null) return;
    JSONObject times;
    try { times = new JSONObject(timesJson); } catch (Exception e) { return; }

    AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;

    boolean[] enabled = new boolean[] {
      p.getBoolean(KEY_FAJR, true),
      p.getBoolean(KEY_DHUHR, true),
      p.getBoolean(KEY_ASR, true),
      p.getBoolean(KEY_MAGHRIB, true),
      p.getBoolean(KEY_ISHA, true)
    };

    for (int i = 0; i < PRAYERS.length; i++) {
      if (!enabled[i]) continue;
      String t = times.optString(PRAYERS[i], null);
      if (t == null) continue;
      int[] hm = parseTime(t);
      if (hm == null) continue;

      Calendar cal = Calendar.getInstance();
      cal.set(Calendar.HOUR_OF_DAY, hm[0]);
      cal.set(Calendar.MINUTE, hm[1]);
      cal.set(Calendar.SECOND, 0);
      cal.set(Calendar.MILLISECOND, 0);
      if (cal.getTimeInMillis() <= System.currentTimeMillis()) {
        cal.add(Calendar.DAY_OF_YEAR, 1);
      }

      Intent intent = new Intent(c, AdhanAlarmReceiver.class);
      intent.putExtra("prayer", PRAYERS[i]);
      intent.putExtra("name", AR_NAMES[i]);
      intent.putExtra("time", t);
      String url = urlFor(c, PRAYERS[i], p.getString(KEY_DEFAULT_URL, ""));
      intent.putExtra("url", url);
      intent.putExtra("volume", p.getFloat(KEY_VOLUME, 0.9f));
      intent.putExtra("sound", sound);
      intent.putExtra("screen", screen);
      PendingIntent pi = PendingIntent.getBroadcast(c, 1000 + i, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          if (am.canScheduleExactAlarms()) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
          } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
          }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
        } else {
          am.setExact(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
        }
      } catch (SecurityException e) {
        try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi); } catch (Exception ignored) {}
      }
    }

    // إعادة جدولة يومية (منتصف الليل) — محاولة بسيطة.
    Calendar midnight = Calendar.getInstance();
    midnight.add(Calendar.DAY_OF_YEAR, 1);
    midnight.set(Calendar.HOUR_OF_DAY, 0);
    midnight.set(Calendar.MINUTE, 5);
    midnight.set(Calendar.SECOND, 0);
    Intent syncIntent = new Intent(c, AdhanBootReceiver.class);
    PendingIntent spi = PendingIntent.getBroadcast(c, 2000, syncIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, midnight.getTimeInMillis(), spi);
      } else {
        am.set(AlarmManager.RTC_WAKEUP, midnight.getTimeInMillis(), spi);
      }
    } catch (Exception ignored) {}
  }

  private static int[] parseTime(String t) {
    try {
      String[] parts = t.split(":");
      int h = Integer.parseInt(parts[0].trim());
      int m = Integer.parseInt(parts[1].trim());
      if (h < 0 || h > 23 || m < 0 || m > 59) return null;
      return new int[]{h, m};
    } catch (Exception e) {
      return null;
    }
  }
}
