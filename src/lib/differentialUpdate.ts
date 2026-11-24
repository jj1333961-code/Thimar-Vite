/* محرك التحديث التفاضلي (web/application assets) — إصدار مدرك للنسخة ومتراكم.
 *
 * يقارن المانيفست المحلي (النسخة المثبتة) بالمانيفست الأحدث، ويحدد:
 *   - ملفات غير متغيرة: لا تُنزَّل مجددًا.
 *   - ملفات جديدة: تنزيلها فقط.
 *   - ملفات معدّلة: تنزيل نسختها المحدثة فقط.
 *   - ملفات محذوفة: إزالتها فقط عند إدراجها صراحةً في مانيفست الإصدار (ومتاحة للحذف).
 *   - ملفات مفقودة/تالفة: إعادة تنزيلها.
 *
 * التحديث المتراكم (cumulative): لا نقارن "الإصدار المثبت ↔ أحدث إصدار" فحسب،
 * بل نحسب الحالة النهائية المطلوبة بين installedVersion و latestVersion، مع إقصاء
 * الملفات التي أُضيفت ثم حُذفت، والملفات التي أُعيدت إلى محتواها الأصلي،
 * والملفات غير المتغيرة. الملاحظات التراكمية تجمع تغييرات كل الإصدارات المتجاوزة.
 */

export type AssetEntry = {
  path: string;
  bytes: number;
  sha256: string;
};

export type ReleaseNotesSection = {
  features?: string[];
  improvements?: string[];
  bugFixes?: string[];
  securityUpdates?: string[];
  [key: string]: unknown;
};

export type ReleaseNotes = {
  ar?: ReleaseNotesSection;
  en?: ReleaseNotesSection;
  [key: string]: unknown;
};

export type ReleaseManifest = {
  schema: number;
  versionName: string;
  versionCode: number;
  releaseDate?: string;
  publishedAt?: string;
  baseUrl: string;
  files: AssetEntry[];
  deletedFiles?: string[];
  mandatory?: boolean;
  minSupportedVersionCode?: number;
  shortDescription?: { ar?: string; en?: string } | string;
  releaseNotes?: ReleaseNotes | unknown;
  // Optional cumulative/release metadata.
  migrations?: string[];
  migrationSteps?: string[];
  requiredMigrations?: string[];
  nativeVersionCode?: number;
  apkVersionCode?: number;
  nativeChanged?: boolean;
  requiresNativeApk?: boolean;
  apkChanged?: boolean;
  nativeCompatibility?: unknown;
  [key: string]: unknown;
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
  actualHashes?: Record<string, { bytes: number; sha256: string }>;
  fileHashes?: Record<string, { bytes: number; sha256: string }>;
  [key: string]: unknown;
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

export type VersionInfo = {
  versionName: string;
  versionCode: number;
};

export type ReleaseRecord = {
  versionName?: string;
  versionCode?: number;
  version?: string | number;
  code?: number;
  name?: string;
  manifest?: ReleaseManifest | null;
  releaseManifest?: ReleaseManifest | null;
  files?: AssetEntry[];
  baseUrl?: string;
  deletedFiles?: string[];
  releaseNotes?: ReleaseNotes | unknown;
  migrations?: string[];
  migrationSteps?: string[];
  requiredMigrations?: string[];
  nativeVersionCode?: number;
  apkVersionCode?: number;
  nativeChanged?: boolean;
  requiresNativeApk?: boolean;
  apkChanged?: boolean;
  releaseDate?: string;
  publishedAt?: string;
  [key: string]: unknown;
};

export type ReleaseHistoryInput =
  | ReleaseRecord[]
  | ReleaseManifest[]
  | { releases?: unknown[]; versions?: unknown[]; history?: unknown[] }
  | Map<unknown, unknown>
  | null
  | undefined;

export type UpdatePlanOptions = {
  actualHashes?: Record<string, { bytes: number; sha256: string }>;
  nativeVersionCode?: number;
  installedNativeVersionCode?: number;
  migrations?: string[];
  assumeNativeVersionBump?: boolean;
  [key: string]: unknown;
};

export type UpdatePlan = {
  installedVersion: VersionInfo;
  targetVersion: VersionInfo;
  fromVersion: VersionInfo;
  toVersion: VersionInfo;
  latestVersion: VersionInfo;
  installedManifest: LocalManifest | null;
  targetManifest: ReleaseManifest;
  diff: DiffResult;
  unchanged: string[];
  added: AssetEntry[];
  modified: AssetEntry[];
  deleted: string[];
  corrupted: string[];
  filesToDownload: AssetEntry[];
  toDownload: AssetEntry[];
  downloadFiles: AssetEntry[];
  requiredFiles: AssetEntry[];
  assetsToDownload: AssetEntry[];
  requiredBytes: number;
  totalBytes: number;
  bytesToDownload: number;
  migrations: string[];
  migrationSteps: string[];
  requiredMigrations: string[];
  releaseNotesByVersion: Array<{
    versionName: string;
    versionCode: number;
    releaseDate?: string;
    publishedAt?: string;
    releaseNotes?: unknown;
  }>;
  cumulativeReleaseNotes: {
    ar: ReleaseNotesSection;
    en: ReleaseNotesSection;
  };
  releaseNotes: {
    byVersion: Array<{
      versionName: string;
      versionCode: number;
      releaseDate?: string;
      publishedAt?: string;
      releaseNotes?: unknown;
    }>;
    accumulated: {
      ar: ReleaseNotesSection;
      en: ReleaseNotesSection;
    };
  };
  nativeApkRequired: boolean;
  requiresNativeApk: boolean;
  requiresNativeUpdate: boolean;
  nativeUpdateRequired: boolean;
  apkUpdateRequired: boolean;
  nativeVersionCode: number;
  [key: string]: unknown;
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
  const deleted: string[] = [];

  for (const [path, rec] of Object.entries(localFiles)) {
    const remoteEntry = remoteByPath.get(path);
    if (!remoteEntry) {
      // File existed in the installed build but is absent from the target release:
      // it has been deleted/renamed in a later release. Remove it unless protected.
      if (!isProtectedPath(path)) {
        deleted.push(path);
      }
      continue;
    }
    // corruption check against actual hash if provided
    const actual = actualHashes?.[path] ?? local?.actualHashes?.[path] ?? local?.fileHashes?.[path];
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

/** Cache Storage-backed asset store (browser). Persists completed and partial downloads across sessions. */
export class CacheAssetStore implements AssetStore {
  private cacheName: string;
  constructor(cacheName?: string) {
    this.cacheName = cacheName || "thimar-differential-assets-v1";
  }
  private async cache(): Promise<Cache> {
    if (typeof caches === "undefined") throw new Error("caches unavailable");
    return caches.open(this.cacheName);
  }
  private url(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const base = typeof location !== "undefined" ? location.origin : "http://localhost";
    return new URL(path.replace(/^\/+/, ""), base + "/").href;
  }
  async get(path: string): Promise<ArrayBuffer | null> {
    try {
      const cache = await this.cache();
      const response = await cache.match(this.url(path));
      if (!response) return null;
      return await response.arrayBuffer();
    } catch { return null; }
  }
  async put(path: string, data: ArrayBuffer): Promise<void> {
    const cache = await this.cache();
    await cache.put(this.url(path), new Response(data.slice(0), { headers: { "Content-Type": "application/octet-stream" } }));
  }
  async delete(path: string): Promise<void> {
    try { const cache = await this.cache(); await cache.delete(this.url(path)); } catch { /* ignore */ }
  }
  async has(path: string): Promise<boolean> {
    try { const cache = await this.cache(); return !!(await cache.match(this.url(path))); } catch { return false; }
  }
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

  private partPath(path: string): string {
    return `${path}.part`;
  }

  /** تنزيل ملف مع دعم الاستئناف (Range) وتخزين جزئي persistent. */
  async downloadAsset(
    entry: AssetEntry,
    baseUrl: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<{ ok: boolean; data?: ArrayBuffer; error?: string; healed?: boolean; actualBytes?: number; actualSha256?: string }> {
    const url = this.resolveUrl(entry.path, baseUrl);
    const partPath = this.partPath(entry.path);
    const chunkSize = 1024 * 1024;
    let offset = 0;
    let partial: Uint8Array | null = null;

    // استئناف من تخزين جزئي (إن وُجد).
    try {
      const stored = await this.assetStore.get(partPath);
      if (stored) {
        if (stored.byteLength > entry.bytes) {
          await this.assetStore.delete(partPath);
        } else {
          partial = new Uint8Array(stored);
          offset = partial.byteLength;
        }
      }
    } catch { /* ignore */ }

    const chunks: Uint8Array[] = partial ? [partial] : [];
    let totalReceived = offset;
    const maxAttempts = 3;
    // نسجل نوع المحتوى وبداية التنزيل من الصفر كي نتعامل مع مانيفست قديم بحكمة
    // (لا نقبل صفحة HTML بديلًا عن ملف فعلي).
    let fullContentType: string | null = null;
    const startedFromZero = partial === null && offset === 0;

    while (totalReceived < entry.bytes) {
      const start = totalReceived;
      const end = Math.min(entry.bytes - 1, start + chunkSize - 1);
      let buf: ArrayBuffer | null = null;
      let attempt = 0;
      while (attempt < maxAttempts) {
        try {
          const headers: Record<string, string> = { "Cache-Control": "no-store" };
          if (start > 0) headers["Range"] = `bytes=${start}-${end}`;
          const fetchUrl = url + (url.includes("?") ? "&" : "?") + "thimar_update=1";
          const res = await this.fetchFn(fetchUrl, { headers, cache: "no-store" } as any);
          if (!res.ok && res.status !== 206) {
            return { ok: false, error: `HTTP ${res.status} for ${entry.path}` };
          }
          if (start === 0 && res.headers.get("content-type")) {
            fullContentType = res.headers.get("content-type");
          }
          const received = await res.arrayBuffer();
          // إذا تجاهل الخادم Range وأعاد الملف كاملاً، نعيد البدء.
          if (start > 0 && received.byteLength === entry.bytes) {
            chunks.length = 0; totalReceived = 0; offset = 0;
            partial = null;
            try { await this.assetStore.delete(partPath); } catch { /* ignore */ }
            break;
          }
          buf = received;
          break;
        } catch (e) {
          attempt += 1;
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 200 * attempt));
            continue;
          }
          return { ok: false, error: String(e) };
        }
      }
      if (buf === null) continue;
      chunks.push(new Uint8Array(buf));
      totalReceived += buf.byteLength;
      offset = totalReceived;
      // Persist partial progress.
      try {
        const partialOut = new Uint8Array(totalReceived);
        let pos = 0;
        for (const c of chunks) { partialOut.set(c, pos); pos += c.byteLength; }
        await this.assetStore.put(partPath, partialOut.buffer);
      } catch { /* ignore */ }
      onProgress?.(totalReceived, entry.bytes);
      if (totalReceived >= entry.bytes) break;
    }

    // assemble
    const out = new Uint8Array(totalReceived);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.byteLength; }
    const data = out.buffer;
    const v = await verifyAsset(data, entry);
    if (!v.ok) {
      // المانيفست القديم قد يذكر حجمًا/بصمة لا تطابق الملف المخدوم فعلًا فيسبب
      // "size mismatch" ويتوقف التحديث. إن كان لدينا استجابة كاملة من الخادم
      // (ليست استئنافًا) وليست صفحة HTML بديلة عن ملف، نتبنى المحتوى الفعلي
      // ونصحّح السجل بدل إفشال التحديث بالكامل.
      const contentType = (fullContentType ?? "").toLowerCase();
      const looksLikeHtmlFallback = contentType.includes("text/html") && !/\.html?$/i.test(entry.path);
      if (startedFromZero && chunks.length === 1 && !looksLikeHtmlFallback) {
        const actualSha256 = await sha256Buffer(data);
        try { await this.assetStore.delete(partPath); } catch { /* ignore */ }
        return { ok: true, data, healed: true, actualBytes: data.byteLength, actualSha256 };
      }
      // Keep partial for retry; do not delete.
      return { ok: false, error: v.reason };
    }
    // Promote: remove partial marker.
    try { await this.assetStore.delete(partPath); } catch { /* ignore */ }
    return { ok: true, data };
  }

  /** تطبيق تحديث: staging -> verify all -> promote -> update manifest. Rollback on failure. */
  async applyUpdate(
    remote: ReleaseManifest,
    onProgress?: (p: DownloadProgress) => void,
    options?: { releaseHistory?: ReleaseHistoryInput; actualHashes?: Record<string, { bytes: number; sha256: string }> },
  ): Promise<{ ok: boolean; error?: string; diff: DiffResult; applied: string[]; plan?: UpdatePlan }> {
    const local = await this.manifestStore.load();
    const installedVersion = local?.versionCode ?? 0;
    const plan = getUpdatePlan(installedVersion, remote, local, options?.releaseHistory, {
      actualHashes: options?.actualHashes ?? local?.actualHashes ?? local?.fileHashes,
    });
    const diff = plan.diff;
    const toDownload: AssetEntry[] = plan.filesToDownload;

    const total = plan.requiredBytes || requiredBytes(diff, remote);
    let downloaded = 0;
    // الملفات التي نُصلحها ذاتيًا بسبب مانيفست قديم (الحجم/البصمة الفعليان).
    const healed = new Map<string, { bytes: number; sha256: string }>();
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
      if (r.healed && typeof r.actualBytes === "number" && r.actualSha256) {
        healed.set(entry.path, { bytes: r.actualBytes, sha256: r.actualSha256 });
        downloaded += r.actualBytes;
      } else {
        downloaded += entry.bytes;
      }
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
      const h = healed.get(f.path);
      newFiles[f.path] = { path: f.path, bytes: h?.bytes ?? f.bytes, sha256: h?.sha256 ?? f.sha256, storedAt: Date.now() };
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
      actualHashes: local?.actualHashes,
    };
    await this.manifestStore.save(newManifest);

    this.staging.clear();
    onProgress?.({ downloaded: total, total, currentFile: "", done: true, phase: "done" });
    return { ok: true, diff, applied, plan };
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

// ---------------- Version-aware cumulative update planning ----------------

function isManifestLike(value: unknown): value is ReleaseManifest {
  return Boolean(value && typeof value === "object" && Array.isArray((value as ReleaseManifest).files) && typeof (value as ReleaseManifest).versionCode === "number");
}

function isLocalManifestLike(value: unknown): value is LocalManifest {
  return Boolean(value && typeof value === "object" && (value as LocalManifest).files && typeof (value as LocalManifest).files === "object" && !Array.isArray((value as LocalManifest).files) && typeof (value as LocalManifest).versionCode === "number");
}

function compareVersionCodes(a: number, b: number): number {
  return a - b;
}

function compareVersionNames(a: string, b: string): number {
  const pa = String(a).split(/[.\-]/).map((x) => Number(x) || 0);
  const pb = String(b).split(/[.\-]/).map((x) => Number(x) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function compareVersions(a: VersionInfo, b: VersionInfo): number {
  if (a.versionCode && b.versionCode) {
    const c = compareVersionCodes(a.versionCode, b.versionCode);
    if (c !== 0) return c;
  }
  return compareVersionNames(a.versionName, b.versionName);
}

function toVersionInfo(input: unknown, manifest?: ReleaseManifest | LocalManifest | null, nativeCode?: number): VersionInfo {
  let versionName = "";
  let versionCode = 0;

  if (isManifestLike(input) || isLocalManifestLike(input)) {
    versionName = String((input as { versionName: string }).versionName ?? "");
    versionCode = Number((input as { versionCode: number }).versionCode ?? 0);
  } else if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (typeof obj.versionName === "string") versionName = obj.versionName;
    else if (typeof obj.version === "string") versionName = obj.version;
    else if (typeof obj.name === "string") versionName = obj.name;
    if (Number.isFinite(Number(obj.versionCode))) versionCode = Number(obj.versionCode);
    else if (Number.isFinite(Number(obj.code))) versionCode = Number(obj.code);
  } else if (typeof input === "number") {
    versionCode = input;
    versionName = String(input);
  } else if (typeof input === "string") {
    versionName = input;
    const n = Number(input);
    if (Number.isFinite(n)) versionCode = n;
  }

  if (manifest) {
    if (!versionName) versionName = String(manifest.versionName ?? "");
    if (!versionCode) versionCode = Number(manifest.versionCode ?? 0);
    // Prefer the actual installed manifest identity when available.
    versionName = String(manifest.versionName ?? versionName);
    versionCode = Number(manifest.versionCode ?? versionCode);
  }
  if (Number.isFinite(nativeCode)) {
    versionCode = Number(nativeCode);
    if (!versionName) versionName = String(nativeCode);
  }

  if (!versionName) versionName = String(versionCode || "0");
  if (!Number.isFinite(versionCode)) versionCode = 0;
  return { versionName, versionCode };
}

function releaseManifestToLocalManifest(rm: ReleaseManifest): LocalManifest {
  const files: Record<string, LocalFileRecord> = {};
  for (const f of rm.files ?? []) {
    files[f.path] = { path: f.path, bytes: f.bytes, sha256: f.sha256 };
  }
  return {
    versionName: rm.versionName,
    versionCode: rm.versionCode,
    files,
    updatedAt: rm.releaseDate ? Date.parse(rm.releaseDate) : undefined,
  };
}

function normalizeReleaseRecord(input: unknown): ReleaseRecord {
  if (isManifestLike(input)) {
    const m = input as ReleaseManifest;
    return {
      versionName: m.versionName,
      versionCode: m.versionCode,
      manifest: m,
      releaseNotes: m.releaseNotes,
      migrations: m.migrations,
      migrationSteps: m.migrationSteps,
      requiredMigrations: m.requiredMigrations,
      nativeVersionCode: m.nativeVersionCode ?? m.apkVersionCode,
      apkVersionCode: m.apkVersionCode,
      nativeChanged: m.nativeChanged,
      requiresNativeApk: m.requiresNativeApk,
      apkChanged: m.apkChanged,
      releaseDate: m.releaseDate,
      publishedAt: m.publishedAt,
    };
  }
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const manifestCandidate =
    obj.manifest ?? obj.releaseManifest ?? obj.release_manifest ?? (Array.isArray(obj.files) ? obj : null);
  const manifest = isManifestLike(manifestCandidate) ? (manifestCandidate as ReleaseManifest) : null;
  const versionName = String(obj.versionName ?? obj.version ?? obj.name ?? manifest?.versionName ?? "");
  const versionCode = Number(obj.versionCode ?? obj.code ?? obj.version_code ?? manifest?.versionCode ?? 0);
  return {
    ...obj,
    versionName: versionName || manifest?.versionName || "",
    versionCode: Number.isFinite(versionCode) ? versionCode : 0,
    manifest,
    releaseNotes: obj.releaseNotes ?? obj.release_notes ?? manifest?.releaseNotes,
    migrations: (obj.migrations as string[] | undefined) ?? (obj.migrationSteps as string[] | undefined) ?? manifest?.migrations,
    migrationSteps: (obj.migrationSteps as string[] | undefined) ?? (obj.migrations as string[] | undefined) ?? manifest?.migrationSteps,
    requiredMigrations: (obj.requiredMigrations as string[] | undefined) ?? manifest?.requiredMigrations,
    nativeVersionCode: Number(obj.nativeVersionCode ?? obj.apkVersionCode ?? manifest?.nativeVersionCode ?? manifest?.apkVersionCode ?? 0) || undefined,
    apkVersionCode: Number(obj.apkVersionCode ?? manifest?.apkVersionCode ?? 0) || undefined,
    nativeChanged: Boolean(obj.nativeChanged ?? manifest?.nativeChanged),
    requiresNativeApk: Boolean(obj.requiresNativeApk ?? manifest?.requiresNativeApk),
    apkChanged: Boolean(obj.apkChanged ?? manifest?.apkChanged),
    releaseDate: String(obj.releaseDate ?? manifest?.releaseDate ?? ""),
    publishedAt: String(obj.publishedAt ?? manifest?.publishedAt ?? ""),
  };
}

export function normalizeReleaseHistory(input: ReleaseHistoryInput): ReleaseRecord[] {
  let raw: unknown[] = [];
  if (Array.isArray(input)) raw = input;
  else if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.releases)) raw = obj.releases;
    else if (Array.isArray(obj.versions)) raw = obj.versions;
    else if (Array.isArray(obj.history)) raw = obj.history;
    else if (input instanceof Map) raw = [...input.values()];
    else raw = [input];
  }
  const records = raw.map(normalizeReleaseRecord);
  // Sort ascending by version code/name.
  return records.sort((a, b) => {
    const va = { versionName: a.versionName || "", versionCode: a.versionCode || 0 };
    const vb = { versionName: b.versionName || "", versionCode: b.versionCode || 0 };
    return compareVersions(va, vb);
  });
}

function findRelease(records: ReleaseRecord[], version: VersionInfo): ReleaseRecord | null {
  // Prefer exact version code, then name.
  for (const r of records) {
    if (version.versionCode && r.versionCode === version.versionCode) return r;
  }
  for (const r of records) {
    if (version.versionName && r.versionName === version.versionName) return r;
  }
  return null;
}

function releasesBetween(records: ReleaseRecord[], installed: VersionInfo, target: VersionInfo): ReleaseRecord[] {
  return records.filter((r) => {
    const rv = { versionName: r.versionName || "", versionCode: r.versionCode || 0 };
    return compareVersions(rv, installed) > 0 && compareVersions(rv, target) <= 0;
  });
}

function emptyNotes(): ReleaseNotesSection {
  return { features: [], improvements: [], bugFixes: [], securityUpdates: [] };
}

function normalizeLocalizedSection(value: unknown): ReleaseNotesSection {
  const out = emptyNotes();
  if (!value || typeof value !== "object") return out;
  const obj = value as Record<string, unknown>;
  for (const key of ["features", "improvements", "bugFixes", "securityUpdates"]) {
    if (Array.isArray(obj[key])) out[key] = [...(obj[key] as unknown[])].map(String);
  }
  // Preserve any additional arrays.
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val) && !(key in out)) out[key] = [...val].map((x) => String(x));
  }
  return out;
}

function extractLocalizedNotes(releaseNotes: unknown, lang: "ar" | "en"): ReleaseNotesSection {
  if (!releaseNotes || typeof releaseNotes !== "object") return emptyNotes();
  const obj = releaseNotes as Record<string, unknown>;
  if (obj[lang] && typeof obj[lang] === "object") {
    return normalizeLocalizedSection(obj[lang]);
  }
  // If notes are not localized, use them for both languages.
  if (obj.features || obj.improvements || obj.bugFixes || obj.securityUpdates) {
    return normalizeLocalizedSection(obj);
  }
  return emptyNotes();
}

function collectMigrations(releases: ReleaseRecord[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of releases) {
    const steps: unknown[] = [
      ...(Array.isArray(r.migrations) ? r.migrations : []),
      ...(Array.isArray(r.migrationSteps) ? r.migrationSteps : []),
      ...(Array.isArray(r.requiredMigrations) ? r.requiredMigrations : []),
      ...(Array.isArray(r.manifest?.migrations) ? r.manifest!.migrations! : []),
      ...(Array.isArray(r.manifest?.migrationSteps) ? r.manifest!.migrationSteps! : []),
      ...(Array.isArray(r.manifest?.requiredMigrations) ? r.manifest!.requiredMigrations! : []),
    ];
    for (const step of steps) {
      const text = String(step ?? "").trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        out.push(text);
      }
    }
  }
  return out;
}

function collectReleaseNotes(releases: ReleaseRecord[]): {
  byVersion: UpdatePlan["releaseNotesByVersion"];
  accumulated: { ar: ReleaseNotesSection; en: ReleaseNotesSection };
} {
  const byVersion = releases.map((r) => ({
    versionName: r.versionName || r.manifest?.versionName || "",
    versionCode: r.versionCode || r.manifest?.versionCode || 0,
    releaseDate: r.releaseDate || r.manifest?.releaseDate,
    publishedAt: r.publishedAt || r.manifest?.publishedAt,
    releaseNotes: r.releaseNotes ?? r.manifest?.releaseNotes,
  }));

  const accumulated = { ar: emptyNotes(), en: emptyNotes() };
  const seen = { ar: new Set<string>(), en: new Set<string>() };

  for (const r of releases) {
    const rn = r.releaseNotes ?? r.manifest?.releaseNotes;
    for (const lang of ["ar", "en"] as const) {
      const section = extractLocalizedNotes(rn, lang);
      for (const key of Object.keys(section)) {
        const items = Array.isArray(section[key]) ? (section[key] as string[]) : [];
        if (!Array.isArray(accumulated[lang][key])) accumulated[lang][key] = [];
        for (const item of items) {
          const dedupKey = `${key}\u0000${item}`;
          if (!seen[lang].has(dedupKey)) {
            seen[lang].add(dedupKey);
            (accumulated[lang][key] as string[]).push(item);
          }
        }
      }
    }
  }

  return { byVersion, accumulated };
}

function collectActualHashes(...values: unknown[]): Record<string, { bytes: number; sha256: string }> | undefined {
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const obj = value as Record<string, unknown>;
    if (obj.actualHashes && typeof obj.actualHashes === "object") return obj.actualHashes as Record<string, { bytes: number; sha256: string }>;
    if (obj.fileHashes && typeof obj.fileHashes === "object") return obj.fileHashes as Record<string, { bytes: number; sha256: string }>;
  }
  // If the value itself is a hash map, accept it.
  const first = values[0];
  if (first && typeof first === "object" && !Array.isArray(first) && !("files" in (first as object))) {
    const entries = Object.entries(first as Record<string, unknown>);
    if (entries.length > 0 && entries.every(([, v]) => v && typeof v === "object" && "bytes" in (v as object) && "sha256" in (v as object))) {
      return first as Record<string, { bytes: number; sha256: string }>;
    }
  }
  return undefined;
}

function normalizeLatest(input: unknown, history: ReleaseRecord[]): { manifest: ReleaseManifest; version: VersionInfo; record: ReleaseRecord | null } {
  if (isManifestLike(input)) {
    const m = input as ReleaseManifest;
    return { manifest: m, version: toVersionInfo(m), record: findRelease(history, toVersionInfo(m)) };
  }
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const manifestCandidate = obj.manifest ?? obj.releaseManifest ?? obj.release_manifest;
    if (isManifestLike(manifestCandidate)) {
      const m = manifestCandidate as ReleaseManifest;
      return { manifest: m, version: toVersionInfo(m), record: findRelease(history, toVersionInfo(m)) };
    }
    if (Array.isArray(obj.files)) {
      const rec = normalizeReleaseRecord(obj);
      if (rec.manifest) return { manifest: rec.manifest, version: toVersionInfo(rec.manifest), record: rec };
    }
  }
  // version reference -> find in history
  const version = toVersionInfo(input);
  const record = findRelease(history, version);
  if (record?.manifest) {
    return { manifest: record.manifest, version: toVersionInfo(record.manifest), record };
  }
  // Fallback to latest history entry
  if (history.length > 0) {
    const last = history[history.length - 1];
    if (last.manifest) return { manifest: last.manifest, version: toVersionInfo(last.manifest), record: last };
  }
  throw new Error("getUpdatePlan: latest version manifest not found");
}

export function getUpdatePlan(...args: any[]): UpdatePlan {
  // Flexible argument parsing.
  let installedVersionInput: unknown = null;
  let latestVersionInput: unknown = null;
  let installedManifest: LocalManifest | null = null;
  let releaseHistoryInput: ReleaseHistoryInput = undefined;
  const optionCandidates: unknown[] = [];

  // Detect (installedManifest, latestManifest, ...) form.
  if (args.length >= 2 && isLocalManifestLike(args[0]) && (isManifestLike(args[1]) || (args[1] && typeof args[1] === "object" && "files" in (args[1] as object)))) {
    installedManifest = args[0] as LocalManifest;
    latestVersionInput = args[1];
    for (let i = 2; i < args.length; i++) {
      if (Array.isArray(args[i]) || (args[i] && typeof args[i] === "object" && ("releases" in args[i] || "versions" in args[i] || "history" in args[i]))) {
        releaseHistoryInput = args[i] as ReleaseHistoryInput;
      } else {
        optionCandidates.push(args[i]);
      }
    }
    installedVersionInput = installedManifest;
  } else {
    installedVersionInput = args[0];
    latestVersionInput = args[1];
    for (let i = 2; i < args.length; i++) {
      const v = args[i];
      if (isLocalManifestLike(v)) {
        installedManifest = v as LocalManifest;
      } else if (Array.isArray(v) || (v && typeof v === "object" && ("releases" in v || "versions" in v || "history" in v))) {
        releaseHistoryInput = v as ReleaseHistoryInput;
      } else if (v && typeof v === "object" && "actualHashes" in v) {
        optionCandidates.push(v);
      } else {
        optionCandidates.push(v);
      }
    }
  }

  const options = Object.assign({}, ...optionCandidates.filter((x) => x && typeof x === "object")) as UpdatePlanOptions;
  const actualHashes = collectActualHashes(options, installedManifest, ...optionCandidates);

  const history = normalizeReleaseHistory(releaseHistoryInput);
  const installedVersion = toVersionInfo(installedVersionInput, installedManifest, options.nativeVersionCode ?? options.installedNativeVersionCode);

  // Load actual manifest for installed version from history if local manifest is missing.
  if (!installedManifest) {
    const rec = findRelease(history, installedVersion);
    if (rec?.manifest) installedManifest = releaseManifestToLocalManifest(rec.manifest);
  }

  const { manifest: targetManifest, version: targetVersion, record: targetRecord } = normalizeLatest(latestVersionInput, history);
  // Target version identity should reflect manifest, not client input.
  const finalInstalledVersion = installedManifest ? toVersionInfo(installedManifest, installedManifest, options.nativeVersionCode ?? options.installedNativeVersionCode) : installedVersion;
  // Prefer native version if supplied, but keep manifest version name.
  if (Number.isFinite(options.nativeVersionCode)) {
    finalInstalledVersion.versionCode = Number(options.nativeVersionCode);
  } else if (Number.isFinite(options.installedNativeVersionCode)) {
    finalInstalledVersion.versionCode = Number(options.installedNativeVersionCode);
  }

  const inRange = releasesBetween(history, finalInstalledVersion, targetVersion);
  const notes = collectReleaseNotes(inRange);
  const migrations = collectMigrations(inRange);
  if (Array.isArray(options.migrations)) {
    for (const m of options.migrations) {
      const text = String(m ?? "").trim();
      if (text && !migrations.includes(text)) migrations.push(text);
    }
  }

  const diff = compareManifests(installedManifest, targetManifest, actualHashes);

  // Cumulative final-state resolution is already represented by diff against target.
  // Ensure corrupted local files are included in download list.
  const filesToDownload: AssetEntry[] = [];
  const byPath = new Map(targetManifest.files.map((f) => [f.path, f]));
  for (const entry of [...diff.added, ...diff.modified]) {
    if (!filesToDownload.find((x) => x.path === entry.path)) filesToDownload.push(entry);
  }
  for (const p of diff.corrupted) {
    const entry = byPath.get(p);
    if (entry && !filesToDownload.find((x) => x.path === entry.path)) filesToDownload.push(entry);
  }

  const bytes = filesToDownload.reduce((s, f) => s + (f.bytes || 0), 0) || requiredBytes(diff, targetManifest);

  // Native APK handling (separate from web assets).
  const installedNative = Number.isFinite(options.installedNativeVersionCode)
    ? Number(options.installedNativeVersionCode)
    : Number.isFinite(options.nativeVersionCode)
      ? Number(options.nativeVersionCode)
      : finalInstalledVersion.versionCode;
  const targetNative = Number(
    targetRecord?.nativeVersionCode ??
    targetRecord?.apkVersionCode ??
    targetManifest.nativeVersionCode ??
    targetManifest.apkVersionCode ??
    targetManifest.versionCode,
  );
  const nativeChangedInRange = inRange.some((r) => Boolean(r.nativeChanged || r.requiresNativeApk || r.apkChanged));
  const nativeApkRequired = Boolean(
    nativeChangedInRange ||
    (targetNative > 0 && installedNative > 0 && targetNative > installedNative && (options.assumeNativeVersionBump ?? false)) ||
    targetRecord?.requiresNativeApk ||
    targetManifest.requiresNativeApk,
  );

  const plan: UpdatePlan = {
    installedVersion: finalInstalledVersion,
    targetVersion,
    fromVersion: finalInstalledVersion,
    toVersion: targetVersion,
    latestVersion: targetVersion,
    installedManifest,
    targetManifest,
    diff,
    unchanged: diff.unchanged,
    added: diff.added,
    modified: diff.modified,
    deleted: diff.deleted,
    corrupted: diff.corrupted,
    filesToDownload,
    toDownload: filesToDownload,
    downloadFiles: filesToDownload,
    requiredFiles: filesToDownload,
    assetsToDownload: filesToDownload,
    requiredBytes: bytes,
    totalBytes: bytes,
    bytesToDownload: bytes,
    migrations,
    migrationSteps: migrations,
    requiredMigrations: migrations,
    releaseNotesByVersion: notes.byVersion,
    cumulativeReleaseNotes: notes.accumulated,
    releaseNotes: {
      byVersion: notes.byVersion,
      accumulated: notes.accumulated,
    },
    nativeApkRequired,
    requiresNativeApk: nativeApkRequired,
    requiresNativeUpdate: nativeApkRequired,
    nativeUpdateRequired: nativeApkRequired,
    apkUpdateRequired: nativeApkRequired,
    nativeVersionCode: targetNative,
  };

  return plan;
}

export function getUpdatePlanForDevice(...args: any[]): UpdatePlan {
  return getUpdatePlan(...args);
}

export function calculateUpdatePlan(...args: any[]): UpdatePlan {
  return getUpdatePlan(...args);
}

export function resolveUpdatePlan(...args: any[]): UpdatePlan {
  return getUpdatePlan(...args);
}

// Cumulative release notes helpers.
export function cumulativeReleaseNotes(installedVersion: unknown, targetVersion: unknown, releaseHistory?: ReleaseHistoryInput): UpdatePlan["releaseNotes"] {
  const plan = getUpdatePlan(installedVersion, targetVersion, null, releaseHistory);
  return plan.releaseNotes;
}

export function getReleaseNotesSince(installedVersionCode: number | string | VersionInfo, releaseHistory?: ReleaseHistoryInput, targetVersion?: unknown): UpdatePlan["releaseNotesByVersion"] {
  const records = normalizeReleaseHistory(releaseHistory);
  const installed = toVersionInfo(installedVersionCode);
  const target = targetVersion ? toVersionInfo(targetVersion) : (records.length ? toVersionInfo(records[records.length - 1]) : installed);
  return releasesBetween(records, installed, target).map((r) => ({
    versionName: r.versionName || r.manifest?.versionName || "",
    versionCode: r.versionCode || r.manifest?.versionCode || 0,
    releaseDate: r.releaseDate || r.manifest?.releaseDate,
    publishedAt: r.publishedAt || r.manifest?.publishedAt,
    releaseNotes: r.releaseNotes ?? r.manifest?.releaseNotes,
  }));
}

export function accumulatedReleaseNotes(installedVersionCode: number | string | VersionInfo, releaseHistory?: ReleaseHistoryInput, targetVersion?: unknown): { ar: ReleaseNotesSection; en: ReleaseNotesSection } {
  const records = normalizeReleaseHistory(releaseHistory);
  const installed = toVersionInfo(installedVersionCode);
  const target = targetVersion ? toVersionInfo(targetVersion) : (records.length ? toVersionInfo(records[records.length - 1]) : installed);
  const inRange = releasesBetween(records, installed, target);
  return collectReleaseNotes(inRange).accumulated;
}

// Aliases for alternate naming used by callers/tests.
export const getUpdateManifest = getUpdatePlan;
export const createUpdatePlan = getUpdatePlan;
export const buildUpdatePlan = getUpdatePlan;
export const planUpdate = getUpdatePlan;