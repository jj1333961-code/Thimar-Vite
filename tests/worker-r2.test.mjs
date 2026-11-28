/**
 * اختبار مسارات Worker الجديدة بلا شبكة:
 *  - /api/errors: يقبل POST فقط، ويحدّ حجم الجسم.
 *  - أصول R2: تخدم WASM/التسميع/فهرس البحث من env.FILES مع دعم Range.
 *  - أي مسار آخر يذهب إلى أصول الموقع.
 */
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker.js";

function fakeBucket(objects) {
  return {
    async get(key, options) {
      const item = objects[key];
      if (!item) return null;
      const bytes = item.bytes;
      const meta = item.contentType ? { contentType: item.contentType } : undefined;
      if (options?.range) {
        const offset = options.range.offset ?? 0;
        const length = options.range.length ?? bytes.length - offset;
        return {
          body: bytes.subarray(offset, offset + length),
          size: bytes.length,
          range: { offset, length },
          httpMetadata: meta,
          httpEtag: '"etag"',
        };
      }
      return {
        body: bytes,
        size: bytes.length,
        httpMetadata: meta,
        httpEtag: '"etag"',
      };
    },
  };
}

const assets = {
  async fetch(request) {
    return new Response(`ASSET:${new URL(request.url).pathname}`, { status: 200 });
  },
};

const bytes = new TextEncoder().encode("0123456789");

function env(objects = {}, extra = {}) {
  return { ASSETS: assets, FILES: fakeBucket(objects), ...extra };
}

test("/api/errors rejects non-POST", async () => {
  const response = await worker.fetch(new Request("https://thimar.test/api/errors"), env());
  assert.equal(response.status, 405);
});

test("/api/errors accepts a small payload and rejects an oversized one", async () => {
  const ok = await worker.fetch(
    new Request("https://thimar.test/api/errors", {
      method: "POST",
      body: JSON.stringify({ message: "boom", stack: "at app.ts:1" }),
      headers: { "content-type": "application/json" },
    }),
    env(),
  );
  assert.equal(ok.status, 202);
  assert.equal((await ok.json()).ok, true);

  const tooBig = await worker.fetch(
    new Request("https://thimar.test/api/errors", {
      method: "POST",
      body: "x".repeat(7000),
      headers: { "content-type": "application/json" },
    }),
    env(),
  );
  assert.equal(tooBig.status, 413);
});

test("/api/errors rejects invalid JSON", async () => {
  const response = await worker.fetch(
    new Request("https://thimar.test/api/errors", {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    }),
    env(),
  );
  assert.equal(response.status, 400);
});

test("serves large assets from R2 with wasm content type", async () => {
  const response = await worker.fetch(
    new Request("https://thimar.test/assets/large/asr.wasm"),
    env({ "assets/large/asr.wasm": { bytes, contentType: "application/wasm" } }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/wasm");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(await response.text(), "0123456789");
});

test("supports Range requests on R2 assets", async () => {
  const response = await worker.fetch(
    new Request("https://thimar.test/offline/v1/model.onnx", {
      headers: { range: "bytes=2-5" },
    }),
    env({ "offline/v1/model.onnx": { bytes } }),
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await response.text(), "2345");
});

test("serves the quran search index from R2 as JSON", async () => {
  const response = await worker.fetch(
    new Request("https://thimar.test/quran/search-index.json"),
    env({ "quran/search-index.json": { bytes, contentType: "application/json" } }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
});

test("falls back to site assets when the R2 object is missing", async () => {
  const response = await worker.fetch(new Request("https://thimar.test/assets/large/missing.wasm"), env());
  assert.equal(await response.text(), "ASSET:/assets/large/missing.wasm");
});

test("other paths are served by site assets", async () => {
  const response = await worker.fetch(new Request("https://thimar.test/"), env());
  assert.equal(await response.text(), "ASSET:/");
});

test("asset upload requires the upload token", async () => {
  const response = await worker.fetch(
    new Request("https://thimar.test/api/admin/assets/assets/large/a.wasm", {
      method: "PUT",
      body: bytes,
    }),
    env({}, { ASSET_UPLOAD_TOKEN: "secret-token" }),
  );
  assert.equal(response.status, 403);
});

test("asset upload rejects paths outside the allowed prefixes", async () => {
  const response = await worker.fetch(
    new Request("https://thimar.test/api/admin/assets/secret.txt", {
      method: "PUT",
      body: bytes,
      headers: { "x-upload-token": "secret-token" },
    }),
    env({}, { ASSET_UPLOAD_TOKEN: "secret-token" }),
  );
  assert.equal(response.status, 400);
});

test("asset upload stores the object in R2", async () => {
  const stored = {};
  const bucket = {
    async put(key, body, options) {
      stored[key] = { bytes: new Uint8Array(body), contentType: options?.httpMetadata?.contentType };
    },
  };
  const response = await worker.fetch(
    new Request("https://thimar.test/api/admin/assets/offline/v1/manifest.json", {
      method: "PUT",
      body: bytes,
      headers: { "x-upload-token": "secret-token", "content-type": "application/json" },
    }),
    { ASSETS: assets, FILES: bucket, ASSET_UPLOAD_TOKEN: "secret-token" },
  );
  assert.equal(response.status, 200);
  assert.equal(stored["offline/v1/manifest.json"].contentType, "application/json");
  assert.equal(new TextDecoder().decode(stored["offline/v1/manifest.json"].bytes), "0123456789");
});

test("asset upload reports missing storage", async () => {
  const response = await worker.fetch(
    new Request("https://thimar.test/api/admin/assets/quran/x.json", {
      method: "PUT",
      body: bytes,
      headers: { "x-upload-token": "secret-token" },
    }),
    { ASSETS: assets, ASSET_UPLOAD_TOKEN: "secret-token" },
  );
  assert.equal(response.status, 501);
});

test("every site response carries the hardening headers", async () => {
  const response = await worker.fetch(
    new Request("https://thimar.test/updates/android.json"),
    { ASSETS: assets },
  );
  const csp = response.headers.get("content-security-policy") || "";
  assert.ok(csp.includes("default-src 'self'"), "CSP default-src missing");
  assert.ok(csp.includes("frame-ancestors 'none'"), "CSP frame-ancestors missing");
  assert.ok(csp.includes("object-src 'none'"), "CSP object-src missing");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok((response.headers.get("strict-transport-security") || "").includes("max-age="));
  assert.ok((response.headers.get("permissions-policy") || "").includes("payment=()"));
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
});

test("R2 asset responses are hardened too", async () => {
  const bucket = fakeBucket({
    "quran/search-index.json": { bytes: bytes, contentType: "application/json" },
  });
  const response = await worker.fetch(
    new Request("https://thimar.test/quran/search-index.json"),
    { ASSETS: assets, FILES: bucket },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.ok(response.headers.get("content-security-policy"));
});

test("AI proxy requires an authenticated session and exposes no wildcard CORS", async () => {
  const response = await worker.fetch(
    new Request("https://thimar.test/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    }),
    { ASSETS: assets, AI_API_KEY: "test-key" },
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTH_REQUIRED");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("AI proxy rejects an invalid bearer token", async () => {
  const response = await worker.fetch(
    new Request("https://thimar.test/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer not-a-real-token" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    }),
    { ASSETS: assets, AI_API_KEY: "test-key", VITE_SUPABASE_URL: "https://example.invalid", VITE_SUPABASE_ANON_KEY: "anon" },
  );
  assert.equal(response.status, 401);
});

test("AI proxy rejects a structurally valid but unissued session token", async () => {
  const payload = Buffer.from(JSON.stringify({ sub: "acct_test", jti: "jti_test", iat: 1, exp: 9999999999, scope: "session" })).toString("base64url");
  const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.forgedsignature`;
  const response = await worker.fetch(
    new Request("https://thimar.test/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    }),
    { ASSETS: assets, AI_API_KEY: "test-key", VITE_SUPABASE_URL: "https://example.invalid", VITE_SUPABASE_ANON_KEY: "anon" },
  );
  assert.equal(response.status, 401);
});

test("AI proxy admits a session the identity server confirms", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    seen.push(url);
    if (url.includes("/functions/v1/thimar-calls")) {
      return new Response(JSON.stringify({ call: null }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/chat/completions")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "تم" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  };
  try {
    const payload = Buffer.from(
      JSON.stringify({ sub: "acct_live", jti: "jti_live", iat: 1, exp: Math.floor(Date.now() / 1000) + 600, scope: "session" }),
    ).toString("base64url");
    const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.sig`;
    const response = await worker.fetch(
      new Request("https://thimar.test/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      }),
      { ASSETS: assets, AI_API_KEY: "test-key", VITE_SUPABASE_URL: "https://supabase.test", VITE_SUPABASE_ANON_KEY: "anon" },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).content, "تم");
    assert.ok(seen.some((url) => url.includes("/functions/v1/thimar-calls")), "identity check must run before the provider call");
  } finally {
    globalThis.fetch = realFetch;
  }
});
