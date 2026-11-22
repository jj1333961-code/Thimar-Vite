#!/usr/bin/env bash
# ينسخ بناء الواجهة + تراخيص الطرف الثالث إلى أصول تطبيق أندرويد حتى تعمل الواجهة
# عند أول تشغيل دون إنترنت. الملفات المضمَّنة لا تُرفع إلى Git (انظر .gitignore).
#
# الحزمة تُبنى دائمًا من dist/ كاملًا: لا نُبقي أي ملف من بناء سابق، ولا نثق
# بأصول Gradle المدمجة (mergeReleaseAssets تزايدي ولا يحذف ما اختفى من المصدر —
# هذا بالضبط ما جعل APK 1.11.0 يحمل quran/hafs/text.json القديم بدل text.json.gz).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/packaging/android/app/src/main/assets"
WWW="$ASSETS/www"
BUILD_DIR="$ROOT/packaging/android/app/build"

fail() { echo "$*" >&2; exit 1; }

[ -f "$ROOT/dist/index.html" ] || fail "dist/ غير موجود — شغّل npm run build أولًا."
[ -f "$ASSETS/offline/v1/manifest.json" ] || fail "أصول التسميع غير موجودة — شغّل scripts/fetch-offline-assets.sh."
# نموذج Quran ASR Small إلزامي: وجوده لا يكفي — الحجم والبصمة والبيان تُتحقق قبل أي نسخ.
bash "$ROOT/scripts/verify-quran-asr-assets.sh" "$ASSETS/offline/v1"

# ملفات يجب أن يكون بناء الواجهة قد أنتجها فعلًا قبل أي نسخ.
required=(
  "dist/sw.js"
  "dist/manifest.webmanifest"
  "dist/quran/pages.json"
  "dist/quran/hafs/text.json.gz"
  "dist/quran/tajweed.json"
)
for rel in "${required[@]}"; do
  [ -f "$ROOT/$rel" ] || fail "بناء الواجهة ناقص: $rel"
done

# خطوط المصحف (نسخة المدينة): ٦٠٤ صفحات موزّعة على ٦١ ملفًا.
line_chunks=$(find "$ROOT/dist/quran/lines" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l)
[ "$line_chunks" -ge 61 ] || fail "ملفات أسطر المصحف ناقصة في dist/quran/lines (وُجد $line_chunks بدل ٦١)."

rm -rf "$WWW"
cp -r "$ROOT/dist" "$WWW"
mkdir -p "$WWW/licenses"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$WWW/licenses/THIRD_PARTY_NOTICES.md" 2>/dev/null || true
cp "$ASSETS/offline/v1/quran-asr-small/LICENSE" "$WWW/licenses/quran-asr-small-LICENSE.txt" 2>/dev/null || true
# النسخة المضمَّنة تستخدم runtime/ort داخل offline/v1، فلا نكرّر 29 م.ب في الحزمة.
rm -f "$WWW"/assets/ort-wasm-*.wasm

# aapt2 يفكّ ضغط أي أصل ينتهي بـ.gz ويُخزّنه باسمه بلا .gz (سلوك قياسي في أندرويد)،
# أي أن text.json.gz يُحزَّم باسم text.json ويصبح طلب .gz داخل التطبيق بلا ملف.
# نفكّ الضغط هنا صراحةً حتى يكون الاسم داخل الحزمة مطابقًا لما تطلبه الواجهة.
if [ -f "$WWW/quran/hafs/text.json.gz" ]; then
  python3 - "$WWW/quran/hafs/text.json.gz" "$WWW/quran/hafs/text.json" <<'PY'
import gzip, shutil, sys
with gzip.open(sys.argv[1], "rb") as src, open(sys.argv[2], "wb") as dst:
    shutil.copyfileobj(src, dst)
PY
  rm -f "$WWW/quran/hafs/text.json.gz"
  echo "quran/hafs: فُكّ الضغط إلى text.json ($(stat -c%s "$WWW/quran/hafs/text.json") بايت)"
fi
# إن وُجد ملف PDF القرآني الأصلي في public/quran فسيُضمَّن كما هو بلا أي تعديل.
for pdf in quran.pdf mushaf.pdf; do
  if [ -f "$ROOT/public/quran/$pdf" ]; then
    mkdir -p "$WWW/quran"
    cp "$ROOT/public/quran/$pdf" "$WWW/quran/$pdf"
    echo "PDF مضاف: $pdf ($(stat -c%s "$ROOT/public/quran/$pdf") بايت)"
  fi
done

# أصول Gradle المدمجة تُحذف قبل البناء: بدون ذلك يعيد mergeReleaseAssets استخدام
# نسخة قديمة ويخرج APK لا يطابق dist/.
rm -rf "$BUILD_DIR/intermediates/assets" \
       "$BUILD_DIR/intermediates/compressed_assets" \
       "$BUILD_DIR/intermediates/merged_assets" \
       "$BUILD_DIR/intermediates/packaged_assets"

# هوية البناء داخل الحزمة: يتحقق منها حاجز الإصدار في CI ويطابقها مع SHA الالتزام.
COMMIT="${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
python3 - "$WWW/build.json" "$COMMIT" <<'PY'
import json, os, sys, time

out, commit = sys.argv[1], sys.argv[2]
index = open(os.path.join(os.path.dirname(out), "index.html"), encoding="utf-8").read()
import re
assets = sorted(set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', index)))
data = {
    "schema": 1,
    "commit": commit,
    "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "source": "github-actions" if os.environ.get("GITHUB_ACTIONS") == "true" else "local",
    "webDir": "dist",
    "indexAssets": assets,
    "quranLineChunks": len(os.listdir(os.path.join(os.path.dirname(out), "quran", "lines"))),
}
with open(out, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
print(json.dumps(data, ensure_ascii=False, indent=2))
PY

echo "== محتويات الحزمة =="
du -sh "$WWW" "$ASSETS/offline"
find "$WWW" -maxdepth 1 -type f -printf '%f %s\n' | sort
