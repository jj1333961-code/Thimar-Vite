/* حزمة الموارد غير المتصلة — تنزيل، إيقاف، استئناف، والتحقق من سلامة الملفات. */

export type PackageFile = {
  path: string;
  bytes: number;
  sha256: string;
};

export type PackageManifest = {
  schema: number;
  version: string;
  appVersionCode: number;
  baseUrl: string;
  files: PackageFile[];
};

export type OfflinePackageId =
  | "quran-reading"
  | "recitation-lite"
  | "recitation-advanced";

export type OfflinePackageInfo = {
  id: OfflinePackageId;
  title: string;
  description: string;
  totalBytes: number;
  requiresVersionCode: number;
  files: PackageFile[];
};

/**
 * Package definitions derived from the actual offline bundle inventory.
 * Sizes are the uncompressed byte counts of the source files.
 */
export const OFFLINE_PACKAGES: OfflinePackageInfo[] = [
  {
    id: "recitation-lite",
    title: "التسميع بلا إنترنت (Lite)",
    description: "محرك التسميع (نموذج Lite) + بيانات المرجع + runtime WASM. يكفي للعمل دون إنترنت.",
    totalBytes: 24650054 + 4749281 + 29520971 + 47250 + 69970 + 180 + 1062 + 1868 + 36081762,
    requiresVersionCode: 24,
    files: [
      { path: "v1/models/spliced-clean-lite/1-int8/model.onnx", bytes: 24650054, sha256: "4974de78d3c35d2542e7a24d99b747e1160d6e31e366fb68492b74a789890f1b" },
      { path: "v1/reference/ref-v2.json", bytes: 4749281, sha256: "f236384ea91e81ad554ba2777bc4073c3ff41e34120343a8a474571c577b7727" },
      { path: "v1/runtime/ort/ort-wasm-simd-threaded.jsep.wasm", bytes: 29520971, sha256: "5ab8361783822d02a57d1e97cf2514bceb451a628f2b29ae0d7b6e618201ff8f" },
      { path: "v1/runtime/ort/ort-wasm-simd-threaded.jsep.mjs", bytes: 47250, sha256: "7838b4b2e77d6f1a739cd0de800e7f18a089328b365e6af4d416a88a94fd7fd3" },
      { path: "v1/quran-asr-small/model.int8.onnx", bytes: 36081762, sha256: "88f9df290d57b8890275d79187b77515aeeb12626a42bc76cbd0f8bfcaff00f0" },
      { path: "v1/quran-asr-small/spelling.json", bytes: 69970, sha256: "7adff00aa1d4b0413a3a89f898117682a22639624b3666121f6de785e0fb346a" },
      { path: "v1/quran-asr-small/tokens.txt", bytes: 180, sha256: "75b53814499cee84a07c7b7a318524d30bcaf84273c0f8b28a04176023e8c74f" },
      { path: "v1/quran-asr-small/LICENSE", bytes: 1062, sha256: "3a9d79091d3c680c22dfa9af3dc8dfa12e62f6f9eb94bad36361393453a5583c" },
      { path: "v1/manifest.json", bytes: 1868, sha256: "a19e5fb46302bd4c69aa9a407fd6b61cb4b822caf10dbf74764da707248cc60a" },
    ],
  },
  {
    id: "quran-reading",
    title: "قراءة القُرآن كاملًا (604 صفحة)",
    description: "نص المصحف (604 صفحة) + أسطر الصفحات + نص حفص + بيانات الصفحات + الخطوط (بدون PDF).",
    totalBytes: 97589 + 850829 + 287416 + 3113255 + 87760 + 107592 + 87760,
    requiresVersionCode: 24,
    files: [],
  },
  {
    id: "recitation-advanced",
    title: "التسميع المتقدم (Full model) + صوتيات",
    description: "النموذج Full (67.8 MB) والصوتيات (اختياري).",
    totalBytes: 67759744,
    requiresVersionCode: 24,
    files: [
      { path: "v1/models/spliced-clean/1-int8/model.onnx", bytes: 67759744, sha256: "714e98addee73b1b8781ad7d99b6d3c745acd9116638baf4e12891f53a15af1b" },
    ],
  },
];

export function packageById(id: OfflinePackageId): OfflinePackageInfo | undefined {
  return OFFLINE_PACKAGES.find((p) => p.id === id);
}

export async function estimateAvailableStorage(): Promise<number | null> {
  try {
    const est = await (navigator as any).storage?.estimate?.();
    if (est && typeof est.quota === "number" && typeof est.usage === "number") {
      return Math.max(0, est.quota - est.usage);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function isVersionCompatible(pkg: OfflinePackageInfo, installedVersionCode: number | null): boolean {
  if (installedVersionCode === null) return true;
  return installedVersionCode >= pkg.requiresVersionCode;
}

export const OFFLINE_PACKAGE_CACHE = "thimar-offline-package-v1";

export function resolvePackageUrl(path: string, baseUrl?: string): string {
  const base = (baseUrl || (import.meta as any).env?.VITE_OFFLINE_PACKAGE_URL || "/offline-package").replace(/\/+$/, "");
  const clean = path.replace(/^\/+/, "");
  return `${base}/${clean}`;
}

export async function sha256Bytes(data: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) throw new Error("crypto.subtle unavailable");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function totalPackageBytes(manifest: PackageManifest): number {
  return manifest.files.reduce((sum, f) => sum + f.bytes, 0);
}

export type DownloadProgress = {
  downloaded: number;
  total: number;
  currentFile: string;
  done: boolean;
};

export class OfflinePackageDownloader {
  private controller: AbortController | null = null;
  private paused = false;
  private resumeResolvers: (() => void)[] = [];

  private manifest: PackageManifest;
  constructor(manifest: PackageManifest) {
    this.manifest = manifest;
  }

  private baseUrl(): string {
    return this.manifest.baseUrl || (import.meta as any).env?.VITE_OFFLINE_PACKAGE_URL || "/offline-package";
  }

  resolveUrl(path: string): string {
    return resolvePackageUrl(path, this.baseUrl());
  }

  async isFileCached(path: string, expectedSha: string): Promise<boolean> {
    if (typeof caches === "undefined") return false;
    try {
      const cache = await caches.open(OFFLINE_PACKAGE_CACHE);
      const res = await cache.match(this.resolveUrl(path));
      if (!res) return false;
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) return false;
      const actual = await sha256Bytes(buf);
      return actual === expectedSha;
    } catch {
      return false;
    }
  }

  async verifyAll(): Promise<{ ok: boolean; missing: string[]; corrupted: string[] }> {
    const missing: string[] = [];
    const corrupted: string[] = [];
    for (const f of this.manifest.files) {
      const cached = await this.isFileCached(f.path, f.sha256);
      if (!cached) {
        // distinguish missing vs corrupted by attempting match
        let present = false;
        try {
          const cache = await caches.open(OFFLINE_PACKAGE_CACHE);
          const res = await cache.match(this.resolveUrl(f.path));
          present = Boolean(res);
          if (res) {
            const buf = await res.arrayBuffer();
            const actual = await sha256Bytes(buf);
            if (actual !== f.sha256) corrupted.push(f.path);
            else if (buf.byteLength !== f.bytes) corrupted.push(f.path);
          }
        } catch {
          /* ignore */
        }
        if (!present && !corrupted.includes(f.path)) missing.push(f.path);
      }
    }
    return { ok: missing.length === 0 && corrupted.length === 0, missing, corrupted };
  }

  pause() {
    this.paused = true;
    this.controller?.abort();
  }

  async resume() {
    this.paused = false;
    for (const r of this.resumeResolvers) r();
    this.resumeResolvers = [];
  }

  private async waitIfPaused() {
    if (!this.paused) return;
    await new Promise<void>((resolve) => {
      this.resumeResolvers.push(resolve);
    });
  }

  async download(
    onProgress?: (p: DownloadProgress) => void,
    shouldStop?: () => boolean,
  ): Promise<{ ok: boolean; error?: string }> {
    const total = totalPackageBytes(this.manifest);
    let downloaded = 0;
    this.paused = false;

    for (const f of this.manifest.files) {
      if (shouldStop?.()) return { ok: false, error: "stopped" };
      await this.waitIfPaused();
      if (shouldStop?.()) return { ok: false, error: "stopped" };

      // skip already-cached valid file
      if (await this.isFileCached(f.path, f.sha256)) {
        downloaded += f.bytes;
        onProgress?.({ downloaded, total, currentFile: f.path, done: false });
        continue;
      }

      this.controller = new AbortController();
      let res: Response;
      try {
        res = await fetch(this.resolveUrl(f.path), { signal: this.controller.signal });
      } catch (e) {
        if (this.paused) {
          // paused: wait then retry this file
          await this.waitIfPaused();
          try {
            res = await fetch(this.resolveUrl(f.path));
          } catch (e2) {
            return { ok: false, error: String(e2) };
          }
        } else {
          return { ok: false, error: String(e) };
        }
      }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status} for ${f.path}` };

      const buf = await res.arrayBuffer();
      if (buf.byteLength !== f.bytes) {
        return { ok: false, error: `size mismatch for ${f.path}: ${buf.byteLength} vs ${f.bytes}` };
      }
      const actual = await sha256Bytes(buf);
      if (actual !== f.sha256) {
        return { ok: false, error: `checksum mismatch for ${f.path}` };
      }

      // never replace a valid cached file with incomplete/corrupt; only store after verification
      try {
        const cache = await caches.open(OFFLINE_PACKAGE_CACHE);
        await cache.put(this.resolveUrl(f.path), new Response(buf));
      } catch (e) {
        return { ok: false, error: String(e) };
      }

      downloaded += f.bytes;
      onProgress?.({ downloaded, total, currentFile: f.path, done: downloaded >= total });
    }

    onProgress?.({ downloaded: total, total, currentFile: "", done: true });
    return { ok: true };
  }

  async deleteAll(): Promise<void> {
    if (typeof caches === "undefined") return;
    try {
      await caches.delete(OFFLINE_PACKAGE_CACHE);
    } catch {
      /* ignore */
    }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
