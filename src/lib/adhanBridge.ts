/**
 * جسر أذان أندرويد الأصلي (WebView ↔ Java). كل الدوال آمنة على الويب
 * ولا تفعل شيئًا إن لم يكن الجسر موجودًا.
 */

type NativeAdhan = {
  scheduleAdhan?: (json: string) => void;
  syncAdhanAssets?: (json: string) => string;
  getAdhanStatus?: () => string;
  requestAdhanPermissions?: () => void;
  requestNotificationPermission?: () => void;
  openAdhanPermission?: (key: string) => void;
  testAdhan?: (prayer: string) => void;
  cancelAdhan?: () => void;
};

export type AdhanPermissionState = {
  notifications?: boolean;
  fullScreenIntent?: boolean;
  exactAlarms?: boolean;
  batteryUnrestricted?: boolean;
  android?: number;
};

export type AdhanStatus = {
  permissions?: AdhanPermissionState;
  assets?: {
    images?: Record<string, { cached: boolean; bytes: number }>;
    audio?: { count: number; bytes: number };
    lastSync?: number;
    lastBytes?: number;
    lastError?: string;
  };
  scheduled?: Record<string, string>;
  lastPlayed?: string;
  assetsBytes?: number;
  error?: string;
};

function bridge(): NativeAdhan | null {
  if (typeof window === "undefined") return null;
  const native = (window as unknown as { ThimarAdhan?: NativeAdhan }).ThimarAdhan;
  return native && typeof native.scheduleAdhan === "function" ? native : null;
}

export function hasNativeAdhan(): boolean {
  return bridge() !== null;
}

export function scheduleNativeAdhan(payload: Record<string, unknown>): boolean {
  const native = bridge();
  if (!native?.scheduleAdhan) return false;
  try {
    native.scheduleAdhan(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function syncAdhanAssets(payload: Record<string, unknown>): AdhanStatus | null {
  const native = bridge();
  if (!native?.syncAdhanAssets) return null;
  try {
    return JSON.parse(native.syncAdhanAssets(JSON.stringify(payload))) as AdhanStatus;
  } catch {
    return null;
  }
}

export function readAdhanStatus(): AdhanStatus | null {
  const native = bridge();
  if (!native?.getAdhanStatus) return null;
  try {
    return JSON.parse(native.getAdhanStatus()) as AdhanStatus;
  } catch {
    return null;
  }
}

export function requestAdhanPermission(key: string): void {
  bridge()?.openAdhanPermission?.(key);
}

export function requestAdhanNotificationPermission(): void {
  bridge()?.requestNotificationPermission?.();
}

export function testAdhanNow(prayer = "Fajr"): void {
  bridge()?.testAdhan?.(prayer);
}
