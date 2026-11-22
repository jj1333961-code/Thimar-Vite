#!/usr/bin/env bash
# يتحقق من أن نموذج Quran ASR Small كامل داخل أصول التطبيق قبل أي بناء:
# الحجم والبصمة لكل ملف إلزامي، ثم مطابقة manifest.json للملفات الفعلية.
# أي نقص أو اختلاف = خروج بخطأ يوقف البناء (debug وrelease وAAB).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="${1:-$ROOT/packaging/android/app/src/main/assets/offline/v1}"

python3 - "$ASSETS" <<'PY'
import hashlib, json, os, sys

assets = sys.argv[1]
mandatory = {
    "quran-asr-small/model.int8.onnx": (36081762, "88f9df290d57b8890275d79187b77515aeeb12626a42bc76cbd0f8bfcaff00f0"),
    "quran-asr-small/tokens.txt": (180, "75b53814499cee84a07c7b7a318524d30bcaf84273c0f8b28a04176023e8c74f"),
    "quran-asr-small/spelling.json": (69970, "7adff00aa1d4b0413a3a89f898117682a22639624b3666121f6de785e0fb346a"),
    "quran-asr-small/LICENSE": (1062, "3a9d79091d3c680c22dfa9af3dc8dfa12e62f6f9eb94bad36361393453a5583c"),
}
labels = {
    "quran-asr-model": "quran-asr-small/model.int8.onnx",
    "quran-asr-tokens": "quran-asr-small/tokens.txt",
    "quran-asr-spelling": "quran-asr-small/spelling.json",
    "quran-asr-license": "quran-asr-small/LICENSE",
}
errors = []

def fail(message):
    errors.append(message)

manifest_path = os.path.join(assets, "manifest.json")
if not os.path.isfile(manifest_path):
    print("خطأ: manifest.json غير موجود في الحزمة المضمَّنة: " + manifest_path, file=sys.stderr)
    sys.exit(1)

for rel, (size, sha) in mandatory.items():
    path = os.path.join(assets, rel)
    if not os.path.isfile(path):
        fail("ملف إلزامي مفقود: " + rel)
        continue
    data = open(path, "rb").read()
    if len(data) != size:
        fail(f"حجم غير مطابق لـ {rel}: {len(data)} بدل {size}")
        continue
    digest = hashlib.sha256(data).hexdigest()
    if digest != sha:
        fail(f"بصمة غير مطابقة لـ {rel}: {digest} بدل {sha}")

try:
    manifest = json.load(open(manifest_path, encoding="utf-8"))
except Exception as exc:
    print("خطأ: manifest.json غير قابل للقراءة: " + str(exc), file=sys.stderr)
    sys.exit(1)

if manifest.get("schema") != 1:
    fail("schema غير مدعوم في manifest.json")
if manifest.get("assetBase") != "/offline/v1/":
    fail("assetBase غير متوقع: " + str(manifest.get("assetBase")))

entries = {entry.get("label"): entry for entry in manifest.get("assets", []) if isinstance(entry, dict)}
for label, rel in labels.items():
    entry = entries.get(label)
    if entry is None:
        fail("manifest.json لا يسجّل الأصل الإلزامي: " + label)
    elif entry.get("path") != rel:
        fail(f"مسار غير مطابق في manifest لـ {label}: {entry.get('path')} بدل {rel}")

# كل أصل مذكور في البيان يجب أن يكون موجودًا ومطابقًا (لا يكفي وجود النموذج).
for entry in manifest.get("assets", []):
    rel = entry.get("path")
    if not isinstance(rel, str) or not rel:
        fail("مدخل بلا مسار في manifest.json")
        continue
    path = os.path.join(assets, rel)
    if not os.path.isfile(path):
        fail("أصل مذكور في البيان مفقود: " + rel)
        continue
    data = open(path, "rb").read()
    if len(data) != entry.get("bytes"):
        fail(f"حجم الأصل {rel} لا يطابق البيان: {len(data)} بدل {entry.get('bytes')}")
        continue
    if hashlib.sha256(data).hexdigest() != entry.get("sha256"):
        fail("بصمة الأصل لا تطابق البيان: " + rel)

if errors:
    print("فشل التحقق من أصول Quran ASR Small الإلزامية:", file=sys.stderr)
    for message in errors:
        print(" - " + message, file=sys.stderr)
    print("شغّل scripts/fetch-offline-assets.sh ثم أعد البناء.", file=sys.stderr)
    sys.exit(1)

print(json.dumps({
    "quranAsrAssets": "verified",
    "root": assets,
    "mandatory": len(mandatory),
    "manifestAssets": len(manifest.get("assets", [])),
}, ensure_ascii=False))
PY
