/* محرك التعرف على speech للقرآن (Tilawa) — يعمل دون اتصال بملفات مضمَّنة داخل التطبيق. */

import { cacheStorage, createTilawa, prepareMicrophone } from "@tilawa/core/web";
import type { Tilawa, Microphone, LoadProgress } from "@tilawa/core/web";
import type { TilawaSession } from "@tilawa/core";

export type TilawaStorage = {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
};

export type ExpectedFile = { key: string; bytes: number; sha256: string; label: string };

const EXPECTED_FILES: ExpectedFile[] = [
  { key: "spliced-clean-lite@1-int8/model.onnx", label: "lite", bytes: 24650054, sha256: "4974de78d3c35d2542e7a24d99b747e1160d6e31e366fb68492b74a789890f1b" },
  { key: "reference/ref-v2.json", label: "reference", bytes: 4749281, sha256: "f236384ea91e81ad554ba2777bc4073c3ff41e34120343a8a474571c577b7727" },
];

/* ONNX WASM runtime hosted via R2 (same origin) — used only when no bundled copy exists. */
const WASM_URL = "/assets/large/ort-wasm-simd-threaded.jsep-Dt5UNR3U.wasm";
const WASM_BYTES = 29520971;
const WASM_SHA256 = "5ab8361783822d02a57d1e97cf2514bceb451a628f2b29ae0d7b6e618201ff8f";

/*
 * الحزمة دون اتصال: تُضاف إلى أصول تطبيق أندرويد وقت البناء (scripts/fetch-offline-assets.sh).
 * وجود manifest.json يعني أن النسخة المثبَّتة تحمل النماذج والمرجع وruntime داخل التطبيق،
 * وأن الجاهزية تُقاس على هذه الملفات نفسها بعد التحقق من الحجم والبصمة — لا على شبكة أو ذاكرة مؤقتة.
 */
export const OFFLINE_BUNDLE_MANIFEST = "/offline/v1/manifest.json";

/*
 * تجاوز اختياري لمستوى النموذج — للاختبار فقط، والافتراضي يبقى "auto" كما هو.
 * الطريقة: ?tilawaTier=lite|full في الرابط، أو localStorage["thimar.tilawa.tier"].
 * لا يُفعَّل Full تلقائيًا على جهاز ضعيف؛ من يكتب التجاوز يختاره صراحةً.
 */
export const TILAWA_TIER_OVERRIDE_KEY = "thimar.tilawa.tier";

export function readTilawaTierOverride(): "lite" | "full" | null {
  try {
    const fromUrl = new URLSearchParams(globalThis.location?.search ?? "").get("tilawaTier");
    const stored = globalThis.localStorage?.getItem(TILAWA_TIER_OVERRIDE_KEY) ?? null;
    const value = String(fromUrl ?? stored ?? "").trim().toLowerCase();
    return value === "lite" || value === "full" ? value : null;
  } catch {
    return null;
  }
}

/*
 * تخزين لا يحتفظ بشيء عند العمل من الحزمة المضمَّنة: النموذج يُقرأ من داخل التطبيق
 * مباشرة. بدون هذا كانت fetchModel() تنسخ النموذج المختار (٢٤٫٦ أو ٦٧٫٨ م.ب) إلى
 * Cache Storage فوق نسخته داخل الـAPK. لا يُحذف أي ملف مضمَّن هنا لأن الكتابة لا تحدث أصلًا.
 */
const BUNDLED_STORAGE: TilawaStorage = {
  get: async () => null,
  put: async () => {},
  delete: async () => {},
  keys: async () => [],
};

export class OfflineAssetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflineAssetsError";
  }
}

type BundleAsset = { path: string; label: string; bytes: number; sha256: string };
type BundleManifest = { schema: number; assetBase: string; assets: BundleAsset[] };
type BundleCheck = { ok: boolean; checked: string[]; failed: string[]; message: string };

let bundlePromise: Promise<BundleManifest | null> | null = null;
let bundleCheckPromise: Promise<BundleCheck> | null = null;

function bundleUrl(base: string, path: string): string {
  const root = base.startsWith("/") ? base : `/${base}`;
  return `${root.replace(/\/?$/, "/")}${path.replace(/^\/+/, "")}`;
}

/** يقرأ بيان الحزمة المضمَّنة. يعيد null على الويب العادي أو عند غياب الحزمة. */
export function loadOfflineBundle(): Promise<BundleManifest | null> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      try {
        const res = await fetch(OFFLINE_BUNDLE_MANIFEST, { cache: "no-store" });
        if (!res.ok) return null;
        const text = await res.text();
        // على الويب العادي يعيد الخادم صفحة HTML (SPA fallback) بدل 404.
        if (!text.trimStart().startsWith("{")) return null;
        const parsed = JSON.parse(text) as BundleManifest;
        if (parsed?.schema !== 1 || typeof parsed.assetBase !== "string") return null;
        if (!Array.isArray(parsed.assets) || parsed.assets.length === 0) return null;
        const valid = parsed.assets.every(
          (asset) =>
            asset &&
            typeof asset.path === "string" &&
            asset.path.length > 0 &&
            typeof asset.sha256 === "string" &&
            asset.sha256.length === 64 &&
            Number.isFinite(asset.bytes) &&
            asset.bytes > 0,
        );
        return valid ? parsed : null;
      } catch {
        return null;
      }
    })().catch(() => null);
  }
  return bundlePromise;
}

/** يتحقق من كل ملف مضمَّن (الحجم والبصمة) مرة واحدة لكل تشغيل. */
export function verifyOfflineBundle(subtle?: SubtleCrypto | null): Promise<BundleCheck> {
  if (!bundleCheckPromise) {
    bundleCheckPromise = (async () => {
      const manifest = await loadOfflineBundle();
      const result: BundleCheck = { ok: false, checked: [], failed: [], message: "" };
      if (!manifest) {
        result.message = "لا توجد حزمة أصول مضمَّنة في هذه النسخة.";
        return result;
      }
      const resolvedSubtle = subtle === undefined ? (globalThis.crypto?.subtle ?? null) : subtle;
      if (!resolvedSubtle) {
        result.message = "التحقق من سلامة الملفات يحتاج WebCrypto، وهو غير متاح في هذا العرض.";
        return result;
      }
      for (const asset of manifest.assets) {
        const url = bundleUrl(manifest.assetBase, asset.path);
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) {
            result.failed.push(asset.path);
            result.message = `ملف مضمَّن مفقود: ${asset.path} (HTTP ${res.status}). أعد تثبيت التطبيق.`;
            continue;
          }
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.length !== asset.bytes) {
            result.failed.push(asset.path);
            result.message = `حجم غير مطابق للملف المضمَّن ${asset.path}: ${bytes.length} بدل ${asset.bytes}.`;
            continue;
          }
          const digest = await sha256Hex(resolvedSubtle, bytes);
          if (digest !== asset.sha256) {
            result.failed.push(asset.path);
            result.message = `بصمة غير مطابقة للملف المضمَّن ${asset.path}. أعد تثبيت التطبيق.`;
            continue;
          }
          result.checked.push(asset.path);
        } catch (error) {
          result.failed.push(asset.path);
          result.message = `تعذّر قراءة الملف المضمَّن ${asset.path}: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      result.ok = result.failed.length === 0 && result.checked.length === manifest.assets.length;
      if (result.ok) result.message = "";
      return result;
    })().catch((error) => ({
      ok: false,
      checked: [],
      failed: [],
      message: error instanceof Error ? error.message : String(error),
    }));
  }
  return bundleCheckPromise;
}

export function resetOfflineBundleCheck(): void {
  bundleCheckPromise = null;
}

export type TilawaIntegrityReport = {
  checked: string[];
  removed: string[];
  unverified: string[];
  cryptoAvailable: boolean;
};

export type TilawaReadinessState =
  | "not_downloaded"
  | "downloading"
  | "verifying"
  | "ready"
  | "download_failed"
  | "integrity_failed"
  | "runtime_unsupported";

export type TilawaReadinessReport = {
  state: TilawaReadinessState;
  checked: string[];
  missing: string[];
  cryptoAvailable: boolean;
  wasmAvailable: boolean;
  /** مصدر الجاهزية: ملفات مضمَّنة داخل التطبيق أو ذاكرة التنزيل المؤقتة. */
  source?: "bundled" | "cache";
  /** رسالة عربية واضحة عند فشل التحقق. */
  message?: string;
};

export const REQUIRED_TILAWA_ASSETS: ExpectedFile[] = [
  ...EXPECTED_FILES,
  { key: WASM_URL, label: "wasm", bytes: WASM_BYTES, sha256: WASM_SHA256 },
];

async function sha256Hex(subtle: SubtleCrypto, bytes: Uint8Array): Promise<string> {
  if (!subtle) {
    throw new Error("Tilawa integrity verification requires crypto.subtle, which is unavailable.");
  }
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as unknown as ArrayBuffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyTilawaCache(
  storage?: TilawaStorage,
  subtle?: SubtleCrypto | null,
  expectedFiles: ExpectedFile[] = EXPECTED_FILES,
): Promise<TilawaIntegrityReport> {
  const resolvedSubtle = subtle === undefined ? (globalThis.crypto?.subtle ?? null) : subtle;
  if (!resolvedSubtle) {
    throw new Error("Tilawa integrity verification requires crypto.subtle, which is unavailable.");
  }
  const resolvedStorage: TilawaStorage = storage ?? (cacheStorage() as unknown as TilawaStorage);
  const report: TilawaIntegrityReport = {
    checked: [],
    removed: [],
    unverified: [],
    cryptoAvailable: true,
  };
  const keys = await resolvedStorage.keys();
  for (const expected of expectedFiles) {
    if (!keys.includes(expected.key)) continue;
    const bytes = await resolvedStorage.get(expected.key);
    if (!bytes) continue;
    if (bytes.length !== expected.bytes) {
      await resolvedStorage.delete(expected.key);
      report.removed.push(expected.key);
      continue;
    }
    const digest = await sha256Hex(resolvedSubtle, bytes);
    if (digest !== expected.sha256) {
      await resolvedStorage.delete(expected.key);
      report.removed.push(expected.key);
      continue;
    }
    report.checked.push(expected.key);
  }
  return report;
}

/** Verify the ONNX WASM runtime (hosted via R2) before the engine uses it. */
async function verifyWasmRuntime(subtle: SubtleCrypto): Promise<void> {
  if (!subtle) {
    throw new Error("Tilawa integrity verification requires crypto.subtle, which is unavailable.");
  }
  let res: Response;
  try {
    res = await fetch(WASM_URL);
  } catch (error) {
    throw new Error("ONNX WASM runtime unavailable (network/cache).");
  }
  if (!res.ok) {
    throw new Error(`ONNX WASM runtime unavailable (HTTP ${res.status}).`);
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length !== WASM_BYTES) {
    throw new Error(`ONNX WASM runtime size mismatch (${bytes.length} of ${WASM_BYTES}).`);
  }
  const digest = await sha256Hex(subtle, bytes);
  if (digest !== WASM_SHA256) {
    throw new Error("ONNX WASM runtime integrity check failed.");
  }
}

export async function checkTilawaReadiness(subtle?: SubtleCrypto | null): Promise<TilawaReadinessReport> {
  const resolvedSubtle = subtle === undefined ? (globalThis.crypto?.subtle ?? null) : subtle;
  const report: TilawaReadinessReport = {
    state: "not_downloaded",
    checked: [],
    missing: [],
    cryptoAvailable: !!resolvedSubtle,
    wasmAvailable: false,
  };
  const bundle = await loadOfflineBundle();
  if (bundle) {
    report.source = "bundled";
    if (!resolvedSubtle) {
      report.state = "runtime_unsupported";
      report.message = "التحقق من سلامة الملفات يحتاج WebCrypto، وهو غير متاح في هذا العرض.";
      return report;
    }
    const check = await verifyOfflineBundle(resolvedSubtle);
    report.checked = check.checked;
    report.missing = check.failed;
    report.wasmAvailable = check.checked.some((path) => path.endsWith(".wasm"));
    report.state = check.ok ? "ready" : "integrity_failed";
    if (!check.ok) report.message = check.message;
    return report;
  }
  report.source = "cache";
  if (!resolvedSubtle) {
    report.state = "runtime_unsupported";
    return report;
  }
  // Check cached Tilawa models via verifyTilawaCache (does not throw).
  let storageReport: TilawaIntegrityReport | null = null;
  try {
    storageReport = await verifyTilawaCache(undefined, resolvedSubtle, EXPECTED_FILES);
  } catch {
    storageReport = null;
  }
  const checkedModels = storageReport?.checked ?? [];
  for (const expected of EXPECTED_FILES) {
    if (checkedModels.includes(expected.key)) report.checked.push(expected.key);
    else report.missing.push(expected.key);
  }
  // Check WASM runtime availability + integrity.
  try {
    const res = await fetch(WASM_URL);
    if (res.ok) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === WASM_BYTES) {
        const digest = await sha256Hex(resolvedSubtle, buf);
        if (digest === WASM_SHA256) {
          report.wasmAvailable = true;
          report.checked.push(WASM_URL);
        } else {
          report.missing.push(WASM_URL);
          report.state = "integrity_failed";
        }
      } else {
        report.missing.push(WASM_URL);
        report.state = "integrity_failed";
      }
    } else {
      report.missing.push(WASM_URL);
    }
  } catch {
    report.missing.push(WASM_URL);
  }
  if (report.state === "integrity_failed") return report;
  if (report.missing.length === 0) report.state = "ready";
  else report.state = "not_downloaded";
  return report;
}

let cached: Promise<Tilawa> | null = null;

export type TilawaPreloadState = "idle" | "loading" | "ready" | "error";

export type TilawaPreloadSnapshot = {
  state: TilawaPreloadState;
  /** هل المحرك يُقرأ من حزمة مضمَّنة داخل التطبيق؟ null قبل التحقق. */
  bundled: boolean | null;
  tier: "lite" | "full" | null;
  progress: number;
  stage: string;
  message: string;
  startedAt: number | null;
  readyAt: number | null;
  durationMs: number | null;
};

let preloadSnapshot: TilawaPreloadSnapshot = {
  state: "idle",
  bundled: null,
  tier: null,
  progress: 0,
  stage: "",
  message: "",
  startedAt: null,
  readyAt: null,
  durationMs: null,
};

const preloadSubscribers = new Set<(snapshot: TilawaPreloadSnapshot) => void>();
let preloadPromise: Promise<Tilawa | null> | null = null;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function publishPreload(patch: Partial<TilawaPreloadSnapshot>): void {
  preloadSnapshot = { ...preloadSnapshot, ...patch };
  for (const listener of preloadSubscribers) {
    try {
      listener(preloadSnapshot);
    } catch {
      /* مستمع تالف لا يعطّل التجهيز. */
    }
  }
}

/** حالة تجهيز المحرك المحلي للمكوّنات التي تعرض جاهز/جارٍ/خطأ. */
export function getTilawaPreloadSnapshot(): TilawaPreloadSnapshot {
  return preloadSnapshot;
}

export function subscribeTilawaPreload(listener: (snapshot: TilawaPreloadSnapshot) => void): () => void {
  preloadSubscribers.add(listener);
  return () => {
    preloadSubscribers.delete(listener);
  };
}

/**
 * يجهّز المحرك مرة واحدة ويعيد استخدام نفس الوعد والجلسة. لا يبدأ أي شبكة:
 * إن لم توجد حزمة مضمَّنة يبقى المحرك على المسار الكسول القديم (loadTilawa).
 */
export function preloadTilawa(): Promise<Tilawa | null> {
  if (preloadPromise) return preloadPromise;
  const startedAt = nowMs();
  const tier = readTilawaTierOverride() ?? "lite";
  publishPreload({
    state: "loading",
    tier,
    progress: 0,
    stage: "",
    message: "",
    startedAt,
    readyAt: null,
    durationMs: null,
  });
  preloadPromise = (async () => {
    const bundle = await loadOfflineBundle();
    if (!bundle) {
      publishPreload({ state: "idle", bundled: false, startedAt: null });
      return null;
    }
    publishPreload({ bundled: true });
    const tilawa = await loadTilawa((p) => {
      publishPreload({
        progress: Number.isFinite(p.fraction) ? Math.max(0, Math.min(1, p.fraction)) : 0,
        stage: p.stage,
      });
    });
    publishPreload({
      state: "ready",
      tier: (tilawa.model.tier ?? tier) as "lite" | "full",
      progress: 1,
      readyAt: nowMs(),
      durationMs: nowMs() - startedAt,
      message: "",
    });
    return tilawa;
  })().catch((error) => {
    preloadPromise = null;
    publishPreload({
      state: "error",
      message: error instanceof Error ? error.message : String(error),
      durationMs: nowMs() - startedAt,
    });
    throw error instanceof Error ? error : new Error(String(error));
  });
  return preloadPromise;
}

/** إعادة محاولة محلية فقط بعد خطأ: تعيد قراءة الحزمة المضمَّنة دون أي تنزيل. */
export function retryTilawaPreload(): Promise<Tilawa | null> {
  if (preloadPromise) return preloadPromise;
  resetOfflineBundleCheck();
  resetTilawaCache();
  return preloadTilawa();
}

/** يبدأ التجهيز التلقائي بعد أول رسم للواجهة دون حجب الإقلاع. */
export function scheduleTilawaPreload(): void {
  if (typeof window === "undefined") return;
  const start = () => {
    void preloadTilawa().catch(() => undefined);
  };
  const idle = (
    window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof idle === "function") idle(start, { timeout: 2000 });
  else window.setTimeout(start, 0);
}

export function loadTilawa(onProgress?: (p: LoadProgress) => void): Promise<Tilawa> {
  if (!cached) {
    cached = (async () => {
      const subtle = globalThis.crypto?.subtle ?? null;
      const bundle = await loadOfflineBundle();
      if (bundle) {
        /* نسخة أندرويد المضمَّنة: لا شبكة ولا تنزيل. فشل التحقق = خطأ ظاهر بلا بديل سحابي. */
        if (!subtle) {
          throw new OfflineAssetsError("التحقق من سلامة ملفات المحرك يحتاج WebCrypto، وهو غير متاح في هذا العرض.");
        }
        const check = await verifyOfflineBundle(subtle);
        if (!check.ok) throw new OfflineAssetsError(check.message);
        const wasm = bundle.assets.find((asset) => asset.label === "wasm");
        const mjs = bundle.assets.find((asset) => asset.label === "wasm-loader");
        const hasFull = bundle.assets.some((asset) => asset.label === "full");
        const requestedTier = readTilawaTierOverride() ?? "lite";
        const tier = requestedTier === "full" && !hasFull ? "lite" : requestedTier;
        const wasmPaths =
          wasm && mjs
            ? ({
                wasm: bundleUrl(bundle.assetBase, wasm.path),
                mjs: bundleUrl(bundle.assetBase, mjs.path),
              } as unknown as string)
            : undefined;
        return createTilawa({
          tier,
          assetBase: bundle.assetBase,
          wasmPaths,
          storage: BUNDLED_STORAGE,
          onProgress: (p) => {
            onProgress?.(p);
          },
        });
      }
      await verifyTilawaCache();
      if (!subtle) {
        throw new Error("Tilawa integrity verification requires crypto.subtle, which is unavailable.");
      }
      await verifyWasmRuntime(subtle);
      return createTilawa({
        tier: "auto",
        wasmPaths: WASM_URL,
        onProgress: (p) => {
          onProgress?.(p);
        },
      });
    })().catch((error) => {
      cached = null;
      throw error instanceof Error ? error : new Error(String(error));
    });
  } else if (onProgress) {
    onProgress({ stage: "done", loaded: 1, total: 1, fraction: 1, fromCache: true } as unknown as LoadProgress);
  }
  return cached;
}

export function resetTilawaCache(): void {
  cached = null;
  preloadPromise = null;
}

export { prepareMicrophone };
export type { Tilawa, TilawaSession, Microphone, LoadProgress };