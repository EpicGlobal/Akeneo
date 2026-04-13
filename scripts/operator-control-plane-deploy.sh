#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_ROOT="${OPERATOR_CONTROL_PLANE_DEPLOY_ROOT:-/home/ubuntu/operator-control-plane}"
APP_DIR="${OPERATOR_CONTROL_PLANE_APP_DIR:-$DEPLOY_ROOT/app}"
BUNDLE_URI="${OPERATOR_CONTROL_PLANE_BUNDLE_URI:-}"
HEALTHCHECK_URL="${OPERATOR_CONTROL_PLANE_HEALTHCHECK_URL:-http://127.0.0.1:8095/health}"

wait_for_http_url() {
  local url="$1"
  local label="$2"
  local attempts="${3:-60}"
  local sleep_seconds="${4:-5}"

  for ((attempt=1; attempt<=attempts; attempt++)); do
    if curl -fsS --max-time 15 "$url" > /dev/null; then
      return 0
    fi

    sleep "$sleep_seconds"
  done

  echo "Timed out waiting for ${label} at ${url}" >&2
  return 1
}

mkdir -p "$DEPLOY_ROOT"

if [[ -n "$BUNDLE_URI" ]]; then
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' EXIT

  aws s3 cp "$BUNDLE_URI" "$temp_dir/operator-control-plane.tar.gz"
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR"
  tar -xzf "$temp_dir/operator-control-plane.tar.gz" -C "$APP_DIR"
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "Operator control plane package not found at $APP_DIR" >&2
  exit 1
fi

sg docker -c "cd '$PROJECT_ROOT' && OPERATOR_CONTROL_PLANE_APP_DIR='$APP_DIR' make control-plane-up"
wait_for_http_url "$HEALTHCHECK_URL" "Operator control plane"

echo "Operator control plane deployed from $APP_DIR"
