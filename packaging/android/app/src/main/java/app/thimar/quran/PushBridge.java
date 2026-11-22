package app.thimar.quran;

import android.app.Activity;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.google.android.gms.tasks.Task;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.lang.ref.WeakReference;

/**
 * الجسر الأصلي بين صفحة ثمار (WebView) وإشعارات FCM.
 *
 * الواجهة تُستخدم من src/lib/nativePush.ts عبر window.ThimarNative، والأحداث
 * تصل إلى الصفحة عبر window.__thimarPushBridge(event, payload).
 */
public class PushBridge {
  static final int REQUEST_NOTIFICATIONS = 4201;

  private static WeakReference<WebView> webViewRef = new WeakReference<>(null);
  private static WeakReference<Activity> activityRef = new WeakReference<>(null);
  private static String pendingUrl = null;
  /** لا تُتاح الوظائف الحساسة إلا عندما تكون الصفحة على نطاق ثمار. */
  private static volatile boolean trustedOrigin = false;
  private static final Handler MAIN = new Handler(Looper.getMainLooper());

  private final Activity activity;

  PushBridge(Activity activity) {
    this.activity = activity;
    activityRef = new WeakReference<>(activity);
  }

  static void attach(WebView webView, Activity activity) {
    webViewRef = new WeakReference<>(webView);
    activityRef = new WeakReference<>(activity);
  }

  static void detach() {
    webViewRef = new WeakReference<>(null);
    trustedOrigin = false;
  }

  /** يُستدعى من النشاط عند كل تنقّل: هل الصفحة الحالية على نطاق التطبيق؟ */
  static void setTrustedOrigin(boolean trusted) {
    trustedOrigin = trusted;
  }

  private static boolean allowed() {
    return trustedOrigin;
  }

  /** يرسل حدثًا إلى الصفحة إن كانت مفتوحة (من أي خيط). */
  static void dispatch(final String event, final String payloadJson) {
    MAIN.post(() -> {
      WebView view = webViewRef.get();
      if (view == null) return;
      String script = "window.__thimarPushBridge && window.__thimarPushBridge("
          + JSONObject.quote(event) + "," + (payloadJson == null ? "{}" : payloadJson) + ")";
      try {
        view.evaluateJavascript(script, null);
      } catch (Exception error) {
        LaunchLog.add(view.getContext(), "تعذّر إبلاغ الصفحة بحدث " + event + ": " + error.getMessage());
      }
    });
  }

  /** رابط إشعار لم يُستهلك بعد (فتح التطبيق من إشعار وهو مغلق). */
  static void setPendingUrl(String url) {
    pendingUrl = url;
  }

  static String consumePendingUrl() {
    String value = pendingUrl;
    pendingUrl = null;
    return value;
  }

  static String peekPendingUrl() {
    return pendingUrl;
  }

  /* ------------------------- واجهة الصفحة ------------------------- */

  @JavascriptInterface
  public String platform() {
    return "android";
  }

  @JavascriptInterface
  public String appVersion() {
    return BuildConfig.VERSION_NAME;
  }

  @JavascriptInterface
  public int appVersionCode() {
    return BuildConfig.VERSION_CODE;
  }

  @JavascriptInterface
  public int getInstalledVersionCode() {
    return BuildConfig.VERSION_CODE;
  }

  @JavascriptInterface
  public String deviceId() {
    return allowed() ? TokenSync.deviceId(activity) : "";
  }

  @JavascriptInterface
  public String accountId() {
    String value = TokenSync.accountId(activity);
    return value == null ? "" : value;
  }

  /** granted | denied | prompt */
  @JavascriptInterface
  public String permission() {
    if (!allowed()) return "denied";
    if (NotificationHelper.canPost(activity)) return "granted";
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        && activity.shouldShowRequestPermissionRationale(android.Manifest.permission.POST_NOTIFICATIONS)) {
      return "prompt";
    }
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "prompt" : "denied";
  }

  @JavascriptInterface
  public boolean createChannel() {
    if (!allowed()) return false;
    NotificationHelper.ensureChannel(activity);
    return true;
  }

  /** يطلب إذن الإشعارات (أندرويد 13+). النتيجة تصل كحدث permission. */
  @JavascriptInterface
  public void requestPermission() {
    if (!allowed()) return;
    if (NotificationHelper.canPost(activity)) {
      dispatch("permission", "{\"granted\":true}");
      return;
    }
    activity.runOnUiThread(() -> {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        activity.requestPermissions(
            new String[] {android.Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
      } else {
        NotificationHelper.openSettings(activity);
        dispatch("permission", "{\"granted\":false}");
      }
    });
  }

  /** يجلب رمز FCM ويرسله للصفحة كحدث registration. */
  @JavascriptInterface
  public void register() {
    if (!allowed()) return;
    Task<String> task = FirebaseMessaging.getInstance().getToken();
    task.addOnCompleteListener(result -> {
      if (!result.isSuccessful()) {
        String reason = result.getException() == null ? "unknown" : result.getException().getMessage();
        LaunchLog.add(activity, "تعذّر جلب رمز FCM: " + reason);
        dispatch("registrationError", "{\"message\":" + JSONObject.quote(String.valueOf(reason)) + "}");
        return;
      }
      String token = result.getResult();
      TokenSync.saveToken(activity, token);
      dispatch("registration", "{\"value\":" + JSONObject.quote(token) + "}");
    });
  }

  @JavascriptInterface
  public String token() {
    if (!allowed()) return "";
    String value = TokenSync.token(activity);
    return value == null ? "" : value;
  }

  /** يربط الجهاز بالحساب المسجّل حاليًا (يُستدعى عند الدخول وتغيّر الحساب). */
  @JavascriptInterface
  public void setAccount(String accountId) {
    if (!allowed()) return;
    TokenSync.setAccount(activity, accountId);
  }

  /** يحفظ برهان ربط الجهاز (hash كلمة المرور) لاستخدامه في طلبات FCM الآمنة. */
  @JavascriptInterface
  public void setAccountSecret(String secret) {
    if (!allowed()) return;
    TokenSync.saveAccountSecret(activity, secret);
  }

  /** يلغي ربط الجهاز ويحذف الرمز (تسجيل الخروج). */
  @JavascriptInterface
  public void clearAccount() {
    if (!allowed()) return;
    TokenSync.clearAccount(activity);
  }

  @JavascriptInterface
  public void deleteToken() {
    if (!allowed()) return;
    FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener(result ->
        dispatch("registrationDeleted", "{\"ok\":" + result.isSuccessful() + "}"));
  }

  @JavascriptInterface
  public String takePendingUrl() {
    if (!allowed()) return "";
    String value = consumePendingUrl();
    return value == null ? "" : value;
  }

  @JavascriptInterface
  public void openNotificationSettings() {
    if (!allowed()) return;
    NotificationHelper.openSettings(activity);
  }

  @JavascriptInterface
  public void log(String message) {
    LaunchLog.add(activity, "JS: " + message);
  }

  static void handlePermissionResult(Activity activity, int requestCode, boolean granted) {
    if (requestCode != REQUEST_NOTIFICATIONS) return;
    if (granted) NotificationHelper.ensureChannel(activity);
    dispatch("permission", "{\"granted\":" + granted + "}");
    LaunchLog.add(activity, "إذن الإشعارات: " + (granted ? "ممنوح" : "مرفوض"));
  }

  static Context context() {
    Activity current = activityRef.get();
    return current == null ? null : current.getApplicationContext();
  }
}
