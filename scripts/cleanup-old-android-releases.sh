#!/usr/bin/env bash
set -euo pipefail

METADATA_URL="${METADATA_URL:-https://thimar.freebuff.page/updates/android.json}"
BASE_URL="${BASE_URL:-https://thimar.freebuff.page}"
TOKEN="${DEPLOY_TOKEN:-${THIMAR_DEPLOY_TOKEN:-}}"

if [[ -z "$TOKEN" ]]; then
  echo "DEPLOY_TOKEN / THIMAR_DEPLOY_TOKEN is required" >&2
  exit 1
fi

# Determine the active release filename from live metadata.
CURRENT_FILE="$(curl -fsS "$METADATA_URL" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("fileName",""))')"
if [[ -z "$CURRENT_FILE" ]]; then
  echo "Current release fileName is missing in metadata" >&2
  exit 1
fi

echo "Current production APK retained: $CURRENT_FILE"

# Candidate obsolete APKs come from the workflow input or a known list.
PREVIOUS_APK="${PREVIOUS_APK:-}"
if [[ -n "$PREVIOUS_APK" && "$PREVIOUS_APK" != "$CURRENT_FILE" ]]; then
  echo "Deleting previous APK from R2: $PREVIOUS_APK"
  curl -fsS -X POST "$BASE_URL/api/admin/delete-large?name=$PREVIOUS_APK" \
    -H "X-Deploy-Token: $TOKEN" \
    -H "X-Confirm-Delete: $PREVIOUS_APK" \
    -w "\nHTTP %{http_code}\n"
  # Verify deletion
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/assets/large/$PREVIOUS_APK")
  if [[ "$code" != "404" ]]; then
    echo "WARNING: previous APK still reachable (HTTP $code)" >&2
    exit 1
  fi
  echo "Previous APK deleted and verified absent (HTTP 404)."
else
  echo "No previous APK specified for deletion."
fi

echo "Cleanup complete. Active APK remains: $CURRENT_FILE"