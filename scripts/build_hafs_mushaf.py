#!/usr/bin/env python3
"""يبني بيانات «مصحف حفص نسخة نصية» المحلية داخل التطبيق.

المصدر: واجهة Quranpedia (https://quranpedia.net/mushaf/2) — نسخة حفص النصية
بالخط العثماني (KFGQPC Uthmani)، ٦٠٤ صفحات و٦٢٣٦ آية.

المخرجات:
  public/quran/pages.json      فهرس الصفحات [سورة، آية، الرقم العام، الجزء]
  public/quran/hafs/text.json.gz نص كل آية مضغوطًا (gzip) بمفتاح "سورة:آية"

الاستخدام:
  curl -sSL https://api.quranpedia.net/v1/mushafs/2 -o /tmp/mushaf2.json
  python3 scripts/build_hafs_mushaf.py /tmp/mushaf2.json
"""

import gzip
import json
import os
import sys

SOURCES = {
    "id": 2,
    "name": "مصحف حفص نسخة نصية",
    "url": "https://quranpedia.net/mushaf/2",
    "api": "https://api.quranpedia.net/v1/mushafs/2",
    "total_pages": 604,
}


def main() -> None:
    source = sys.argv[1] if len(sys.argv) > 1 else "/tmp/mushaf2.json"
    with open(source, encoding="utf-8") as handle:
        dump = json.load(handle)

    if dump.get("id") != SOURCES["id"]:
        raise SystemExit(f"unexpected mushaf id: {dump.get('id')}")

    pages: list[list[list[int]]] = [[] for _ in range(SOURCES["total_pages"])]
    texts: dict[str, str] = {}
    # الرقم العام في ترتيب المصحف ١..٦٢٣٦ (لا معرّف المزوّد) لأن ملفات الصوت
    # والعلامات والملاحظات في التطبيق تعتمد عليه.
    global_number = 0

    for surah in sorted(dump["surahs"], key=lambda item: int(item["id"])):
        surah_number = int(surah["id"])
        for ayah in sorted(surah["ayahs"], key=lambda item: int(item["number"])):
            page = int(ayah["page_number"])
            if not 1 <= page <= SOURCES["total_pages"]:
                raise SystemExit(f"page out of range: {page}")
            number = int(ayah["number"])
            global_number += 1
            pages[page - 1].append([surah_number, number, global_number, int(ayah.get("juz") or 1)])
            texts[f"{surah_number}:{number}"] = ayah["text"].strip()

    empty = [index + 1 for index, rows in enumerate(pages) if not rows]
    if empty:
        raise SystemExit(f"empty pages: {empty[:10]}")

    ayah_total = sum(len(rows) for rows in pages)
    if ayah_total != 6236 or global_number != 6236:
        raise SystemExit(f"unexpected ayah total: {ayah_total}/{global_number}")
    for rows in pages:
        for row in rows:
            if not 1 <= row[2] <= 6236:
                raise SystemExit(f"global number out of range: {row}")

    base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "quran")
    hafs_dir = os.path.join(base, "hafs")
    os.makedirs(hafs_dir, exist_ok=True)

    meta = {
        "v": 2,
        "source": SOURCES["url"],
        "api": SOURCES["api"],
        "edition": SOURCES["name"],
        "riwayah": "حفص عن عاصم",
        "pages": pages,
    }
    with open(os.path.join(base, "pages.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, separators=(",", ":"))

    raw = json.dumps(texts, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.GzipFile(os.path.join(hafs_dir, "text.json.gz"), "wb", compresslevel=9, mtime=0) as handle:
        handle.write(raw)

    print(f"pages: {len(pages)} | ayahs: {ayah_total} | text raw: {len(raw)} bytes")
    print(f"written: {os.path.join(base, 'pages.json')}")
    print(f"written: {os.path.join(hafs_dir, 'text.json.gz')}")


if __name__ == "__main__":
    main()
