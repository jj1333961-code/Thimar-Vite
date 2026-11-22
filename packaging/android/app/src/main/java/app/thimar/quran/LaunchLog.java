package app.thimar.quran;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** سجل تشخيص دائم على الجهاز: كل خطوة في الإقلاع والأخطاء، مع معلومات الجهاز. */
final class LaunchLog {
  private static final String FILE_NAME = "launch-log.txt";
  private static final int MAX_BYTES = 120 * 1024;
  private static boolean installed = false;

  private LaunchLog() {}

  static synchronized void init(Context context) {
    if (installed) return;
    installed = true;
    final Context app = context.getApplicationContext();
    Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
      StringWriter buffer = new StringWriter();
      error.printStackTrace(new PrintWriter(buffer));
      add(app, "CRASH in thread " + thread.getName() + "\n" + buffer);
      if (Build.VERSION.SDK_INT >= 29) {
        // نترك النظام يعالج الانهيار بعد حفظ السجل.
      }
      android.os.Process.killProcess(android.os.Process.myPid());
      System.exit(10);
    });
    add(app, "---- بدء تشغيل التطبيق ----");
    add(app, deviceInfo(app));
  }

  static String deviceInfo(Context context) {
    StringBuilder builder = new StringBuilder();
    builder.append("الجهاز: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n');
    builder.append("أندرويد: ").append(Build.VERSION.RELEASE).append(" (SDK ").append(Build.VERSION.SDK_INT).append(")\n");
    try {
      PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
      builder.append("إصدار التطبيق: ").append(info.versionName).append(" (").append(info.versionCode).append(")\n");
    } catch (Exception ignored) {
      // تجاهل
    }
    builder.append("Chrome: ").append(packageVersion(context, "com.android.chrome")).append('\n');
    builder.append("WebView: ").append(webViewVersion(context)).append('\n');
    return builder.toString();
  }

  static String packageVersion(Context context, String packageName) {
    try {
      return context.getPackageManager().getPackageInfo(packageName, 0).versionName;
    } catch (PackageManager.NameNotFoundException error) {
      return "غير مثبّت";
    }
  }

  static String webViewVersion(Context context) {
    try {
      if (Build.VERSION.SDK_INT >= 26) {
        PackageInfo info = android.webkit.WebView.getCurrentWebViewPackage();
        if (info != null) return info.versionName + " (" + info.packageName + ")";
      }
    } catch (Throwable ignored) {
      // تجاهل
    }
    return "غير معروف";
  }

  static synchronized void add(Context context, String line) {
    String stamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date());
    try {
      File file = new File(context.getFilesDir(), FILE_NAME);
      if (file.length() > MAX_BYTES) {
        File old = new File(context.getFilesDir(), FILE_NAME + ".old");
        if (old.exists()) old.delete();
        file.renameTo(old);
      }
      FileWriter writer = new FileWriter(file, true);
      writer.append('[').append(stamp).append("] ").append(line).append('\n');
      writer.close();
    } catch (Exception ignored) {
      // لا شيء نفعله إن تعذّر الكتابة.
    }
    android.util.Log.i("ThimarLaunch", line);
  }

  static synchronized String read(Context context) {
    File file = new File(context.getFilesDir(), FILE_NAME);
    if (!file.exists()) return "لا يوجد سجل بعد.";
    try {
      java.io.FileInputStream input = new java.io.FileInputStream(file);
      byte[] buffer = new byte[(int) file.length()];
      int read = input.read(buffer);
      input.close();
      return new String(buffer, 0, Math.max(read, 0), "UTF-8");
    } catch (Exception error) {
      return "تعذّر قراءة السجل: " + error;
    }
  }

  static synchronized void clear(Context context) {
    new File(context.getFilesDir(), FILE_NAME).delete();
    add(context, "تم مسح السجل.");
  }
}
