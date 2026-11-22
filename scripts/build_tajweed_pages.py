#!/usr/bin/env python3
"""يستخرج صفحات «مصحف التجويد الملون» (604 صفحة) من ملف الموسوعة القرآنية
https://quranpedia.net/book/27121  (BOOK_27121_1.pdf) إلى صور WebP تعمل دون إنترنت.

الملف: 685 صفحة ممسوحة؛ صفحات المصحف هي 10..613 (الصفحة 613 مطبوع عليها ٦٠٤).
لا يُعدَّل أي شيء في الصفحة: تُنزَّل الصورة المدمجة كما هي، ويُغيَّر حجمها فقط
للعرض على الشاشة، وتُحوَّل إلى WebP لتقليل الحجم.

الناتج: packaging/android/app/src/main/assets/mushaf/001.webp .. 604.webp
"""
from __future__ import annotations

import io
import os
import sys
import time

import pymupdf
from PIL import Image

PDF = os.environ.get("TAJWEED_PDF", "/tmp/tajweed.pdf")
FIRST_PDF_PAGE = 10          # صفحة المصحف ١
PAGES = 604
WIDTH = int(os.environ.get("PAGE_WIDTH", "800"))
QUALITY = int(os.environ.get("PAGE_QUALITY", "45"))

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "packaging", "android", "app", "src", "main", "assets", "mushaf")


def render(doc: pymupdf.Document, page_number: int) -> bytes:
    page = doc[FIRST_PDF_PAGE - 1 + page_number - 1]
    images = page.get_images(full=True)
    if images:
        meta = doc.extract_image(images[0][0])
        image = Image.open(io.BytesIO(meta["image"]))
    else:  # احتياطًا: رسم الصفحة
        pix = page.get_pixmap(dpi=200)
        image = Image.open(io.BytesIO(pix.tobytes("png")))
    image = image.convert("RGB")
    height = int(round(image.height * WIDTH / image.width))
    image = image.resize((WIDTH, height), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, "WEBP", quality=QUALITY, method=4)
    return buffer.getvalue()


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    doc = pymupdf.open(PDF)
    if doc.page_count < FIRST_PDF_PAGE + PAGES - 1:
        print("ملف PDF لا يحتوي الصفحات المتوقعة", file=sys.stderr)
        sys.exit(1)
    only = [int(a) for a in sys.argv[1:] if a.isdigit()]
    targets = only or list(range(1, PAGES + 1))
    total = 0
    started = time.time()
    for number in targets:
        path = os.path.join(OUT, f"{number:03d}.webp")
        if os.path.exists(path) and os.path.getsize(path) > 5000:
            total += os.path.getsize(path)
            continue
        data = render(doc, number)
        with open(path, "wb") as handle:
            handle.write(data)
        total += len(data)
        if number % 25 == 0 or number == targets[-1]:
            print(f"page {number}/{PAGES} · {total / 1e6:.1f}MB · {time.time() - started:.0f}s", flush=True)
    print(f"done: {len(os.listdir(OUT))} files · {total / 1e6:.1f}MB", flush=True)


if __name__ == "__main__":
    main()
