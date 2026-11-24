package app.thimar.quran;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.NetworkRequest;

/**
 * نشاط التطبيق الوحيد: يفتح ثمار مباشرة داخل عرضه الداخلي (WebView).
 * لا يفتح متصفحًا خارجيًا، ولا يُطلق أي Intent لعرض الموقع، ولذلك لا تظهر
 * نافذة «فتح بواسطة» عند تشغيل التطبيق.
 */
public class WebFallbackActivity extends Activity {
  private static final String APP_HOST = "thimar.freebuff.page";
  private static final String APP_URL = "https://" + APP_HOST + "/";
  private static final int FILE_CHOOSER_REQUEST = 1001;
  private static final int REQUEST_MEDIA_PERMISSIONS = 1002;
  private PermissionRequest pendingPermissionRequest;
  private String[] pendingAllowedResources;
  private WebView webView;
  private ValueCallback<Uri[]> filePathCallback;
  private PushBridge pushBridge;
  private ThimarAssetUpdater assetUpdater;
  private boolean pageLoaded = false;
  private ConnectivityManager connectivityManager;
  private ConnectivityManager.NetworkCallback networkCallback;
  private volatile boolean lastOnlineState = true;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    LaunchLog.init(this);
    LaunchLog.add(this, "WebFallbackActivity.onCreate — فتح مباشر داخل التطبيق");
    NotificationHelper.ensureChannel(this);
    // تحديث رمز FCM (بما في ذلك app_version المثبت) при كل تشغيل.
    try {
      String account = TokenSync.accountId(this);
      String token = TokenSync.token(this);
      if (account != null && !account.trim().isEmpty() && token != null && !token.trim().isEmpty()) {
        TokenSync.bind(this, token, account);
      }
    } catch (Exception ignored) {
      LaunchLog.add(this, "تعذّر تحديث رمز الإشعارات عند التشغيل");
    }
    try {
      startWebView();
      registerConnectivityCallback();
      handleNotificationIntent(getIntent());
    } catch (Throwable error) {
      LaunchLog.add(this, "تعذّر تشغيل WebView: " + error);
      showStartupError(error);
    }
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleNotificationIntent(intent);
  }

  /**
   * فتح الصفحة المطلوبة عند الضغط على إشعار.
   * إن كانت الواجهة محمّلة نُمرّر المسار إليها دون إعادة تحميل، وإلا نحفظه
   * ليُسلَّم بعد اكتمال التحميل (حالة فتح التطبيق من إشعار وهو مغلق).
   */
  private void handleNotificationIntent(Intent intent) {
    if (intent == null) return;
    LaunchLog.add(this, "handleNotificationIntent action=" + intent.getAction());
    String target = intent.getStringExtra(NotificationHelper.EXTRA_URL);
    /*
     * الإشعار الذي يعرضه النظام والتطبيق مغلق/في الخلفية يصل كـ data payload
     * بمفاتيح كما هي (url, tag)، فلا بد من قراءة «url» أيضًا وإلا فُقد الرابط.
     */
    if (target == null || target.trim().isEmpty()) {
      target = intent.getStringExtra("url");
    }
    if (target == null || target.trim().isEmpty()) {
      target = intent.getStringExtra("gcm.notification.url");
    }
    if (target == null || target.trim().isEmpty()) {
      android.os.Bundle extras = intent.getExtras();
      if (extras != null) {
        for (String key : extras.keySet()) {
          Object value = extras.get(key);
          LaunchLog.add(this, "intent extra: " + key + "=" + String.valueOf(value));
          if (target == null || target.trim().isEmpty()) {
            if (key != null && key.toLowerCase().contains("url") && value != null) {
              target = String.valueOf(value);
            } else if (value != null && String.valueOf(value).contains("update=1")) {
              target = String.valueOf(value);
            }
          }
        }
      }
    }
    if ((target == null || target.trim().isEmpty()) && intent.getData() != null) {
      target = intent.getData().toString();
    }
    if (target == null || target.trim().isEmpty()) {
      // FCM update notifications use OPEN_NOTIFICATION even when data extras are missing.
      if (NotificationHelper.OPEN_ACTION.equals(intent.getAction())) {
        target = "/?update=1";
      } else {
        return;
      }
    }

    final String path = NotificationHelper.normalizeUrl(target);
    LaunchLog.add(this, "فتح من إشعار: " + path);
    PushBridge.setPendingUrl(path);
    if (pageLoaded && webView != null) {
      deliverDeepLink(path);
    }
  }

  private void deliverDeepLink(String path) {
    if (webView == null) return;
    String script = "window.__thimarPushOpen && window.__thimarPushOpen("
        + org.json.JSONObject.quote(path) + ")";
    try {
      webView.evaluateJavascript(script, null);
    } catch (Exception error) {
      LaunchLog.add(this, "تعذّر تمرير رابط الإشعار: " + error.getMessage());
    }
  }

  /** شاشة بديلة تمنع إغلاق التطبيق إذا لم يتوفر WebView على الجهاز. */
  private void showStartupError(Throwable error) {
    android.widget.TextView view = new android.widget.TextView(this);
    String details = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    view.setText("تعذّر تشغيل واجهة التطبيق (WebView).\n\n"
        + "افتح «متجر Play» وحدّث «Android System WebView» أو «Chrome»، ثم أعد فتح التطبيق.\n\n"
        + "التفاصيل: " + details);
    view.setTextSize(16);
    view.setPadding(32, 72, 32, 32);
    view.setTextColor(0xFF1F2937);
    view.setBackgroundColor(0xFFFAF7F1);
    setContentView(view);
  }

  private void startWebView() {
    webView = new WebView(this);
    setContentView(webView, new ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    /* لا وصول لنظام الملفات: كل الموارد المضمَّنة تُقدَّم عبر قطع الطلبات (serveLocal). */
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setLoadWithOverviewMode(true);
    settings.setUseWideViewPort(true);
    settings.setSupportZoom(false);
    settings.setJavaScriptCanOpenWindowsAutomatically(true);
    settings.setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
    /* تحديد الموقع داخل التطبيق يعمل مثل المتصفح (للمواقيت والأذان). */
    settings.setGeolocationEnabled(true);
    CookieManager.getInstance().setAcceptCookie(true);
    webView.setBackgroundColor(0xFFFAF7F1);

    webView.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return handleUrl(view, request.getUrl());
      }

      @SuppressWarnings("deprecation")
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return handleUrl(view, Uri.parse(url));
      }

      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        return serveLocal(request.getUrl());
      }

      @SuppressWarnings("deprecation")
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
        return serveLocal(Uri.parse(url));
      }

      @Override
      public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
        // الجسر (رمز الإشعارات والحساب) متاح فقط لصفحات نطاق ثمار.
        PushBridge.setTrustedOrigin(url != null && url.startsWith(APP_URL));
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        LaunchLog.add(WebFallbackActivity.this, "WebView انتهى تحميل: " + url);
        pageLoaded = true;
        String pending = PushBridge.peekPendingUrl();
        if (pending != null) {
          final String target = pending;
          webView.evaluateJavascript("typeof window.__thimarPushOpen === 'function'", (result) -> {
            if ("true".equals(result)) {
              PushBridge.consumePendingUrl();
              deliverDeepLink(target);
            }
          });
        }
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request,
                                  android.webkit.WebResourceError error) {
        LaunchLog.add(WebFallbackActivity.this,
            "WebView خطأ تحميل: " + request.getUrl() + " — " + error.getDescription());
        if (request.isForMainFrame()) {
          if (!isOnline()) showFirstUseOffline();
          else showOfflineError();
        }
      }
    });

    webView.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        if (request == null) return;
        runOnUiThread(() -> {
          Uri origin = request.getOrigin();
          String originStr = origin == null ? "" : origin.toString();
          /* السماح فقط للأصل الموثوق (ثمار) — لا منح تلقائي لكل الموارد. */
          if (!originStr.startsWith("https://thimar.freebuff.page")) {
            request.deny();
            return;
          }
          String[] requested = request.getResources();
          java.util.List<String> allowed = new java.util.ArrayList<>();
          boolean needAudio = false;
          boolean needVideo = false;
          for (String r : requested) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
              allowed.add(r);
              needAudio = true;
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
              allowed.add(r);
              needVideo = true;
            }
          }
          if (allowed.isEmpty()) {
            request.deny();
            return;
          }
          /* احترام صلاحيات وقت التشغيل (Android 6+). */
          java.util.List<String> toRequest = new java.util.ArrayList<>();
          if (needAudio && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
              != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            toRequest.add(android.Manifest.permission.RECORD_AUDIO);
          }
          if (needVideo && checkSelfPermission(android.Manifest.permission.CAMERA)
              != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            toRequest.add(android.Manifest.permission.CAMERA);
          }
          if (!toRequest.isEmpty()) {
            pendingPermissionRequest = request;
            pendingAllowedResources = allowed.toArray(new String[0]);
            requestPermissions(toRequest.toArray(new String[0]), REQUEST_MEDIA_PERMISSIONS);
            return;
          }
          request.grant(allowed.toArray(new String[0]));
        });
      }

      @Override
      public void onGeolocationPermissionsShowPrompt(
          String origin, android.webkit.GeolocationPermissions.Callback callback) {
        callback.invoke(origin, true, false);
      }

      @Override
      public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
        LaunchLog.add(WebFallbackActivity.this,
            "JS[" + message.messageLevel() + "] " + message.message() + " @" + message.lineNumber());
        return true;
      }

      @Override
      public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                       FileChooserParams params) {
        filePathCallback = callback;
        try {
          startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
          return true;
        } catch (Exception error) {
          filePathCallback = null;
          return false;
        }
      }
    });

    /* تنزيل الملفات (مثل ملفات التسميع) داخل التطبيق دون فتح نافذة اختيار. */
    webView.setDownloadListener(new DownloadListener() {
      @Override
      public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                  String mimeType, long contentLength) {
        try {
          String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
          DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
          request.setMimeType(mimeType);
          request.addRequestHeader("User-Agent", userAgent);
          request.setNotificationVisibility(
              DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
          request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
          DownloadManager manager =
              (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
          if (manager != null) {
            manager.enqueue(request);
            Toast.makeText(WebFallbackActivity.this, "جارٍ تنزيل الملف…", Toast.LENGTH_SHORT).show();
            return;
          }
        } catch (Exception error) {
          LaunchLog.add(WebFallbackActivity.this, "فشل التنزيل: " + error.getMessage());
        }
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
      }
    });

    /* جسر إشعارات FCM للصفحة (window.ThimarNative). */
    pushBridge = new PushBridge(this);
    webView.addJavascriptInterface(pushBridge, "ThimarNative");
    webView.addJavascriptInterface(new AdhanBridge(this), "ThimarAdhan");
    /* جسر تحديث APK (window.ThimarUpdater) — تحديث أصلي آمن مع تحقق SHA-256. */
    webView.addJavascriptInterface(new ThimarUpdater(this), "ThimarUpdater");
    /* جسر تحديث الموارد (window.ThimarAssetUpdater) — تحديث تفاضلي مستمر. */
    assetUpdater = new ThimarAssetUpdater(this, webView);
    webView.addJavascriptInterface(assetUpdater, "ThimarAssetUpdater");
    PushBridge.attach(webView, this);

    webView.loadUrl(APP_URL);
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode == PushBridge.REQUEST_NOTIFICATIONS) {
      boolean granted = grantResults.length > 0
          && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
      PushBridge.handlePermissionResult(this, requestCode, granted);
      return;
    }
    if (requestCode == REQUEST_MEDIA_PERMISSIONS) {
      boolean allGranted = grantResults.length > 0;
      for (int result : grantResults) {
        if (result != android.content.pm.PackageManager.PERMISSION_GRANTED) {
          allGranted = false;
          break;
        }
      }
      if (pendingPermissionRequest != null) {
        if (allGranted && pendingAllowedResources != null) {
          pendingPermissionRequest.grant(pendingAllowedResources);
        } else {
          pendingPermissionRequest.deny();
        }
        pendingPermissionRequest = null;
        pendingAllowedResources = null;
      }
      return;
    }
  }

  /**
   * يقدّم واجهة التطبيق وملفاتها من داخل الحزمة المثبَّتة (أصول www/) بدل الشبكة،
   * فيعمل أول تشغيل دون إنترنت. تُستثنى مسارات الخادم الحيّة (/api/ و /updates/)
   * فتبقى على الشبكة تمامًا كما هي، وكذلك أي مسار غير مضمَّن وغير موجود محليًا.
   */
  private WebResourceResponse serveLocal(Uri uri) {
    if (uri == null) return null;
    String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
    if (!host.equals(APP_HOST)) return null;
    String path = uri.getPath();
    if (path == null || path.isEmpty()) path = "/";
    /* الخادم الحيّ: واجهات API وبيانات التحديث تُجلب من الشبكة فقط. */
    if (path.startsWith("/api/") || path.startsWith("/updates/")) return null;
    if (path.contains("..")) return null;
    if (path.startsWith("/mushaf-pages/")) return serveMushafPage(uri);
    /*
     * أصول التسميع المضمَّنة (نماذج ONNX والمرجع وruntime) تُحزَّم في assets/offline
     * لا داخل assets/www، فتُخدَم من جذر الأصول. بدون هذا كان المسار /offline/v1/
     * يعود إلى الشبكة، أي أن المحرك المحلي لم يكن قابلًا للتحميل أصلًا على أندرويد.
     */
    String assetPath;
    if (path.startsWith("/offline/")) assetPath = path.substring(1);
    else assetPath = path.equals("/") ? "www/index.html" : "www" + path;
    WebResourceResponse local = openAsset(assetPath);
    if (local != null) return local;
    /* مسارات التطبيق (React) بلا امتداد: تُعرض الواجهة المضمَّنة نفسها. */
    if (!path.substring(path.lastIndexOf('/')).contains(".")) {
      WebResourceResponse shell = openAsset("www/index.html");
      if (shell != null) return shell;
    }
    return null;
  }

  private WebResourceResponse openAsset(String assetPath) {
    /* أصول محدثة في التخزين الدائم (لا تشمل نماذج التسميع المضمّنة). */
    if (!assetPath.startsWith("offline/")) {
      java.io.File updated = (assetUpdater != null) ? assetUpdater.resolveUpdatedFile(assetPath) : null;
      if (updated != null) {
        try {
          java.io.FileInputStream fis = new java.io.FileInputStream(updated);
          Map<String, String> headers = new HashMap<>();
          headers.put("Cache-Control", "no-cache");
          headers.put("X-Thimar-Updated-Asset", "1");
          return new WebResourceResponse(mimeTypeOf(assetPath), null, 200, "OK", headers, fis);
        } catch (Exception ignored) {
          /* fallback to bundled asset */
        }
      }
    }
    try {
      InputStream stream = getAssets().open(assetPath);
      Map<String, String> headers = new HashMap<>();
      headers.put("Cache-Control", "no-cache");
      headers.put("X-Thimar-Offline-Bundle", "1");
      WebResourceResponse response =
          new WebResourceResponse(mimeTypeOf(assetPath), null, 200, "OK", headers, stream);
      return response;
    } catch (Exception error) {
      return null;
    }
  }

  private static String mimeTypeOf(String path) {
    String lower = path.toLowerCase();
    if (lower.endsWith(".html")) return "text/html";
    if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
    if (lower.endsWith(".css")) return "text/css";
    if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json";
    if (lower.endsWith(".wasm")) return "application/wasm";
    if (lower.endsWith(".woff2")) return "font/woff2";
    if (lower.endsWith(".woff")) return "font/woff";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    if (lower.endsWith(".pdf")) return "application/pdf";
    if (lower.endsWith(".gz")) return "application/gzip";
    if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
    if (lower.endsWith(".onnx")) return "application/octet-stream";
    return "application/octet-stream";
  }

  /**
   * صفحات «مصحف التجويد الملون» (604 صفحات) مضمَّنة داخل التطبيق، فتُقدَّم من
   * ملفات التطبيق نفسها بدل الشبكة وتعمل دون إنترنت.
   */
  private WebResourceResponse serveMushafPage(Uri uri) {
    if (uri == null) return null;
    String path = uri.getPath();
    if (path == null || !path.startsWith("/mushaf-pages/")) return null;
    String name = path.substring("/mushaf-pages/".length());
    if (!name.matches("\\d{3}\\.webp")) return null;
    try {
      InputStream stream = getAssets().open("mushaf/" + name);
      Map<String, String> headers = new HashMap<>();
      headers.put("Cache-Control", "public, max-age=31536000, immutable");
      headers.put("Access-Control-Allow-Origin", "*");
      return new WebResourceResponse("image/webp", null, 200, "OK", headers, stream);
    } catch (Exception error) {
      LaunchLog.add(this, "صفحة مصحف غير متوفرة: " + name);
      return null;
    }
  }

  /** يتحقق من توفر إنترنت فعلي (وليس مجرد اتصال Wi-Fi). */
  private boolean isOnline() {
    try {
      ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
      if (cm == null) return false;
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
        Network network = cm.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        if (caps == null) return false;
        boolean hasInternet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        boolean validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        // على بعض الأجهزة VALIDATED قد يكون false مؤقتًا؛ نقبل INTERNET + NOT_SUSPENDED.
        boolean notSuspended = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_SUSPENDED);
        return hasInternet && notSuspended && (validated || true);
      }
      NetworkInfo info = cm.getActiveNetworkInfo();
      return info != null && info.isConnected();
    } catch (Exception ignored) {
      return false;
    }
  }

  /** شاشة توضيحية عند أول استخدام دون إنترنت (لا توجد نسخة محفوظة بعد). */
  private void showFirstUseOffline() {
    try {
      String html = "<html dir='rtl'><body style='background:#FAF7F1;font-family:sans-serif;padding:40px;color:#1F2937'>"
          + "<h2>أنت الآن في وضع عدم الاتصال</h2>"
          + "<p>ثمار يعمل دون إنترنت بعد أول فتح له باتصال. افتح التطبيق مرة واحدة باتصال إنترنت لتحميل الواجهة والموارد، ثم عُد دون اتصال.</p>"
          + "<button style='padding:12px 20px;font-size:16px;border-radius:10px;background:#2F5C4A;color:#fff;border:0' "
          + "onclick=\"location.replace('https://" + APP_HOST + "/')\">إعادة المحاولة</button></body></html>";
      webView.loadDataWithBaseURL(APP_URL, html, "text/html", "UTF-8", null);
    } catch (Exception ignored) {
      /* ignore */
    }
  }

  /** يستمع لتغيّرات الاتصال ويستعيد الوضع عبر الإنترنت تلقائيًا. */
  private void registerConnectivityCallback() {
    try {
      connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
      if (connectivityManager == null) return;
      networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override
        public void onAvailable(Network network) {
          runOnUiThread(() -> handleNetworkRestored());
        }
        @Override
        public void onLost(Network network) {
          runOnUiThread(() -> handleNetworkLost());
        }
      };
      NetworkRequest request = new NetworkRequest.Builder()
          .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          .build();
      connectivityManager.registerNetworkCallback(request, networkCallback);
      lastOnlineState = isOnline();
    } catch (Exception error) {
      LaunchLog.add(this, "تعذّر تسجيل مراقب الاتصال: " + error.getMessage());
    }
  }

  private void unregisterConnectivityCallback() {
    try {
      if (connectivityManager != null && networkCallback != null) {
        connectivityManager.unregisterNetworkCallback(networkCallback);
      }
    } catch (Exception ignored) {
      /* ignore */
    }
    connectivityManager = null;
    networkCallback = null;
  }

  private void handleNetworkRestored() {
    boolean nowOnline = isOnline();
    if (nowOnline == lastOnlineState) {
      // Even if state unchanged, notify the page so React can refresh data.
    }
    lastOnlineState = nowOnline;
    if (nowOnline && webView != null) {
      try {
        webView.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
        if (!pageLoaded) {
          webView.loadUrl(APP_URL);
        } else {
          webView.evaluateJavascript(
              "window.dispatchEvent(new Event('online')); if(window.__thimarRefresh) window.__thimarRefresh();", null);
        }
      } catch (Exception ignored) {
        /* ignore */
      }
    }
  }

  private void handleNetworkLost() {
    lastOnlineState = false;
    if (webView != null) {
      try {
        webView.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
        webView.evaluateJavascript("window.dispatchEvent(new Event('offline'));", null);
      } catch (Exception ignored) {
        /* ignore */
      }
    }
  }

  /** إن فشل تحميل الصفحة الأولى (شبكة/شهادة) تُعرض رسالة عربية مع إعادة المحاولة. */
  private void showOfflineError() {
    try {
      String html = "<html dir='rtl'><body style='background:#FAF7F1;font-family:sans-serif;padding:40px;color:#1F2937'>"
          + "<h2>تعذّر الاتصال بثمار</h2><p>تأكد من اتصال الإنترنت ثم أعد المحاولة.</p>"
          + "<button style='padding:12px 20px;font-size:16px;border-radius:10px;background:#2F5C4A;color:#fff;border:0' "
          + "onclick=\"location.replace('https://" + APP_HOST + "/')\">إعادة المحاولة</button></body></html>";
      webView.loadDataWithBaseURL(APP_URL, html, "text/html", "UTF-8", null);
    } catch (Exception ignored) {
      /* ignore */
    }
  }

  /** يبقي كل روابط الويب داخل التطبيق، ويُخرج فقط tel/mailto/whatsapp. */
  private boolean handleUrl(WebView view, Uri uri) {
    if (uri == null) return false;
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
    String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
    if (scheme.equals("http") || scheme.equals("https")) {
      if (host.endsWith(APP_HOST) || host.endsWith("freebuff.page")) {
        view.loadUrl(uri.toString());
        return true;
      }
      // روابط خارجية تُعرض داخل التطبيق أيضًا حتى لا يظهر «فتح بواسطة».
      view.loadUrl(uri.toString());
      return true;
    }
    if (scheme.equals("tel") || scheme.equals("mailto") || scheme.equals("sms")
        || scheme.equals("whatsapp")) {
      try {
        startActivity(new Intent(Intent.ACTION_VIEW, uri));
      } catch (Exception ignored) {
        /* لا يوجد تطبيق يدعم هذا الرابط. */
      }
      return true;
    }
    return false;
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    if (requestCode == FILE_CHOOSER_REQUEST && filePathCallback != null) {
      Uri[] results = null;
      if (resultCode == RESULT_OK && data != null && data.getData() != null) {
        results = new Uri[] { data.getData() };
      }
      filePathCallback.onReceiveValue(results);
      filePathCallback = null;
      return;
    }
    super.onActivityResult(requestCode, resultCode, data);
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
      webView.goBack();
      return true;
    }
    return super.onKeyDown(keyCode, event);
  }

  @Override
  protected void onDestroy() {
    unregisterConnectivityCallback();
    PushBridge.detach();
    if (webView != null) {
      webView.setWebChromeClient(null);
      webView.destroy();
      webView = null;
    }
    super.onDestroy();
  }
}
