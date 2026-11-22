import { cloud } from "./cloud";

/**
 * حدود المصادقة على الخادم (prepared, non-default).
 *
 * المصادقة الحالية تُتمّ في المتصفح: تُقرأ بصمة كلمة المرور والملح من الجدول ثم تُقارن
 * محليًا. هذا هو سبب انكشاف البصمات. الدالتان هنا تنقلان التحقق إلى Postgres عبر RPC
 * (انظر artifacts/AUTH-BOUNDARY.sql)، فلا تعود البصمة ولا الملح تخرج من قاعدة البيانات.
 *
 * التفعيل مقصود أن يكون اختياريًا: ما لم يُضبط المفتاح أدناه إلى "1" يبقى المسار القديم
 * كما هو تمامًا، حتى لا ينقطع دخول أي مستخدم قبل نشر الدالتين في القاعدة.
 */
export const AUTH_RPC_FLAG = "thimar.auth.rpc";

export function rpcAuthEnabled(): boolean {
  try {
    return localStorage.getItem(AUTH_RPC_FLAG) === "1";
  } catch {
    return false;
  }
}

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

/** 404/42883 = الدالة غير منشورة بعد؛ نعود للمسار المحلي بدل تعطيل الدخول. */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "");
  return (
    code === "42883" ||
    code === "PGRST202" ||
    message.includes("Could not find the function") ||
    message.includes("does not exist")
  );
}

export async function loginViaRpc(username: string, password: string): Promise<RpcLoginResult> {
  try {
    const { data, error } = await cloud.rpc("thimar_login", {
      p_username: username,
      p_password: password,
    });
    if (error) {
      if (isMissingFunction(error)) return { status: "unavailable" };
      if (String(error.message ?? "").includes("RATE_LIMITED")) {
        return { status: "error", message: RATE_LIMITED_MESSAGE };
      }
      return { status: "error", message: GENERIC_ERROR };
    }
    if (!data) return { status: "error", message: GENERIC_ERROR };
    const row = data as RpcAccountRow & { error?: string };
    if (row.error === "ACCOUNT_BANNED") {
      return { status: "error", message: "تم حظر حسابك من قبل المسؤول." };
    }
    if (row.error === "ACCOUNT_INACTIVE") {
      return { status: "error", message: "حسابك غير مفعّل بعد." };
    }
    if (!row.id || !row.username) return { status: "error", message: GENERIC_ERROR };
    return { status: "ok", account: row };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * تغيير كلمة المرور: تُرسل البصمة الجديدة المحسوبة محليًا مع كلمة المرور القديمة
 * (لإثبات الملكية). تعيد null إذا كانت الدالة غير منشورة، حتى يبقى المسار القديم ممكنًا.
 */
export async function changePasswordViaRpc(
  accountId: string,
  oldPassword: string,
  newHash: string,
  newSalt: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await cloud.rpc("thimar_change_password", {
      p_account_id: accountId,
      p_old_password: oldPassword,
      p_new_hash: newHash,
      p_new_salt: newSalt,
    });
    if (error) {
      if (isMissingFunction(error)) return null;
      return false;
    }
    return data === true;
  } catch {
    return null;
  }
}
