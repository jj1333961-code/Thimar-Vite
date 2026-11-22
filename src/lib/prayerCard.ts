/* بطاقة الصلاة: صورة جاهزة محفوظة مع ملفات التطبيق، يُكتب عليها اسم الصلاة ووقتها وتاريخها. */

const CARD_URL = `${import.meta.env.BASE_URL || "/"}images/prayer-card.jpg`;

export type PrayerCardInput = {
  prayerName: string;
  time: string;
  date: string;
  city?: string;
};

let templatePromise: Promise<HTMLImageElement> | null = null;

function loadTemplate(): Promise<HTMLImageElement> {
  if (!templatePromise) {
    templatePromise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("prayer-card-unavailable"));
      image.src = CARD_URL;
    }).catch((error) => {
      templatePromise = null;
      throw error;
    });
  }
  return templatePromise;
}

/** يرسم البطاقة ويعيد PNG جاهزًا للمشاركة أو التنزيل. */
export async function buildPrayerCard(input: PrayerCardInput): Promise<Blob> {
  const image = await loadTemplate();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || 880;
  canvas.height = image.naturalHeight || 1184;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas-unavailable");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const font = (size: number, weight = 700) =>
    `${weight} ${size}px "Tajawal", "Amiri", system-ui, sans-serif`;
  const center = canvas.width / 2;
  const baseY = canvas.height * 0.42;

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#f6e7bd";
  context.font = font(canvas.width * 0.045, 700);
  context.fillText("موعد الصلاة", center, baseY - canvas.height * 0.12);

  context.fillStyle = "#ffffff";
  context.font = font(canvas.width * 0.13, 800);
  context.fillText(input.prayerName, center, baseY);

  context.fillStyle = "#ffd979";
  context.font = font(canvas.width * 0.1, 800);
  context.fillText(input.time, center, baseY + canvas.height * 0.11);

  context.fillStyle = "#f2e6c9";
  context.font = font(canvas.width * 0.05, 600);
  context.fillText(input.date, center, baseY + canvas.height * 0.2);

  if (input.city) {
    context.fillStyle = "rgba(255,255,255,0.78)";
    context.font = font(canvas.width * 0.04, 600);
    context.fillText(input.city, center, baseY + canvas.height * 0.26);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("prayer-card-failed"));
    }, "image/png");
  });
}

/** يشارك البطاقة إن أمكن، وإلا ينزّلها على الجهاز. */
export async function sharePrayerCard(input: PrayerCardInput): Promise<"shared" | "downloaded"> {
  const blob = await buildPrayerCard(input);
  const file = new File([blob], `prayer-${Date.now()}.png`, { type: "image/png" });
  const scope = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof scope.share === "function" && scope.canShare?.({ files: [file] })) {
    try {
      await scope.share({ files: [file], title: `صلاة ${input.prayerName}` });
      return "shared";
    } catch {
      /* المستخدم أغلق نافذة المشاركة. */
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}
