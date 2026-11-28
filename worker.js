import { handlePush } from "./freebuff-sites-build/push.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-3.5-flash";
const MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-3.8-flash"];

/** مسارات الأصول الثقيلة التي تُخدَم من R2 بدل حزمة الموقع (حد 10 MiB). */
const R2_PREFIXES = ["/assets/large/", "/offline/v1/", "/quran/search-index.json", "/quran/tajweed.json"];
const R2_CACHE_SECONDS = 60 * 60 * 24 * 30;

const MIME_BY_EXTENSION = {
  wasm: "application/wasm",
  mjs: "text/javascript; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  bin: "application/octet-stream",
  onnx: "application/octet-stream",
  txt: "text/plain; charset=utf-8",
  gz: "application/gzip",
};

/**
 * امتدادات ملفات ثابتة لا يجوز أبدًا أن يُردّ عليها بصفحة HTML.
 *
 * عامل المواقع يردّ على أي مسار غير موجود بـ index.html (SPA fallback) بترميز
 * text/html وحالة 200؛ فإذا كانت الحزمة المضفّرة المطلوبة قد تغيّر اسمها بعد
 * تحديث (أو كان العميل يستعمل نسخة قديمة من index.html) يرفض المتصفح تشغيل
 * الوحدة النمطية لخطأ MIME، فيبقى #root فارغًا وتظهر صفحة بيضاء بلا رسالة.
 */
const STATIC_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".map",
  ".json",
  ".wasm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".ico",
  ".mp3",
  ".mp4",
  ".webm",
  ".pdf",
  ".txt",
  ".xml",
  ".webmanifest",
]);

function looksLikeStaticFile(pathname) {
  const dot = pathname.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = pathname.slice(dot).toLowerCase();
  return STATIC_EXTENSIONS.has(ext);
}

function notFoundAsset(pathname) {
  return new Response(`Not found: ${pathname}`, {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // لا نُخزّن 404: قد تُرفع الحزمة بعد لحظات أثناء التحديث.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function contentTypeFor(key, metadataType) {
  if (metadataType) return metadataType;
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[ext] || "application/octet-stream";
}

function parseRange(header) {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header || "").trim());
  if (!match) return null;
  const start = match[1] === "" ? null : Number(match[1]);
  const end = match[2] === "" ? null : Number(match[2]);
  if (start === null && end === null) return null;
  return { start, end };
}

/**
 * يخدم ملفات WASM ومحرك التسميع وفهرس البحث من حزمة R2 (`env.FILES`)
 * مع دعم Range حتى لا تُحمّل الملفات الكبيرة كاملة عند الاستئناف.
 */
async function serveFromR2(request, env, url) {
  if (!env?.FILES) return null;
  const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!key || key.includes("..")) return null;

  const isHead = request.method === "HEAD";
  if (request.method !== "GET" && !isHead) return null;

  const range = parseRange(request.headers.get("range"));
  let object = null;
  try {
    if (range && range.start !== null) {
      const length = range.end !== null ? range.end - range.start + 1 : undefined;
      object = await env.FILES.get(key, {
        range: length ? { offset: range.start, length } : { offset: range.start },
      });
    } else {
      object = await env.FILES.get(key);
    }
  } catch {
    return null;
  }
  if (!object) return null;

  const headers = new Headers();
  headers.set("Content-Type", contentTypeFor(key, object.httpMetadata?.contentType));
  headers.set("Cache-Control", `public, max-age=${R2_CACHE_SECONDS}, immutable`);
  headers.set("Accept-Ranges", "bytes");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  if (object.httpMetadata?.contentLanguage) {
    headers.set("Content-Language", object.httpMetadata.contentLanguage);
  }

  if (object.range && range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? 0;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(isHead ? null : object.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(object.size));
  return new Response(isHead ? null : object.body, { status: 200, headers });
}

/**
 * مراقبة أخطاء الإنتاج: تُسجَّل في سجلات Worker بلا أي أسرار.
 * الحد صغير عمدًا حتى لا يُستخدم كنفق إرسال.
 */
async function handleClientError(request) {
  if (request.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  const text = await request.text();
  if (text.length > 6000) return json(413, { error: "TOO_LARGE" });
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "INVALID_JSON" });
  }
  const record = {
    kind: "client_error",
    at: new Date().toISOString(),
    message: String(body?.message ?? "").slice(0, 500),
    stack: String(body?.stack ?? "").slice(0, 2000),
    source: String(body?.source ?? "").slice(0, 200),
    accountId: String(body?.accountId ?? "").slice(0, 80),
    role: String(body?.role ?? "").slice(0, 20),
    version: String(body?.version ?? "").slice(0, 40),
    platform: String(body?.platform ?? "").slice(0, 40),
    url: String(body?.url ?? "").slice(0, 300),
    ua: (request.headers.get("user-agent") || "").slice(0, 200),
    country: request.headers.get("cf-ipcountry") || "",
  };
  console.error(JSON.stringify(record));
  return json(202, { ok: true });
}


/**
 * رفع محمي لأصول R2 (WASM/نموذج التسميع/فهرس البحث).
 *
 *   PUT /api/admin/assets/<key>  مع ترويسة x-upload-token: <ASSET_UPLOAD_TOKEN>
 *
 * لا مصادقة بلا ترويسة مطابقة، والمسار محصور في المجلدات الثلاثة المعروفة.
 */
const UPLOAD_PREFIXES = ["assets/large/", "offline/v1/", "quran/"];

function sameSecret(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleAssetUpload(request, env, url) {
  if (request.method !== "PUT") return json(405, { error: "METHOD_NOT_ALLOWED" });
  if (!env?.FILES) return json(501, { error: "STORAGE_NOT_CONFIGURED" });
  if (!env.ASSET_UPLOAD_TOKEN) return json(501, { error: "UPLOAD_DISABLED" });
  if (!sameSecret(request.headers.get("x-upload-token") || "", env.ASSET_UPLOAD_TOKEN)) {
    return json(403, { error: "FORBIDDEN" });
  }
  const key = decodeURIComponent(url.pathname.replace(/^\/api\/admin\/assets\/+/, ""));
  if (!key || key.includes("..") || !UPLOAD_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return json(400, { error: "INVALID_KEY" });
  }
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 60 * 1024 * 1024) return json(413, { error: "TOO_LARGE" });
  const contentType = request.headers.get("content-type") || contentTypeFor(key);
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return json(400, { error: "EMPTY_BODY" });
    await env.FILES.put(key, body, { httpMetadata: { contentType } });
  } catch (error) {
    return json(502, { error: "UPLOAD_FAILED", detail: String(error).slice(0, 200) });
  }
  return json(200, { ok: true, key });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // إشعارات الدفع (Web Push + FCM) — تعمل والتطبيق مغلق.
    if (url.pathname.startsWith("/api/push/")) {
      const handled = await handlePush(request, env, url);
      if (handled) return handled;
    }

    if (url.pathname === "/api/errors") {
      return handleClientError(request);
    }

    if (url.pathname.startsWith("/api/admin/assets/")) {
      return handleAssetUpload(request, env, url);
    }

    if (url.pathname === "/api/ai/health") {
      const key = env.AI_API_KEY || env.GEMINI_API_KEY;
      return json(200, {
        configured: Boolean(key),
        model: DEFAULT_MODEL,
        models: MODELS,
      });
    }

    if (url.pathname === "/api/ai/chat") {
      if (request.method === "OPTIONS") {
        return new Response("ok", {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
          },
        });
      }
      if (request.method !== "POST") {
        return json(405, { error: "METHOD_NOT_ALLOWED" });
      }
      const key = env.AI_API_KEY || env.GEMINI_API_KEY;
      if (!key) {
        return json(501, { error: "AI_NOT_CONFIGURED" });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json(400, { error: "INVALID_JSON" });
      }
      if (!Array.isArray(body?.messages) || body.messages.length === 0) {
        return json(400, { error: "MESSAGES_REQUIRED" });
      }
      const upstream = await fetch(`${GEMINI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: body.messages,
          temperature: Math.min(1, Math.max(0, body.temperature ?? 0.4)),
          max_tokens: Math.min(1200, Math.max(64, body.max_tokens ?? 500)),
        }),
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        return json(502, {
          error: "UPSTREAM_ERROR",
          status: upstream.status,
          detail: text.slice(0, 500),
        });
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return json(502, { error: "INVALID_UPSTREAM_RESPONSE" });
      }
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return json(502, { error: "EMPTY_AI_RESPONSE" });
      }
      return json(200, { content, model: data?.model || DEFAULT_MODEL });
    }

    /* الأصول الثقيلة من R2 قبل الرجوع إلى أصول الموقع. */
    if (R2_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
      const asset = await serveFromR2(request, env, url);
      if (asset) return asset;
      /* الأصل غير موجود في R2: نُجرّب أصول الموقع (قد لا يزال الملف مضمَّنًا
         في الحزمة) قبل إرجاع 404؛ يمنع هذا الرجوع SPA fallback HTML. */
    }

    if (looksLikeStaticFile(url.pathname)) {
      const asset = await env.ASSETS.fetch(request);
      // عامل المواقع يعيد index.html لأي مسار غير موجود: نمنع ذلك للملفات
      // الثابتة كي لا تصل حزمة JS بترميز HTML (سبب الصفحة البيضاء).
      if (asset.ok && /text\/html/i.test(asset.headers.get("content-type") || "")) {
        return notFoundAsset(url.pathname);
      }
      return asset;
    }

    return env.ASSETS.fetch(request);
  },
};
