#!/usr/bin/env bash
set -uo pipefail
python3 - <<'PY' > /tmp/asset-list.tsv
import json, urllib.request
m = json.load(urllib.request.urlopen(urllib.request.Request("https://thimar.freebuff.page/updates/web-manifest.json", headers={"User-Agent":"Mozilla/5.0"})))
for f in m["files"]:
    print(f"{f['path']}\t{f['bytes']}\t{f['sha256']}")
PY
total=0; ok=0; fail=0
while IFS=$'\t' read -r path bytes sha; do
  url="https://thimar.freebuff.page/$path"
  tmp="/tmp/asset.tmp"
  if curl -fsSL -A "Mozilla/5.0" -o "$tmp" "$url"; then
    actual_size=$(stat -c%s "$tmp")
    actual_sha=$(sha256sum "$tmp" | awk '{print $1}')
    if [ "$actual_size" = "$bytes" ] && [ "$actual_sha" = "$sha" ]; then
      ok=$((ok+1))
    else
      fail=$((fail+1))
      echo "MISMATCH $path size=$actual_size/$bytes sha=$actual_sha/$sha"
    fi
    total=$((total+actual_size))
  else
    fail=$((fail+1))
    echo "DOWNLOAD_FAIL $path"
  fi
done < /tmp/asset-list.tsv
echo "SUMMARY ok=$ok fail=$fail total_bytes=$total"