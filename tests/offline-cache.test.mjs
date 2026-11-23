import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithOfflineFallback } from "../src/lib/offlineCacheCore.ts";

function memoryCache() {
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

test("online Quran fetch replaces stale cached content", async () => {
  const cache = memoryCache();
  const url = "https://example.test/quran-resource.json";
  cache.values.set(url, new Response("old", { status: 200 }));
  let requestOptions;
  const response = await fetchWithOfflineFallback(
    url,
    async () => null,
    () => cache.open(),
    async (_input, options) => {
      requestOptions = options;
      return new Response("new", { status: 200 });
    },
  );

  assert.equal(await response.text(), "new");
  assert.equal(await cache.values.get(url).clone().text(), "new");
  assert.equal(requestOptions.cache, "no-store");
});

test("cached Quran content is used only when the network is unavailable", async () => {
  const cache = memoryCache();
  const url = "https://example.test/quran-resource.json";
  cache.values.set(url, new Response("cached-valid-content", { status: 200 }));
  const response = await fetchWithOfflineFallback(
    url,
    async () => null,
    () => cache.open(),
    async () => {
      throw new TypeError("offline");
    },
  );

  assert.equal(await response.text(), "cached-valid-content");
});

test("network HTTP errors are returned and not cached as successful resources", async () => {
  const cache = memoryCache();
  const url = "https://example.test/quran-resource.json";
  const response = await fetchWithOfflineFallback(
    url,
    async () => null,
    () => cache.open(),
    async () => new Response("not found", { status: 404 }),
  );

  assert.equal(response.status, 404);
  assert.equal(cache.values.has(url), false);
});

test("local Quran response takes priority without a network request", async () => {
  const local = new Response("local-quran", { status: 200 });
  let networkCalls = 0;
  const response = await fetchWithOfflineFallback(
    "https://api.alquran.cloud/v1/page/1",
    async () => local.clone(),
    async () => null,
    async () => {
      networkCalls += 1;
      return new Response("network");
    },
  );

  assert.equal(await response.text(), "local-quran");
  assert.equal(networkCalls, 0);
});
