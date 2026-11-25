package app.thimar.quran;

import android.content.Context;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.util.Map;

/**
 * خدمة FCM الأصلية لتطبيق ثمار (غلاف WebView بلا Capacitor).
 *
 * • الرمز الجديد: يُحفظ ويُربط بالحساب المسجّل (يعمل والتطبيق مغلق).
 * • التطبيق في المقدمة: FCM لا يعرض الإشعار تلقائيًا، فنعرضه هنا.
 * • التطبيق في الخلفية أو مغلقًا: يعرضه النظام من كتلة notification
 *   (القناة والأيقونة واللون من AndroidManifest)، والضغط يفتح النشاط بالرابط.
 */
public class ThimarMessagingService extends FirebaseMessagingService {

  @Override
  public void onNewToken(String token) {
    super.onNewToken(token);
    TokenSync.onTokenRefreshed(this, token);
    PushBridge.dispatch("registration", tokenEvent(token));
  }

  @Override
  public void onMessageReceived(RemoteMessage message) {
    super.onMessageReceived(message);
    Map<String, String> data = message.getData();
    RemoteMessage.Notification shown = message.getNotification();

    String title = firstNonEmpty(
        data.get("title"),
        shown != null ? shown.getTitle() : null,
        "ثمار");
    String body = firstNonEmpty(
        data.get("body"),
        shown != null ? shown.getBody() : null,
        "");
    if (!PushBridge.messagePreviewEnabled()) body = "رسالة جديدة";
    String url = firstNonEmpty(data.get("url"), "/");
    String tag = firstNonEmpty(data.get("tag"), "thimar");

    if (title.isEmpty() && body.isEmpty()) {
      LaunchLog.add(this, "وصلت رسالة FCM بلا محتوى — تم تجاهلها");
      return;
    }

    // تجنّب إشعار غير ضروري عندما يكون المستخدم يشاهد نفس المحادثة فعلاً.
    String activeConversation = PushBridge.activeConversation();
    String conversationId = extractConversationId(url);
    if (activeConversation != null && !activeConversation.isEmpty()
        && conversationId != null && conversationId.equals(activeConversation)) {
      PushBridge.dispatch("pushReceived", messageEvent(title, body, url, tag));
      return;
    }

    NotificationHelper.show(this, title, body, url, tag);

    // إن كانت الواجهة مفتوحة نُبلغها لتحديث صفحة الإشعارات فورًا.
    PushBridge.dispatch("pushReceived", messageEvent(title, body, url, tag));
  }

  private static String tokenEvent(String token) {
    try {
      JSONObject payload = new JSONObject();
      payload.put("value", token);
      return payload.toString();
    } catch (Exception error) {
      return "{\"value\":\"\"}";
    }
  }

  private static String messageEvent(String title, String body, String url, String tag) {
    try {
      JSONObject payload = new JSONObject();
      payload.put("title", title);
      payload.put("body", body);
      payload.put("url", url);
      payload.put("tag", tag);
      return payload.toString();
    } catch (Exception error) {
      return "{}";
    }
  }

  private static String extractConversationId(String url) {
    if (url == null) return null;
    try {
      android.net.Uri uri = android.net.Uri.parse(url);
      String value = uri.getQueryParameter("c");
      if (value == null || value.trim().isEmpty()) {
        // fallback for paths like /messages?c=...
        int index = url.indexOf("c=");
        if (index >= 0) {
          String tail = url.substring(index + 2);
          int end = tail.indexOf('&');
          value = end >= 0 ? tail.substring(0, end) : tail;
        }
      }
      return value == null ? null : value.trim();
    } catch (Exception ignored) {
      return null;
    }
  }

  private static String firstNonEmpty(String... values) {
    for (String value : values) {
      if (value != null && !value.trim().isEmpty()) return value.trim();
    }
    return "";
  }

  /** يُستدعى من النشاط بعد منح/رفض إذن الإشعارات. */
  static void notifyPermission(Context context, boolean granted) {
    PushBridge.dispatch("permission", "{\"granted\":" + granted + "}");
  }
}
