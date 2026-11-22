#!/usr/bin/env bash
set -euo pipefail

METADATA_URL="${METADATA_URL:-https://thimar.freebuff.page/updates/android.json}"
FUNCTION_URL="${SUPABASE_FUNCTION_URL:-https://jbsvmpiwdwowizzfzlqr.supabase.co/functions/v1/send-update-notification}"

if [[ -z "${THIMAR_PUSH_SECRET:-}" ]]; then
  echo "THIMAR_PUSH_SECRET is required" >&2
  exit 1
fi

echo "Validating release metadata at ${METADATA_URL}..."
curl -fsS "${METADATA_URL}" >/tmp/thimar-android.json

python3 - <<'PY'
import json,sys
data=json.load(open('/tmp/thimar-android.json'))
required=['available','versionName','versionCode','downloadUrl','fileSize','sha256']
missing=[k for k in required if k not in data or data.get(k) in (None,'')]
if missing or data.get('available') is not True:
    print('Invalid or unpublished release metadata:', missing, file=sys.stderr)
    sys.exit(1)
print('Release metadata valid:', data['versionName'], data['versionCode'])
PY

# قبول المزوّد (FCM) يُسجَّل كما هو؛ وهو ليس دليلًا على وصول الإشعار إلى الأجهزة.
RESPONSE_FILE=/tmp/thimar-notify-response.json
HTTP_CODE=$(curl -sS -o "$RESPONSE_FILE" -w "%{http_code}" -X POST "${FUNCTION_URL}" \
  -H "Authorization: Bearer ${THIMAR_PUSH_SECRET}" \
  -H "Content-Type: application/json" \
  -d "{\"metadataUrl\":\"${METADATA_URL}\"}" || echo "000")

RESPONSE="$(cat "$RESPONSE_FILE" 2>/dev/null || true)"
echo "Notification response: HTTP ${HTTP_CODE} ${RESPONSE}"

if [[ "${HTTP_CODE}" != "200" && "${HTTP_CODE}" != "202" ]]; then
  echo "Notification function rejected the request (HTTP ${HTTP_CODE})." >&2
  exit 1
fi

# Do not treat HTTP 200 alone as success: inspect the reported campaign counts.
python3 - "$RESPONSE" <<'PY'
import json, sys
raw = sys.argv[1] if len(sys.argv) > 1 else ""
try:
    data = json.loads(raw)
except Exception:
    print("Unparseable notification response:", raw, file=sys.stderr)
    sys.exit(1)
if data.get("note") in ("ALREADY_NOTIFIED", "CAMPAIGN_IN_PROGRESS", "NO_TOKENS"):
    print("Notification campaign status:", data.get("note"))
    sys.exit(0)
failed = int(data.get("failed", 0) or 0)
status = data.get("status")
if failed > 0 or status in ("failed", "partial"):
    print("Notification campaign had failures:", json.dumps(data), file=sys.stderr)
    sys.exit(1)
print("Notification campaign accepted:", json.dumps(data))
PY

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Android update notification"
    echo ""
    echo "- Provider acceptance HTTP: ${HTTP_CODE}"
    echo "- Response: \`${RESPONSE}\""
    echo "- Device delivery evidence: not available from this workflow (FCM acceptance only)."
  } >> "$GITHUB_STEP_SUMMARY"
fi
