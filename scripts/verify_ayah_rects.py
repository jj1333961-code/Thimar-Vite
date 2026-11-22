"""يتحقق من خريطة حدود الآيات: التغطية داخل كل سطر، وعدم تداخل آيتين، وحدود الصورة."""
import json, os
import numpy as np
from PIL import Image

CACHE = "/tmp/mushaf_pages"
BOX = "public/quran/ayah-rects"
pages = json.load(open("public/quran/pages.json"))["pages"]

def boxes_for(page):
    start = ((page - 1) // 50) * 50 + 1
    end = min(604, start + 49)
    data = json.load(open(f"{BOX}/{start}-{end}.json"))
    return data.get(str(page), []), data

problems = []
overlaps_bad = 0
cover_bad = 0
page_ids = 0
for page in range(1, 605):
    rects, _ = boxes_for(page)
    page_ids += len(rects)
    # تجميع المستطيلات بحسب السطر (y المتوسط)
    lines = {}
    for surah, ayah, rs in rects:
        for r in rs:
            key = round((r[1] + r[3]) / 2 / 12)
            lines.setdefault(key, []).append((surah, ayah, r))
    img = np.array(Image.open(f"{CACHE}/{page}.jpg").convert("L"), dtype=np.uint8)
    H, W = img.shape
    ink = img < 178
    for key, items in lines.items():
        y0 = max(0, min(i[2][1] for i in items) * H // 1000 - 2)
        y1 = min(H, max(i[2][3] for i in items) * H // 1000 + 2)
        band = ink[y0:y1]
        cols = np.where(band.any(axis=0))[0]
        if cols.size:
            ink_l, ink_r = int(cols.min()), int(cols.max())
            span = max(1, ink_r - ink_l)
            union = np.zeros(W, dtype=bool)
            for _, _, r in items:
                lo = max(0, r[0] * W // 1000); hi = min(W, r[2] * W // 1000)
                union[lo:hi] = True
            covered = union[ink_l:ink_r + 1].sum() / span
            if covered < 0.80:
                cover_bad += 1
                if len(problems) < 12:
                    problems.append((page, key, round(float(covered), 2), "coverage"))
        # تداخل بين آيتين مختلفتين
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a, b = items[i], items[j]
                if a[0] == b[0] and a[1] == b[1]:
                    continue
                lo = max(a[2][0], b[2][0]); hi = min(a[2][2], b[2][2])
                if hi - lo > 12:
                    overlaps_bad += 1
                    if len(problems) < 20:
                        problems.append((page, key, hi - lo, "overlap"))
    for _, _, rs in rects:
        for r in rs:
            if r[0] < 0 or r[1] < 0 or r[2] > 1000 or r[3] > 1000:
                problems.append((page, -1, r, "out-of-bounds"))

print("pages:", 604, "ayahs:", page_ids)
print("line bands with coverage < 80%:", cover_bad)
print("cross-ayah overlaps (>12 per-mille):", overlaps_bad)
for p in problems[:15]:
    print("problem:", p)
