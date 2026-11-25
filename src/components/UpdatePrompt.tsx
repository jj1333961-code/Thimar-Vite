import { useEffect, useState } from "react";
import { getInstalledVersionCode } from "../lib/nativePush";

export const ANDROID_UPDATE_METADATA_URL =
  (import.meta as any).env?.VITE_UPDATE_METADATA_URL || "/updates/android.json";
export const IOS_UPDATE_METADATA_URL =
  (import.meta as any).env?.VITE_IOS_UPDATE_METADATA_URL || "/updates/ios.json";
const METADATA_URL = ANDROID_UPDATE_METADATA_URL;

type Platform = "ios" | "android" | "electron" | "web";

type AndroidMetadata = {
  platform?: string;
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  available?: boolean;
  downloadUrl?: string;
  assetOnly?: boolean;
  apkRequired?: boolean;
  fileName?: string;
  fileSize?: number;
  sha256?: string;
  resourceVersionCode?: number;
  resourceSize?: number;
  versionHistory?: { versionName?: string; versionCode?: number }[];
};

type IOSMetadata = {
  available?: boolean;
  url?: string;
};

/** إصدار موارد الويب المثبت حالياً (0 إن لم يُثبّت تحديث موارد بعد). */
export function installedResourceVersion(): number | null {
  try {
    const updater = (window as any).ThimarAssetUpdater;
    if (!updater || typeof updater.getInstalledVersion !== "function") return null;
    const raw = String(updater.getInstalledVersion() || "");
    const match = raw.match(/\((\d+)\)\s*$/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** Reject incomplete, stale, or off-site APK metadata before starting a native update. */
function isValidAndroidRelease(meta: AndroidMetadata | null | undefined): meta is AndroidMetadata {
  if (!meta || meta.available !== true || meta.packageName !== "app.thimar.quran") return false;
  if (!Number.isSafeInteger(meta.versionCode) || Number(meta.versionCode) < 1) return false;
  if (typeof meta.versionName !== "string" || !meta.versionName.trim()) return false;
  const assetOnly = meta.assetOnly === true || meta.apkRequired === false;
  if (assetOnly) {
    // تحديث موارد فقط: لا يوجد APK ولا حاجة إلى حجم/بصمة/رابط تنزيل.
    return Number.isSafeInteger(meta.resourceVersionCode ?? meta.versionCode);
  }
  if (typeof meta.fileName !== "string" || !/^[a-zA-Z0-9._-]+\.apk$/i.test(meta.fileName)) return false;
  if (!Number.isSafeInteger(meta.fileSize) || Number(meta.fileSize) < 1024 * 1024) return false;
  if (typeof meta.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(meta.sha256)) return false;
  if (typeof meta.downloadUrl !== "string") return false;
  try {
    const url = new URL(meta.downloadUrl);
    if (url.protocol !== "https:") return false;
    const lastSegment = url.pathname.split("/").pop();
    if (lastSegment !== meta.fileName) return false;
    // APKs are published as GitHub release assets (too large for the site).
    const allowedHost =
      url.hostname === "thimar.freebuff.page" ||
      url.hostname === "github.com" ||
      url.hostname.endsWith(".github.com");
    return allowedHost;
  } catch {
    return false;
  }
}

export function detectPlatform(): Platform {
  const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").toLowerCase();
  const w = typeof window !== "undefined" ? (window as any) : {};
  if (w.electron || w.electronAPI) return "electron";

  // User-agent identifies the operating system, not an installed native app.
  // Only the native bridge marks this runtime as an updatable Android/iOS app.
  const nativeBridge = w.ThimarNative;
  let updaterBridge = w.ThimarUpdater;
  if (typeof updaterBridge === "function") {
    try {
      updaterBridge = updaterBridge();
    } catch {
      updaterBridge = null;
    }
  }
  const hasNativeBridge = Boolean(
    nativeBridge ||
    (updaterBridge &&
      (typeof updaterBridge.downloadUpdate === "function" ||
        typeof updaterBridge.getInstalledVersionCode === "function")),
  );
  if (!hasNativeBridge) return "web";

  let nativePlatform = "";
  try {
    if (typeof nativeBridge?.platform === "function") {
      nativePlatform = String(nativeBridge.platform()).toLowerCase();
    }
  } catch {
    // A broken optional bridge must not prevent the website from opening.
  }
  if (nativePlatform.includes("ios") || /iphone|ipad|ipod/.test(ua)) return "ios";
  return "android";
}

export default function UpdatePrompt() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<number>(0);
  const [availableSize, setAvailableSize] = useState<number>(0);
  const [availableNotes, setAvailableNotes] = useState<string>("");
  const [availableMeta, setAvailableMeta] = useState<any>(null);
  const [showDetails, setShowDetails] = useState<boolean>(false);


  useEffect(() => {
    // Do not auto-open based on a stale localStorage version comparison.
    // The modal should only open via an explicit trigger (push notification,
    // update=1 URL param, or a detected newer release).
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("update") === "1") setOpen(true);
    } catch {
      /* ignore */
    }
    const w = window as any;
    w.__thimarUpdateStatus = (message: string) => setStatus(message);
    const installed = getInstalledVersionCode();
    // Automatic update detection: on Android, check for a newer release and
    // surface the banner without requiring the user to open Settings.
    if (detectPlatform() === "android") {
      (async () => {
        try {
          const response = await fetch(METADATA_URL, { cache: "no-store" });
          if (!response.ok) return;
          const meta = (await response.json()) as AndroidMetadata;
          if (!isValidAndroidRelease(meta)) return;
          const latest = Number(meta.versionCode);
          const current = installed ?? null;
          const assetOnly = meta.assetOnly === true || meta.apkRequired === false;
          const latestResource = Number(meta.resourceVersionCode ?? latest);
          const currentResource = installedResourceVersion();
          const needsAssetUpdate = assetOnly && (currentResource === null || latestResource > currentResource);
          if ((current !== null && latest > current) || needsAssetUpdate) {
            setAvailableVersion(latest);
            if (typeof meta.fileSize === "number") setAvailableSize(meta.fileSize);
            else if (typeof meta.resourceSize === "number") setAvailableSize(meta.resourceSize);
            const sd =
              (meta as any)?.shortDescription ??
              (meta as any)?.releaseNotes?.ar?.shortDescription ??
              (meta as any)?.releaseNotes?.en?.shortDescription;
            const note = (typeof sd === "string" ? sd : (sd?.ar || sd?.en || ""));
            if (note) setAvailableNotes(String(note));
            setAvailableMeta(meta);
            setOpen(true);
          }
        } catch {
          /* ignore — network may be unavailable */
        }
      })();
    }
    const handlePushOpen = (event: Event) => {
      const url = (event as CustomEvent)?.detail?.url;
      if (typeof url === "string" && url.includes("update=1")) setOpen(true);
    };
    window.addEventListener("thimar:push-open", handlePushOpen);
    return () => {
      window.removeEventListener("thimar:push-open", handlePushOpen);
      delete w.__thimarUpdateStatus;
    };
  }, []);

  const platform = detectPlatform();

  const handleLater = () => {
    setOpen(false);
  };

  const handleDownload = async () => {
    setBusy(true);
    setStatus("جارٍ بدء التحديث…");
    try {
      if (platform === "ios") {
        let url = "";
        try {
          const response = await fetch(IOS_UPDATE_METADATA_URL, { cache: "no-store" });
          if (response.ok) {
            const meta = (await response.json()) as IOSMetadata;
            if (meta.available && meta.url) url = meta.url;
          }
        } catch {
          /* ignore */
        }
        if (!url) {
          setStatus("رابط تحديث iOS غير مُعدّ. أعد المحاولة لاحقًا.");
          setBusy(false);
          return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
        setStatus("تم فتح متجر التطبيقات/تست فلايت. أكمل التحديث من النظام.");
      } else if (platform === "android") {
        let metadata: AndroidMetadata | null = null;
        try {
          const response = await fetch(METADATA_URL, { cache: "no-store" });
          if (response.ok) {
            metadata = (await response.json()) as AndroidMetadata;
            if (metadata?.versionCode) setAvailableVersion(metadata.versionCode);
            if (typeof metadata?.fileSize === "number") setAvailableSize(metadata.fileSize);
            const sd = (metadata as any)?.shortDescription;
            const note = (typeof sd === "string" ? sd : (sd?.ar || sd?.en || ""));
            if (note) setAvailableNotes(String(note));
            setAvailableMeta(metadata);
          }
        } catch {
          metadata = null;
        }
        // تحديث الموارد (asset-only): لا تنزيل APK — استخدم محدّث Java (تفاضلي).
        const assetOnly = metadata?.assetOnly === true || metadata?.apkRequired === false;
        if (assetOnly) {
          const updater = (window as any).ThimarAssetUpdater;
          if (updater && typeof updater.update === "function") {
            setStatus("جارٍ تحديث الموارد (تفاضلي)…");
            try { updater.update(); } catch (e) { setStatus(`تعذّر بدء التحديث: ${String(e)}`); }
            setBusy(false);
            return;
          }
          // نسخة قديمة جداً بلا محدّث موارد: لا نُنزّل APK غير موجود في بيانات الموارد.
          setStatus("هذا الإصدار يحتاج تحديث التطبيق مرة واحدة من المتجر/الرابط الرسمي.");
          setBusy(false);
          return;
        }
        // Download the complete APK, not a separate/incremental resource patch.
        // Its bundled assets always belong to the same release as the installed binary.
        if (!isValidAndroidRelease(metadata)) {
          setStatus("بيانات التحديث أو رابط ملف APK غير مكتملة أو غير موثوقة. لم يبدأ التنزيل.");
          setBusy(false);
          return;
        }
        let installed = getInstalledVersionCode();
        if (installed === null) {
          const installedName = (window as any).ThimarNative?.appVersion?.();
          const entry = (metadata.versionHistory || []).find((item) => item?.versionName === installedName);
          if (entry && Number.isFinite(Number(entry.versionCode))) installed = Number(entry.versionCode);
        }
        if (installed !== null && Number(metadata.versionCode) <= installed) {
          setStatus("أنت تستخدم أحدث إصدار من تطبيق ثمار.");
          setBusy(false);
          return;
        }
        setStatus("جارٍ تنزيل APK…");
        window.location.assign(metadata.downloadUrl!);
        setBusy(false);
        return;
      } else if (platform === "electron") {
        const api = (window as any).electronUpdater || (window as any).electronAPI;
        if (api?.downloadUpdate) {
          await api.downloadUpdate();
          setStatus("تم تنزيل التحديث. سيتم التثبيت وإعادة التشغيل.");
        } else if (api?.checkForUpdates) {
          await api.checkForUpdates();
          setStatus("تم طلب التحديث من محدّث Electron.");
        } else {
          setStatus("محدّث Electron غير مُعدّ. أعد المحاولة لاحقًا.");
          setBusy(false);
          return;
        }
      } else if (platform === "web") {
        // A browser is already served from the latest website release.
        // This action downloads the native app; it never upgrades the browser/PWA shell.
        const ua = (navigator.userAgent || "").toLowerCase();
        if (/iphone|ipad|ipod/.test(ua)) {
          const response = await fetch(IOS_UPDATE_METADATA_URL, { cache: "no-store" });
          if (!response.ok) throw new Error(`iOS metadata HTTP ${response.status}`);
          const meta = (await response.json()) as IOSMetadata;
          if (!meta.available || !meta.url) {
            setStatus("تطبيق iOS غير متاح للتنزيل حاليًا.");
            setBusy(false);
            return;
          }
          window.open(meta.url, "_blank", "noopener,noreferrer");
          setStatus("تم فتح رابط تطبيق iOS.");
        } else {
          const response = await fetch(METADATA_URL, { cache: "no-store" });
          if (!response.ok) throw new Error(`Android metadata HTTP ${response.status}`);
          const meta = (await response.json()) as AndroidMetadata;
          if (!meta.available || !meta.downloadUrl) {
            setStatus("ملف تنزيل تطبيق Android غير متاح حاليًا.");
            setBusy(false);
            return;
          }
          setStatus("جارٍ تنزيل تطبيق ثمار. لا يحتاج المتصفح إلى تحديث.");
          window.location.href = meta.downloadUrl;
        }
      } else {
        setStatus("التحديث غير متاح على هذه المنصة.");
        setBusy(false);
        return;
      }
    } catch (error) {
      setStatus(`تعذّر التحديث: ${error instanceof Error ? error.message : "خطأ غير معروف"}. حاول مرة أخرى.`);
    } finally {
      setBusy(false);
    }
  };

  const windowAny = window as any;
  windowAny.__thimarOpenUpdatePrompt = () => setOpen(true);
  windowAny.__thimarStartUpdateDownload = () => {
    setOpen(true);
    void handleDownload();
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>هناك تحديث جديد — Thimar</h3>
        <p className="muted">يتوفر إصدار جديد من تطبيق ثمار. يمكنك تنزيله الآن أو تأجيله.</p>
        {availableVersion ? (
          <p className="muted">
            <strong>{availableVersion}</strong>
            {" — "}
            {availableMeta?.releaseDate ? `تاريخ الإصدار: ${availableMeta.releaseDate}` : null}
            {" — "}
            {availableSize
              ? (availableSize >= 1024 * 1024 * 1024
                  ? (availableSize / (1024 * 1024 * 1024)).toFixed(2) + " GB"
                  : (availableSize / (1024 * 1024)).toFixed(1) + " MB")
              : "Size unavailable"}
            {(availableMeta?.minSupportedVersionCode && getInstalledVersionCode() !== null && (getInstalledVersionCode() as number) < availableMeta.minSupportedVersionCode)
              ? " — إلزامي" : " — اختياري"}
          </p>
        ) : null}
        {availableNotes ? <p className="muted" style={{ fontSize: 13 }}>{availableNotes}</p> : null}
        {status ? <p className="muted">{status}</p> : null}
        {busy ? (
          <div style={{ width: "100%", height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden", margin: "8px 0" }}>
            <div style={{ width: "100%", height: "100%", background: "#2F5C4A", animation: "thimar-progress 1.2s ease-in-out infinite" }} />
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" className="ghost-button" onClick={() => setShowDetails((v) => !v)} disabled={busy}>
            {showDetails ? "إخفاء التفاصيل" : "عرض تفاصيل الإصدار"}
          </button>
        </div>
        {showDetails && availableMeta ? (
          <div className="muted" style={{ fontSize: 13, marginTop: 8, textAlign: "right" }}>
            {(() => {
              const rn = availableMeta.releaseNotes?.ar || availableMeta.releaseNotes?.en;
              if (!rn) return null;
              return (
                <>
                  {Array.isArray(rn.features) && rn.features.length ? (
                    <div><strong>الميزات:</strong><ul>{rn.features.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>
                  ) : null}
                  {Array.isArray(rn.improvements) && rn.improvements.length ? (
                    <div><strong>تحسينات:</strong><ul>{rn.improvements.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>
                  ) : null}
                  {Array.isArray(rn.bugFixes) && rn.bugFixes.length ? (
                    <div><strong>إصلاحات:</strong><ul>{rn.bugFixes.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>
                  ) : null}
                  {Array.isArray(rn.securityUpdates) && rn.securityUpdates.length ? (
                    <div><strong>أمان:</strong><ul>{rn.securityUpdates.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>
                  ) : null}
                </>
              );
            })()}
          </div>
        ) : null}
        <div className="form-actions">
          <button type="button" className="ghost-button" onClick={handleLater} disabled={busy}>
            لاحقاً
          </button>
          <button type="button" className="primary-button" onClick={handleDownload} disabled={busy}>
            {busy ? "جارٍ…" : "تحديث الآن"}
          </button>
        </div>
      </div>
    </div>
  );
}
