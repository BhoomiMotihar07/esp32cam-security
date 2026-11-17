#!/bin/bash
# End-to-end smoke check in local mode. Start the API first: npm run dev:api
# Registers an owner (or logs in), claims cam-01, runs the simulator through arm → motion → sound,
# then reads the event feed, downloads a photo and acknowledges the newest event.
set -euo pipefail
API=${API:-http://localhost:7071/api}
SETUP_CODE=${SETUP_CODE:-setup-1234}
cd "$(dirname "$0")/.."

for _ in $(seq 1 30); do curl -sf "$API/push/vapid-public-key" >/dev/null && break; sleep 0.5; done
curl -sf "$API/push/vapid-public-key" >/dev/null || { echo "API not reachable at $API"; exit 1; }

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

echo "== owner account"
TOKEN=$(curl -s -X POST "$API/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"owner@example.com\",\"password\":\"password123\",\"setupCode\":\"$SETUP_CODE\",\"householdName\":\"Flat 4B\"}" | json 'd.get("token","")')
if [ -z "$TOKEN" ]; then
  TOKEN=$(curl -s -X POST "$API/auth/login" -H 'content-type: application/json' -d '{"email":"owner@example.com","password":"password123"}' | json 'd["token"]')
  echo "(existing account, logged in)"
fi

echo "== claim cam-01"
curl -s -X POST "$API/devices" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"deviceId":"cam-01","name":"Hall cam","uploadKey":"dev-upload-key-123"}' | json '"state", d["state"]'

echo "== simulator: arm now, motion, sound"
npm run sim --silent -- --script "arm0,wait:1,motion,wait:1,sound,wait:2,quit" --heartbeat 5 | sed 's/^/   /'

echo "== device"
curl -s "$API/devices/cam-01" -H "authorization: Bearer $TOKEN" | json '{k: d.get(k) for k in ["state","armSource","offline","lastEvent"]}'
echo "== events"
curl -s "$API/devices/cam-01/events?limit=2" -H "authorization: Bearer $TOKEN" | json '[(e["type"], e["photoCount"], e["acknowledged"]) for e in d]'

echo "== photo"
BLOB=$(curl -s "$API/devices/cam-01/events?limit=1" -H "authorization: Bearer $TOKEN" | json 'd[0]["photos"][0]')
URL=$(curl -s "$API/photos/url?blob=$BLOB" -H "authorization: Bearer $TOKEN" | json 'd["url"]')
curl -s -o /tmp/homesec-smoke.jpg -w "GET photo -> %{http_code}, %{size_download} bytes\n" "$URL"

echo "== acknowledge"
EID=$(curl -s "$API/devices/cam-01/events?limit=1" -H "authorization: Bearer $TOKEN" | json 'd[0]["id"]')
curl -s -X POST "$API/devices/cam-01/events/$EID/ack" -H "authorization: Bearer $TOKEN" | json '"acknowledged", d["acknowledged"], "by", d["acknowledgedBy"]'
echo "== SMOKE OK"
