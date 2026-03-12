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

cat <<'EOF' | sudo tee /etc/sysctl.d/99-akeneo-elasticsearch.conf > /dev/null
vm.max_map_count=1048576
EOF
sudo sysctl --system > /dev/null

set_env_value "AKENEO_PIM_URL" "$PIM_URL"
set_env_value "APP_SECRET" "$APP_SECRET_VALUE"
set_env_value "DOCKER_PORT_HTTP" "80"
set_env_value "ES_JAVA_OPTS" "-Xms1g -Xmx1g -XX:-UseContainerSupport -Dlog4j2.disable.jmx=true"

echo "Using AKENEO_PIM_URL=$PIM_URL"
echo "Using DOCKER_PORT_HTTP=80"
echo "Using ES_JAVA_OPTS=-Xms1g -Xmx1g -XX:-UseContainerSupport -Dlog4j2.disable.jmx=true"
echo "Configured vm.max_map_count=$(sysctl -n vm.max_map_count)"

sg docker -c "cd '$PROJECT_ROOT' && docker compose down -v --remove-orphans || true"
if ! sg docker -c "cd '$PROJECT_ROOT' && make prod"; then
  sg docker -c "cd '$PROJECT_ROOT' && docker compose ps -a"
  sg docker -c "cd '$PROJECT_ROOT' && docker compose logs --tail=120 elasticsearch"
  exit 1
fi
