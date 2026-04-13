#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${1:-$HOME/backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT%/}/operator-${TIMESTAMP}"
STARTED_AT="$(date --iso-8601=seconds)"

if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
  echo "Expected .env at $PROJECT_ROOT/.env" >&2
  exit 1
fi

set -a
source "$PROJECT_ROOT/.env"
set +a

mkdir -p "$BACKUP_DIR"

echo "Creating Operator backup in $BACKUP_DIR"

pushd "$PROJECT_ROOT" >/dev/null

export MYSQL_PWD="${APP_DATABASE_PASSWORD:-}"
docker compose exec -T mysql mysqldump \
  --single-transaction \
  --quick \
  -u"${APP_DATABASE_USER:-akeneo_pim}" \
  "${APP_DATABASE_NAME:-akeneo_pim}" | gzip > "${BACKUP_DIR}/akeneo.sql.gz"

export MYSQL_PWD="${RESOURCE_SPACE_DB_PASSWORD:-}"
docker compose -f docker-compose.yml -f docker-compose.resourcespace.yml exec -T mariadb mysqldump \
  --single-transaction \
  --quick \
  -u"${RESOURCE_SPACE_DB_USER:-resourcespace_rw}" \
  "${RESOURCE_SPACE_DB_NAME:-resourcespace}" | gzip > "${BACKUP_DIR}/resourcespace.sql.gz"
unset MYSQL_PWD

docker compose -f docker-compose.yml -f docker-compose.resourcespace.yml exec -T resourcespace sh -lc \
  'tar czf - -C /var/www/html/filestore .' > "${BACKUP_DIR}/resourcespace-filestore.tar.gz"

cat > "${BACKUP_DIR}/manifest.json" <<JSON
{
  "created_at": "${STARTED_AT}",
  "backup_dir": "${BACKUP_DIR}",
  "artifacts": [
    "akeneo.sql.gz",
    "resourcespace.sql.gz",
    "resourcespace-filestore.tar.gz"
  ]
}
JSON

if [[ -n "${OPERATOR_BACKUP_S3_URI:-}" ]]; then
  aws s3 cp "${BACKUP_DIR}/akeneo.sql.gz" "${OPERATOR_BACKUP_S3_URI%/}/${TIMESTAMP}/akeneo.sql.gz"
  aws s3 cp "${BACKUP_DIR}/resourcespace.sql.gz" "${OPERATOR_BACKUP_S3_URI%/}/${TIMESTAMP}/resourcespace.sql.gz"
  aws s3 cp "${BACKUP_DIR}/resourcespace-filestore.tar.gz" "${OPERATOR_BACKUP_S3_URI%/}/${TIMESTAMP}/resourcespace-filestore.tar.gz"
  aws s3 cp "${BACKUP_DIR}/manifest.json" "${OPERATOR_BACKUP_S3_URI%/}/${TIMESTAMP}/manifest.json"
fi

if [[ -n "${OPERATOR_CONTROL_PLANE_OPS_BASE_URL:-}" ]] && command -v curl >/dev/null 2>&1; then
  BACKUP_LOCATION="${BACKUP_DIR}"
  if [[ -n "${OPERATOR_BACKUP_S3_URI:-}" ]]; then
    BACKUP_LOCATION="${OPERATOR_BACKUP_S3_URI%/}/${TIMESTAMP}"
  fi

  curl -fsS -X POST "${OPERATOR_CONTROL_PLANE_OPS_BASE_URL%/}/api/ops/backups" \
    -H 'Content-Type: application/json' \
    --data-binary @- >/dev/null || true <<JSON
{
  "environment": "${OPERATOR_CONTROL_PLANE_ENVIRONMENT:-unknown}",
  "tenantCode": "${OPERATOR_CONTROL_PLANE_OPS_TENANT:-}",
  "scope": "full_stack",
  "status": "success",
  "location": "${BACKUP_LOCATION}",
  "startedAt": "${STARTED_AT}",
  "completedAt": "$(date --iso-8601=seconds)",
  "notes": "Operator backup completed from ${PROJECT_ROOT}"
}
JSON
fi

popd >/dev/null

echo "Backup complete."
