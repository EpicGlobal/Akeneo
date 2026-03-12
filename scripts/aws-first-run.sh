#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: bash scripts/aws-first-run.sh <public-ip-or-url>" >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
fi

TARGET="$1"
if [[ "$TARGET" =~ ^https?:// ]]; then
  PIM_URL="$TARGET"
else
  PIM_URL="http://$TARGET"
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"
APP_SECRET_VALUE="${APP_SECRET_VALUE:-$(openssl rand -hex 32)}"

set_env_value() {
  local key="$1"
  local value="$2"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

mkdir -p "$HOME/.cache/yarn" "$HOME/.cache/Cypress"
sudo chown -R "$USER:$USER" "$HOME/.cache"

sed -i 's/\r$//' "$PROJECT_ROOT/docker/wait_docker_up.sh"
chmod +x "$PROJECT_ROOT/docker/wait_docker_up.sh"

set_env_value "AKENEO_PIM_URL" "$PIM_URL"
set_env_value "APP_SECRET" "$APP_SECRET_VALUE"
set_env_value "DOCKER_PORT_HTTP" "80"

echo "Using AKENEO_PIM_URL=$PIM_URL"
echo "Using DOCKER_PORT_HTTP=80"

sg docker -c "cd '$PROJECT_ROOT' && docker compose down -v --remove-orphans || true"
sg docker -c "cd '$PROJECT_ROOT' && make prod"
