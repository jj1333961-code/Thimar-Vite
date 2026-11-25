import { isValidPhoneNumber } from "libphonenumber-js";
import mobileExamples from "libphonenumber-js/examples.mobile.json";
import { findCountry } from "../data/countries";

/**
 * أمثلة أرقام الجوال الدولية من libphonenumber. طول المثال هو الطول الوطني
 * المتوقع للجوال في الدولة، ويُستخدم لضبط maxLength ورسالة الخطأ.
 */
const examples = mobileExamples as Record<string, string | undefined>;

export type PhoneRule = {
  /** عدد الأرقام الوطنية المسموح بها بعد كود الدولة. */
  length: number;
  /** مثال للتنسيق داخل حقل الإدخال. */
  placeholder: string;
  /** كود الاتصال الدولي. */
  dial: string;
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function groupDigits(value: string): string {
  if (value.length <= 4) return value;
  if (value.length <= 7) return `${value.slice(0, 3)} ${value.slice(3)}`;
  if (value.length <= 10) {
    return `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6)}`;
  }
  return `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6, 9)} ${value.slice(9)}`;
}

/** قاعدة رقم الهاتف للدولة المختارة، مع احتياط آمن للدول غير المتوفرة. */
export function phoneRule(countryCode: string): PhoneRule {
  const country = findCountry(countryCode);
  const example = digitsOnly(examples[countryCode] ?? "");
  const length = example.length > 0 ? example.length : 15;
  return {
    length,
    placeholder: groupDigits(example || "5".repeat(length)),
    dial: country?.dial ?? "",
  };
}

/**
 * يتحقق من الرقم الوطني (بدون كود الدولة) وفق طول الجوال في الدولة.
 * يعيد رسالة عربية عند الخطأ، أو سلسلة فارغة عند الصحة.
 */
export function validateNationalPhone(countryCode: string, value: string): string {
  const country = findCountry(countryCode);
  const rule = phoneRule(countryCode);
  const digits = digitsOnly(value);
  const name = country?.ar ?? "الدولة";
  if (!digits) return "أدخل رقم الهاتف.";
  if (digits.length !== rule.length) {
    return `رقم ${name} يتكوّن من ${rule.length} أرقام بعد كود الدولة (${rule.dial}).`;
  }
  const international = `${rule.dial}${digits}`;
  if (rule.dial && !isValidPhoneNumber(international)) {
    return `أدخل رقم ${name} صحيحاً بدون كود الدولة.`;
  }
  return "";
}
