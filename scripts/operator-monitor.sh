#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
  echo "Expected .env at $PROJECT_ROOT/.env" >&2
  exit 1
fi

set -a
source "$PROJECT_ROOT/.env"
set +a

CONTROL_PLANE_BASE_URL="${OPERATOR_CONTROL_PLANE_OPS_BASE_URL:-}"
ENVIRONMENT_NAME="${OPERATOR_CONTROL_PLANE_ENVIRONMENT:-unknown}"
TENANT_CODE="${OPERATOR_CONTROL_PLANE_OPS_TENANT:-}"
MARKETPLACE_PUBLIC_URL="${OPERATOR_MONITOR_MARKETPLACE_URL:-${MARKETPLACE_ORCHESTRATOR_PUBLIC_BASE_URL:-${MARKETPLACE_ORCHESTRATOR_BASE_URI:-}}}"

probe() {
  local service="$1"
  local url="$2"
  local output
  local http_code
  local total_seconds
  local response_ms
  local ok="false"
  local details

  output="$(curl -sS -o /dev/null -w "%{http_code} %{time_total}" "$url" 2>/dev/null || echo "000 0")"
  http_code="$(echo "$output" | awk '{print $1}')"
  total_seconds="$(echo "$output" | awk '{print $2}')"
  response_ms="$(awk "BEGIN { printf \"%d\", ($total_seconds * 1000) }")"
  details="HTTP ${http_code} in ${response_ms}ms"

  if [[ "$http_code" =~ ^(200|302|401)$ ]]; then
    ok="true"
  fi

  echo "${service}|${url}|${http_code}|${response_ms}|${ok}|${details}"
}

SERVICES=()
SERVICES+=("catalog|${AKENEO_PIM_URL%/}/user/login")
SERVICES+=("assets|${RESOURCE_SPACE_BASE_URI%/}/login.php?url=%2F&no_redirect=true")

if [[ -n "$MARKETPLACE_PUBLIC_URL" ]]; then
  SERVICES+=("market|${MARKETPLACE_PUBLIC_URL%/}/health")
fi

if [[ -n "$CONTROL_PLANE_BASE_URL" ]]; then
  SERVICES+=("control_plane|${CONTROL_PLANE_BASE_URL%/}/health")
fi

if [[ -n "${OPERATOR_MONITOR_EPIC_AI_URL:-}" ]]; then
  SERVICES+=("ai|${OPERATOR_MONITOR_EPIC_AI_URL%/}/health")
fi

for service in "${SERVICES[@]}"; do
  IFS='|' read -r service_name service_url http_code response_ms ok details <<<"$(probe "${service%%|*}" "${service#*|}")"
  echo "${service_name}: ${details}"

  if [[ -n "$CONTROL_PLANE_BASE_URL" ]]; then
    curl -fsS -X POST "${CONTROL_PLANE_BASE_URL%/}/api/ops/monitor-snapshots" \
      -H 'Content-Type: application/json' \
      --data-binary @- >/dev/null || true <<JSON
{
  "environment": "${ENVIRONMENT_NAME}",
  "tenantCode": "${TENANT_CODE}",
  "service": "${service_name}",
  "url": "${service_url}",
  "statusCode": ${http_code},
  "responseTimeMs": ${response_ms},
  "ok": ${ok},
  "details": "${details}"
}
JSON
  fi
done
