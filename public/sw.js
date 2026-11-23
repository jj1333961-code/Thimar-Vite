/* ثمار — عامل الخدمة: يشغّل التطبيق والمصحف والتحفة والأذكار والأحاديث دون إنترنت. */
const VERSION = "v38";
const SHELL_CACHE = `thimar-shell-${VERSION}`;
const DATA_CACHE = "thimar-data-v1";
const RUNTIME_CACHE = "thimar-runtime-v1";
const MUSHAF_CACHE = "thimar-mushaf-pages-v3";
const LARGE_CACHE = "thimar-large-v1";

const CORE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

/** يجلب ملفات البناء المضفّرة (assets/*.js و*.css) من صفحة index. */
async function assetUrls() {
  try {
    const response = await fetch("/index.html", { cache: "no-store" });
    if (!response.ok) return [];
    const html = await response.text();
    const found = new Set();
    const regex = /(?:src|href)="(\/[^"]+\.(?:js|css))"/g;
    let match;
    while ((match = regex.exec(html))) found.add(match[1]);
    return [...found];
  } catch {
    return [];
  }
}

async function addAllSafe(cacheName, urls) {
  const cache = await caches.open(cacheName);
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (response.ok) await cache.put(url, response);
      } catch {
        // ملف غير متاح الآن — يُخزَّن عند أول استخدام.
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // تخزين الغلاف (shell) والأصول المضفّرة (JS/CSS) لضمان الفتح دون إنترنت
      // بعد أول زيارة (أو تحديث) — لا نعتمد على التخزين التلقائي فقط.
      const assets = await assetUrls();
      await addAllSafe(SHELL_CACHE, [...CORE, ...assets]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key !== SHELL_CACHE &&
              key !== DATA_CACHE &&
              key !== RUNTIME_CACHE &&
              key !== MUSHAF_CACHE &&
              key !== LARGE_CACHE &&
              key !== "thimar-quran-v1" &&
              key.startsWith("thimar-"),
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** يستجيب من الكاش أولًا، ويحدّث النسخة في الخلفية. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone());
      })
      .catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/** الشبكة أولًا حتى لا يعرض المتصفح ملف موارد قديمًا عند توفر الإنترنت. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response("", { status: 504 });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /*
   * حزمة أندرويد المضمَّنة (/offline/v1/*) تُقدَّم من داخل التطبيق عبر
   * shouldInterceptRequest، ولا يدخل عامل الخدمة بينهما: لا نسخ ٩٢ م.ب من النماذج
   * إلى Cache Storage، ولا طلب شبكة لها في وضع الطيران.
   */
  if (url.origin === self.location.origin && url.pathname.startsWith("/offline/")) return;

  /* صور صفحات مصحف التجويد: تُخزَّن بعد أول عرض فتُقرأ دون إنترنت. */
  if ((url.hostname === "cdn.jsdelivr.net" || url.hostname === "raw.githubusercontent.com") && url.pathname.includes("awradi-mushaf")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MUSHAF_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) await cache.put(request, response.clone());
          return response;
        } catch {
          return new Response("", { status: 504 });
        }
      })(),
    );
    return;
  }

  /* نطاقات خارجية نحتاجها دون إنترنت: الخطوط، نصوص القرآن، التفسير، الأحاديث، المواقيت. */
  const OFFLINE_HOSTS = [
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "api.quran.com",
    "api.alquran.cloud",
    "api.aladhan.com",
    "cdn.jsdelivr.net",
    "api.qurancdn.com",
    "static.qurancdn.com",
  ];

  if (url.origin !== self.location.origin) {
    if (!OFFLINE_HOSTS.includes(url.hostname)) return;
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(request);
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          if (cached) return cached;
          return new Response(JSON.stringify({ offline: true }), {
            status: 503,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }
      })(),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put("/index.html", response.clone());
          return response;
        } catch {
          const cached =
            (await caches.match("/index.html")) || (await caches.match("/"));
          return cached || new Response("التطبيق غير متاح دون إنترنت بعد.", { status: 503 });
        }
      })(),
    );
    return;
  }

  /* بيانات التحديث (android.json/ios.json): الشبكة فقط — لا تُخزَّن في الكاش لتفادي بيانات قديمة. */
  if (url.pathname.startsWith("/updates/")) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request, { cache: "no-store" });
          return response;
        } catch {
          return new Response(JSON.stringify({ offline: true }), {
            status: 503,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }
      })(),
    );
    return;
  }

  /* ملفات البناء المضفّرة: الشبكة أولًا حتى تصل أحدث نسخة فورًا، والكاش عند انقطاع الإنترنت. */
  if (url.pathname.startsWith("/assets/")) {
    const cacheName = url.pathname.startsWith("/assets/large/") ? LARGE_CACHE : SHELL_CACHE;
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(request);
          return cached || new Response("", { status: 504 });
        }
      })(),
    );
    return;
  }

  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/adhan/") ||
    url.pathname.startsWith("/quran/") ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return new Response("", { status: 504 });
      }
    })(),
  );
});

/* ---------------- الإشعارات خارج التطبيق ---------------- */

async function showExternalNotification(title, body, url, tag, image) {
  await self.registration.showNotification(title || "ثمار", {
    body: body || "لديك تحديث جديد في ثمار.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    dir: "rtl",
    lang: "ar",
    vibrate: [200, 100, 200],
    tag: tag || "thimar-external",
    renotify: true,
    ...(image ? { image } : {}),
    data: { url: url || "/", image },
  });
}

async function notifyOpenClients() {
  try {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    list.forEach((client) => client.postMessage({ type: "thimar-background-check" }));
  } catch {
    /* ignore */
  }
}

/* رسائل الدفع (Push) عند إعداد خادم إشعارات لاحقًا. */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    showExternalNotification(payload.title, payload.body, payload.url, payload.tag, payload.image),
  );
});

/* رسالة من التطبيق لعرض إشعار خارجي عبر عامل الخدمة. */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "thimar-notify") {
    event.waitUntil(showExternalNotification(data.title, data.body, data.url, data.tag, data.image));
  }
  if (data.type === "thimar-check-now") {
    event.waitUntil(notifyOpenClients());
  }
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* Background Sync: يوقظ التطبيق عند عودة الإنترنت. */
self.addEventListener("sync", (event) => {
  if (event.tag === "thimar-notifications") event.waitUntil(notifyOpenClients());
});

/* Periodic Background Sync: فحص دوري حيث يدعمه النظام. */
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "thimar-check") event.waitUntil(notifyOpenClients());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
