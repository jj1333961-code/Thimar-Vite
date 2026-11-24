import { DifferentialUpdateEngine, CacheAssetStore, LocalStorageManifestStore, getUpdatePlan } from "./differentialUpdate";

const LATEST_MANIFEST_URL = "/updates/web-manifest.json";
const MANIFEST_STORE_KEY = "thimar.productionWebManifest";
const CACHE_NAME = "thimar-production-assets-v1";

export type ProductionUpdateResult = {
  ok: boolean;
  downloaded: string[];
  skipped: string[];
  error?: string;
};

export async function fetchProductionManifest(): Promise<any> {
  const res = await fetch(LATEST_MANIFEST_URL + "?thimar_update=1", { cache: "no-store" });
  if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
  return res.json();
}

export function createProductionUpdateEngine() {
  return new DifferentialUpdateEngine({
    assetStore: new CacheAssetStore(CACHE_NAME),
    manifestStore: new LocalStorageManifestStore(MANIFEST_STORE_KEY),
    fetch: (url, init) => fetch(url, init),
  });
}

function createAssetStore() {
  return new CacheAssetStore(CACHE_NAME);
}

function createManifestStore() {
  return new LocalStorageManifestStore(MANIFEST_STORE_KEY);
}

async function sha256Buffer(data: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) throw new Error("crypto.subtle unavailable");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function scanInstalledManifest(remote: any): Promise<any> {
  const assetStore = createAssetStore();
  const manifestStore = createManifestStore();
  const files: Record<string, { path: string; bytes: number; sha256: string }> = {};
  for (const f of remote.files ?? []) {
    const data = await assetStore.get(f.path);
    if (!data) continue;
    files[f.path] = {
      path: f.path,
      bytes: data.byteLength,
      sha256: await sha256Buffer(data),
    };
  }
  const manifest = {
    versionName: "installed",
    versionCode: 0,
    baseUrl: remote.baseUrl ?? "/",
    files,
    updatedAt: Date.now(),
  };
  await manifestStore.save(manifest);
  return manifest;
}

export async function getProductionUpdatePlan(): Promise<{ plan: ReturnType<typeof getUpdatePlan>; manifest: any }> {
  const remote = await fetchProductionManifest();
  const manifestStore = createManifestStore();
  let local = await manifestStore.load();
  if (!local) {
    local = await scanInstalledManifest(remote);
  }
  const installedVersionCode = local?.versionCode ?? 0;
  const plan = getUpdatePlan(installedVersionCode, remote, local);
  return { plan, manifest: remote };
}

export async function applyProductionUpdate(
  onProgress?: (downloaded: number, total: number, path: string) => void,
): Promise<ProductionUpdateResult> {
  const engine = createProductionUpdateEngine();
  const remote = await fetchProductionManifest();
  const manifestStore = createManifestStore();
  let local = await manifestStore.load();
  if (!local) {
    local = await scanInstalledManifest(remote);
  }
  const result = await engine.applyUpdate(remote, (p) => {
    onProgress?.(p.downloaded, p.total, p.currentFile);
  });
  return {
    ok: result.ok,
    downloaded: result.applied,
    skipped: result.diff?.unchanged ?? [],
    error: result.error,
  };
}

export function scheduleProductionAssetUpdate(): void {
  if (typeof window === "undefined") return;
  const run = () => {
    void applyProductionUpdate().catch(() => undefined);
  };
  if (document.readyState === "complete") window.setTimeout(run, 5000);
  else window.addEventListener("load", () => window.setTimeout(run, 5000), { once: true });
}