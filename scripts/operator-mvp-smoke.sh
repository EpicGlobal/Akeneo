#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${1:-http://127.0.0.1}"
BASE_URL="${BASE_URL%/}"

fetch() {
  local url="$1"
  curl -fsS --max-time 20 "$url"
}

fetch_headers() {
  local url="$1"
  curl -fsSI --max-time 20 "$url"
}

grep_or_fail() {
  local needle="$1"
  local content="$2"
  if ! printf '%s' "$content" | grep -Fq "$needle"; then
    echo "Expected to find '$needle' in response." >&2
    exit 1
  fi
}

echo "Running Operator MVP smoke checks against $BASE_URL"

fetch_headers "$BASE_URL/" >/dev/null
grep_or_fail 'Operator Control Plane' "$(fetch "$BASE_URL/control-plane/")"
grep_or_fail '"status": "ok"' "$(fetch "$BASE_URL/control-plane/health")"
grep_or_fail 'Operator Marketplace Dashboard' "$(fetch "$BASE_URL/market/dashboard")"
grep_or_fail '"status": "ok"' "$(fetch "$BASE_URL/market/health")"
fetch_headers "$BASE_URL/assets/" >/dev/null

echo "Operator MVP smoke checks passed."
