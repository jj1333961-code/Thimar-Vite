package app.thimar.quran;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

/**
 * يربط رمز FCM بمعرّف الحساب المُسجَّل في Supabase.
 *
 * الربط يجري عبر دالة RPC آمنة (thimar_bind_fcm_token) وليس بكتابة مباشرة على
 * الجدول، ويُعاد تنفيذه تلقائيًا عند تجديد الرمز حتى لو كان التطبيق مغلقًا.
 */
final class TokenSync {
  private static final String PREFS = "thimar.push";
  private static final String KEY_TOKEN = "fcm_token";
  private static final String KEY_ACCOUNT = "account_id";
  private static final String KEY_DEVICE = "device_id";
  private static final String KEY_SECRET = "account_secret";

  /** معرّف ثابت للجهاز (يُستخدم لتقييد رمز واحد لكل جهاز). */
  public static final String RPC_BIND = "thimar_bind_fcm_token";
  public static final String RPC_REVOKE = "thimar_revoke_fcm_token";

  private TokenSync() {}

  static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  /** معرّف جهاز مجهول مستقر — لا يحتوي أي بيانات شخصية. */
  static String deviceId(Context context) {
    SharedPreferences store = prefs(context);
    String saved = store.getString(KEY_DEVICE, null);
    if (saved != null && !saved.isEmpty()) return saved;

    String raw = null;
    try {
      raw = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
    } catch (Exception ignored) {
      /* بعض الأجهزة تمنع القراءة. */
    }
    String id;
    if (raw == null || raw.isEmpty()) {
      id = "and-" + UUID.randomUUID().toString().replace("-", "");
    } else {
      id = "and-" + sha256(raw).substring(0, 32);
    }
    store.edit().putString(KEY_DEVICE, id).apply();
    return id;
  }

  static String accountId(Context context) {
    return prefs(context).getString(KEY_ACCOUNT, null);
  }

  static String token(Context context) {
    return prefs(context).getString(KEY_TOKEN, null);
  }

  static void saveToken(Context context, String token) {
    if (token == null || token.isEmpty()) return;
    prefs(context).edit().putString(KEY_TOKEN, token).apply();
  }

  static void saveAccountSecret(Context context, String secret) {
    if (secret == null || secret.trim().isEmpty()) return;
    prefs(context).edit().putString(KEY_SECRET, secret.trim()).apply();
  }

  static String accountSecret(Context context) {
    String value = prefs(context).getString(KEY_SECRET, null);
    return value == null || value.trim().isEmpty() ? null : value.trim();
  }

  /** ربط الجهاز بالحساب الحالي ثم إرسال الرمز إلى قاعدة البيانات. */
  static void setAccount(Context context, String accountId) {
    SharedPreferences store = prefs(context);
    if (accountId == null || accountId.trim().isEmpty()) {
      store.edit().remove(KEY_ACCOUNT).remove(KEY_SECRET).apply();
      return;
    }
    String previous = store.getString(KEY_ACCOUNT, null);
    if (previous != null && !previous.equals(accountId.trim())) {
      store.edit().remove(KEY_SECRET).apply();
    }
    store.edit().putString(KEY_ACCOUNT, accountId.trim()).apply();
    String token = token(context);
    if (token != null && !token.isEmpty()) bind(context, token, accountId);
  }

  /** إلغاء الربط (تسجيل الخروج). */
  static void clearAccount(Context context) {
    final String account = accountId(context);
    prefs(context).edit().remove(KEY_ACCOUNT).remove(KEY_SECRET).apply();
    final String device = deviceId(context);
    final Context app = context.getApplicationContext();
    new Thread(() -> revoke(app, device, account), "thimar-fcm-revoke").start();
  }

  /** رمز جديد من Firebase — يُحفظ ويُربط بالحساب إن كان هناك حساب مسجّل. */
  static void onTokenRefreshed(Context context, String token) {
    saveToken(context, token);
    String account = accountId(context);
    if (account != null && !account.isEmpty()) bind(context, token, account);
    LaunchLog.add(context, "رمز FCM محدَّث" + (account != null && !account.isEmpty() ? " ورُبط بالحساب" : " (بانتظار تسجيل الدخول)"));
  }

  static void bind(Context context, String token, String accountId) {
    final String device = deviceId(context);
    final String secret = accountSecret(context);
    JSONObject payload = new JSONObject();
    try {
      payload.put("p_token", token);
      payload.put("p_account_id", accountId);
      payload.put("p_device_id", device);
      payload.put("p_platform", "android");
      payload.put("p_app_version", BuildConfig.VERSION_NAME);
      payload.put("p_app_version_code", BuildConfig.VERSION_CODE);
    } catch (Exception ignored) {
      return;
    }
    final Context app = context.getApplicationContext();
    new Thread(() -> {
      int status = -1;
      if (secret != null) {
        try {
          JSONObject securePayload = new JSONObject(payload.toString());
          securePayload.put("p_device_secret", secret);
          securePayload.put("p_request_nonce", UUID.randomUUID().toString());
          status = post(app, "thimar_bind_fcm_token_secure", securePayload.toString());
          if (status >= 200 && status < 300) {
            LaunchLog.add(app, "ربط رمز الإشعارات بالحساب (secure): HTTP " + status);
            return;
          }
          LaunchLog.add(app, "ربط رمز الإشعارات (secure) فشل: HTTP " + status);
        } catch (Exception ignored) {
          /* نكمل بالمسار البديل أدناه */
        }
        return;
      }
      // Fallback for devices without a stored device secret (e.g. auto-login):
      // bind using the legacy RPC so message notifications still work.
      try {
        status = post(app, "thimar_bind_fcm_token", payload.toString());
        if (status >= 200 && status < 300) {
          LaunchLog.add(app, "ربط رمز الإشعارات بالحساب (legacy): HTTP " + status);
          return;
        }
        LaunchLog.add(app, "ربط رمز الإشعارات (legacy) فشل: HTTP " + status);
      } catch (Exception ignored) {
        /* ignore */
      }
    }, "thimar-fcm-bind").start();
  }

  private static void revoke(Context context, String deviceId, String accountId) {
    JSONObject payload = new JSONObject();
    try {
      payload.put("p_device_id", deviceId);
      if (accountId == null || accountId.isEmpty()) {
        payload.put("p_account_id", JSONObject.NULL);
      } else {
        payload.put("p_account_id", accountId);
      }
    } catch (Exception ignored) {
      return;
    }

    String secret = (accountId == null || accountId.trim().isEmpty()) ? null : accountSecret(context);
    if (secret == null || accountId == null || accountId.trim().isEmpty()) {
      LaunchLog.add(context, "لا يوجد تفويض جهاز آمن؛ تم تخطي إلغاء الربط على الخادم.");
      return;
    }
    try {
      JSONObject securePayload = new JSONObject();
      securePayload.put("p_device_id", deviceId);
      securePayload.put("p_account_id", accountId);
      securePayload.put("p_device_secret", secret);
      securePayload.put("p_request_nonce", UUID.randomUUID().toString());
      int secureStatus = post(context, "thimar_revoke_fcm_token_secure", securePayload.toString());
      if (secureStatus >= 200 && secureStatus < 300) {
        LaunchLog.add(context, "إلغاء ربط رمز الإشعارات (secure): HTTP " + secureStatus);
        return;
      }
      LaunchLog.add(context, "إلغاء ربط رمز الإشعارات (secure) فشل: HTTP " + secureStatus);
    } catch (Exception ignored) {
      /* do not fall back to the insecure RPC */
    }
  }

  private static int post(Context context, String function, String body) {
    HttpURLConnection connection = null;
    try {
      URL url = new URL(BuildConfig.SUPABASE_URL + "/rest/v1/rpc/" + function);
      connection = (HttpURLConnection) url.openConnection();
      connection.setRequestMethod("POST");
      connection.setConnectTimeout(12000);
      connection.setReadTimeout(12000);
      connection.setDoOutput(true);
      connection.setRequestProperty("Content-Type", "application/json");
      connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY);
      connection.setRequestProperty("Authorization", "Bearer " + BuildConfig.SUPABASE_ANON_KEY);
      connection.setRequestProperty("Prefer", "return=minimal");
      try (OutputStream output = connection.getOutputStream()) {
        output.write(body.getBytes(StandardCharsets.UTF_8));
      }
      int status = connection.getResponseCode();
      if (status >= 400) {
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(connection.getErrorStream(), StandardCharsets.UTF_8))) {
          StringBuilder text = new StringBuilder();
          String line;
          while ((line = reader.readLine()) != null) text.append(line);
          LaunchLog.add(context, "خطأ " + function + ": " + status + " " + text);
        } catch (Exception ignored) {
          /* لا يوجد جسم خطأ. */
        }
      }
      return status;
    } catch (Exception error) {
      LaunchLog.add(context, "تعذّر الاتصال بقاعدة الإشعارات: " + error.getMessage());
      return -1;
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  static String sha256Hex(String value) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder();
      for (byte b : bytes) hex.append(String.format("%02x", b));
      return hex.toString();
    } catch (Exception error) {
      return Integer.toHexString(value.hashCode());
    }
  }

  private static String sha256(String value) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder();
      for (byte b : bytes) hex.append(String.format("%02x", b));
      return hex.toString();
    } catch (Exception error) {
      return Integer.toHexString(value.hashCode());
    }
  }
}
