package app.thimar.quran;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

/**
 * جسر النافذة العائمة بين واجهة ثمار وأندرويد.
 * كل عملية تتحقق من الإذن الأصلي أولاً؛ الواجهة لا تستطيع تجاوز النظام.
 */
public class OverlayBridge {
  private final Context context;

  public OverlayBridge(Context context) {
    this.context = context.getApplicationContext();
  }

  @JavascriptInterface
  public String getOverlayStatus() {
    JSONObject status = new JSONObject();
    try {
      status.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M);
      status.put("granted", FloatingOverlayService.canDrawOverlays(context));
      status.put("showing", FloatingOverlayService.isShowing());
      status.put("android", Build.VERSION.SDK_INT);
    } catch (Exception error) {
      try {
        status.put("error", safeMessage(error));
      } catch (Exception ignored) {
        // لا شيء.
      }
    }
    return status.toString();
  }

  @JavascriptInterface
  public boolean canDrawOverlays() {
    return FloatingOverlayService.canDrawOverlays(context);
  }

  /** أدلة الجهاز نفسها عن إذن النافذة — للعرض والتشخيص فقط. */
  @JavascriptInterface
  public String getOverlayDiagnostics() {
    JSONObject json = AdhanPermissions.status(context);
    try {
      json.put("overlay", FloatingOverlayService.canDrawOverlays(context));
      json.put("overlayShowing", FloatingOverlayService.isShowing());
    } catch (Exception error) {
      try {
        json.put("error", safeMessage(error));
      } catch (Exception ignored) {
        // لا شيء.
      }
    }
    return json.toString();
  }

  /** يفتح أدوات تشخيص الأذان: معاينة كل صلاة، النافذة العائمة، والنسخة الإنجليزية. */
  @JavascriptInterface
  public void openAdhanDiagnostics() {
    if (!PushBridge.isTrustedOrigin()) return;
    try {
      Intent intent = new Intent(context, DiagnosticsActivity.class);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      context.startActivity(intent);
    } catch (Exception error) {
      LaunchLog.add(context, "تعذّر فتح تشخيص الأذان: " + safeMessage(error));
    }
  }

  /** يفتح شاشة النظام الرسمية «الظهور فوق التطبيقات» لهذا التطبيق. */
  @JavascriptInterface
  public void openOverlaySettings() {
    if (!PushBridge.isTrustedOrigin()) return;
    AdhanPermissions.openSettings(context, "overlay");
  }

  /** لا يعرض النافذة إن لم يكن الإذن ممنوحاً. */
  @JavascriptInterface
  public boolean showOverlay() {
    if (!PushBridge.isTrustedOrigin()) return false;
    return FloatingOverlayService.show(context);
  }

  @JavascriptInterface
  public void hideOverlay() {
    FloatingOverlayService.hide(context);
  }

  private static String safeMessage(Exception error) {
    String message = error.getMessage();
    if (message == null) message = "error";
    return message.replace("\"", "'").replace("\n", " ");
  }
}
