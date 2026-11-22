import { test } from "node:test";
import assert from "node:assert/strict";
import { OfflinePackageDownloader, formatBytes, sha256Bytes, totalPackageBytes } from "../src/lib/offlinePackage.ts";

function memoryCache() {
  const store = new Map();
  return {
    async open() {
      return {
        async match(url) {
          const v = store.get(url);
          return v ? new Response(v) : undefined;
        },
        async put(url, res) {
          store.set(url, await res.arrayBuffer());
        },
        async delete(url) {
          store.delete(url);
        },
        async keys() {
          return [...store.keys()];
        },
      };
    },
    // expose for assertions
    _store: store,
  };
}

const originalCaches = globalThis.caches;

test("sha256Bytes matches node crypto", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const actual = await sha256Bytes(bytes);
  const crypto = await import("node:crypto");
  const expected = crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  assert.equal(actual, expected);
});

test("totalPackageBytes sums file sizes", () => {
  const manifest = { schema: 1, version: "1", appVersionCode: 1, baseUrl: "/x", files: [{ path: "a", bytes: 10, sha256: "0".repeat(64) }, { path: "b", bytes: 20, sha256: "0".repeat(64) }] };
  assert.equal(totalPackageBytes(manifest), 30);
});

test("formatBytes", () => {
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

test("download skips already-cached valid file and stores new file", async () => {
  const cacheStore = new Map();
  globalThis.caches = {
    async open() {
      return {
        async match(url) { const v = cacheStore.get(url); return v ? new Response(v) : undefined; },
        async put(url, res) { cacheStore.set(url, await res.arrayBuffer()); },
      };
    },
  };
  const crypto = await import("node:crypto");
  const data = new Uint8Array([7, 8, 9]);
  const hash = crypto.createHash("sha256").update(Buffer.from(data)).digest("hex");
  const manifest = { schema: 1, version: "1", appVersionCode: 1, baseUrl: "/x", files: [{ path: "f.bin", bytes: data.length, sha256: hash }] };
  // pre-cache the file
  cacheStore.set("/x/f.bin", data.buffer);
  const dl = new OfflinePackageDownloader(manifest);
  const progress = [];
  const res = await dl.download((p) => progress.push(p));
  assert.equal(res.ok, true);
  assert.equal(cacheStore.size, 1);
  globalThis.caches = originalCaches;
});

test("download detects size mismatch and does not store", async () => {
  const cacheStore = new Map();
  globalThis.caches = {
    async open() {
      return {
        async match() { return undefined; },
        async put(url, res) { cacheStore.set(url, await res.arrayBuffer()); },
      };
    },
  };
  const crypto = await import("node:crypto");
  const data = new Uint8Array([1, 2]);
  const hash = crypto.createHash("sha256").update(Buffer.from(data)).digest("hex");
  const manifest = { schema: 1, version: "1", appVersionCode: 1, baseUrl: "/x", files: [{ path: "g.bin", bytes: 999, sha256: hash }] };
  const dl = new OfflinePackageDownloader(manifest);
  // mock fetch
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(data);
  const res = await dl.download();
  globalThis.fetch = origFetch;
  assert.equal(res.ok, false);
  assert.match(res.error, /size mismatch/);
  assert.equal(cacheStore.size, 0);
  globalThis.caches = originalCaches;
});

test("verifyAll reports missing files", async () => {
  const cacheStore = new Map();
  globalThis.caches = {
    async open() {
      return {
        async match() { return undefined; },
        async put() {},
      };
    },
  };
  const manifest = { schema: 1, version: "1", appVersionCode: 1, baseUrl: "/x", files: [{ path: "missing.bin", bytes: 4, sha256: "0".repeat(64) }] };
  const dl = new OfflinePackageDownloader(manifest);
  const r = await dl.verifyAll();
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["missing.bin"]);
  globalThis.caches = originalCaches;
});
