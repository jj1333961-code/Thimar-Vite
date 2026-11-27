package app.thimar.quran;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.os.Parcelable;
import android.os.ResultReceiver;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.app.NotificationCompat;

/**
 * نافذة ثمار العائمة فوق التطبيقات الأخرى.
 *
 * لا تُنشأ النافذة إلا بعد منح SYSTEM_ALERT_WINDOW. لها وضعان:
 * - نافذة الأذان المصغّرة: نفس محتوى شاشة الصلاة (اسم، وقت، تاريخان، شعار)
 *   مبنية برمجيًا عبر AdhanWindowView، وتُفتح بالضغط على شاشة الصلاة الكاملة.
 * - النافذة العامة: بطاقة ثمار الصغيرة القابلة للسحب.
 * تُزال النافذة فورًا عند سحب الإذن أو إغلاق الخدمة.
 */
public final class FloatingOverlayService extends Service {
  public static final String ACTION_SHOW = "app.thimar.quran.overlay.SHOW";
  public static final String ACTION_SHOW_ADHAN = "app.thimar.quran.overlay.SHOW_ADHAN";
  public static final String ACTION_HIDE = "app.thimar.quran.overlay.HIDE";

  /** نتيجة عرض النافذة العائمة: تسمح للمستقبل بفتح الشاشة الكاملة عند الفشل. */
  public static final int RESULT_OK = 1;
  public static final int RESULT_FAILED = 2;

  private static final String EXTRA_RESULT = "overlay_result";
  private static final String CHANNEL_OVERLAY = "thimar_adhan_overlay";
  private static final int NOTIFICATION_ID = 4300;

  private static volatile boolean showing = false;

  private WindowManager windowManager;
  private View overlayView;
  private WindowManager.LayoutParams overlayParams;
  private AdhanWindowView.Data adhanData;

  public static boolean canDrawOverlays(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
    try {
      return Settings.canDrawOverlays(context);
    } catch (Exception ignored) {
      return false;
    }
  }

  public static boolean isShowing() {
    return showing;
  }

  /** يبدأ الخدمة من نشاط ظاهر فقط؛ لا يظهر شيء إن لم يكن الإذن ممنوحاً. */
  public static boolean show(Context context) {
    if (context == null || !canDrawOverlays(context)) return false;
    try {
      Intent intent = new Intent(context, FloatingOverlayService.class).setAction(ACTION_SHOW);
      context.startService(intent);
      return true;
    } catch (Exception error) {
      LaunchLog.add(context, "FloatingOverlayService.show: " + error.getMessage());
      return false;
    }
  }

  /**
   * يعرض نافذة الأذان العائمة بنفس بيانات الصلاة الحقيقية.
   * لا شيء يظهر إن لم يكن إذن الظهور فوق التطبيقات ممنوحًا.
   */
  public static boolean showAdhan(Context context, String prayer, String name, String time,
      String lang, String city, boolean sound) {
    return showAdhan(context, prayer, name, time, lang, city, sound, null);
  }

  /**
   * يعرض نافذة الأذان العائمة ويُبلّغ عبر ResultReceiver عند فشل addView،
   * فيتمكن مستقبل المنبه من فتح شاشة الصلاة الكاملة بدل نافذة صامتة.
   */
  public static boolean showAdhan(Context context, String prayer, String name, String time,
      String lang, String city, boolean sound, ResultReceiver result) {
    if (context == null || !canDrawOverlays(context)) return false;
    try {
      Intent intent = new Intent(context, FloatingOverlayService.class).setAction(ACTION_SHOW_ADHAN);
      intent.putExtra("prayer", prayer);
      intent.putExtra("name", name);
      intent.putExtra("time", time);
      intent.putExtra("lang", lang);
      intent.putExtra("city", city);
      intent.putExtra("sound", sound);
      if (result != null) intent.putExtra(EXTRA_RESULT, result);
      /* خدمة أمامية: تمنع النظام من قتل النافذة أثناء عرضها فوق تطبيق آخر. */
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent);
      } else {
        context.startService(intent);
      }
      return true;
    } catch (Exception error) {
      LaunchLog.add(context, "FloatingOverlayService.showAdhan: " + error.getMessage());
      return false;
    }
  }

  public static void hide(Context context) {
    if (context == null) return;
    try {
      context.stopService(new Intent(context, FloatingOverlayService.class));
    } catch (Exception ignored) {
      // الخدمة لم تكن تعمل.
    }
  }

  /** عند العودة من إعدادات النظام: يزيل النافذة إن سُحب الإذن. */
  public static void stopIfPermissionRevoked(Context context) {
    if (context != null && !canDrawOverlays(context)) hide(context);
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? ACTION_SHOW : intent.getAction();
    if (ACTION_HIDE.equals(action)) {
      hideOverlay();
      stopSelf();
      return START_NOT_STICKY;
    }
    boolean adhan = ACTION_SHOW_ADHAN.equals(action);
    if (adhan && !startOverlayForeground(intent)) return START_NOT_STICKY;
    if (!canDrawOverlays(this)) {
      LaunchLog.add(this, "النافذة العائمة: إذن الظهور فوق التطبيقات غير ممنوح");
      sendResult(intent, false);
      hideOverlay();
      stopSelf();
      return START_NOT_STICKY;
    }
    if (adhan) {
      addAdhanOverlay(intent);
    } else {
      addGenericOverlay();
    }
    return START_NOT_STICKY;
  }

  /** إشعار منخفض الأهمية لا يُصدر صوتًا ولا يزاحم إشعار الأذان الأساسي. */
  private boolean startOverlayForeground(Intent intent) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null && nm.getNotificationChannel(CHANNEL_OVERLAY) == null) {
          NotificationChannel channel = new NotificationChannel(
              CHANNEL_OVERLAY, "نافذة الأذان العائمة", NotificationManager.IMPORTANCE_MIN);
          channel.setDescription("تبقي نافذة وقت الصلاة ظاهرة فوق التطبيقات الأخرى.");
          channel.setSound(null, null);
          channel.enableVibration(false);
          channel.setShowBadge(false);
          channel.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
          nm.createNotificationChannel(channel);
        }
      }
      Intent open = new Intent(this, WebFallbackActivity.class);
      open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
          | Intent.FLAG_ACTIVITY_CLEAR_TOP
          | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      PendingIntent openPi = PendingIntent.getActivity(this, NOTIFICATION_ID, open,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      Notification notification = new NotificationCompat.Builder(this, CHANNEL_OVERLAY)
          .setSmallIcon(R.drawable.ic_stat_thimar)
          .setContentTitle("نافذة الأذان")
          .setContentText("وقت الصلاة ظاهر فوق التطبيقات")
          .setPriority(NotificationCompat.PRIORITY_LOW)
          .setCategory(NotificationCompat.CATEGORY_SERVICE)
          .setOngoing(true)
          .setSilent(true)
          .setContentIntent(openPi)
          .build();
      startForeground(NOTIFICATION_ID, notification);
      return true;
    } catch (Exception error) {
      LaunchLog.add(this, "FloatingOverlayService.startForeground: " + error.getMessage());
      sendResult(intent, false);
      stopSelf();
      return false;
    }
  }

  // ------------------------------------------------------ نافذة الأذان

  private void addAdhanOverlay(Intent intent) {
    hideOverlay();
    windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    if (windowManager == null) {
      sendResult(intent, false);
      stopSelf();
      return;
    }

    AdhanWindowView.Data data = new AdhanWindowView.Data();
    data.prayer = intent == null ? "fajr" : intent.getStringExtra("prayer");
    data.name = intent == null ? "" : intent.getStringExtra("name");
    data.time = intent == null ? "" : intent.getStringExtra("time");
    data.city = intent == null ? "" : intent.getStringExtra("city");
    data.theme = AdhanScheduler.theme(this);
    data.sound = false;
    String lang = intent == null ? null : intent.getStringExtra("lang");
    data.lang = AdhanWindowView.LANG_EN.equalsIgnoreCase(lang)
        ? AdhanWindowView.LANG_EN
        : AdhanWindowView.LANG_AR;
    adhanData = data;

    AdhanWindowView card = new AdhanWindowView(this);
    card.setActions(new AdhanWindowView.Actions() {
      @Override
      public void onClose() {
        hideOverlay();
        stopSelf();
      }

      @Override
      public void onOpen() {
        openAdhanScreen();
      }

      @Override
      public void onToggleAudio() {
        // النافذة المصغّرة للعرض؛ التحكم بالصوت في شاشة الصلاة الكاملة.
      }

      @Override
      public void onStopAudio() {
        // لا شيء.
      }

      @Override
      public void onVolume(float value) {
        // لا شيء.
      }
    });
    card.bind(data, true);

    /* عرض متكيّف: لا يغطي حواف الشاشة ولا شريط التنقل، ويبقى مقروءًا. */
    int screenWidth = getResources().getDisplayMetrics().widthPixels;
    int width = Math.min(dp(400), Math.max(dp(260), screenWidth - dp(36)));
    overlayParams = new WindowManager.LayoutParams(
        width,
        WindowManager.LayoutParams.WRAP_CONTENT,
        overlayType(),
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT);
    overlayParams.gravity = Gravity.TOP | Gravity.START;
    overlayParams.x = Math.max(dp(10), (screenWidth - width) / 2);
    overlayParams.y = dp(12);

    boolean attached = attachWithDrag(card);
    sendResult(intent, attached);
    if (attached) {
      LaunchLog.add(this, "نافذة الأذان العائمة: عرض " + data.prayer + " " + data.time);
    } else {
      LaunchLog.add(this, "نافذة الأذان العائمة: تعذّر إضافة النافذة");
      stopSelf();
    }
  }

  private void openAdhanScreen() {
    try {
      Intent intent = new Intent(this, AdhanScreenActivity.class);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
          | Intent.FLAG_ACTIVITY_CLEAR_TOP
          | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      AdhanWindowView.Data data = adhanData == null ? new AdhanWindowView.Data() : adhanData;
      intent.putExtra("prayer", data.prayer);
      intent.putExtra("name", data.name);
      intent.putExtra("time", data.time);
      intent.putExtra("lang", data.lang);
      intent.putExtra("city", data.city);
      intent.putExtra("sound", false);
      startActivity(intent);
      hideOverlay();
      stopSelf();
    } catch (Exception error) {
      LaunchLog.add(this, "نافذة الأذان العائمة: تعذّر فتح الشاشة — " + error.getMessage());
    }
  }

  // ------------------------------------------------------ النافذة العامة

  private void addGenericOverlay() {
    hideOverlay();
    windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    if (windowManager == null) return;

    overlayParams = new WindowManager.LayoutParams(
        dp(244),
        WindowManager.LayoutParams.WRAP_CONTENT,
        overlayType(),
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT);
    overlayParams.gravity = Gravity.TOP | Gravity.START;
    overlayParams.x = dp(18);
    overlayParams.y = dp(180);

    LinearLayout card = new LinearLayout(this);
    card.setOrientation(LinearLayout.VERTICAL);
    card.setPadding(dp(16), dp(13), dp(16), dp(13));
    GradientDrawable background = new GradientDrawable();
    background.setColor(Color.rgb(28, 58, 47));
    background.setCornerRadius(dp(18));
    background.setStroke(dp(1), Color.rgb(216, 178, 90));
    card.setBackground(background);
    card.setElevation(dp(8));

    TextView title = new TextView(this);
    title.setText("ثمار");
    title.setTextColor(Color.rgb(240, 215, 156));
    title.setTextSize(18);
    title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
    title.setGravity(Gravity.START);
    title.setPadding(0, 0, 0, dp(3));
    title.setContentDescription("نافذة ثمار العائمة — اسحب للتحريك");
    card.addView(title);

    TextView subtitle = new TextView(this);
    subtitle.setText("نافذة عائمة — تعمل فوق التطبيقات الأخرى");
    subtitle.setTextColor(Color.rgb(220, 232, 225));
    subtitle.setTextSize(12);
    subtitle.setPadding(0, 0, 0, dp(10));
    card.addView(subtitle);

    LinearLayout actions = new LinearLayout(this);
    actions.setOrientation(LinearLayout.HORIZONTAL);
    actions.setGravity(Gravity.END);

    Button open = new Button(this);
    open.setText("فتح ثمار");
    open.setTextSize(12);
    open.setAllCaps(false);
    open.setOnClickListener(view -> openApp());
    actions.addView(open);

    Button close = new Button(this);
    close.setText("إغلاق");
    close.setTextSize(12);
    close.setAllCaps(false);
    close.setOnClickListener(view -> {
      hideOverlay();
      stopSelf();
    });
    actions.addView(close);
    card.addView(actions);

    attachWithDrag(card);
  }

  /**
   * يضيف النافذة ويجعل السحب من الترويسة فقط، مع إبقائها داخل حدود الشاشة
   * كي لا تغطي شريط التنقل أو تخرج عن الحواف. الضغط بلا سحب يفتح الإجراء.
   */
  private boolean attachWithDrag(View card) {
    View handle = card instanceof AdhanWindowView
        ? ((AdhanWindowView) card).getDragHandle()
        : (card instanceof LinearLayout && ((LinearLayout) card).getChildCount() > 0
            ? ((LinearLayout) card).getChildAt(0)
            : card);

    handle.setOnTouchListener(new View.OnTouchListener() {
      private float downX;
      private float downY;
      private int startX;
      private int startY;
      private boolean moved;

      @Override
      public boolean onTouch(View view, MotionEvent event) {
        switch (event.getActionMasked()) {
          case MotionEvent.ACTION_DOWN:
            downX = event.getRawX();
            downY = event.getRawY();
            startX = overlayParams.x;
            startY = overlayParams.y;
            moved = false;
            return true;
          case MotionEvent.ACTION_MOVE:
            float dx = event.getRawX() - downX;
            float dy = event.getRawY() - downY;
            if (Math.abs(dx) > dp(4) || Math.abs(dy) > dp(4)) moved = true;
            overlayParams.x = clampX(startX + Math.round(dx), card.getWidth());
            overlayParams.y = clampY(startY + Math.round(dy), card.getHeight());
            try {
              windowManager.updateViewLayout(card, overlayParams);
            } catch (Exception ignored) {
              // قد تُزال النافذة أثناء السحب.
            }
            return true;
          case MotionEvent.ACTION_UP:
            if (!moved) view.performClick();
            return true;
          default:
            return false;
        }
      }
    });
    handle.setOnClickListener(view -> {
      if (card instanceof AdhanWindowView) {
        openAdhanScreen();
      } else {
        openApp();
      }
    });

    try {
      windowManager.addView(card, overlayParams);
      overlayView = card;
      showing = true;
      return true;
    } catch (Exception error) {
      LaunchLog.add(this, "FloatingOverlayService.addView: " + error.getMessage());
      overlayView = null;
      showing = false;
      return false;
    }
  }

  /** يُبلّغ مستقبل المنبه بنتيجة العرض؛ لا يفعل شيئًا لطلبات الواجهة العادية. */
  @SuppressWarnings("deprecation")
  private void sendResult(Intent intent, boolean ok) {
    if (intent == null) return;
    Parcelable extra = intent.getParcelableExtra(EXTRA_RESULT);
    if (extra instanceof ResultReceiver) {
      try {
        ((ResultReceiver) extra).send(ok ? RESULT_OK : RESULT_FAILED, null);
      } catch (Exception error) {
        LaunchLog.add(this, "FloatingOverlayService.sendResult: " + error.getMessage());
      }
    }
  }

  private int overlayType() {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        : WindowManager.LayoutParams.TYPE_PHONE;
  }

  private int clampX(int value, int cardWidth) {
    int width = cardWidth > 0 ? cardWidth : dp(300);
    int screenWidth = getResources().getDisplayMetrics().widthPixels;
    return Math.max(dp(6), Math.min(value, Math.max(dp(6), screenWidth - width - dp(6))));
  }

  private int clampY(int value, int cardHeight) {
    int height = cardHeight > 0 ? cardHeight : dp(240);
    int screenHeight = getResources().getDisplayMetrics().heightPixels;
    return Math.max(dp(6), Math.min(value, Math.max(dp(6), screenHeight - height - navBarHeight() - dp(6))));
  }

  private int navBarHeight() {
    int id = getResources().getIdentifier("navigation_bar_height", "dimen", "android");
    return id > 0 ? getResources().getDimensionPixelSize(id) : dp(48);
  }

  private void openApp() {
    try {
      Intent intent = new Intent(this, WebFallbackActivity.class);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
          | Intent.FLAG_ACTIVITY_CLEAR_TOP
          | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      startActivity(intent);
    } catch (Exception error) {
      LaunchLog.add(this, "FloatingOverlayService.openApp: " + error.getMessage());
    }
  }

  private void hideOverlay() {
    if (overlayView != null && windowManager != null) {
      try {
        windowManager.removeView(overlayView);
      } catch (Exception ignored) {
        // أزالتها نافذة النظام بالفعل.
      }
    }
    overlayView = null;
    showing = false;
  }

  @Override
  public void onDestroy() {
    hideOverlay();
    adhanData = null;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE);
    } else {
      stopForeground(true);
    }
    super.onDestroy();
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }
}
