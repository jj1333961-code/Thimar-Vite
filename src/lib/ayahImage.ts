/*
 * صورة مشاركة الآيات: تُرسم على canvas بنص الآيات المحددة فقط، بخط عربي
 * واضح، مع اسم السورة وأرقام الآيات وشعار ثمار الرسمي (أيقونة التطبيق نفسها).
 */

import { surahs } from "../data/surahs";
import type { HafsAyah } from "./mushafText";

const LOGO_URL = `${import.meta.env.BASE_URL || "/"}icons/icon-192.png`;
const WIDTH = 1200;
const PADDING = 84;

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

export function arabicNumber(value: number): string {
  return String(value)
    .split("")
    .map((char) => (/[0-9]/.test(char) ? ARABIC_DIGITS[Number(char)] : char))
    .join("");
}

export function surahNameOfNumber(number: number): string {
  return surahs[number - 1]?.name ?? `سورة ${number}`;
}

/** عنوان مختصر للاختيار: «سورة البقرة — الآية ٢٥٥» أو «سورة البقرة — الآيات ١–٥». */
export function selectionTitle(ayahs: HafsAyah[]): string {
  if (!ayahs.length) return "";
  const surahsSet = new Set(ayahs.map((ayah) => ayah.surah));
  if (surahsSet.size > 1) {
    return `${arabicNumber(ayahs.length)} آيات من ${arabicNumber(surahsSet.size)} سور`;
  }
  const name = surahNameOfNumber(ayahs[0].surah);
  const numbers = [...new Set(ayahs.map((ayah) => ayah.ayah))].sort((first, second) => first - second);
  if (numbers.length === 1) return `سورة ${name} — الآية ${arabicNumber(numbers[0])}`;
  const consecutive = numbers.every((value, index) => index === 0 || value === numbers[index - 1] + 1);
  if (consecutive) {
    return `سورة ${name} — الآيات ${arabicNumber(numbers[0])}–${arabicNumber(numbers[numbers.length - 1])}`;
  }
  if (numbers.length === 2) {
    return `سورة ${name} — الآيتان ${arabicNumber(numbers[0])} و${arabicNumber(numbers[1])}`;
  }
  if (numbers.length <= 4) {
    return `سورة ${name} — الآيات ${numbers.map(arabicNumber).join("، ")}`;
  }
  return `سورة ${name} — ${arabicNumber(numbers.length)} آيات مختارة`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("logo unavailable"));
    image.src = url;
  });
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawPattern(ctx: CanvasRenderingContext2D, height: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(15, 95, 78, 0.07)";
  ctx.lineWidth = 1.4;
  const step = 56;
  for (let y = step; y < height; y += step) {
    for (let x = step; x < WIDTH; x += step) {
      const size = 13;
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size, y);
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();
}

export type AyahImageResult = {
  canvas: HTMLCanvasElement;
  blob: Blob;
  dataUrl: string;
};

/** يرسم صورة المشاركة ويعيدها مع رابط بيانات للمعاينة. */
export async function buildAyahImage(ayahs: HafsAyah[]): Promise<AyahImageResult> {
  if (!ayahs.length) throw new Error("لا توجد آيات محددة");

  const measuring = document.createElement("canvas");
  const measure = measuring.getContext("2d");
  if (!measure) throw new Error("تعذّر إنشاء الصورة على هذا الجهاز");

  await document.fonts?.ready?.catch(() => undefined);
  try { await document.fonts?.load?.('64px "QuranUthmani"'); } catch { /* ignore */ }
  try { await document.fonts?.load?.('40px "Tajawal"'); } catch { /* ignore */ }

  const totalChars = ayahs.reduce((total, ayah) => total + ayah.text.length, 0);
  // حجم خط ثابت نسبيًا (لا تقلّص للنص) — الارتفاع يُحسب تلقائيًا.
  const fontSize = totalChars <= 260 ? 62 : totalChars <= 600 ? 56 : 50;
  const lineHeight = Math.round(fontSize * 1.95);
  const bodyFont = `${fontSize}px "QuranUthmani", "Amiri Quran", "Amiri", serif`;
  measure.font = bodyFont;
  measure.direction = "rtl";

  const textWidth = WIDTH - PADDING * 2;
  const paragraphs = ayahs.map((ayah) => `${ayah.text} ﴿${arabicNumber(ayah.ayah)}﴾`);
  const wrapped = paragraphs.map((paragraph) => wrapText(measure, paragraph, textWidth));
  const bodyLines = wrapped.reduce((total, lines) => total + lines.length, 0);
  const gapBetweenAyahs = Math.round(lineHeight * 0.55);

  const headerHeight = 300;
  const footerHeight = 130;
  const bodyHeight = bodyLines * lineHeight + (ayahs.length - 1) * gapBetweenAyahs;
  const height = Math.max(760, Math.round(headerHeight + bodyHeight + footerHeight + PADDING));

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذّر إنشاء الصورة على هذا الجهاز");

  // خلفية عاجية.
  const background = ctx.createLinearGradient(0, 0, WIDTH, height);
  background.addColorStop(0, "#fffdf7");
  background.addColorStop(0.55, "#fbf4e4");
  background.addColorStop(1, "#f3e8ce");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, height);
  drawPattern(ctx, height);

  // إطار ذهبي مزدوج.
  ctx.strokeStyle = "#c9a24a";
  ctx.lineWidth = 6;
  roundedRect(ctx, 30, 30, WIDTH - 60, height - 60, 34);
  ctx.stroke();
  ctx.strokeStyle = "rgba(15, 95, 78, 0.55)";
  ctx.lineWidth = 2;
  roundedRect(ctx, 48, 48, WIDTH - 96, height - 96, 26);
  ctx.stroke();

  // الشعار (الأيقونة الرسمية) + اسم التطبيق.
  try {
    const logo = await loadImage(LOGO_URL);
    const size = 112;
    const logoX = WIDTH / 2 - size / 2;
    const logoY = 62;
    ctx.save();
    roundedRect(ctx, logoX, logoY, size, size, 24);
    ctx.clip();
    ctx.drawImage(logo, logoX, logoY, size, size);
    ctx.restore();
  } catch {
    /* يبقى التصميم صالحًا دون الشعار إن تعذّر تحميله. */
  }

  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.fillStyle = "#0f5f4e";
  ctx.font = '700 42px "Aref Ruqaa", "Reem Kufi", "Amiri", serif';
  ctx.fillText("ثمار", WIDTH / 2, 228);

  ctx.fillStyle = "#8a6a2f";
  ctx.font = '600 22px "Tajawal", system-ui, sans-serif';
  ctx.fillText("حفظ القرآن الكريم وتسميعه", WIDTH / 2, 262);

  // اسم السورة وأرقام الآيات.
  ctx.fillStyle = "#0f5f4e";
  ctx.font = '700 32px "Tajawal", system-ui, sans-serif';
  ctx.fillText(selectionTitle(ayahs), WIDTH / 2, 312);

  ctx.strokeStyle = "rgba(201, 162, 74, 0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(WIDTH / 2 - 150, 332);
  ctx.lineTo(WIDTH / 2 + 150, 332);
  ctx.stroke();

  // نص الآيات — خط المصحف، RTL، التفاف طبيعي.
  ctx.font = bodyFont;
  ctx.fillStyle = "#1c1a14";
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  let y = headerHeight;
  wrapped.forEach((lines, index) => {
    for (const line of lines) {
      ctx.fillText(line, WIDTH - PADDING, y);
      y += lineHeight;
    }
    if (index < wrapped.length - 1) {
      y += gapBetweenAyahs;
      ctx.fillStyle = "rgba(201, 162, 74, 0.45)";
      ctx.fillRect(WIDTH - PADDING - 120, y - Math.round(lineHeight * 0.35), 120, 2);
      ctx.fillStyle = "#1c1a14";
    }
  });

  // تذييل.
  const last = ayahs[ayahs.length - 1];
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.fillStyle = "#6b6252";
  ctx.font = '600 22px "Tajawal", system-ui, sans-serif';
  ctx.fillText(
    `مصحف حفص — رواية حفص عن عاصم • الجزء ${arabicNumber(last.juz)} • صفحة ${arabicNumber(last.page)}`,
    WIDTH / 2,
    height - 78,
  );
  ctx.fillStyle = "#0f5f4e";
  ctx.font = '700 24px "Tajawal", system-ui, sans-serif';
  ctx.fillText("تطبيق ثمار", WIDTH / 2, height - 42);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("تعذّر إنشاء الصورة"));
    }, "image/png");
  });

  return { canvas, blob, dataUrl: canvas.toDataURL("image/png") };
}

/** مشاركة الصورة أو تنزيلها إن لم يدعم المتصفح المشاركة. */
export async function shareAyahImage(result: AyahImageResult, title: string): Promise<"shared" | "saved"> {
  const file = new File([result.blob], "thimar-ayah.png", { type: "image/png" });
  const shareData = {
    files: [file],
    title,
    text: title,
  } as ShareData;
  if (typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return "shared";
    } catch {
      /* المستخدم أغلق المشاركة — نعرض التنزيل. */
    }
  }
  const link = document.createElement("a");
  link.href = result.dataUrl;
  link.download = "thimar-ayah.png";
  link.click();
  return "saved";
}
