/*
 * صورة مشاركة الآيات: تُرسم على canvas بنص الآيات المحددة فقط، بخط المصحف
 * (QuranUthmani) بعد التأكد من تحميله، مع اسم السورة وأرقام الآيات وشعار ثمار.
 *
 * التصميم مقسّم إلى مناطق رأسية مستقلة (شعار/عنوان/نص/تذييل) تُحسب ارتفاعاتها
 * أولًا ثم تُرسم بالتتابع، فلا يمكن أن يتداخل النص القرآني مع الشعار أو العنوان،
 * ولا أن تخرج الآيات عن حدود الصورة.
 */

import { surahs } from "../data/surahs";
import type { HafsAyah } from "./mushafText";

const BASE = import.meta.env.BASE_URL || "/";
const LOGO_URL = `${BASE}icons/icon-192.png`;
const WIDTH = 1080;
const PADDING = 56;
const MAX_HEIGHT = 3400;

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
    image.onerror = () => reject(new Error("image unavailable"));
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
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** يلفّ النص العربي حسب العرض المتاح دون كسر الكلمات. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/*
 * عنوان الخط: خط المصحف المضمَّن يعمل دون إنترنت، ثم بدائل عربية إن لم يتوفر.
 * نُحمّل الخط فعليًا قبل القياس والرسم حتى لا تختلف عروض الكلمات بين القياس
 * والرسم (وهو سبب تداخل الكلمات في الصورة القديمة).
 */
const BODY_FAMILY = '"Hafs", "QuranUthmani", "Amiri Quran", "Scheherazade New", "Amiri", serif';

async function ensureFonts(fontSize: number): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts) return;
  try {
    await fonts.ready;
  } catch {
    /* المتابعة بالخط البديل */
  }
  /* خط المصحف نفسه المستخدم في صفحة القراءة («Hafs» = عثماني حفص) ثم البديل. */
  const loads = [
    fonts.load(`400 ${fontSize}px "Hafs"`),
    fonts.load(`400 ${fontSize}px "QuranUthmani"`),
    fonts.load(`700 40px "Tajawal"`),
    fonts.load(`600 30px "Tajawal"`),
    fonts.load(`700 46px "Aref Ruqaa"`),
  ];
  await Promise.all(loads.map((job) => job.catch(() => undefined)));
  try {
    await fonts.ready;
  } catch {
    /* المتابعة */
  }
  /*
   * لا نرسم بخط لم يُحمَّل: القياس بخط والرسم بآخر هو سبب تداخل الكلمات في
   * الصورة القديمة. إن فشل تحميل خط المصحف ننتظر حتى ينتهي التحميل الجاري.
   */
  if (!fonts.check(`400 ${fontSize}px "Hafs"`)) {
    try {
      await fonts.load(`400 ${fontSize}px "Hafs"`);
    } catch {
      /* نكمل بالخط المتاح */
    }
  }
}

function drawPattern(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(15, 95, 78, 0.06)";
  ctx.lineWidth = 1.4;
  const step = 54;
  for (let y = step; y < height; y += step) {
    for (let x = step; x < width; x += step) {
      const size = 12;
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

type Layout = {
  fontSize: number;
  lineHeight: number;
  wrapped: string[][];
  bodyHeight: number;
  ayahGap: number;
  headerHeight: number;
  titleHeight: number;
  footerHeight: number;
  height: number;
};

/**
 * يحسب التوزيع الرأسي كاملًا قبل الرسم: اختيار حجم الخط ثم عدد الأسطر ثم
 * ارتفاع كل منطقة، مع تصغير تدريجي حتى تدخل الصورة في الحد الأقصى للارتفاع.
 */
function computeLayout(measure: CanvasRenderingContext2D, ayahs: HafsAyah[]): Layout {
  const textWidth = WIDTH - PADDING * 2;
  const totalChars = ayahs.reduce((total, ayah) => total + ayah.text.length, 0);
  let fontSize = totalChars <= 220 ? 56 : totalChars <= 520 ? 50 : totalChars <= 1000 ? 44 : 38;

  const headerHeight = 250;
  const titleHeight = 96;
  const footerHeight = 150;

  for (;;) {
    const lineHeight = Math.round(fontSize * 2.15);
    const markerHeight = Math.round(fontSize * 0.86);
    // مساحة محجوزة في نهاية آخر سطر لعلامة رقم الآية، فلا تتراكب مع النص أبدًا.
    const markerReserve = Math.round(markerHeight * 0.85) + 14;
    const wrapWidth = Math.max(180, textWidth - markerReserve);
    measure.font = `400 ${fontSize}px ${BODY_FAMILY}`;
    measure.direction = "rtl";

    const wrapped = ayahs.map((ayah) => wrapText(measure, ayah.text, wrapWidth));
    const lineCount = wrapped.reduce((total, lines) => total + lines.length, 0);
    const ayahGap = Math.round(lineHeight * 0.42);
    const bodyHeight = lineCount * lineHeight + Math.max(0, ayahs.length - 1) * ayahGap;
    const height = Math.round(
      PADDING + headerHeight + titleHeight + bodyHeight + Math.max(0, ayahs.length - 1) * 6 + footerHeight + PADDING,
    );

    if (height <= MAX_HEIGHT || fontSize <= 24) {
      return {
        fontSize,
        lineHeight,
        wrapped,
        bodyHeight,
        ayahGap,
        headerHeight,
        titleHeight,
        footerHeight,
        height: Math.max(720, height),
      };
    }
    fontSize -= 3;
  }
}

/** يرسم صورة المشاركة ويعيدها مع رابط بيانات للمعاينة. */
export async function buildAyahImage(ayahs: HafsAyah[]): Promise<AyahImageResult> {
  if (!ayahs.length) throw new Error("لا توجد آيات محددة");

  const measuring = document.createElement("canvas");
  const measure = measuring.getContext("2d");
  if (!measure) throw new Error("تعذّر إنشاء الصورة على هذا الجهاز");

  await ensureFonts(56);

  const layout = computeLayout(measure, ayahs);
  const {
    fontSize,
    lineHeight,
    wrapped,
    ayahGap,
    headerHeight,
    titleHeight,
    footerHeight,
    height,
  } = layout;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذّر إنشاء الصورة على هذا الجهاز");

  /* ---------- الخلفية والإطار ---------- */
  const background = ctx.createLinearGradient(0, 0, WIDTH, height);
  background.addColorStop(0, "#fffdf7");
  background.addColorStop(0.55, "#fbf4e4");
  background.addColorStop(1, "#f1e6cb");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, height);
  drawPattern(ctx, WIDTH, height);

  ctx.strokeStyle = "#c9a24a";
  ctx.lineWidth = 6;
  roundedRect(ctx, 26, 26, WIDTH - 52, height - 52, 34);
  ctx.stroke();
  ctx.strokeStyle = "rgba(15, 95, 78, 0.5)";
  ctx.lineWidth = 2;
  roundedRect(ctx, 44, 44, WIDTH - 88, height - 88, 26);
  ctx.stroke();

  ctx.direction = "rtl";
  ctx.textBaseline = "alphabetic";

  /* ---------- منطقة الرأس: الشعار واسم التطبيق فقط ---------- */
  const headerTop = PADDING;
  const logoSize = 92;
  try {
    const logo = await loadImage(LOGO_URL);
    ctx.save();
    roundedRect(ctx, WIDTH / 2 - logoSize / 2, headerTop, logoSize, logoSize, 22);
    ctx.clip();
    ctx.drawImage(logo, WIDTH / 2 - logoSize / 2, headerTop, logoSize, logoSize);
    ctx.restore();
  } catch {
    /* يبقى التصميم صالحًا دون الشعار إن تعذّر تحميله. */
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#0f5f4e";
  ctx.font = '700 44px "Aref Ruqaa", "Reem Kufi", "Amiri", serif';
  ctx.fillText("ثمار", WIDTH / 2, headerTop + logoSize + 56);

  ctx.fillStyle = "#8a6a2f";
  ctx.font = '600 26px "Tajawal", system-ui, sans-serif';
  ctx.fillText("حفظ القرآن الكريم وتسميعه", WIDTH / 2, headerTop + logoSize + 96);

  /* ---------- منطقة العنوان: مستقلة تمامًا عن النص ---------- */
  const titleTop = headerTop + headerHeight;
  ctx.fillStyle = "#0f5f4e";
  ctx.font = '700 34px "Tajawal", system-ui, sans-serif';
  ctx.fillText(selectionTitle(ayahs), WIDTH / 2, titleTop + 44);

  ctx.strokeStyle = "rgba(201, 162, 74, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(WIDTH / 2 - 170, titleTop + 62);
  ctx.lineTo(WIDTH / 2 + 170, titleTop + 62);
  ctx.stroke();

  /* ---------- منطقة النص القرآني ---------- */
  let markerImage: HTMLImageElement | null = null;
  try {
    markerImage = await loadImage(`${BASE}images/ayah-mark.svg`);
  } catch {
    markerImage = null;
  }

  const bodyFont = `400 ${fontSize}px ${BODY_FAMILY}`;
  // نُعيد ضبط القياس بنفس الخط النهائي قبل الرسم للتأكد من تطابق العروض.
  measure.font = bodyFont;
  measure.direction = "rtl";

  const markerHeight = Math.round(fontSize * 0.86);
  const markerWidth = Math.round(markerHeight * 0.80542);
  const textRight = WIDTH - PADDING;
  /*
   * عندما تكون الآيات قليلة يبقى فراغ أسفلها: نُوزّعه بالتساوي فوق النص وتحته
   * بحد أقصى، فلا يلتصق النص بالعنوان ولا يترك فراغًا هائلًا في صورة صغيرة.
   */
  const bodyTop = titleTop + titleHeight;
  const footerBandTop = height - PADDING - footerHeight;
  const slack = Math.max(0, footerBandTop - bodyTop - layout.bodyHeight);
  let y = bodyTop + Math.min(Math.round(slack / 2), 150);

  ctx.font = bodyFont;
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";

  wrapped.forEach((lines, index) => {
    const ayah = ayahs[index];
    lines.forEach((line, lineIndex) => {
      const baseline = y + Math.round(lineHeight * 0.76);
      ctx.fillStyle = "#17140e";
      ctx.font = bodyFont;
      ctx.fillText(line, textRight, baseline);

      if (lineIndex === lines.length - 1) {
        const lineWidth = measure.measureText(line).width;
        const markerX = textRight - lineWidth - markerWidth - 10;
        const markerY = baseline - Math.round(markerHeight * 0.78);
        if (markerImage) {
          ctx.drawImage(markerImage, markerX, markerY, markerWidth, markerHeight);
          ctx.save();
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#007c89";
          ctx.font = `600 ${Math.max(13, Math.round(fontSize * 0.36))}px "QuranUthmani", "Amiri", serif`;
          ctx.fillText(
            arabicNumber(ayah.ayah),
            markerX + markerWidth / 2,
            markerY + markerHeight * 0.52,
          );
          ctx.restore();
        } else {
          ctx.save();
          ctx.textAlign = "right";
          ctx.fillStyle = "#007c89";
          ctx.font = `600 ${Math.round(fontSize * 0.5)}px "QuranUthmani", "Amiri", serif`;
          ctx.fillText(`﴿${arabicNumber(ayah.ayah)}﴾`, markerX + markerWidth, markerY + markerHeight * 0.8);
          ctx.restore();
        }
        ctx.font = bodyFont;
        ctx.fillStyle = "#17140e";
        ctx.textAlign = "right";
        ctx.textBaseline = "alphabetic";
      }
      y += lineHeight;
    });

    if (index < wrapped.length - 1) {
      y += ayahGap;
      ctx.save();
      ctx.strokeStyle = "rgba(201, 162, 74, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(WIDTH / 2 - 60, y - Math.round(ayahGap * 0.5));
      ctx.lineTo(WIDTH / 2, y - Math.round(ayahGap * 0.5) - 6);
      ctx.lineTo(WIDTH / 2 + 60, y - Math.round(ayahGap * 0.5));
      ctx.stroke();
      ctx.restore();
    }
  });

  /* ---------- منطقة التذييل ---------- */
  const footerTop = footerBandTop;
  ctx.strokeStyle = "rgba(201, 162, 74, 0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PADDING + 40, footerTop + 8);
  ctx.lineTo(WIDTH - PADDING - 40, footerTop + 8);
  ctx.stroke();

  const last = ayahs[ayahs.length - 1];
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.fillStyle = "#6b6252";
  ctx.font = '600 24px "Tajawal", system-ui, sans-serif';
  ctx.fillText(
    `مصحف حفص — رواية حفص عن عاصم • الجزء ${arabicNumber(last.juz)} • صفحة ${arabicNumber(last.page)}`,
    WIDTH / 2,
    footerTop + 62,
  );
  ctx.fillStyle = "#0f5f4e";
  ctx.font = '700 26px "Tajawal", system-ui, sans-serif';
  ctx.fillText("تطبيق ثمار", WIDTH / 2, footerTop + 108);

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
