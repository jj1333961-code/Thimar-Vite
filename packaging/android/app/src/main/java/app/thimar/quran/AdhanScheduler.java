package app.thimar.quran;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * جدولة الأذان محليًا (Android) — لا تعتمد على مؤقّتات JavaScript.
 */
public class AdhanScheduler {
  private static final String PREFS = "thimar_adhan";
  /** منبه إعادة الجدولة اليومي (منتصف الليل) — إجراء صريح حتى لا يُهمَل. */
  public static final String ACTION_RESCHEDULE = "app.thimar.quran.adhan.RESCHEDULE";
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
  public static final String KEY_LAST_PLAYED_AT = "last_played_at";
  /** آخر جدولة ناجحة (JSON) — تُعرض في التشخيص وتُثبت أن المنبهات وُضعت. */
  public static final String KEY_SCHEDULED = "scheduled_json";
  private static final String KEY_SIGNATURE = "schedule_signature";

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
    /* منبه إعادة الجدولة اليومي أيضًا. */
    Intent sync = new Intent(c, AdhanBootReceiver.class);
    sync.setAction(ACTION_RESCHEDULE);
    PendingIntent spi = PendingIntent.getBroadcast(c, 2000, sync,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    if (am != null) am.cancel(spi);
    spi.cancel();
    prefs(c).edit().remove(KEY_SCHEDULED).apply();
  }

  public static void scheduleAll(Context c) {
    scheduleAll(c, false);
  }

  /**
   * force=true يعيد وضع المنبهات دائمًا (بعد إعادة التشغيل أو تغيير التوقيت
   * أو بعد إطلاق صلاة)، وfalse يتخطى إعادة الجدولة إن لم تتغيّر المدخلات.
   */
  public static void scheduleAll(Context c, boolean force) {
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

    boolean[] enabledFlags = enabled;
    StringBuilder enabledKey = new StringBuilder();
    for (boolean flag : enabledFlags) enabledKey.append(flag ? '1' : '0');
    String signature = timesJson + "|" + sound + screen + "|" + enabledKey
        + "|" + p.getString(KEY_URLS, "") + "|" + p.getString(KEY_DEFAULT_URL, "")
        + "|" + p.getFloat(KEY_VOLUME, 0.9f)
        + "|" + new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    if (!force && signature.equals(p.getString(KEY_SIGNATURE, "")) && p.contains(KEY_SCHEDULED)) {
      return;
    }

    JSONObject scheduled = new JSONObject();
    SimpleDateFormat stamp = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US);

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

      /*
       * setAlarmClock أقوى جدولة يوفّرها أندرويد: دقيقة، تتجاوز Doze، وتُظهر
       * أيقونة المنبّه. هي الأنسب لإيقاظ الشاشة في وقت الصلاة. عند منع الإذن
       * نرجع إلى setAndAllowWhileIdle حتى لا تفوت الصلاة.
       */
      try {
        Intent showIntent = new Intent(c, AdhanScreenActivity.class);
        showIntent.putExtra("prayer", PRAYERS[i]);
        showIntent.putExtra("name", AR_NAMES[i]);
        showIntent.putExtra("time", t);
        showIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent showPi = PendingIntent.getActivity(c, 3000 + i, showIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager.AlarmClockInfo clock = new AlarmManager.AlarmClockInfo(cal.getTimeInMillis(), showPi);
        am.setAlarmClock(clock, pi);
        scheduled.put(PRAYERS[i], stamp.format(new Date(cal.getTimeInMillis())));
      } catch (SecurityException e) {
        try {
          if (AdhanPermissions.canScheduleExact(c)) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
          } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
          }
          scheduled.put(PRAYERS[i], stamp.format(new Date(cal.getTimeInMillis())));
        } catch (Exception ignored) {}
      } catch (Exception e) {
        try {
          if (AdhanPermissions.canScheduleExact(c)) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
          } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
          }
          scheduled.put(PRAYERS[i], stamp.format(new Date(cal.getTimeInMillis())));
        } catch (Exception ignored) {}
      }
    }

    // إعادة جدولة يومية (منتصف الليل) — محاولة بسيطة.
    Calendar midnight = Calendar.getInstance();
    midnight.add(Calendar.DAY_OF_YEAR, 1);
    midnight.set(Calendar.HOUR_OF_DAY, 0);
    midnight.set(Calendar.MINUTE, 5);
    midnight.set(Calendar.SECOND, 0);
    Intent syncIntent = new Intent(c, AdhanBootReceiver.class);
    syncIntent.setAction(ACTION_RESCHEDULE);
    PendingIntent spi = PendingIntent.getBroadcast(c, 2000, syncIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, midnight.getTimeInMillis(), spi);
      } else {
        am.set(AlarmManager.RTC_WAKEUP, midnight.getTimeInMillis(), spi);
      }
    } catch (Exception ignored) {}

    prefs(c).edit()
        .putString(KEY_SCHEDULED, scheduled.toString())
        .putString(KEY_SIGNATURE, signature)
        .apply();
    LaunchLog.add(c, "جدولة المنبهات: " + (scheduled.length() == 0 ? "لا أوقات" : scheduled.toString())
        + (AdhanPermissions.canScheduleExact(c) ? " (دقيقة)" : " (تقريبية — إذن المنبه الدقيق غير ممنوح)"));
  }

  /** حذف منبهات صلاة معيّنة (عند تعطيلها من الإعدادات). */
  public static void cancelPrayer(Context c, String prayer) {
    AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    for (int i = 0; i < PRAYERS.length; i++) {
      if (!PRAYERS[i].equalsIgnoreCase(prayer)) continue;
      Intent intent = new Intent(c, AdhanAlarmReceiver.class);
      PendingIntent pi = PendingIntent.getBroadcast(c, 1000 + i, intent,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      am.cancel(pi);
      pi.cancel();
    }
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
