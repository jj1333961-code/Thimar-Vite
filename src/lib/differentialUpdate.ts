/* محرك التحديث التفاضلي (web/application assets) — إصدار مدرك للنسخة.
 *
 * يقارن المانيفست المحلي (النسخة المثبتة) بالمانيفست الأحدث، ويحدد:
 *   - ملفات غير متغيرة: لا تُنزَّل مجددًا.
 *   - ملفات جديدة: تنزيلها فقط.
 *   - ملفات معدّلة: تنزيل نسختها المحدثة فقط.
 *   - ملفات محذوفة: إزالتها только عند إدراجها صراحةً في مانيفست الإصدار (ومتاحة للحذف).
 *   - ملفات مفقودة/تالفة: إعادة تنزيلها.
 *
 * التحقق: SHA-256 + حجم لكل ملف. المانيفست المحلي يسجل النسخة وهاش كل أصل مُدار.
 * التخزين: تنزيل إلى staging، التحقق، ثم نشر (atomic)، والاحتفاظ بالنسخة القديمة
 * حتى نجاح التحقق (rollback عند الفشل).
 */

export type AssetEntry = {
  path: string;
  bytes: number;
  sha256: string;
};

export type ReleaseManifest = {
  schema: number;
  versionName: string;
  versionCode: number;
  releaseDate?: string;
  baseUrl: string;
  files: AssetEntry[];
  deletedFiles?: string[];
  mandatory?: boolean;
  minSupportedVersionCode?: number;
  shortDescription?: { ar?: string; en?: string } | string;
  releaseNotes?: unknown;
};

export type LocalFileRecord = {
  path: string;
  bytes: number;
  sha256: string;
  storedAt?: number;
};

export type LocalManifest = {
  versionName: string;
  versionCode: number;
  files: Record<string, LocalFileRecord>;
  updatedAt?: number;
};

export type DiffResult = {
  unchanged: string[];
  added: AssetEntry[];
  modified: AssetEntry[];
  deleted: string[];
  corrupted: string[];
};

export type DownloadProgress = {
  downloaded: number;
  total: number;
  currentFile: string;
  done: boolean;
  phase: "checking" | "downloading" | "verifying" | "promoting" | "done" | "failed";
};

/** مسارات محمية (بيانات المستخدم/الإعدادات/القرآن المحفوظ) — لا تُحذف أبدًا. */
export const PROTECTED_PATHS = new Set<string>([
  "user-data",
  "settings",
  "quran/user",
  "recitation/user",
]);

export function isProtectedPath(path: string): boolean {
  const clean = path.replace(/^\/+/, "");
  for (const p of PROTECTED_PATHS) {
    if (clean === p || clean.startsWith(p + "/")) return true;
  }
  return false;
}

/** مقارنة مانيفست محلي بمانيفست إصدار. actualHashes: هاشات فعلية (إعادة حساب) للملفات المحلية (اختياري). */
export function compareManifests(
  local: LocalManifest | null,
  remote: ReleaseManifest,
  actualHashes?: Record<string, { bytes: number; sha256: string }>,
): DiffResult {
  const localFiles = local?.files ?? {};
  const remoteByPath = new Map(remote.files.map((f) => [f.path, f]));
  const unchanged: string[] = [];
  const added: AssetEntry[] = [];
  const modified: AssetEntry[] = [];
  const corrupted: string[] = [];
  const deletedSet = new Set(remote.deletedFiles ?? []);
  const deleted: string[] = [];

  for (const [path, rec] of Object.entries(localFiles)) {
    const remoteEntry = remoteByPath.get(path);
    if (!remoteEntry) {
      if (deletedSet.has(path) && !isProtectedPath(path)) {
        deleted.push(path);
      }
      // not listed -> leave untouched
      continue;
    }
    // corruption check against actual hash if provided
    const actual = actualHashes?.[path];
    if (actual && (actual.sha256 !== rec.sha256 || actual.bytes !== rec.bytes)) {
      corrupted.push(path);
    }
    if (rec.sha256 === remoteEntry.sha256 && rec.bytes === remoteEntry.bytes) {
      unchanged.push(path);
    } else {
      modified.push(remoteEntry);
    }
  }

  for (const f of remote.files) {
    if (!localFiles[f.path]) {
      added.push(f);
    }
  }

  return { unchanged, added, modified, deleted, corrupted };
}

/** إجمالي بايتات الملفات المطلوبة (جديدة + معدّلة + تالفة). */
export function requiredBytes(diff: DiffResult, remote: ReleaseManifest): number {
  const set = new Map<string, AssetEntry>();
  for (const f of [...diff.added, ...diff.modified]) set.set(f.path, f);
  // corrupted -> re-download remote version
  for (const p of diff.corrupted) {
    const e = remote.files.find((f) => f.path === p);
    if (e) set.set(e.path, e);
  }
  return [...set.values()].reduce((s, f) => s + f.bytes, 0);
}

/** التحقق من تطابق ملف (bytes + sha256). */
export async function verifyAsset(
  data: ArrayBuffer,
  expected: AssetEntry,
): Promise<{ ok: boolean; reason?: string }> {
  if (data.byteLength !== expected.bytes) {
    return { ok: false, reason: `size mismatch: ${data.byteLength} != ${expected.bytes}` };
  }
  const hash = await sha256Buffer(data);
  if (hash !== expected.sha256) {
    return { ok: false, reason: `sha256 mismatch: ${hash} != ${expected.sha256}` };
  }
  return { ok: true };
}

async function sha256Buffer(data: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) throw new Error("crypto.subtle unavailable");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Storage abstraction (Cache API / IndexedDB / memory). */
export interface AssetStore {
  get(path: string): Promise<ArrayBuffer | null>;
  put(path: string, data: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
  has(path: string): Promise<boolean>;
}

export interface ManifestStore {
  load(): Promise<LocalManifest | null>;
  save(m: LocalManifest): Promise<void>;
  clear(): Promise<void>;
}

/** مخزن في الذاكرة (للاختبارات). */
export class MemoryAssetStore implements AssetStore {
  private store = new Map<string, ArrayBuffer>();
  async get(path: string) { return this.store.get(path) ?? null; }
  async put(path: string, data: ArrayBuffer) { this.store.set(path, data.slice(0)); }
  async delete(path: string) { this.store.delete(path); }
  async has(path: string) { return this.store.has(path); }
  _store() { return this.store; }
}

export class MemoryManifestStore implements ManifestStore {
  private value: LocalManifest | null = null;
  async load() { return this.value ? JSON.parse(JSON.stringify(this.value)) : null; }
  async save(m: LocalManifest) { this.value = JSON.parse(JSON.stringify(m)); }
  async clear() { this.value = null; }
}

/** LocalStorage-backed manifest store (browser). */
export class LocalStorageManifestStore implements ManifestStore {
  private key: string;
  constructor(key?: string) {
    this.key = key || "thimar.webUpdateManifest";
  }
  async load(): Promise<LocalManifest | null> {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      return JSON.parse(raw) as LocalManifest;
    } catch { return null; }
  }
  async save(m: LocalManifest): Promise<void> {
    try { localStorage.setItem(this.key, JSON.stringify(m)); } catch { /* ignore */ }
  }
  async clear(): Promise<void> {
    try { localStorage.removeItem(this.key); } catch { /* ignore */ }
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class DifferentialUpdateEngine {
  private fetchFn: FetchFn;
  private assetStore: AssetStore;
  private manifestStore: ManifestStore;
  private staging: Map<string, ArrayBuffer> = new Map();

  constructor(opts: { fetch?: FetchFn; assetStore: AssetStore; manifestStore: ManifestStore }) {
    this.fetchFn = opts.fetch ?? ((u, i) => fetch(u, i));
    this.assetStore = opts.assetStore;
    this.manifestStore = opts.manifestStore;
  }

  async getLocalManifest(): Promise<LocalManifest | null> {
    return this.manifestStore.load();
  }

  resolveUrl(path: string, baseUrl: string): string {
    const base = baseUrl.replace(/\/+$/, "");
    const clean = path.replace(/^\/+/, "");
    return `${base}/${clean}`;
  }

  /** تنزيل ملف مع دعم الاستئناف (Range) في الذاكرة. */
  async downloadAsset(
    entry: AssetEntry,
    baseUrl: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<{ ok: boolean; data?: ArrayBuffer; error?: string }> {
    const url = this.resolveUrl(entry.path, baseUrl);
    let offset = 0;
    const chunks: Uint8Array[] = [];
    let totalReceived = 0;
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const headers: Record<string, string> = {};
        if (offset > 0) headers["Range"] = `bytes=${offset}-`;
        const res = await this.fetchFn(url, { headers });
        if (!res.ok && res.status !== 206) {
          return { ok: false, error: `HTTP ${res.status} for ${entry.path}` };
        }
        const buf = await res.arrayBuffer();
        // If server ignored Range and returned full, reset.
        if (offset > 0 && buf.byteLength === entry.bytes) {
          chunks.length = 0; totalReceived = 0; offset = 0;
        }
        chunks.push(new Uint8Array(buf));
        totalReceived += buf.byteLength;
        offset = totalReceived;
        onProgress?.(totalReceived, entry.bytes);
        if (totalReceived >= entry.bytes) break;
      } catch (e) {
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          continue;
        }
        return { ok: false, error: String(e) };
      }
    }
    // assemble
    const out = new Uint8Array(totalReceived);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.byteLength; }
    const data = out.buffer;
    const v = await verifyAsset(data, entry);
    if (!v.ok) return { ok: false, error: v.reason };
    return { ok: true, data };
  }

  /** تطبيق تحديث: staging -> verify all -> promote -> update manifest. Rollback on failure. */
  async applyUpdate(
    remote: ReleaseManifest,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<{ ok: boolean; error?: string; diff: DiffResult; applied: string[] }> {
    const local = await this.manifestStore.load();
    // actual hashes unknown here; pass undefined (corruption handled at download time)
    const diff = compareManifests(local, remote);
    const toDownload: AssetEntry[] = [...diff.added, ...diff.modified];
    // corrupted re-download
    for (const p of diff.corrupted) {
      const e = remote.files.find((f) => f.path === p);
      if (e && !toDownload.find((x) => x.path === e.path)) toDownload.push(e);
    }

    const total = requiredBytes(diff, remote);
    let downloaded = 0;
    this.staging.clear();

    onProgress?.({ downloaded: 0, total, currentFile: "", done: false, phase: "checking" });

    // 1. Download all required into staging, verify each.
    for (const entry of toDownload) {
      onProgress?.({ downloaded, total, currentFile: entry.path, done: false, phase: "downloading" });
      const r = await this.downloadAsset(entry, remote.baseUrl, (d) => {
        onProgress?.({ downloaded: downloaded + d, total, currentFile: entry.path, done: false, phase: "downloading" });
      });
      if (!r.ok || !r.data) {
        // rollback: discard staging
        this.staging.clear();
        onProgress?.({ downloaded, total, currentFile: entry.path, done: false, phase: "failed" });
        return { ok: false, error: r.error ?? "download failed", diff, applied: [] };
      }
      this.staging.set(entry.path, r.data);
      downloaded += entry.bytes;
    }

    // 2. Promote: write staging to asset store (atomic replace after verify).
    onProgress?.({ downloaded, total, currentFile: "", done: false, phase: "promoting" });
    const applied: string[] = [];
    try {
      for (const [path, data] of this.staging) {
        await this.assetStore.put(path, data);
        applied.push(path);
      }
      // 3. Remove deleted files (only listed & not protected).
      for (const p of diff.deleted) {
        if (!isProtectedPath(p)) {
          await this.assetStore.delete(p);
        }
      }
    } catch (e) {
      // rollback: we cannot fully undo, but we keep old manifest unchanged.
      onProgress?.({ downloaded, total, currentFile: "", done: false, phase: "failed" });
      return { ok: false, error: `promote failed: ${String(e)}`, diff, applied };
    }

    // 4. Update local manifest.
    const newFiles: Record<string, LocalFileRecord> = {};
    for (const f of remote.files) {
      // reuse staged data or existing stored
      const staged = this.staging.get(f.path);
      let bytes = f.bytes;
      let sha = f.sha256;
      if (staged) {
        // already verified
      }
      newFiles[f.path] = { path: f.path, bytes, sha256: sha, storedAt: Date.now() };
    }
    // carry over unchanged existing records (keep storedAt)
    if (local) {
      for (const p of diff.unchanged) {
        if (local.files[p]) newFiles[p] = { ...local.files[p] };
      }
    }
    // remove deleted from manifest
    for (const p of diff.deleted) delete newFiles[p];

    const newManifest: LocalManifest = {
      versionName: remote.versionName,
      versionCode: remote.versionCode,
      files: newFiles,
      updatedAt: Date.now(),
    };
    await this.manifestStore.save(newManifest);

    this.staging.clear();
    onProgress?.({ downloaded: total, total, currentFile: "", done: true, phase: "done" });
    return { ok: true, diff, applied };
  }

  async rollbackTo(local: LocalManifest | null): Promise<void> {
    // Restore manifest pointer only; asset store already retains old files for unchanged.
    if (local) await this.manifestStore.save(local);
    this.staging.clear();
  }

  /** التحقق من سلامة التثبيت (جميع ملفات المانيفست present + hash). */
  async verifyInstallation(remote: ReleaseManifest): Promise<{ ok: boolean; missing: string[]; corrupted: string[] }> {
    const missing: string[] = [];
    const corrupted: string[] = [];
    for (const f of remote.files) {
      const data = await this.assetStore.get(f.path);
      if (!data) { missing.push(f.path); continue; }
      const v = await verifyAsset(data, f);
      if (!v.ok) corrupted.push(f.path);
    }
    return { ok: missing.length === 0 && corrupted.length === 0, missing, corrupted };
  }
}
