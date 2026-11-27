import { ApiError, apiCall } from "./api";
import { loginInCloud } from "./cloud";

/**
 * حدود المصادقة على الخادم.
 *
 * التحقق من كلمة المرور يحدث داخل Postgres (`thimar_api` → `login`)، فلا تخرج
 * البصمة ولا الملح من قاعدة البيانات إلى المتصفح. تُحفظ محليًا بصمة مشتقة
 * (scrypt) للسماح بالدخول دون إنترنت على الجهاز نفسه فقط.
 */

export type RpcAccountRow = {
  id: string;
  type: string;
  username: string;
  fullName?: string;
  countryCode?: string;
  phone?: string;
  email?: string;
  status?: string;
  banned?: boolean;
  student?: unknown;
  teacher?: unknown;
  guardian?: unknown;
};

export type RpcLoginResult =
  | { status: "ok"; account: RpcAccountRow }
  | { status: "error"; message: string }
  | { status: "unavailable" };

const RATE_LIMITED_MESSAGE = "محاولات كثيرة. انتظر ربع ساعة ثم أعد المحاولة.";
const GENERIC_ERROR = "اسم المستخدم أو كلمة المرور غير صحيحة.";

function codeOf(error: unknown): string {
  return error instanceof ApiError ? error.code : "ERROR";
}

/** NETWORK = الخادم غير متاح؛ نعود للمسار المحلي بدل تعطيل الدخول. */
function isUnavailable(error: unknown): boolean {
  return ["NETWORK", "HTTP_502", "HTTP_503", "HTTP_504", "PGRST202"].includes(codeOf(error));
}

export async function loginViaRpc(username: string, password: string): Promise<RpcLoginResult> {
  const nativeDeviceId = (globalThis as any)?.ThimarNative?.deviceId?.();
  try {
    const result = await loginInCloud(
      username,
      password,
      typeof nativeDeviceId === "string" ? nativeDeviceId : undefined,
    );
    const row = result.account as Record<string, any>;
    if (!row?.id || !row?.username) return { status: "error", message: GENERIC_ERROR };
    return {
      status: "ok",
      account: {
        id: row.id,
        type: row.type,
        username: row.username,
        fullName: row.full_name ?? row.username,
        countryCode: row.country_code ?? "SA",
        phone: row.phone ?? "",
        email: row.email ?? "",
        status: row.status ?? "active",
        banned: Boolean(row.banned),
        student: row.student ?? undefined,
        teacher: row.teacher ?? undefined,
        guardian: row.guardian ?? undefined,
      },
    };
  } catch (error) {
    if (isUnavailable(error)) return { status: "unavailable" };
    const code = codeOf(error);
    if (code === "TOO_MANY_ATTEMPTS") return { status: "error", message: RATE_LIMITED_MESSAGE };
    if (code === "ACCOUNT_BANNED") return { status: "error", message: "تم حظر حسابك من قبل المسؤول." };
    if (code === "ACCOUNT_NOT_ACTIVE") return { status: "error", message: "حسابك غير مفعّل بعد." };
    if (code === "INVALID_CREDENTIALS" || code === "MISSING_CREDENTIALS") {
      return { status: "error", message: GENERIC_ERROR };
    }
    return { status: "error", message: GENERIC_ERROR };
  }
}

/** رمز عملية تغيير كلمة المرور (يُترجم في auth.ts إلى رسالة عربية). */
export async function changePasswordViaRpc(oldPassword: string, newPassword: string): Promise<string | null> {
  try {
    await apiCall("password.change", { oldPassword, newPassword });
    return null;
  } catch (error) {
    if (isUnavailable(error)) return "NETWORK";
    return codeOf(error);
  }
}
