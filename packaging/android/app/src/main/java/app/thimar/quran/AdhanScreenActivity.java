package app.thimar.quran;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.TextView;

import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * شاشة وقت الصلاة: تُعرض تلقائيًا (فوق شاشة القفل) عند دخول وقت الصلاة،
 * وتُظهر صورة مع اسم التطبيق وشعاره واسم الصلاة والتاريخ ووقت الصلاة.
 *
 * لا تُفتح إلا من داخل التطبيق (إشعار وقت الصلاة) وهي غير مُصدَّرة للخارج.
 */
public class AdhanScreenActivity extends Activity {
  /** تُغلق الشاشة تلقائيًا بعد هذه المدة إن لم يلمسها المستخدم. */
  private static final long AUTO_DISMISS_MS = 90_000L;

  private static final String[] PRAYER_KEYS = { "fajr", "dhuhr", "asr", "maghrib", "isha" };
  private static final String[] PRAYER_NAMES = { "الفجر", "الظهر", "العصر", "المغرب", "العشاء" };

  private final Handler handler = new Handler(Looper.getMainLooper());
  private final Runnable autoDismiss = new Runnable() {
    @Override
    public void run() {
      finish();
    }
  };

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    showOverLockScreen();
    setContentView(R.layout.activity_adhan_screen);
    LaunchLog.init(this);
    LaunchLog.add(this, "شاشة وقت الصلاة: عرض");
    if (getIntent() != null) populate(getIntent());
    View root = findViewById(R.id.adhan_root);
    if (root != null) {
      root.setOnClickListener(new View.OnClickListener() {
        @Override
        public void onClick(View view) {
          finish();
        }
      });
    }
    handler.postDelayed(autoDismiss, AUTO_DISMISS_MS);
  }

  /** العرض فوق شاشة القفل مع إضاءة الشاشة وإخفاء أشرطة النظام. */
  private void showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
    } else {
      getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
          | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
          | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
  }

  /** صلاة أخرى تصل والشاشة معروضة: تُحدَّث البيانات ولا تُفتح شاشة ثانية. */
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    if (intent == null) return;
    setIntent(intent);
    handler.removeCallbacks(autoDismiss);
    populate(intent);
    handler.postDelayed(autoDismiss, AUTO_DISMISS_MS);
  }

  /**
   * عند اختفاء الشاشة (إطفاء الشاشة أو فتح تطبيق آخر) تُغلق فورًا
   * حتى لا يبقى الهاتف مستيقظًا بلا داعٍ.
   */
  @Override
  protected void onStop() {
    handler.removeCallbacks(autoDismiss);
    if (!isChangingConfigurations()) finish();
    super.onStop();
  }

  private void populate(Intent intent) {
    String prayerKey = intent == null ? null : intent.getStringExtra("prayer");
    String prayerName = intent == null ? null : intent.getStringExtra("name");
    String time = intent == null ? null : intent.getStringExtra("time");

    int index = indexOfPrayer(prayerKey);
    if (prayerName == null || prayerName.trim().isEmpty()) {
      prayerName = index >= 0 ? PRAYER_NAMES[index] : "";
    }

    TextView prayerView = (TextView) findViewById(R.id.adhan_prayer);
    if (prayerView != null) {
      prayerView.setText(prayerName.isEmpty() ? "حان وقت الصلاة" : "حان وقت صلاة " + prayerName);
    }

    TextView timeView = (TextView) findViewById(R.id.adhan_time);
    if (timeView != null) {
      String shown = time == null ? "" : time.trim();
      if (shown.isEmpty()) shown = new SimpleDateFormat("HH:mm", Locale.US).format(new Date());
      timeView.setText(shown);
    }

    TextView dateView = (TextView) findViewById(R.id.adhan_date);
    if (dateView != null) {
      dateView.setText(new SimpleDateFormat("EEEE، d MMMM yyyy", new Locale("ar")).format(new Date()));
    }

    TextView hijriView = (TextView) findViewById(R.id.adhan_hijri);
    if (hijriView != null) {
      String hijri = hijriDate();
      hijriView.setText(hijri);
      hijriView.setVisibility(hijri.isEmpty() ? View.GONE : View.VISIBLE);
    }

    ImageView background = (ImageView) findViewById(R.id.adhan_background);
    if (background != null) {
      Bitmap bitmap = index >= 0 ? decodeAsset("www/adhan/prayer/" + PRAYER_KEYS[index] + ".jpg") : null;
      if (bitmap == null) bitmap = decodeAsset("www/images/prayer-card.jpg");
      if (bitmap != null) background.setImageBitmap(bitmap);
    }
  }

  private static int indexOfPrayer(String key) {
    if (key == null) return -1;
    String lower = key.trim().toLowerCase(Locale.US);
    for (int i = 0; i < PRAYER_KEYS.length; i++) {
      if (PRAYER_KEYS[i].equals(lower)) return i;
    }
    return -1;
  }

  /** تاريخ هجري (أم القرى) حين توفّره المنصة، وإلا يبقى السطر مخفيًا. */
  private static String hijriDate() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return "";
    try {
      android.icu.util.IslamicCalendar calendar = new android.icu.util.IslamicCalendar();
      calendar.setCalculationType(android.icu.util.IslamicCalendar.CalculationType.ISLAMIC_UMALQURA);
      calendar.setTimeInMillis(System.currentTimeMillis());
      android.icu.text.SimpleDateFormat format =
          new android.icu.text.SimpleDateFormat("d MMMM yyyy", android.icu.util.ULocale.forLanguageTag("ar"));
      return format.format(calendar.getTime()) + " هـ";
    } catch (Throwable error) {
      return "";
    }
  }

  /** يقرأ الصورة من الأصول المضمَّنة في الحزمة (لا شبكة، لا ملفات خارجية). */
  private Bitmap decodeAsset(String path) {
    try {
      BitmapFactory.Options bounds = new BitmapFactory.Options();
      bounds.inJustDecodeBounds = true;
      InputStream head = getAssets().open(path);
      try {
        BitmapFactory.decodeStream(head, null, bounds);
      } finally {
        head.close();
      }
      int widest = Math.max(bounds.outWidth, bounds.outHeight);
      int sample = 1;
      while (widest > 0 && widest / sample > 1600) sample *= 2;

      BitmapFactory.Options options = new BitmapFactory.Options();
      options.inSampleSize = sample;
      InputStream data = getAssets().open(path);
      try {
        return BitmapFactory.decodeStream(data, null, options);
      } finally {
        data.close();
      }
    } catch (Exception error) {
      LaunchLog.add(this, "صورة وقت الصلاة غير متوفرة: " + path);
      return null;
    }
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacks(autoDismiss);
    super.onDestroy();
  }
}
