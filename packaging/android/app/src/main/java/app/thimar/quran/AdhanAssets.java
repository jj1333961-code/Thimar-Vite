package app.thimar.quran;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * مخزن محلي لصور الصلاة وملفات الأذان.
 *
 * - الصور والأصوات المضمَّنة في الحزمة (assets/www/adhan) تعمل دون إنترنت أصلًا.
 * - أي رابط بعيد يختاره المستخدم (صورة أو صوت مخصص) يُنزَّل مرة واحدة إلى
 *   filesDir/adhan ويُعاد استخدامه بعد ذلك، فلا يتكرر التنزيل.
 * - التنزيل ذرّي: ملف .part ثم إعادة تسمية، فانقطاع الشبكة لا يُفسد الملف القديم.
 * - عند فشل التنزيل أو غياب الملف نرجع إلى الأصل المضمَّن ثم إلى الرابط، بلا أعطال.
 */
public final class AdhanAssets {
  private static final String TAG = "ThimarAdhanAssets";
  private static final String PREFS = "thimar_adhan_assets";
  private static final String KEY_AUDIO = "audio_map";
  private static final String KEY_IMAGES = "image_map";
  private static final String KEY_IMAGE_URLS = "image_urls";
  private static final String KEY_LAST_SYNC = "last_sync";
  private static final String KEY_LAST_ERROR = "last_error";
  private static final String KEY_LAST_BYTES = "last_bytes";

  private static final long MAX_BYTES = 40L * 1024 * 1024;
  private static final long PART_MAX_AGE_MS = 60L * 60 * 1000;
  private static final int MAX_AUDIO_FILES = 12;

  private static final ExecutorService POOL = Executors.newSingleThreadExecutor();
  private static final AtomicBoolean BUSY = new AtomicBoolean(false);

  private AdhanAssets() {}

  private static SharedPreferences prefs(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public static File directory(Context context) {
    File dir = new File(context.getFilesDir(), "adhan");
    if (!dir.isDirectory() && !dir.mkdirs()) {
      Log.w(TAG, "تعذّر إنشاء مجلد الأذان المحلي");
    }
    return dir;
  }

  /** الصورة المحمّلة للصلاة، أو null إن لم تكن موجودة/صالحة. */
  public static File imageFile(Context context, String prayer) {
    if (prayer == null) return null;
    File file = new File(directory(context), "image-" + safe(prayer) + ".jpg");
    return file.isFile() && file.length() > 1024 ? file : null;
  }

  /** ملف الأذان المحمّل لهذا الرابط، أو null. */
  public static File audioFile(Context context, String url) {
    if (url == null || url.trim().isEmpty()) return null;
    File file = new File(directory(context), hash(url.trim()) + extension(url));
    return file.isFile() && file.length() > 2048 ? file : null;
  }

  /**
   * يحل مصدر التشغيل بالترتيب: ملف محمّل ← أصل مضمَّن ← رابط.
   * يعيد مسارًا مطلقًا، أو "asset:..."، أو الرابط كما هو.
   */
  public static String resolveAudio(Context context, String url) {
    if (url == null || url.trim().isEmpty()) return null;
    String value = url.trim();
    File local = audioFile(context, value);
    if (local != null) return local.getAbsolutePath();
    if (value.startsWith("http://") || value.startsWith("https://")) {
      /* لم يكتمل تنزيل الأذان المختار: نرجع إلى أذان الحزمة بدل الصمت. */
      if (assetExists(context, "www/adhan/azan1.mp3")) {
        LaunchLog.add(context, "الأذان المختار غير محمّل محليًا — استخدام أذان الحزمة");
        return "asset:www/adhan/azan1.mp3";
      }
      return value;
    }
    if (value.startsWith("content://") || value.startsWith("file://")) {
      return value;
    }
    String asset = value.startsWith("/") ? "www" + value : "www/" + value;
    if (assetExists(context, asset)) return "asset:" + asset;
    String bare = value.startsWith("/") ? value.substring(1) : value;
    if (assetExists(context, bare)) return "asset:" + bare;
    return value;
  }

  /** مسار الصورة للتشغيل: الملف المحمّل أو أصل الحزمة أو null. */
  public static String resolveImage(Context context, String prayer) {
    File local = imageFile(context, prayer);
    if (local != null) return local.getAbsolutePath();
    String key = safe(prayer);
    String path = "www/adhan/prayer/" + key + ".jpg";
    if (assetExists(context, path)) return "asset:" + path;
    if (assetExists(context, "www/images/prayer-card.jpg")) return "asset:www/images/prayer-card.jpg";
    return null;
  }

  public static boolean assetExists(Context context, String path) {
    try {
      InputStream stream = context.getAssets().open(path);
      stream.close();
      return true;
    } catch (Exception ignored) {
      return false;
    }
  }

  /** يبدأ مزامنة خلفية واحدة فقط في كل مرة (يمنع التنزيل المتكرر). */
  public static void syncAsync(final Context context) {
    final Context app = context.getApplicationContext();
    if (!BUSY.compareAndSet(false, true)) return;
    POOL.execute(new Runnable() {
      @Override
      public void run() {
        try {
          syncNow(app);
        } catch (Throwable error) {
          recordError(app, "مزامنة الأذان: " + error.getMessage());
        } finally {
          BUSY.set(false);
        }
      }
    });
  }

  /** حفظ روابط صور الصلوات القادمة من الواجهة ثم مزامنتها. */
  public static void saveImageUrls(Context context, JSONObject urls) {
    if (urls == null) return;
    prefs(context).edit().putString(KEY_IMAGE_URLS, urls.toString()).apply();
  }

  /** تنزيل/تحديث الصور والأصوات المطلوبة. لا يرمي استثناءات. */
  public static void syncNow(Context context) {
    cleanupParts(context);
    JSONObject imageUrls = readJson(context, KEY_IMAGE_URLS);
    JSONObject images = readJson(context, KEY_IMAGES);
    long total = 0;
    int failures = 0;

    /* الصور: نحتفظ بالنسخة المضمّنة إن فشل التنزيل. */
    if (imageUrls != null) {
      Iterator<String> keys = imageUrls.keys();
      while (keys.hasNext()) {
        String prayer = keys.next();
        String url = imageUrls.optString(prayer, "");
        if (!isRemote(url)) continue;
        File target = new File(directory(context), "image-" + safe(prayer) + ".jpg");
        JSONObject meta = images == null ? null : images.optJSONObject(prayer);
        /* الصورة المضمَّنة تُنسخ مرة واحدة إلى التخزين الدائم (تعمل دون إنترنت). */
        if (!(target.isFile() && target.length() > 1024)) {
          copyAsset(context, "www/adhan/prayer/" + safe(prayer) + ".jpg", target);
        }
        /* لا نعيد تنزيل صورة موجودة؛ التنزيل فقط إن فشلت النسخة المضمَّنة. */
        if (target.isFile() && target.length() > 1024) {
          try {
            if (images == null) images = new JSONObject();
            JSONObject next = new JSONObject();
            next.put("url", "bundled");
            next.put("file", target.getName());
            next.put("bytes", target.length());
            next.put("at", System.currentTimeMillis());
            images.put(prayer, next);
          } catch (Exception ignored) {
            // تبقى الصورة صالحة للعرض حتى لو تعذّر حفظ بياناتها.
          }
          total += target.length();
          continue;
        }
        try {
          long written = fetchToFile(context, url, target, meta);
          JSONObject next = new JSONObject();
          next.put("url", url);
          next.put("file", target.getName());
          next.put("bytes", target.length());
          next.put("at", System.currentTimeMillis());
          if (meta != null && meta.optString("etag", "").length() > 0) {
            next.put("etag", meta.optString("etag"));
          }
          if (images == null) images = new JSONObject();
          images.put(prayer, next);
          if (written > 0) total += written;
        } catch (Exception error) {
          failures++;
          Log.w(TAG, "تعذّر تنزيل صورة " + prayer + ": " + error.getMessage());
        }
      }
      if (images != null) prefs(context).edit().putString(KEY_IMAGES, images.toString()).apply();
    }

    /* الأصوات: من جدولة الأذان (لكل صلاة) + الصوت الافتراضي. */
    SharedPreferences schedule = AdhanScheduler.prefs(context);
    JSONObject audio = readJson(context, KEY_AUDIO);
    if (audio == null) audio = new JSONObject();
    JSONObject urls = readJson(context, AdhanScheduler.KEY_URLS);
    java.util.LinkedHashSet<String> wanted = new java.util.LinkedHashSet<>();
    if (urls != null) {
      Iterator<String> keys = urls.keys();
      while (keys.hasNext()) wanted.add(urls.optString(keys.next(), ""));
    }
    wanted.add(schedule.getString(AdhanScheduler.KEY_DEFAULT_URL, ""));
    for (String url : wanted) {
      if (!isRemote(url)) continue;
      File target = new File(directory(context), hash(url) + extension(url));
      JSONObject meta = audio.optJSONObject(url);
      /* الأذان المضمَّن: نسخة محلية دائمة مرة واحدة. */
      if (!(target.isFile() && target.length() > 2048) && url.startsWith("/")) {
        copyAsset(context, "www" + url, target);
      }
      if (target.isFile() && target.length() > 2048) {
        try {
          JSONObject next = new JSONObject();
          next.put("file", target.getName());
          next.put("bytes", target.length());
          next.put("at", System.currentTimeMillis());
          next.put("bundled", url.startsWith("/"));
          audio.put(url, next);
        } catch (Exception ignored) {
          // الملف صالح للتشغيل حتى لو تعذّر تسجيل بياناته.
        }
        continue;
      }
      try {
        long written = fetchToFile(context, url, target, meta);
        JSONObject next = new JSONObject();
        next.put("file", target.getName());
        next.put("bytes", target.length());
        next.put("at", System.currentTimeMillis());
        if (meta != null && meta.optString("etag", "").length() > 0) {
          next.put("etag", meta.optString("etag"));
        }
        audio.put(url, next);
        if (written > 0) total += written;
      } catch (Exception error) {
        failures++;
        Log.w(TAG, "تعذّر تنزيل الأذان: " + error.getMessage());
      }
    }
    pruneAudio(context, audio);
    prefs(context).edit()
        .putString(KEY_AUDIO, audio.toString())
        .putLong(KEY_LAST_SYNC, System.currentTimeMillis())
        .putLong(KEY_LAST_BYTES, total)
        .apply();
    if (failures > 0) {
      recordError(context, failures + " ملف/ملفات تعذّر تنزيلها — سيُعاد المحاولة لاحقًا");
    }
    LaunchLog.add(context, "مزامنة الأذان: " + (total > 0 ? (total / 1024) + " ك.ب" : "لا جديد")
        + (failures > 0 ? "، فشل " + failures : ""));
  }

  /**
   * تنزيل ملف إلى مسار محلي بشكل ذرّي مع دعم ETag.
   * يعيد عدد البايتات المكتوبة (0 عند عدم التغيير).
   */
  private static long fetchToFile(Context context, String url, File target, JSONObject meta) throws Exception {
    File part = new File(target.getParentFile(), target.getName() + ".part");
    if (part.exists()) part.delete();

    HttpURLConnection connection = null;
    try {
      connection = (HttpURLConnection) new URL(url).openConnection();
      connection.setConnectTimeout(15000);
      connection.setReadTimeout(30000);
      connection.setInstanceFollowRedirects(true);
      connection.setRequestProperty("Accept", "image/jpeg,audio/*,*/*");
      String etag = meta == null ? null : meta.optString("etag", null);
      if (etag != null && etag.length() > 0) {
        connection.setRequestProperty("If-None-Match", etag);
      }
      int status = connection.getResponseCode();
      if (status == HttpURLConnection.HTTP_NOT_MODIFIED) {
        return 0;
      }
      if (status != HttpURLConnection.HTTP_OK) {
        throw new Exception("HTTP " + status);
      }
      long declared = connection.getContentLengthLong();
      if (declared > MAX_BYTES) throw new Exception("الملف أكبر من الحد المسموح");

      InputStream input = connection.getInputStream();
      FileOutputStream output = new FileOutputStream(part);
      long written = 0;
      try {
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = input.read(buffer)) > 0) {
          written += read;
          if (written > MAX_BYTES) throw new Exception("الملف أكبر من الحد المسموح");
          output.write(buffer, 0, read);
        }
        output.flush();
        output.getFD().sync();
      } finally {
        try {
          output.close();
        } catch (Exception ignored) {
          // تجاهل.
        }
        try {
          input.close();
        } catch (Exception ignored) {
          // تجاهل.
        }
      }
      if (declared > 0 && written < declared) {
        throw new Exception("تنزيل غير مكتمل");
      }
      if (target.exists() && !target.delete()) {
        throw new Exception("تعذّر استبدال الملف القديم");
      }
      if (!part.renameTo(target)) {
        throw new Exception("تعذّر حفظ الملف");
      }
      String newEtag = connection.getHeaderField("ETag");
      if (meta != null && newEtag != null) meta.put("etag", newEtag);
      return written;
    } finally {
      if (connection != null) connection.disconnect();
      if (part.exists()) part.delete();
    }
  }

  /** حذف بقايا تنزيل انقطعت قبل ساعة أو أكثر. */
  private static void cleanupParts(Context context) {
    File[] files = directory(context).listFiles();
    if (files == null) return;
    long now = System.currentTimeMillis();
    for (File file : files) {
      if (file.getName().endsWith(".part") && now - file.lastModified() > PART_MAX_AGE_MS) {
        file.delete();
      }
    }
  }

  /** إبقاء أحدث {{MAX_AUDIO_FILES}} ملف صوت فقط. */
  private static void pruneAudio(Context context, JSONObject audio) {
    try {
      java.util.List<String> names = new java.util.ArrayList<>();
      Iterator<String> keys = audio.keys();
      while (keys.hasNext()) names.add(audio.optJSONObject(keys.next()).optString("file", ""));
      File[] files = directory(context).listFiles();
      if (files == null) return;
      for (File file : files) {
        if (!file.getName().endsWith(".mp3") && !file.getName().endsWith(".m4a")) continue;
        if (!names.contains(file.getName())) file.delete();
      }
      if (names.size() > MAX_AUDIO_FILES) {
        // الأقدم أولًا (at) يُحذف.
        java.util.List<String> ordered = new java.util.ArrayList<>(names);
        java.util.Collections.sort(ordered, new java.util.Comparator<String>() {
          @Override
          public int compare(String a, String b) {
            return a.compareTo(b);
          }
        });
        for (int i = 0; i < ordered.size() - MAX_AUDIO_FILES; i++) {
          new File(directory(context), ordered.get(i)).delete();
        }
      }
    } catch (Exception ignored) {
      // لا شيء.
    }
  }

  /** حالة مختصرة للعرض في الواجهة/التشخيص (بلا بيانات حساسة). */
  public static JSONObject status(Context context) {
    JSONObject json = new JSONObject();
    try {
      JSONObject images = new JSONObject();
      String[] prayers = {"Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"};
      for (String prayer : prayers) {
        File file = imageFile(context, prayer);
        boolean bundled = assetExists(context, "www/adhan/prayer/" + safe(prayer) + ".jpg");
        JSONObject item = new JSONObject();
        item.put("cached", file != null);
        item.put("bundled", bundled);
        item.put("available", file != null || bundled);
        item.put("bytes", file == null ? 0 : file.length());
        images.put(prayer, item);
      }
      json.put("images", images);

      JSONObject audioStatus = new JSONObject();
      JSONObject audioMap = readJson(context, KEY_AUDIO);
      int count = 0;
      long bytes = 0;
      if (audioMap != null) {
        Iterator<String> keys = audioMap.keys();
        while (keys.hasNext()) {
          JSONObject item = audioMap.optJSONObject(keys.next());
          if (item == null) continue;
          File file = new File(directory(context), item.optString("file", ""));
          if (file.isFile() && file.length() > 2048) {
            count++;
            bytes += file.length();
          }
        }
      }
      audioStatus.put("count", count);
      audioStatus.put("bytes", bytes);
      json.put("audio", audioStatus);
      int bundledCount = 0;
      String[] bundled = {"azan1.mp3", "azan2.mp3", "azan3.mp3", "imadi.mp3", "hamathani.mp3", "afasy-fajr.mp3"};
      for (String name : bundled) {
        if (assetExists(context, "www/adhan/" + name)) bundledCount++;
      }
      audioStatus.put("bundled", bundledCount);
      json.put("lastSync", prefs(context).getLong(KEY_LAST_SYNC, 0));
      json.put("lastBytes", prefs(context).getLong(KEY_LAST_BYTES, 0));
      json.put("lastError", prefs(context).getString(KEY_LAST_ERROR, ""));
    } catch (Exception ignored) {
      // تبقى القيم الفارغة.
    }
    return json;
  }

  public static void clearError(Context context) {
    prefs(context).edit().remove(KEY_LAST_ERROR).apply();
  }

  private static void recordError(Context context, String message) {
    String safeMessage = message == null ? "خطأ غير معروف" : message;
    prefs(context).edit().putString(KEY_LAST_ERROR, safeMessage).apply();
    LaunchLog.add(context, "مخزن الأذان: " + safeMessage);
  }

  private static JSONObject readJson(Context context, String key) {
    String raw = prefs(context).getString(key, null);
    if (raw == null) return null;
    try {
      return new JSONObject(raw);
    } catch (Exception ignored) {
      return null;
    }
  }

  private static boolean isRemote(String url) {
    return url != null && (url.startsWith("http://") || url.startsWith("https://"));
  }

  private static String safe(String value) {
    if (value == null) return "unknown";
    return value.trim().toLowerCase(Locale.US).replaceAll("[^a-z0-9-]", "").isEmpty()
        ? "unknown"
        : value.trim().toLowerCase(Locale.US).replaceAll("[^a-z0-9-]", "");
  }

  private static String extension(String url) {
    String lower = url.toLowerCase(Locale.US);
    if (lower.contains(".m4a")) return ".m4a";
    if (lower.contains(".wav")) return ".wav";
    if (lower.contains(".ogg")) return ".ogg";
    return ".mp3";
  }

  private static String hash(String value) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-1");
      byte[] bytes = digest.digest(value.getBytes("UTF-8"));
      StringBuilder out = new StringBuilder();
      for (int i = 0; i < 10; i++) out.append(String.format("%02x", bytes[i]));
      return out.toString();
    } catch (Exception ignored) {
      return "audio" + Integer.toHexString(value.hashCode());
    }
  }

  /** نسخ أصل مضمَّن إلى التخزين المحلي (يُستخدم عند طلب «تنزيل» صريح). */
  public static boolean copyAsset(Context context, String assetPath, File target) {
    try {
      InputStream input = context.getAssets().open(assetPath);
      File part = new File(target.getParentFile(), target.getName() + ".part");
      FileOutputStream output = new FileOutputStream(part);
      try {
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = input.read(buffer)) > 0) output.write(buffer, 0, read);
        output.flush();
        output.getFD().sync();
      } finally {
        output.close();
        input.close();
      }
      if (target.exists()) target.delete();
      if (!part.renameTo(target)) {
        part.delete();
        return false;
      }
      return true;
    } catch (Exception ignored) {
      return false;
    }
  }

  /** حجم كل ملفات المخزن (للعرض في الواجهة). */
  public static long totalBytes(Context context) {
    long total = 0;
    File[] files = directory(context).listFiles();
    if (files == null) return 0;
    for (File file : files) total += file.length();
    return total;
  }
}
