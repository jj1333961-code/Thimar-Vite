package app.thimar.quran;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * خدمة أمامية تشغّل الأذان في الخلفية (والتطبيق مغلق) وتحافظ على استيقاظ المعالج.
 * تُشغَّل من AdhanAlarmReceiver، وتُوقف من زر «إيقاف الأذان» في شاشة الصلاة
 * أو من إجراء الإشعار.
 */
public class AdhanService extends Service {
  private static final String TAG = "ThimarAdhan";
  private static final String CHANNEL_ID = "thimar_adhan_service";
  private static final int NOTIFICATION_ID = 7301;
  /** أقصى مدة لانتظار تجهيز الصوت قبل إيقاف الخدمة (يمنع بقاء إشعار عالق). */
  private static final long PREPARE_TIMEOUT_MS = 20_000L;

  public static final String ACTION_START = "app.thimar.quran.adhan.START";
  public static final String ACTION_STOP = "app.thimar.quran.adhan.STOP";
  public static final String ACTION_TOGGLE = "app.thimar.quran.adhan.TOGGLE";
  public static final String ACTION_VOLUME = "app.thimar.quran.adhan.VOLUME";
  public static final String EXTRA_URL = "url";
  public static final String EXTRA_VOLUME = "volume";
  public static final String EXTRA_PRAYER = "prayer";
  public static final String EXTRA_NAME = "name";
  public static final String EXTRA_TIME = "time";

  private static volatile boolean running = false;
  private static volatile boolean paused = false;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private MediaPlayer player;
  private boolean prepared = false;
  /** المصدر الحالي: يمنع إعادة تشغيل نفس الأذان عند وصول أمر بدء مكرر. */
  private String currentSource;
  private float currentVolume = 0.9f;
  private PowerManager.WakeLock wakeLock;
  private AudioManager audioManager;
  private AudioFocusRequest focusRequest;
  /** إن لم يجهز المشغّل خلال المهلة نوقف الخدمة بدل إبقاء الأذان معلّقًا. */
  private final Runnable prepareTimeout = new Runnable() {
    @Override
    public void run() {
      if (running || prepared) return;
      LaunchLog.add(AdhanService.this, "مهلة تجهيز الأذان (20 ثانية) — إيقاف الخدمة");
      Log.w(TAG, "MediaPlayer prepare timeout");
      stopSelf();
    }
  };

  private final AudioManager.OnAudioFocusChangeListener focusListener = focusChange -> {
    if (focusChange == AudioManager.AUDIOFOCUS_LOSS
        || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
      stopSelf();
    }
  };

  public static boolean isRunning() {
    return running;
  }

  public static boolean isPaused() {
    return paused;
  }

  /** تبديل التشغيل/الإيقاف المؤقت من شاشة الصلاة. */
  public static void toggle(Context context) {
    if (!running) return;
    try {
      Intent intent = new Intent(context, AdhanService.class);
      intent.setAction(ACTION_TOGGLE);
      context.startService(intent);
    } catch (Exception ignored) {
      // تبقى الشاشة صالحة.
    }
  }

  /** ضبط مستوى الصوت من شاشة الصلاة. */
  public static void setVolume(Context context, float volume) {
    try {
      Intent intent = new Intent(context, AdhanService.class);
      intent.setAction(ACTION_VOLUME);
      intent.putExtra(EXTRA_VOLUME, volume);
      context.startService(intent);
    } catch (Exception ignored) {
      // تجاهل.
    }
  }

  /** يبني Intent بدء التشغيل مع كل بيانات الأذان. */
  public static Intent startIntent(Context context, String prayer, String name, String time, String url, float volume) {
    Intent intent = new Intent(context, AdhanService.class);
    intent.setAction(ACTION_START);
    intent.putExtra(EXTRA_PRAYER, prayer);
    intent.putExtra(EXTRA_NAME, name);
    intent.putExtra(EXTRA_TIME, time);
    intent.putExtra(EXTRA_URL, url);
    intent.putExtra(EXTRA_VOLUME, volume);
    return intent;
  }

  /** إيقاف الأذان من أي مكان (شاشة الصلاة أو الإشعار). */
  public static void stop(Context context) {
    try {
      Intent intent = new Intent(context, AdhanService.class);
      intent.setAction(ACTION_STOP);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent);
      } else {
        context.startService(intent);
      }
    } catch (Exception ignored) {
      try {
        context.stopService(new Intent(context, AdhanService.class));
      } catch (Exception ignoredToo) {
        // لا شيء آخر يمكن فعله.
      }
    }
  }

  @Override
  public void onCreate() {
    super.onCreate();
    audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? null : intent.getAction();
    // يجب استدعاء startForeground فورًا عند البدء بـ startForegroundService (أندرويد 8+)
    // حتى لأوامر الإيقاف/التبديل القادمة من الشاشة أو الإشعار.
    startForeground(NOTIFICATION_ID, buildNotification(intent));
    if (ACTION_STOP.equals(action)) {
      stopSelf();
      return START_NOT_STICKY;
    }
    if (ACTION_TOGGLE.equals(action)) {
      togglePlayback();
      return START_NOT_STICKY;
    }
    if (ACTION_VOLUME.equals(action)) {
      if (intent != null) {
        setPlaybackVolume(intent.getFloatExtra(EXTRA_VOLUME, currentVolume));
      }
      return START_NOT_STICKY;
    }

    acquireWakeLock();
    requestAudioFocus();

    /*
     * الإشعار وشاشة الصلاة يبدآن الخدمة معًا؛ إن كان نفس الملف قيد التجهيز
     * أو التشغيل فلا نعيد بناء المشغّل من البداية (كان يقطع الأذان ثم يعيده).
     */
    if (ACTION_START.equals(action) && intent != null && player != null) {
      String requested = intent.getStringExtra(EXTRA_URL);
      String resolved = AdhanAssets.resolveAudio(this, requested);
      if (resolved != null && resolved.equals(currentSource)) {
        LaunchLog.add(this, "تجاهل بدء أذان مكرر: " + resolved);
        return START_NOT_STICKY;
      }
    }

    if (intent == null || !startPlayback(intent)) {
      // لا رابط صوت: تُبقى الخدمة حيّة لدعم الشاشة، ثم تُغلق بعد مهلة قصيرة.
      stopSelf();
      return START_NOT_STICKY;
    }
    return START_NOT_STICKY;
  }

  private void togglePlayback() {
    if (player == null) return;
    try {
      if (player.isPlaying()) {
        player.pause();
        paused = true;
      } else {
        player.start();
        paused = false;
      }
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification(null));
    } catch (Exception ignored) {
      // يبقى التشغيل على حاله.
    }
  }

  private void setPlaybackVolume(float volume) {
    currentVolume = Math.min(1f, Math.max(0f, volume));
    if (player != null) {
      try {
        player.setVolume(currentVolume, currentVolume);
      } catch (Exception ignored) {
        // تجاهل.
      }
    }
  }

  private boolean startPlayback(Intent intent) {
    String url = intent.getStringExtra(EXTRA_URL);
    if (url == null || url.trim().isEmpty()) return false;
    /* المصدر المحلي أولًا: يعمل دون إنترنت ولا يتكرر تنزيله. */
    String source = AdhanAssets.resolveAudio(this, url);
    if (source == null || source.trim().isEmpty()) return false;
    float volume = intent.getFloatExtra(EXTRA_VOLUME, 0.9f);
    try {
      releasePlayer();
      currentSource = source;
      player = new MediaPlayer();
      player.setAudioAttributes(new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build());
      player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
      setPlaybackVolume(volume);
      /* المستمعون قبل prepareAsync حتى لا تفوت أي حالة. */
      player.setOnPreparedListener(mp -> {
        handler.removeCallbacks(prepareTimeout);
        prepared = true;
        try {
          mp.start();
          running = true;
          paused = false;
          long seconds = Math.max(0, mp.getDuration()) / 1000L;
          LaunchLog.add(this, "تشغيل الأذان (" + seconds + " ث): " + source);
        } catch (Exception error) {
          LaunchLog.add(this, "تعذّر بدء تشغيل الأذان: " + error.getMessage());
          stopSelf();
        }
      });
      player.setOnCompletionListener(mp -> {
        LaunchLog.add(this, "اكتمل تشغيل الأذان: " + source);
        stopSelf();
      });
      player.setOnErrorListener((mp, what, extra) -> {
        handler.removeCallbacks(prepareTimeout);
        Log.w(TAG, "MediaPlayer error " + what + "/" + extra);
        LaunchLog.add(this, "تعذّر تشغيل صوت الأذان (" + what + "/" + extra + ")");
        /* إن كان الملف المحلي تالفًا نحذفه ليُعاد تنزيله لاحقًا. */
        if (source.startsWith("/")) new java.io.File(source).delete();
        stopSelf();
        return true;
      });
      setDataSource(source);
      player.prepareAsync();
      handler.postDelayed(prepareTimeout, PREPARE_TIMEOUT_MS);
      return true;
    } catch (Exception error) {
      Log.w(TAG, "تعذّر تشغيل الأذان: " + error.getMessage());
      releasePlayer();
      return false;
    }
  }

  /** يدعم الملفات المحلية والروابط البعيدة وأصول الحزمة المضمّنة (www/adhan/*.mp3). */
  private void setDataSource(String url) throws Exception {
    if (url.startsWith("asset:")) {
      openAsset(url.substring("asset:".length()));
      return;
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      player.setDataSource(url);
      return;
    }
    if (url.startsWith("content://") || url.startsWith("file://")) {
      player.setDataSource(this, Uri.parse(url));
      return;
    }
    if (url.startsWith("/")) {
      player.setDataSource(url);
      return;
    }
    String path = url.startsWith("/") ? url.substring(1) : url;
    try {
      AssetFileDescriptor afd = getAssets().openFd("www/" + path);
      try {
        player.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
      } finally {
        afd.close();
      }
      return;
    } catch (Exception ignored) {
      // ليس أصلًا مضمّنًا: جرّب مسارًا مباشرًا.
    }
    try {
      AssetFileDescriptor afd = getAssets().openFd(path);
      try {
        player.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
      } finally {
        afd.close();
      }
    } catch (Exception error) {
      player.setDataSource(this, Uri.parse(url));
    }
  }

  private void openAsset(String path) throws Exception {
    AssetFileDescriptor afd = getAssets().openFd(path);
    try {
      player.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
    } finally {
      afd.close();
    }
  }

  private void acquireWakeLock() {
    if (wakeLock != null && wakeLock.isHeld()) return;
    try {
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      if (pm == null) return;
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "thimar:adhan-audio");
      wakeLock.setReferenceCounted(false);
      wakeLock.acquire(10 * 60 * 1000L);
    } catch (Exception ignored) {
      // يبقى التشغيل ممكنًا دون قفل استيقاظ.
    }
  }

  private void requestAudioFocus() {
    if (audioManager == null) return;
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build())
            .setOnAudioFocusChangeListener(focusListener)
            .build();
        audioManager.requestAudioFocus(focusRequest);
      } else {
        audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN);
      }
    } catch (Exception ignored) {
      // يكمل التشغيل بصوت النظام.
    }
  }

  private void abandonAudioFocus() {
    if (audioManager == null) return;
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
      } else {
        audioManager.abandonAudioFocus(focusListener);
      }
    } catch (Exception ignored) {
      // تجاهل.
    }
    focusRequest = null;
  }

  private void releasePlayer() {
    handler.removeCallbacks(prepareTimeout);
    prepared = false;
    if (player == null) return;
    try {
      if (player.isPlaying()) player.stop();
    } catch (Exception ignored) {
      // تجاهل.
    }
    try {
      player.reset();
      player.release();
    } catch (Exception ignored) {
      // تجاهل.
    }
    player = null;
    currentSource = null;
    running = false;
    paused = false;
  }

  private Notification buildNotification(Intent intent) {
    createChannel();
    String name = intent == null ? null : intent.getStringExtra(EXTRA_NAME);
    String title = "الأذان — " + (name == null || name.trim().isEmpty() ? "حان وقت الصلاة" : name);
    if (paused) title = title + " (متوقف مؤقتًا)";

    Intent screen = new Intent(this, AdhanScreenActivity.class);
    screen.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    if (intent != null) {
      screen.putExtra(EXTRA_PRAYER, intent.getStringExtra(EXTRA_PRAYER));
      screen.putExtra(EXTRA_NAME, intent.getStringExtra(EXTRA_NAME));
      screen.putExtra(EXTRA_TIME, intent.getStringExtra(EXTRA_TIME));
      screen.putExtra("sound", false);
    }
    PendingIntent contentIntent = PendingIntent.getActivity(this, 4100, screen,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Intent stop = new Intent(this, AdhanService.class);
    stop.setAction(ACTION_STOP);
    PendingIntent stopIntent = PendingIntent.getService(this, 4101, stop,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
        .setContentTitle(title)
        .setContentText("اضغط لإيقاف الأذان")
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setOngoing(true)
        .setContentIntent(contentIntent)
        .addAction(0, "إيقاف الأذان", stopIntent);
    return builder.build();
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
    NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "تشغيل الأذان", NotificationManager.IMPORTANCE_LOW);
    channel.setDescription("خدمة تشغيل صوت الأذان");
    channel.setSound(null, null);
    channel.enableVibration(false);
    nm.createNotificationChannel(channel);
  }

  @Override
  public void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    releasePlayer();
    abandonAudioFocus();
    if (wakeLock != null && wakeLock.isHeld()) {
      try {
        wakeLock.release();
      } catch (Exception ignored) {
        // تجاهل.
      }
    }
    wakeLock = null;
    running = false;
    try {
      stopForeground(true);
    } catch (Exception ignored) {
      // تجاهل.
    }
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
