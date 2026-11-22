#!/usr/bin/env bash
# يفحص حزمة APK أو AAB الناتجة فعليًا: كل أصول Quran ASR Small موجودة داخل
# الحزمة، وحجمها وبصمتها تطابق manifest.json والقيَم المثبَّتة.
# الاستخدام: bash scripts/verify-package-assets.sh path/to/app.apk|app.aab
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "الاستخدام: $0 <ملف apk أو aab>" >&2
  exit 2
fi
if [ ! -f "$1" ]; then
  echo "خطأ: الحزمة غير موجودة: $1" >&2
  exit 2
fi

python3 - "$1" <<'PY'
import hashlib, json, sys, zipfile

package = sys.argv[1]
mandatory = {
    "quran-asr-small/model.int8.onnx": (36081762, "88f9df290d57b8890275d79187b77515aeeb12626a42bc76cbd0f8bfcaff00f0"),
    "quran-asr-small/tokens.txt": (180, "75b53814499cee84a07c7b7a318524d30bcaf84273c0f8b28a04176023e8c74f"),
    "quran-asr-small/spelling.json": (69970, "7adff00aa1d4b0413a3a89f898117682a22639624b3666121f6de785e0fb346a"),
    "quran-asr-small/LICENSE": (1062, "3a9d79091d3c680c22dfa9af3dc8dfa12e62f6f9eb94bad36361393453a5583c"),
}
errors = []

with zipfile.ZipFile(package) as archive:
    names = set(archive.namelist())
    prefixes = [p for p in ("assets/offline/v1/", "base/assets/offline/v1/") if any(n.startswith(p) for n in names)]
    if not prefixes:
        print("خطأ: لا توجد أصول /offline/v1 داخل الحزمة: " + package, file=sys.stderr)
        sys.exit(1)
    prefix = prefixes[0]
    manifest_name = prefix + "manifest.json"
    if manifest_name not in names:
        print("خطأ: manifest.json غير موجود داخل الحزمة: " + manifest_name, file=sys.stderr)
        sys.exit(1)
    manifest = json.loads(archive.read(manifest_name).decode("utf-8"))

    def read(rel):
        return archive.read(prefix + rel)

    for rel, (size, sha) in mandatory.items():
        if prefix + rel not in names:
            errors.append("ملف إلزامي غير محزَّم: " + rel)
            continue
        data = read(rel)
        if len(data) != size:
            errors.append(f"حجم غير مطابق داخل الحزمة لـ {rel}: {len(data)} بدل {size}")
            continue
        if hashlib.sha256(data).hexdigest() != sha:
            errors.append("بصمة غير مطابقة داخل الحزمة: " + rel)

    labels = {entry.get("label") for entry in manifest.get("assets", []) if isinstance(entry, dict)}
    for label in ("quran-asr-model", "quran-asr-tokens", "quran-asr-spelling", "quran-asr-license"):
        if label not in labels:
            errors.append("manifest داخل الحزمة لا يسجّل: " + label)

    for entry in manifest.get("assets", []):
        rel = entry.get("path")
        if prefix + rel not in names:
            errors.append("أصل مذكور في البيان غير محزَّم: " + str(rel))
            continue
        data = read(rel)
        if len(data) != entry.get("bytes") or hashlib.sha256(data).hexdigest() != entry.get("sha256"):
            errors.append("أصل داخل الحزمة لا يطابق البيان: " + str(rel))

if errors:
    print("فشل فحص الحزمة " + package + ":", file=sys.stderr)
    for message in errors:
        print(" - " + message, file=sys.stderr)
    sys.exit(1)

print(json.dumps({
    "package": package,
    "prefix": prefix,
    "mandatoryAssets": len(mandatory),
    "manifestAssets": len(manifest.get("assets", [])),
    "modelSha256": mandatory["quran-asr-small/model.int8.onnx"][1],
    "status": "verified",
}, ensure_ascii=False))
PY
