#!/usr/bin/env bash
# يجلب أصول التسميع اللازمة للعمل دون اتصال ويضعها داخل أصول تطبيق أندرويد،
# ويتحقق من الحجم والبصمة ثم يكتب manifest.json الذي تقرأه الواجهة للتحقق عند التشغيل.
# التشغيل: bash scripts/fetch-offline-assets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/packaging/android/app/src/main/assets/offline/v1"
ORT_DIR="$ROOT/node_modules/onnxruntime-web/dist"

FULL_SHA="714e98addee73b1b8781ad7d99b6d3c745acd9116638baf4e12891f53a15af1b"
LITE_SHA="4974de78d3c35d2542e7a24d99b747e1160d6e31e366fb68492b74a789890f1b"
REF_SHA="f236384ea91e81ad554ba2777bc4073c3ff41e34120343a8a474571c577b7727"
WASM_SHA="5ab8361783822d02a57d1e97cf2514bceb451a628f2b29ae0d7b6e618201ff8f"

# Quran ASR Small (Abdou/quran-asr-small، MIT) — مثبَّت على التزام محدد لا على main.
QASR_REV="0c2744b9d70aaf45ba574c30c5d318c575258e66"
QASR_MODEL_SHA="88f9df290d57b8890275d79187b77515aeeb12626a42bc76cbd0f8bfcaff00f0"
QASR_TOKENS_SHA="75b53814499cee84a07c7b7a318524d30bcaf84273c0f8b28a04176023e8c74f"
QASR_SPELLING_SHA="7adff00aa1d4b0413a3a89f898117682a22639624b3666121f6de785e0fb346a"
QASR_LICENSE_SHA="3a9d79091d3c680c22dfa9af3dc8dfa12e62f6f9eb94bad36361393453a5583c"
QASR_BASE="https://huggingface.co/Abdou/quran-asr-small/resolve/$QASR_REV"

mkdir -p "$OUT/models/spliced-clean-lite/1-int8" \
  "$OUT/reference" "$OUT/runtime/ort" "$OUT/quran-asr-small"

get() { # url dest expected-sha
  local url="$1" dest="$2" sha="$3"
  if [ -f "$dest" ] && [ "$(sha256sum "$dest" | cut -d' ' -f1)" = "$sha" ]; then
    echo "cached  $dest"
    return 0
  fi
  echo "fetch   $url"
  curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
  local got
  got="$(sha256sum "$dest" | cut -d' ' -f1)"
  if [ "$got" != "$sha" ]; then
    echo "SHA-256 mismatch for $dest: $got != $sha" >&2
    rm -f "$dest"
    exit 1
  fi
}

get "https://tilawa.dev/v1/models/spliced-clean-lite/1-int8/model.onnx" \
  "$OUT/models/spliced-clean-lite/1-int8/model.onnx" "$LITE_SHA"
get "https://tilawa.dev/v1/reference/ref-v2.json" \
  "$OUT/reference/ref-v2.json" "$REF_SHA"

get "$QASR_BASE/model.int8.onnx" "$OUT/quran-asr-small/model.int8.onnx" "$QASR_MODEL_SHA"
get "$QASR_BASE/tokens.txt" "$OUT/quran-asr-small/tokens.txt" "$QASR_TOKENS_SHA"
get "$QASR_BASE/spelling.json" "$OUT/quran-asr-small/spelling.json" "$QASR_SPELLING_SHA"
get "$QASR_BASE/LICENSE" "$OUT/quran-asr-small/LICENSE" "$QASR_LICENSE_SHA"

cp "$ORT_DIR/ort-wasm-simd-threaded.jsep.wasm" "$OUT/runtime/ort/"
cp "$ORT_DIR/ort-wasm-simd-threaded.jsep.mjs" "$OUT/runtime/ort/"
[ "$(sha256sum "$OUT/runtime/ort/ort-wasm-simd-threaded.jsep.wasm" | cut -d' ' -f1)" = "$WASM_SHA" ] \
  || { echo "ORT wasm SHA-256 mismatch" >&2; exit 1; }

# ملف البيان: تقرأه الواجهة وتتحقق منه فعليًا (الحجم + البصمة) قبل إعلان الجاهزية دون اتصال.
python3 - "$OUT" <<'PY'
import hashlib, json, os, sys
out = sys.argv[1]
files = [
    ("models/spliced-clean-lite/1-int8/model.onnx", "lite"),
    ("reference/ref-v2.json", "reference"),
    ("runtime/ort/ort-wasm-simd-threaded.jsep.wasm", "wasm"),
    ("runtime/ort/ort-wasm-simd-threaded.jsep.mjs", "wasm-loader"),
    ("quran-asr-small/model.int8.onnx", "quran-asr-model"),
    ("quran-asr-small/tokens.txt", "quran-asr-tokens"),
    ("quran-asr-small/spelling.json", "quran-asr-spelling"),
    ("quran-asr-small/LICENSE", "quran-asr-license"),
]
assets = []
for rel, label in files:
    path = os.path.join(out, rel)
    with open(path, "rb") as fh:
        data = fh.read()
    assets.append({
        "path": rel,
        "label": label,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    })
manifest = {"schema": 1, "assetBase": "/offline/v1/", "assets": assets}
with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)
print(json.dumps(manifest, ensure_ascii=False, indent=2))
PY
