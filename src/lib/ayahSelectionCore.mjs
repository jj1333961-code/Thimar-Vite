/*
 * منطق تحديد الآيات المتتابعة — وحدة نقية تعمل في المتصفح وفي Node للاختبار.
 *
 * التحديد يعتمد على الرقم العام للآية (١..٦٢٣٦)، لا على رقم الآية داخل السورة،
 * فلا يختلط بين آيات السور المختلفة، ويعمل عبر حدود الصفحات والسور.
 */

/** يبني قائمة مفاتيح مرتبة حسب الأرقام العامة من «from» إلى «to» شاملين. */
export function rangeKeys(keysByGlobal, from, to) {
  const keys = [];
  const start = Math.max(1, Math.round(from));
  const end = Math.round(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return keys;
  for (let global = start; global <= end; global += 1) {
    const key = keysByGlobal[global];
    if (typeof key === "string" && key) keys.push(key);
  }
  return keys;
}

/**
 * نتيجة الضغط على آية:
 * - لا تحديد سابق: تُحدَّد الآية وحدها.
 * - الضغط داخل المجموعة المحددة: يبقى ما قبل الآية المضغوطة فقط، وتُلغى هي وما بعدها.
 * - الضغط خارج المجموعة: يمتد التحديد من المجموعة إلى الآية المضغوطة (نطاق متتابع).
 */
export function selectionAfterTap({ keysByGlobal, globalOf, current, tapped }) {
  const tappedGlobal = globalOf.get(tapped);
  if (typeof tappedGlobal !== "number" || !Number.isFinite(tappedGlobal)) {
    return Array.isArray(current) ? current.slice() : [];
  }
  const currentGlobals = [];
  for (const key of current || []) {
    const global = globalOf.get(key);
    if (typeof global === "number" && Number.isFinite(global)) currentGlobals.push(global);
  }
  if (!currentGlobals.length) return [tapped];

  const min = Math.min(...currentGlobals);
  const max = Math.max(...currentGlobals);
  if (tappedGlobal >= min && tappedGlobal <= max) {
    return rangeKeys(keysByGlobal, min, tappedGlobal - 1);
  }
  return rangeKeys(keysByGlobal, Math.min(min, tappedGlobal), Math.max(max, tappedGlobal));
}
