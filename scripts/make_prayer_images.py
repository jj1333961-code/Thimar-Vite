"""يولّد صور الصلوات الخمس (public/adhan/prayer/*.jpg).

كل صلاة بصورة مستقلة: تدرّج لوني خاص بها، ومسجد، وزخرفة ذهبية، واسم الصلاة
مع عبارة تحفيزية. يُشغَّل يدويًا: python3 scripts/make_prayer_images.py
"""

import math
import os
import random

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1440
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "adhan", "prayer")
FONT_BOLD = "/tmp/Amiri-Bold.ttf"
FONT_REG = "/tmp/Amiri-Regular.ttf"

GOLD = (231, 199, 132)
CREAM = (250, 244, 230)


def grad(top, bottom, mid=None):
    img = Image.new("RGB", (W, H), top)
    draw = ImageDraw.Draw(img)
    stops = [(0.0, top), (1.0, bottom)] if mid is None else [(0.0, top), (0.55, mid), (1.0, bottom)]
    for y in range(H):
        t = y / (H - 1)
        for i in range(len(stops) - 1):
            a_t, a_c = stops[i]
            b_t, b_c = stops[i + 1]
            if a_t <= t <= b_t:
                f = (t - a_t) / max(b_t - a_t, 1e-6)
                color = tuple(int(a_c[k] + (b_c[k] - a_c[k]) * f) for k in range(3))
                draw.line([(0, y), (W, y)], fill=color)
                break
    return img


def stars(draw, count, seed, max_y):
    rnd = random.Random(seed)
    for _ in range(count):
        x = rnd.randint(0, W)
        y = rnd.randint(0, max_y)
        r = rnd.choice([1, 1, 1, 2])
        alpha = rnd.randint(90, 220)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, alpha))


def pattern(draw, alpha=26):
    """زخرفة هندسية خفيفة: معينات ذهبية متكررة."""
    step = 120
    for gy in range(-step, H + step, step):
        for gx in range(-step, W + step, step):
            cx, cy = gx + (step // 2 if (gy // step) % 2 else 0), gy
            d = 34
            draw.polygon([(cx, cy - d), (cx + d, cy), (cx, cy + d), (cx - d, cy)], outline=(*GOLD, alpha))
            draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(*GOLD, alpha))


def ornament(draw, cx, cy, size, color=(*GOLD, 235)):
    d = size
    draw.polygon([(cx, cy - d), (cx + d, cy), (cx, cy + d), (cx - d, cy)], outline=color, width=3)
    draw.polygon([(cx, cy - d // 2), (cx + d // 2, cy), (cx, cy + d // 2), (cx - d // 2, cy)], outline=color, width=2)
    draw.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=color)


def frame(draw):
    for inset, width in ((34, 4), (50, 2)):
        draw.rounded_rectangle([inset, inset, W - inset, H - inset], radius=42, outline=(*GOLD, 210), width=width)
    for cx, cy in ((34, 34), (W - 34, 34), (34, H - 34), (W - 34, H - 34)):
        ornament(draw, cx, cy, 26)


def mosque(draw, base_color, scale=1.0, horizon=H - 300):
    """ظلّ مسجد: قبّة مركزية ومئذنتان."""
    c = base_color
    # الأرض
    draw.rectangle([0, horizon, W, H], fill=c)
    # القاعدة
    draw.rectangle([W * 0.18, horizon - 70 * scale, W * 0.82, horizon], fill=c)
    # القبة الكبرى
    wx, wy = W * 0.5, horizon - 70 * scale
    rw, rh = 150 * scale, 120 * scale
    draw.ellipse([wx - rw, wy - rh * 2, wx + rw, wy], fill=c)
    draw.polygon([(wx, wy - rh * 2 - 46 * scale), (wx - 26 * scale, wy - rh * 2 + 6), (wx + 26 * scale, wy - rh * 2 + 6)], fill=c)
    # قباب جانبية
    for sx in (0.31, 0.69):
        cx = W * sx
        r = 78 * scale
        draw.ellipse([cx - r, wy - r * 2, cx + r, wy], fill=c)
        draw.polygon([(cx, wy - r * 2 - 30 * scale), (cx - 16 * scale, wy - r * 2 + 4), (cx + 16 * scale, wy - r * 2 + 4)], fill=c)
    # المآذن
    for sx in (0.2, 0.8):
        cx = W * sx
        top = horizon - 330 * scale
        draw.rectangle([cx - 15 * scale, top + 40, cx + 15 * scale, horizon], fill=c)
        draw.ellipse([cx - 22 * scale, top + 20, cx + 22 * scale, top + 62], fill=c)
        draw.polygon([(cx, top - 34 * scale), (cx - 18 * scale, top + 24), (cx + 18 * scale, top + 24)], fill=c)


def wrap(draw, text, font, max_w):
    words = text.split()
    lines, line = [], ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if draw.textlength(candidate, font=font, direction="rtl", language="ar") <= max_w or not line:
            line = candidate
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def centered(draw, y, text, font, fill):
    draw.text((W // 2, y), text, font=font, fill=fill, anchor="ma", direction="rtl", language="ar")


def build(name, palette, accent, phrase, label, seed, night=False, sun=None):  # noqa: C901
    top, mid, bottom = palette
    img = grad(top, mid, bottom).convert("RGB")
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    if night:
        stars(d, 130, seed, int(H * 0.62))

    if sun:
        cx, cy, r, color = sun
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        for step in range(14, 0, -1):
            rr = int(r * (1 + step * 0.34))
            gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(*color, 10))
        overlay = Image.alpha_composite(overlay, glow)
        d = ImageDraw.Draw(overlay)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*color, 205))

    pattern(d)
    frame(d)
    mosque(d, (*accent, 235), 0.92, int(H * 0.46))

    # تظليل أسفل الصورة لإبراز النص
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for y in range(int(H * 0.52), H):
        t = (y - H * 0.52) / (H * 0.48)
        sd.line([(0, y), (W, y)], fill=(6, 18, 16, int(226 * t)))
    overlay = Image.alpha_composite(overlay, shade)
    d = ImageDraw.Draw(overlay)

    f_label = ImageFont.truetype(FONT_BOLD, 46)
    f_title = ImageFont.truetype(FONT_BOLD, 84)
    f_phrase = ImageFont.truetype(FONT_REG, 50)
    f_small = ImageFont.truetype(FONT_REG, 32)

    ornament(d, W // 2, int(H * 0.585), 14)
    y = int(H * 0.625)
    centered(d, y, label, f_label, GOLD)
    y += 84
    centered(d, y, "حان وقت الصلاة", f_title, CREAM)
    y += 118

    for line in wrap(d, phrase, f_phrase, W - 240):
        centered(d, y, line, f_phrase, (240, 234, 219, 250))
        y += 74

    y = max(y + 26, int(H * 0.9))
    d.line([(W // 2 - 130, y), (W // 2 + 130, y)], fill=(*GOLD, 170), width=2)
    y += 46
    centered(d, y, "ثمار — تطبيق حفظ القرآن الكريم", f_small, (219, 230, 221, 190))

    out = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    path = os.path.join(OUT, f"{name}.jpg")
    out.save(path, "JPEG", quality=88, optimize=True, progressive=True)
    print("saved", path, os.path.getsize(path) // 1024, "KB")


def main():
    os.makedirs(OUT, exist_ok=True)
    build(
        "fajr",
        ((17, 26, 58), (86, 62, 108), (214, 156, 112)),
        (14, 22, 46),
        "بورك فيمن بكّر — صلاة الفجر نور يبدأ به يومك",
        "صلاة الفجر",
        7,
        night=True,
        sun=(760, 420, 54, (247, 222, 176)),
    )
    build(
        "dhuhr",
        ((28, 96, 92), (122, 190, 176), (247, 238, 214)),
        (16, 62, 60),
        "توقّف عن الدنيا لحظة… لصلاتك سكينة تعيد ترتيب يومك",
        "صلاة الظهر",
        11,
        sun=(540, 330, 96, (255, 246, 214)),
    )
    build(
        "asr",
        ((150, 84, 40), (222, 158, 92), (250, 232, 196)),
        (92, 48, 22),
        "حافظ على العصر… فهي صلاة من تركها حبط عمله",
        "صلاة العصر",
        17,
        sun=(330, 380, 72, (255, 231, 176)),
    )
    build(
        "maghrib",
        ((36, 16, 58), (146, 46, 70), (233, 122, 58)),
        (40, 16, 34),
        "لحظة غروب… ذنوب تغيب مع دعاء المغرب",
        "صلاة المغرب",
        23,
        sun=(540, 560, 106, (255, 176, 92)),
    )
    build(
        "isha",
        ((4, 12, 34), (13, 38, 62), (28, 74, 88)),
        (4, 12, 28),
        "اختم يومك بالعشاء… وابدأ ليلك مطمئنًا",
        "صلاة العشاء",
        29,
        night=True,
        sun=(300, 300, 46, (226, 233, 240)),
    )


if __name__ == "__main__":
    main()
