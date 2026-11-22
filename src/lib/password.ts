/**
 * حماية كلمات المرور: لا تُخزَّن كلمة المرور نفسها في الجهاز ولا في السحابة،
 * بل بصمة SHA-256 مع ملح عشوائي لكل حساب (نفس الصيغة المستخدمة في قاعدة البيانات).
 */

/** ملح عشوائي بصيغة ست عشرية (32 حرفًا). */
export function newPasswordSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** بصمة كلمة المرور: sha256(salt + ":" + password) بصيغة ست عشرية. */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** يتحقق من كلمة المرور مقابل البصمة المحفوظة. */
export async function verifyPassword(
  password: string,
  salt: string,
  hash: string,
): Promise<boolean> {
  const candidate = await hashPassword(password, salt);
  return candidate === hash;
}
