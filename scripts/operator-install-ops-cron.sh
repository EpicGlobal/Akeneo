#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_USER="${BOOTSTRAP_USER:-${SUDO_USER:-${USER:-}}}"
LOG_DIR="${OPERATOR_LOG_DIR:-/var/log/operator}"
BACKUP_ROOT="${OPERATOR_BACKUP_ROOT:-/home/${RUNTIME_USER}/backups}"
AWS_DEFAULT_REGION_VALUE="${AWS_REGION:-us-west-2}"

if [[ -z "$RUNTIME_USER" ]]; then
  if id -u ubuntu >/dev/null 2>&1; then
    RUNTIME_USER="ubuntu"
  else
    RUNTIME_USER="$(id -un)"
  fi
fi

sudo install -d -m 0755 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$LOG_DIR"
sudo install -d -m 0755 -o "$RUNTIME_USER" -g "$RUNTIME_USER" "$BACKUP_ROOT"

cron_file="/etc/cron.d/operator"
logrotate_file="/etc/logrotate.d/operator"

sudo tee "$cron_file" > /dev/null <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION_VALUE}

*/5 * * * * ${RUNTIME_USER} cd '${PROJECT_ROOT}' && bash scripts/operator-monitor.sh >> '${LOG_DIR}/monitor.log' 2>&1
15 2 * * * ${RUNTIME_USER} cd '${PROJECT_ROOT}' && bash scripts/operator-backup.sh '${BACKUP_ROOT}' >> '${LOG_DIR}/backup.log' 2>&1
EOF

sudo chmod 0644 "$cron_file"

sudo tee "$logrotate_file" > /dev/null <<EOF
${LOG_DIR}/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF

echo "Installed Operator cron schedule at ${cron_file}"
