import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedFetch } from "../src/lib/offlineCache.ts";

function memoryCaches() {
  const values = new Map();
  return {
    values,
    async open() {
      return {
        async match(key) {
          const value = values.get(key);
          return value ? value.clone() : undefined;
        },
        async put(key, response) {
          values.set(key, response.clone());
        },
      };
    },
  };
}

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;

test("online Quran fetch replaces stale cached content", async () => {
  const cache = memoryCaches();
  globalThis.caches = cache;
  const url = "https://example.test/quran-resource.json";
  cache.values.set(url, new Response("old", { status: 200 }));
  let requestOptions;
  globalThis.fetch = async (_input, options) => {
    requestOptions = options;
    return new Response("new", { status: 200 });
  };

  try {
    const response = await cachedFetch(url);
    assert.equal(await response.text(), "new");
    assert.equal(await (await cache.values.get(url).clone()).text(), "new");
    assert.equal(requestOptions.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});

test("cached Quran content is used only when the network is unavailable", async () => {
  const cache = memoryCaches();
  globalThis.caches = cache;
  const url = "https://example.test/quran-resource.json";
  cache.values.set(url, new Response("cached-valid-content", { status: 200 }));
  globalThis.fetch = async () => {
    throw new TypeError("offline");
  };

  try {
    const response = await cachedFetch(url);
    assert.equal(await response.text(), "cached-valid-content");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});

test("network HTTP errors are returned and not cached as successful resources", async () => {
  const cache = memoryCaches();
  globalThis.caches = cache;
  const url = "https://example.test/quran-resource.json";
  globalThis.fetch = async () => new Response("not found", { status: 404 });

  try {
    const response = await cachedFetch(url);
    assert.equal(response.status, 404);
    assert.equal(cache.values.has(url), false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});
