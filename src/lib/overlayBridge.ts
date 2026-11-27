/**
 * جسر النافذة العائمة مع تطبيق أندرويد. في المتصفح لا يوجد جسر،
 * فتعود الدوال بحالة آمنة بدل افتراض وجود الإذن.
 */
type NativeOverlay = {
  getOverlayStatus?: () => string;
  canDrawOverlays?: () => boolean;
  openOverlaySettings?: () => void;
  showOverlay?: () => boolean;
  hideOverlay?: () => void;
  getOverlayDiagnostics?: () => string;
  openAdhanDiagnostics?: () => void;
};

export type OverlayStatus = {
  supported: boolean;
  granted: boolean;
  showing: boolean;
  android?: number;
};

function bridge(): NativeOverlay | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ThimarOverlay?: NativeOverlay }).ThimarOverlay ?? null;
}

export function hasNativeOverlay(): boolean {
  return Boolean(bridge()?.getOverlayStatus);
}

export function readOverlayStatus(): OverlayStatus | null {
  const native = bridge();
  if (!native?.getOverlayStatus) return null;
  try {
    const parsed = JSON.parse(native.getOverlayStatus()) as Partial<OverlayStatus>;
    return {
      supported: parsed.supported !== false,
      granted: parsed.granted === true,
      showing: parsed.showing === true,
      android: parsed.android,
    };
  } catch {
    return null;
  }
}

export function openOverlaySettings(): void {
  try {
    bridge()?.openOverlaySettings?.();
  } catch {
    // إعدادات النظام غير متاحة من هذه النسخة.
  }
}

export function showFloatingOverlay(): boolean {
  try {
    return bridge()?.showOverlay?.() === true;
  } catch {
    return false;
  }
}

export function hideFloatingOverlay(): void {
  try {
    bridge()?.hideOverlay?.();
  } catch {
    // لا نافذة مفتوحة.
  }
}

/** يفتح أدوات تشخيص الأذان الأصلية (معاينة الصلوات والنافذة العائمة). */
export function openAdhanDiagnostics(): void {
  try {
    bridge()?.openAdhanDiagnostics?.();
  } catch {
    // ليس تطبيق أندرويد.
  }
}

/** أدلة الجهاز نفسها عن إذن النافذة (نص JSON) — للعرض داخل التطبيق فقط. */
export function readOverlayDiagnostics(): string {
  try {
    return bridge()?.getOverlayDiagnostics?.() ?? "";
  } catch {
    return "";
  }
}
