package app.thimar.quran;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.SeekBar;
import android.widget.TextView;

import java.io.File;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * شاشة وقت الصلاة: تُعرض تلقائيًا (فوق شاشة القفل) عند دخول وقت الصلاة،
 * وتعرض العمل الفني للصلاة مع اسمها ووقتها، وأدوات التحكم بالأذان،
 * وأزرار الإيقاف والإغلاق. تعمل على مختلف أحجام الشاشات عبر أوزان مرنة.
 *
 * لا تُفتح إلا من داخل التطبيق (إشعار وقت الصلاة) وهي غير مُصدَّرة للخارج.
 */
public class AdhanScreenActivity extends Activity {
  /** تُغلق الشاشة تلقائيًا بعد هذه المدة إن لم يلمسها المستخدم. */
  private static final long AUTO_DISMISS_MS = 90_000L;

  private static final String[] PRAYER_KEYS = { "fajr", "dhuhr", "asr", "maghrib", "isha" };
  private static final String[] PRAYER_NAMES = { "الفجر", "الظهر", "العصر", "المغرب", "العشاء" };

  private final Handler handler = new Handler(Looper.getMainLooper());
  private long dismissAt = 0;
  private ImageButton toggleButton;

  private final Runnable autoDismiss = new Runnable() {
    @Override
    public void run() {
      if (System.currentTimeMillis() >= dismissAt) {
        finish();
        return;
      }
      updateHint();
      handler.postDelayed(this, 1000);
    }
  };

  private final Runnable playbackWatcher = new Runnable() {
    @Override
    public void run() {
      updateToggleIcon();
      handler.postDelayed(this, 700);
    }
  };

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    showOverLockScreen();
    setContentView(R.layout.activity_adhan_screen);
    LaunchLog.init(this);
    LaunchLog.add(this, "شاشة وقت الصلاة: عرض");

    Intent intent = getIntent();
    if (intent != null) {
      populate(intent);
      ensureAdhanPlaying(intent);
    }

    View root = findViewById(R.id.adhan_root);
    if (root != null) {
      /* لمس الشاشة يؤجّل الإغلاق التلقائي ولا يُغلقها فورًا. */
      root.setOnTouchListener(new View.OnTouchListener() {
        @Override
        public boolean onTouch(View view, MotionEvent event) {
          if (event.getActionMasked() == MotionEvent.ACTION_DOWN) resetDismissTimer();
          return false;
        }
      });
    }

    ImageButton close = (ImageButton) findViewById(R.id.adhan_close);
    if (close != null) {
      close.setOnClickListener(new View.OnClickListener() {
        @Override
        public void onClick(View view) {
          finish();
        }
      });
    }

    View stop = findViewById(R.id.adhan_stop);
    if (stop != null) {
      stop.setOnClickListener(new View.OnClickListener() {
        @Override
        public void onClick(View view) {
          AdhanService.stop(AdhanScreenActivity.this);
          finish();
        }
      });
    }

    toggleButton = (ImageButton) findViewById(R.id.adhan_toggle);
    if (toggleButton != null) {
      toggleButton.setOnClickListener(new View.OnClickListener() {
        @Override
        public void onClick(View view) {
          if (!AdhanService.isRunning()) {
            ensureAdhanPlaying(getIntent());
          } else {
            AdhanService.toggle(AdhanScreenActivity.this);
          }
          handler.postDelayed(new Runnable() {
            @Override
            public void run() {
              updateToggleIcon();
            }
          }, 250);
        }
      });
    }

    SeekBar volume = (SeekBar) findViewById(R.id.adhan_volume);
    if (volume != null) {
      int initial = Math.round(AdhanScheduler.prefs(this).getFloat(AdhanScheduler.KEY_VOLUME, 0.9f) * 100);
      volume.setProgress(Math.min(100, Math.max(0, initial)));
      volume.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
        @Override
        public void onProgressChanged(SeekBar bar, int value, boolean fromUser) {
          if (!fromUser) return;
          AdhanService.setVolume(AdhanScreenActivity.this, value / 100f);
          AdhanScheduler.prefs(AdhanScreenActivity.this).edit()
              .putFloat(AdhanScheduler.KEY_VOLUME, value / 100f).apply();
        }

        @Override
        public void onStartTrackingTouch(SeekBar bar) {}

        @Override
        public void onStopTrackingTouch(SeekBar bar) {}
      });
    }

    /* عند تعطيل الصوت لا نعرض أدوات صوتية وهمية. */
    if (intent == null || !intent.getBooleanExtra("sound", false)) {
      if (toggleButton != null) toggleButton.setVisibility(View.GONE);
      if (volume != null) volume.setVisibility(View.GONE);
      if (stop != null) stop.setVisibility(View.GONE);
      View volumeLabel = findViewById(R.id.adhan_hint);
      if (volumeLabel != null) {
        ((TextView) volumeLabel).setText("اضغط زر الإغلاق للعودة");
      }
    }

    resetDismissTimer();
    handler.post(playbackWatcher);
    updateToggleIcon();
  }

  private void resetDismissTimer() {
    dismissAt = System.currentTimeMillis() + AUTO_DISMISS_MS;
    handler.removeCallbacks(autoDismiss);
    handler.postDelayed(autoDismiss, 1000);
    updateHint();
  }

  private void updateHint() {
    TextView hint = (TextView) findViewById(R.id.adhan_hint);
    if (hint == null) return;
    long seconds = Math.max(0, (dismissAt - System.currentTimeMillis()) / 1000);
    hint.setText("يُغلق تلقائيًا خلال " + formatArabicNumber(seconds) + " ثانية — أو استخدم زر الإغلاق");
  }

  /** أرقام عربية هندية بسيطة لعرض العدّاد. */
  private static String formatArabicNumber(long value) {
    String digits = String.valueOf(value);
    char[] arabic = { '٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩' };
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < digits.length(); i++) {
      char c = digits.charAt(i);
      out.append(c >= '0' && c <= '9' ? arabic[c - '0'] : c);
    }
    return out.toString();
  }

  private void updateToggleIcon() {
    if (toggleButton == null) return;
    boolean paused = AdhanService.isRunning() && AdhanService.isPaused();
    toggleButton.setImageResource(paused ? R.drawable.ic_adhan_play : R.drawable.ic_adhan_pause);
    toggleButton.setContentDescription(getString(paused ? R.string.adhan_resume : R.string.adhan_pause));
  }

  /** يضمن تشغيل الأذان حتى لو تعذّر على المستقبل بدء الخدمة (مثلاً فتح الشاشة يدويًا). */
  private void ensureAdhanPlaying(Intent intent) {
    if (intent == null) return;
    boolean sound = intent.getBooleanExtra("sound", false);
    String url = intent.getStringExtra("url");
    if (!sound || url == null || url.trim().isEmpty()) return;
    if (AdhanService.isRunning()) return;
    try {
      Intent service = AdhanService.startIntent(
          this,
          intent.getStringExtra("prayer"),
          intent.getStringExtra("name"),
          intent.getStringExtra("time"),
          url,
          intent.getFloatExtra("volume", 0.9f));
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        startForegroundService(service);
      } else {
        startService(service);
      }
    } catch (Exception ignored) {
      // الإشعار يحمل زر إيقاف/عرض بديل.
    }
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
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      getWindow().setDecorFitsSystemWindows(false);
    }
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
    populate(intent);
    ensureAdhanPlaying(intent);
    resetDismissTimer();
    updateToggleIcon();
  }

  /**
   * عند اختفاء الشاشة (إطفاء الشاشة أو فتح تطبيق آخر) تُغلق فورًا
   * حتى لا يبقى الهاتف مستيقظًا بلا داعٍ. الصوت يكمل في خدمته الأمامية.
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
    String key = index >= 0 ? PRAYER_KEYS[index] : "fajr";
    if (prayerName == null || prayerName.trim().isEmpty()) {
      prayerName = index >= 0 ? PRAYER_NAMES[index] : "";
    }

    TextView prayerView = (TextView) findViewById(R.id.adhan_prayer);
    if (prayerView != null) {
      prayerView.setText(prayerName.isEmpty() ? "حان وقت الصلاة" : "صلاة " + prayerName);
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

    TextView phraseView = (TextView) findViewById(R.id.adhan_phrase);
    if (phraseView != null) {
      phraseView.setText(PHRASES[index >= 0 ? index : 0]);
    }

    Bitmap art = decodeArt(key);
    ImageView background = (ImageView) findViewById(R.id.adhan_background);
    if (background != null && art != null) background.setImageBitmap(art);
    ImageView backdrop = (ImageView) findViewById(R.id.adhan_backdrop);
    if (backdrop != null && art != null) backdrop.setImageBitmap(art);
  }

  private static final String[] PHRASES = {
    "بورك فيمن بكّر — صلاة الفجر نور يبدأ به يومك",
    "توقّف عن الدنيا لحظة… لصلاتك سكينة تعيد ترتيب يومك",
    "حافظ على العصر… فهي صلاة من تركها حبط عمله",
    "لحظة غروب… ذنوب تغيب مع دعاء المغرب",
    "اختم يومك بالعشاء… وابدأ ليلك مطمئنًا",
  };

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

  /**
   * يقرأ العمل الفني بالترتيب: النسخة المحمّلة إلى التخزين الدائم،
   * ثم الصورة المضمَّنة في الحزمة (كلاهما يعمل دون إنترنت).
   */
  private Bitmap decodeArt(String key) {
    String resolved = AdhanAssets.resolveImage(this, key);
    if (resolved != null) {
      try {
        if (resolved.startsWith("asset:")) {
          Bitmap bitmap = decodeAsset(resolved.substring("asset:".length()));
          if (bitmap != null) {
            LaunchLog.add(this, "صورة الصلاة: " + resolved + " (" + bitmap.getWidth() + "x" + bitmap.getHeight() + ")");
            return bitmap;
          }
        } else {
          File file = new File(resolved);
          if (file.isFile()) {
            Bitmap bitmap = decodeFile(file);
            if (bitmap != null) {
              LaunchLog.add(this, "صورة الصلاة: " + resolved + " (" + bitmap.getWidth() + "x" + bitmap.getHeight() + ")");
              return bitmap;
            }
          }
        }
      } catch (Exception error) {
        LaunchLog.add(this, "تعذّر تحميل صورة الصلاة: " + resolved);
      }
    }
    Bitmap fallback = decodeAsset("www/adhan/prayer/" + key + ".jpg");
    LaunchLog.add(this, "صورة الصلاة: " + (fallback == null ? "غير متاحة" : "احتياطية مضمَّنة " + key));
    return fallback;
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
      BitmapFactory.Options options = new BitmapFactory.Options();
      options.inSampleSize = sampleSize(bounds);
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

  /** يقرأ الصورة المحمّلة إلى التخزين الدائم. */
  private Bitmap decodeFile(File file) {
    try {
      BitmapFactory.Options bounds = new BitmapFactory.Options();
      bounds.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
      BitmapFactory.Options options = new BitmapFactory.Options();
      options.inSampleSize = sampleSize(bounds);
      return BitmapFactory.decodeFile(file.getAbsolutePath(), options);
    } catch (Exception error) {
      return null;
    }
  }

  private static int sampleSize(BitmapFactory.Options bounds) {
    int widest = Math.max(bounds.outWidth, bounds.outHeight);
    int sample = 1;
    while (widest > 0 && widest / sample > 1600) sample *= 2;
    return sample;
  }

  @Override
  protected void onResume() {
    super.onResume();
    showOverLockScreen();
    handler.removeCallbacks(playbackWatcher);
    handler.post(playbackWatcher);
  }

  @Override
  protected void onPause() {
    handler.removeCallbacks(playbackWatcher);
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    super.onDestroy();
  }
}
