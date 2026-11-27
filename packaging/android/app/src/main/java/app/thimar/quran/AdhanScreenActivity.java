package app.thimar.quran;

import android.app.Activity;
import android.content.Intent;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * شاشة وقت الصلاة: تُعرض تلقائيًا فوق التطبيقات الأخرى (بعد منح إذن
 * «العرض فوق التطبيقات») وتُضيء الشاشة وتظهر فوق شاشة القفل.
 *
 * التصميم بالكامل من AdhanWindowView: بلا أي صورة، ولكل صلاة لونها وزخرفتها
 * وعبارتها. أزرار الصوت في الهاتف تكتم الأذان إن كان الخيار مفعّلًا في الإعدادات.
 */
public class AdhanScreenActivity extends Activity implements AdhanWindowView.Actions {
  /** تُغلق الشاشة تلقائيًا بعد هذه المدة إن لم يلمسها المستخدم. */
  private static final long AUTO_DISMISS_MS = 90_000L;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private AdhanWindowView card;
  private long dismissAt = 0;
  private boolean muted = false;
  private float restoreVolume = 0.9f;
  private boolean volumeKeyMute = true;
  private boolean soundEnabled = false;

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
      if (card != null) card.setPaused(AdhanService.isRunning() && AdhanService.isPaused());
      handler.postDelayed(this, 900);
    }
  };

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    showOverLockScreen();
    setContentView(R.layout.activity_adhan_screen);
    LaunchLog.init(this);
    LaunchLog.add(this, "شاشة وقت الصلاة: عرض");

    volumeKeyMute = AdhanScheduler.prefs(this).getBoolean(AdhanScheduler.KEY_VOLUME_KEY_MUTE, true);

    card = new AdhanWindowView(this);
    card.setFill(true);
    card.setActions(this);
    LinearLayout host = (LinearLayout) findViewById(R.id.adhan_host);
    if (host != null) {
      host.addView(card, new LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    }

    FrameLayout root = (FrameLayout) findViewById(R.id.adhan_root);
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

    Intent intent = getIntent();
    if (intent != null) {
      populate(intent);
      ensureAdhanPlaying(intent);
    }

    resetDismissTimer();
    handler.post(playbackWatcher);
  }

  private void resetDismissTimer() {
    dismissAt = System.currentTimeMillis() + AUTO_DISMISS_MS;
    handler.removeCallbacks(autoDismiss);
    handler.postDelayed(autoDismiss, 1000);
    updateHint();
  }

  private void updateHint() {
    if (card == null) return;
    if (!soundEnabled) {
      card.setHint(getString(R.string.adhan_close_hint));
      return;
    }
    long seconds = Math.max(0, (dismissAt - System.currentTimeMillis()) / 1000);
    String countdown = getString(R.string.adhan_dismiss_seconds, formatArabicNumber(seconds));
    if (muted) {
      card.setHint(getString(R.string.adhan_muted) + " • " + countdown);
    } else if (volumeKeyMute && AdhanService.isRunning()) {
      card.setHint(getString(R.string.adhan_volume_key_hint) + " • " + countdown);
    } else {
      card.setHint(countdown);
    }
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

  /**
   * أزرار الصوت في الهاتف: عند تفعيل الخيار في الإعدادات يكتم الزر الأذان
   * بدل تغيير صوت الرنين، والضغط مرة أخرى يستأنف الصوت.
   */
  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (isVolumeKey(keyCode) && shouldMuteWithVolumeKey()) {
      toggleMute();
      return true;
    }
    return super.onKeyDown(keyCode, event);
  }

  @Override
  public boolean onKeyUp(int keyCode, KeyEvent event) {
    if (isVolumeKey(keyCode) && shouldMuteWithVolumeKey()) return true;
    return super.onKeyUp(keyCode, event);
  }

  private static boolean isVolumeKey(int keyCode) {
    return keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN;
  }

  private boolean shouldMuteWithVolumeKey() {
    return volumeKeyMute && soundEnabled && AdhanService.isRunning();
  }

  private void toggleMute() {
    float saved = AdhanScheduler.prefs(this).getFloat(AdhanScheduler.KEY_VOLUME, 0.9f);
    if (!muted) {
      restoreVolume = saved > 0.01f ? saved : 0.9f;
      AdhanService.setVolume(this, 0f);
      muted = true;
      if (card != null) card.setVolumeValue(0);
      LaunchLog.add(this, "شاشة وقت الصلاة: كتم الأذان بزر الصوت");
    } else {
      AdhanService.setVolume(this, restoreVolume);
      muted = false;
      if (card != null) card.setVolumeValue(Math.round(restoreVolume * 100));
      LaunchLog.add(this, "شاشة وقت الصلاة: استئناف الأذان بزر الصوت");
    }
    resetDismissTimer();
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
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
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
    soundEnabled = intent != null && intent.getBooleanExtra("sound", false);

    AdhanWindowView.Data data = new AdhanWindowView.Data();
    data.prayer = AdhanWindowView.normalizePrayer(prayerKey);
    data.name = prayerName == null ? "" : prayerName;
    String shown = time == null ? "" : time.trim();
    data.time = shown.isEmpty() ? new SimpleDateFormat("HH:mm", Locale.US).format(new Date()) : shown;
    data.city = AdhanScheduler.prefs(this).getString(AdhanScheduler.KEY_CITY, "");
    data.lang = "en".equalsIgnoreCase(AdhanScheduler.prefs(this).getString(AdhanScheduler.KEY_LANG, "ar"))
        ? AdhanWindowView.LANG_EN
        : AdhanWindowView.LANG_AR;
    String theme = AdhanScheduler.prefs(this).getString(AdhanScheduler.KEY_THEME, "");
    data.theme = theme == null || theme.trim().isEmpty() ? AdhanScheduler.theme(this) : theme;
    data.sound = soundEnabled;

    if (card != null) {
      card.bind(data, false);
      float volume = AdhanScheduler.prefs(this).getFloat(AdhanScheduler.KEY_VOLUME, 0.9f);
      card.setVolumeValue(Math.round(volume * 100));
      card.setPaused(AdhanService.isRunning() && AdhanService.isPaused());
    }
    applyBackground(data.prayer, data.theme);
  }

  /** خلفية متدرجة خاصة بكل صلاة: الفجر نيلي، الظهر زمردي، العصر عنبري، المغرب وردي، العشاء بنفسجي. */
  private void applyBackground(String prayerKey, String theme) {
    int[] colors = AdhanWindowView.windowColors(
        prayerKey, AdhanWindowView.isFriday(), AdhanWindowView.lightTheme(this, theme));
    GradientDrawable background = new GradientDrawable(GradientDrawable.Orientation.TL_BR, colors);
    View root = findViewById(R.id.adhan_root);
    if (root != null) root.setBackground(background);
  }

  // ------------------------------------------------------------ Actions

  @Override
  public void onClose() {
    finish();
  }

  @Override
  public void onOpen() {
    finish();
  }

  @Override
  public void onToggleAudio() {
    if (!AdhanService.isRunning()) {
      ensureAdhanPlaying(getIntent());
    } else {
      AdhanService.toggle(this);
    }
    handler.postDelayed(new Runnable() {
      @Override
      public void run() {
        if (card != null) card.setPaused(AdhanService.isPaused());
        updateHint();
      }
    }, 250);
  }

  @Override
  public void onStopAudio() {
    AdhanService.stop(this);
    finish();
  }

  @Override
  public void onVolume(float value) {
    AdhanService.setVolume(this, value);
    AdhanScheduler.prefs(this).edit().putFloat(AdhanScheduler.KEY_VOLUME, value).apply();
    muted = value <= 0.01f;
    updateHint();
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
