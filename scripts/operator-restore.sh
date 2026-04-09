#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: bash scripts/operator-restore.sh <backup-dir> [--yes]" >&2
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage
fi

BACKUP_DIR="$1"
CONFIRM="${2:-}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Backup directory not found: $BACKUP_DIR" >&2
  exit 1
fi

if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
  echo "Expected .env at $PROJECT_ROOT/.env" >&2
  exit 1
fi

if [[ "$CONFIRM" != "--yes" ]]; then
  echo "Restore is destructive. Re-run with --yes to continue." >&2
  exit 1
fi

set -a
source "$PROJECT_ROOT/.env"
set +a

pushd "$PROJECT_ROOT" >/dev/null

echo "Restoring Akeneo database..."
export MYSQL_PWD="${APP_DATABASE_PASSWORD:-}"
gunzip -c "${BACKUP_DIR}/akeneo.sql.gz" | docker compose exec -T mysql mysql \
  -u"${APP_DATABASE_USER:-akeneo_pim}" \
  "${APP_DATABASE_NAME:-akeneo_pim}"

echo "Restoring ResourceSpace database..."
export MYSQL_PWD="${RESOURCE_SPACE_DB_PASSWORD:-}"
gunzip -c "${BACKUP_DIR}/resourcespace.sql.gz" | docker compose -f docker-compose.yml -f docker-compose.resourcespace.yml exec -T mariadb mysql \
  -u"${RESOURCE_SPACE_DB_USER:-resourcespace_rw}" \
  "${RESOURCE_SPACE_DB_NAME:-resourcespace}"
unset MYSQL_PWD

echo "Restoring ResourceSpace filestore..."
docker compose -f docker-compose.yml -f docker-compose.resourcespace.yml exec -T resourcespace sh -lc \
  'rm -rf /var/www/html/filestore/*'
docker compose -f docker-compose.yml -f docker-compose.resourcespace.yml exec -T resourcespace sh -lc \
  'tar xzf - -C /var/www/html/filestore' < "${BACKUP_DIR}/resourcespace-filestore.tar.gz"

popd >/dev/null

echo "Restore complete."
