package app.thimar.quran;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * تخزين رمز الجلسة مشفّرًا بمفتاح داخل Android Keystore (AES-GCM).
 *
 * المفتاح غير قابل للاستخراج ولا يغادر مخزن المفاتيح، فلا يكفي نسخ ملف
 * التفضيلات لقراءة الرمز. الجسر مخصص لأصل التطبيق الموثوق فقط (نفس شرط
 * PushBridge.isTrustedOrigin)، والواجهة متزامنة لأن WebView لا يدعم
 * استدعاءات JS غير متزامنة على جسور JavaScript.
 */
public class SecureStore {

    private static final String TAG = "ThimarSecureStore";
    private static final String PREFS = "thimar_secure_store";
    private static final String KEY_ALIAS = "thimar_session_key_v1";
    private static final String FIELD = "session_token";

    private final Context context;

    SecureStore(Context context) {
        this.context = context.getApplicationContext();
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return (SecretKey) store.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    @JavascriptInterface
    public String get() {
        if (!PushBridge.isTrustedOrigin()) return "";
        try {
            String packed = prefs().getString(FIELD, "");
            if (packed == null || packed.isEmpty()) return "";
            byte[] raw = Base64.decode(packed, Base64.NO_WRAP);
            if (raw.length < 13) return "";
            byte[] iv = new byte[12];
            byte[] cipherText = new byte[raw.length - 12];
            System.arraycopy(raw, 0, iv, 0, 12);
            System.arraycopy(raw, 12, cipherText, 0, cipherText.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            byte[] plain = cipher.doFinal(cipherText);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception error) {
            Log.w(TAG, "read failed: " + error.getClass().getSimpleName());
            return "";
        }
    }

    @JavascriptInterface
    public void set(String value) {
        if (!PushBridge.isTrustedOrigin()) return;
        if (value == null || value.isEmpty()) {
            clear();
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] cipherText = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] iv = cipher.getIV();
            byte[] packed = new byte[iv.length + cipherText.length];
            System.arraycopy(iv, 0, packed, 0, iv.length);
            System.arraycopy(cipherText, 0, packed, iv.length, cipherText.length);
            prefs().edit().putString(FIELD, Base64.encodeToString(packed, Base64.NO_WRAP)).apply();
        } catch (Exception error) {
            Log.w(TAG, "write failed: " + error.getClass().getSimpleName());
        }
    }

    @JavascriptInterface
    public void clear() {
        if (!PushBridge.isTrustedOrigin()) return;
        try {
            prefs().edit().remove(FIELD).apply();
        } catch (Exception error) {
            Log.w(TAG, "clear failed: " + error.getClass().getSimpleName());
        }
    }
}
