#!/usr/bin/env python3
"""يبني ملف المصحف الملوّن من موقع الموسوعة القرآنية (quranpedia.net) فقط.

المصدر: صفحات التجويد لكل سورة  https://quranpedia.net/surah/1/<n>/tajweed
الناتج: public/quran/tajweed.json بنفس صيغة الترميز المستخدمة في التطبيق:
        \\u0001<rule>\\u0002<text>\\u0003   حيث <rule> اسم حكم التجويد.
لا يُعدَّل نص القرآن ولا ترتيبه؛ فقط تُرمَّز وسوم <tajweed class> إلى هذا الترميز.
"""
from __future__ import annotations

import gzip
import html
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://quranpedia.net/surah/1/{surah}/tajweed"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "quran", "tajweed.json")
UA = "Mozilla/5.0 (Linux; Android 12) ThimarApp/1.0"

AYAH_RE = re.compile(
    r'<a class="ayah"\s+ayah="(\d+)"\s+surah="(\d+)"\s+number="(\d+)"[^>]*>(.*?)</a>',
    re.S,
)
TAJWEED_RE = re.compile(r'<tajweed class="([^"]+)"[^>]*>(.*?)</tajweed>', re.S)
MARK_RE = re.compile(r'<span class="ayah-mark".*?</span></span>', re.S)
TAG_RE = re.compile(r"<[^>]+>")

CLASS_MAP = {
    "ham_wasl": "ham_wasl",
    "slnt": "laam_shamsiyah",
    "laam_shamsiyah": "laam_shamsiyah",
    "madda_normal": "madda_normal",
    "madda_permissible": "madda_permissible",
    "madda_obligatory": "madda_obligatory",
    "madda_necessary": "madda_necessary",
    "qalaqah": "qalaqah",
    "qalqalah": "qalaqah",
    "ghunnah": "ghunnah",
    "ikhafa": "ikhafa",
    "ikhfa": "ikhafa",
    "ikhafa_shafawi": "ikhfa_shafawi",
    "idgham_ghunnah": "idgham_ghunnah",
    "idgham_wo_ghunnah": "idgham_wo_ghunnah",
    "idgham_shafawi": "idgham_shafawi",
    "iqlab": "iqlab",
    "idgham_mutajanisayn": "idgham_mutajanisayn",
    "idgham_mutaqaribayn": "idgham_mutaqaribayn",
    # أسماء مختصرة مستخدمة في صفحات الموسوعة
    "qlq": "qalaqah",
    "ghn": "ghunnah",
    "ikhf": "ikhafa",
    "ikhf_shfw": "ikhfa_shafawi",
    "idgh_ghn": "idgham_ghunnah",
    "idgh_w_ghn": "idgham_wo_ghunnah",
    "idghm_shfw": "idgham_shafawi",
    "iqlb": "iqlab",
}


def fetch(surah: int) -> str:
    req = urllib.request.Request(BASE.format(surah=surah), headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                return resp.read().decode("utf-8")
        except Exception as err:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  retry {surah}: {err}", file=sys.stderr)
            time.sleep(1.5 * (attempt + 1))
    return ""


def encode(inner: str) -> str:
    inner = MARK_RE.sub("", inner)
    out: list[str] = []
    pos = 0
    for match in TAJWEED_RE.finditer(inner):
        out.append(html.unescape(TAG_RE.sub("", inner[pos:match.start()])))
        cls = match.group(1).strip()
        rule = CLASS_MAP.get(cls, cls.replace("-", "_"))
        out.append("\x01" + rule + "\x02" + html.unescape(TAG_RE.sub("", match.group(2))) + "\x03")
        pos = match.end()
    out.append(html.unescape(TAG_RE.sub("", inner[pos:])))
    text = "".join(out)
    # تطبيع المسافات مع الحفاظ على رموز الأحكام (لا تحتوي مسافات).
    text = re.sub(r"[ \t\r\n\u200b\u200c\u200d]+", " ", text)
    return text.strip()


def main() -> None:
    surahs: dict[int, dict[int, str]] = {}
    classes: dict[str, int] = {}

    def work(n: int) -> tuple[int, str]:
        return n, fetch(n)

    with ThreadPoolExecutor(max_workers=6) as pool:
        for n, page in pool.map(work, range(1, 115)):
            found = 0
            for m in AYAH_RE.finditer(page):
                ayah = int(m.group(1))
                surahs.setdefault(n, {})[ayah] = encode(m.group(4))
                found += 1
                for cls in re.findall(r'<tajweed class="([^"]+)"', m.group(4)):
                    classes[cls] = classes.get(cls, 0) + 1
            print(f"surah {n}: {found} ayat", flush=True)

    if os.path.exists(OUT):
        old = json.load(open(OUT, encoding="utf-8"))
    else:
        old = {"chapters": []}
    chapters = old.get("chapters") or []
    by_number = {c["surah_number"]: c for c in chapters}

    verses: dict[str, str] = {}
    for n in range(1, 115):
        ayat = surahs.get(n, {})
        for ayah in sorted(ayat):
            verses[f"{n}:{ayah}"] = ayat[ayah]

    print("classes:", json.dumps(classes, ensure_ascii=False))
    print("ayat:", len(verses))
    payload = {"chapters": chapters, "verses": verses}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    raw = os.path.getsize(OUT)
    gz = len(gzip.compress(open(OUT, "rb").read(), 9))
    print(f"wrote {OUT} raw={raw/1e6:.2f}MB gz={gz/1e6:.2f}MB chapters={len(chapters)}")
    if not by_number:
        print("warning: no chapters available", file=sys.stderr)


if __name__ == "__main__":
    main()
