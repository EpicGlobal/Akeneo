#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: bash scripts/aws-epic-deploy.sh <public-ip-or-url>" >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
fi

TARGET="$1"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"
AWS_REGION="${AWS_REGION:-us-west-2}"
DEPLOY_PARAMETER_PREFIX="${DEPLOY_PARAMETER_PREFIX:-}"
RESOURCE_SPACE_TENANT_CODE="${RESOURCE_SPACE_TENANT_CODE:-default}"
COPPERMIND_DEFAULT_TENANT_CODE_VALUE="${COPPERMIND_DEFAULT_TENANT_CODE_VALUE:-default}"
RESOURCE_SPACE_ADMIN_USERNAME_VALUE="${RESOURCE_SPACE_ADMIN_USERNAME_VALUE:-admin}"
RESOURCE_SPACE_ADMIN_FULLNAME_VALUE="${RESOURCE_SPACE_ADMIN_FULLNAME_VALUE:-Epic Global DAM Admin}"
RESOURCE_SPACE_ADMIN_EMAIL_VALUE="${RESOURCE_SPACE_ADMIN_EMAIL_VALUE:-jorgen@epicglobalinc.com}"
RESOURCE_SPACE_APPLICATION_NAME_VALUE="${RESOURCE_SPACE_APPLICATION_NAME_VALUE:-Epic Global DAM}"
RESOURCE_SPACE_EMAIL_FROM_VALUE="${RESOURCE_SPACE_EMAIL_FROM_VALUE:-no-reply@epicglobalinc.com}"
RESOURCE_SPACE_EMAIL_NOTIFY_VALUE="${RESOURCE_SPACE_EMAIL_NOTIFY_VALUE:-jorgen@epicglobalinc.com}"
RESOURCE_SPACE_SEARCH_TEMPLATE_VALUE="${RESOURCE_SPACE_SEARCH_TEMPLATE_VALUE:-akeneo_links:%s}"
RESOURCE_SPACE_SEARCH_LIMIT_VALUE="${RESOURCE_SPACE_SEARCH_LIMIT_VALUE:-24}"
RESOURCE_SPACE_TIMEOUT_SECONDS_VALUE="${RESOURCE_SPACE_TIMEOUT_SECONDS_VALUE:-20}"
RESOURCE_SPACE_WRITEBACK_IDENTIFIER_FIELD_VALUE="${RESOURCE_SPACE_WRITEBACK_IDENTIFIER_FIELD_VALUE:-akeneo_identifier}"
RESOURCE_SPACE_WRITEBACK_UUID_FIELD_VALUE="${RESOURCE_SPACE_WRITEBACK_UUID_FIELD_VALUE:-akeneo_product_uuid}"
RESOURCE_SPACE_WRITEBACK_OWNER_TYPE_FIELD_VALUE="${RESOURCE_SPACE_WRITEBACK_OWNER_TYPE_FIELD_VALUE:-akeneo_owner_type}"
RESOURCE_SPACE_WRITEBACK_LINKS_FIELD_VALUE="${RESOURCE_SPACE_WRITEBACK_LINKS_FIELD_VALUE:-akeneo_links}"

if [[ "$TARGET" =~ ^https?:// ]]; then
  PIM_URL="$TARGET"
  TARGET_HOST="${TARGET#http://}"
  TARGET_HOST="${TARGET_HOST#https://}"
  TARGET_HOST="${TARGET_HOST%%/*}"
  TARGET_HOST="${TARGET_HOST%%:*}"
else
  TARGET_HOST="$TARGET"
  PIM_URL="http://$TARGET"
fi

RESOURCE_SPACE_BASE_URI_VALUE="${RESOURCE_SPACE_BASE_URI_VALUE:-http://${TARGET_HOST}:8081}"
RESOURCE_SPACE_INTERNAL_BASE_URI_VALUE="${RESOURCE_SPACE_INTERNAL_BASE_URI_VALUE:-http://resourcespace}"
MARKETPLACE_ORCHESTRATOR_BASE_URI_VALUE="${MARKETPLACE_ORCHESTRATOR_BASE_URI_VALUE:-http://marketplace-orchestrator:8090}"

dotenv_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local escaped_value

  escaped_value="$(dotenv_escape "$value")"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${escaped_value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$escaped_value" >> "$ENV_FILE"
  fi
}

get_parameter() {
  local name="$1"

  aws ssm get-parameter \
    --region "$AWS_REGION" \
    --with-decryption \
    --name "$name" \
    --query 'Parameter.Value' \
    --output text
}

if [[ -n "$DEPLOY_PARAMETER_PREFIX" ]]; then
  APP_SECRET_VALUE="$(get_parameter "$DEPLOY_PARAMETER_PREFIX/app_secret")"
  APP_DATABASE_PASSWORD_VALUE="$(get_parameter "$DEPLOY_PARAMETER_PREFIX/app_database_password")"
  APP_DATABASE_ROOT_PASSWORD_VALUE="$(get_parameter "$DEPLOY_PARAMETER_PREFIX/app_database_root_password")"
  OBJECT_STORAGE_ACCESS_KEY_VALUE="$(get_parameter "$DEPLOY_PARAMETER_PREFIX/object_storage_access_key")"
  OBJECT_STORAGE_SECRET_KEY_VALUE="$(get_parameter "$DEPLOY_PARAMETER_PREFIX/object_storage_secret_key")"
  RESOURCE_SPACE_DB_PASSWORD_VALUE="$(get_parameter "$DEPLOY_PARAMETER_PREFIX/resource_space_db_password")"
  RESOURCE_SPACE_DB_ROOT_PASSWORD_VALUE="$(get_parameter "$DEPLOY_PARAMETER_PREFIX/resource_space_db_root_password")"
  RESOURCE_SPACE_ADMIN_PASSWORD_VALUE="$(get_parameter "$DEPLOY_PARAMETER_PREFIX/resource_space_admin_password")"
  RESOURCE_SPACE_SCRAMBLE_KEY_VALUE="$(get_parameter "$DEPLOY_PARAMETER_PREFIX/resource_space_scramble_key")"
  RESOURCE_SPACE_API_SCRAMBLE_KEY_VALUE="$(get_parameter "$DEPLOY_PARAMETER_PREFIX/resource_space_api_scramble_key")"
fi

set_env_value "APP_DATABASE_PASSWORD" "${APP_DATABASE_PASSWORD_VALUE:-akeneo_pim}"
set_env_value "APP_DATABASE_ROOT_PASSWORD" "${APP_DATABASE_ROOT_PASSWORD_VALUE:-root}"
set_env_value "OBJECT_STORAGE_ACCESS_KEY" "${OBJECT_STORAGE_ACCESS_KEY_VALUE:-AKENEO_OBJECT_STORAGE_ACCESS_KEY}"
set_env_value "OBJECT_STORAGE_SECRET_KEY" "${OBJECT_STORAGE_SECRET_KEY_VALUE:-AKENEO_OBJECT_STORAGE_SECRET_KEY}"
set_env_value "RESOURCE_SPACE_DB_PASSWORD" "${RESOURCE_SPACE_DB_PASSWORD_VALUE:-change-me}"
set_env_value "RESOURCE_SPACE_DB_ROOT_PASSWORD" "${RESOURCE_SPACE_DB_ROOT_PASSWORD_VALUE:-change-me}"
set_env_value "RESOURCE_SPACE_ADMIN_USERNAME" "$RESOURCE_SPACE_ADMIN_USERNAME_VALUE"
set_env_value "RESOURCE_SPACE_ADMIN_PASSWORD" "${RESOURCE_SPACE_ADMIN_PASSWORD_VALUE:-ShardplatePower13}"
set_env_value "RESOURCE_SPACE_ADMIN_FULLNAME" "$RESOURCE_SPACE_ADMIN_FULLNAME_VALUE"
set_env_value "RESOURCE_SPACE_ADMIN_EMAIL" "$RESOURCE_SPACE_ADMIN_EMAIL_VALUE"
set_env_value "RESOURCE_SPACE_APPLICATION_NAME" "$RESOURCE_SPACE_APPLICATION_NAME_VALUE"
set_env_value "RESOURCE_SPACE_EMAIL_FROM" "$RESOURCE_SPACE_EMAIL_FROM_VALUE"
set_env_value "RESOURCE_SPACE_EMAIL_NOTIFY" "$RESOURCE_SPACE_EMAIL_NOTIFY_VALUE"
set_env_value "RESOURCE_SPACE_BASE_URI" "$RESOURCE_SPACE_BASE_URI_VALUE"
set_env_value "RESOURCE_SPACE_INTERNAL_BASE_URI" "$RESOURCE_SPACE_INTERNAL_BASE_URI_VALUE"
set_env_value "RESOURCE_SPACE_SEARCH_TEMPLATE" "$RESOURCE_SPACE_SEARCH_TEMPLATE_VALUE"
set_env_value "RESOURCE_SPACE_SCRAMBLE_KEY" "${RESOURCE_SPACE_SCRAMBLE_KEY_VALUE:-coppermind-local-rs-scramble-key-2026}"
set_env_value "RESOURCE_SPACE_API_SCRAMBLE_KEY" "${RESOURCE_SPACE_API_SCRAMBLE_KEY_VALUE:-coppermind-local-rs-api-scramble-key-2026}"
set_env_value "RESOURCE_SPACE_API_USER" "$RESOURCE_SPACE_ADMIN_USERNAME_VALUE"
set_env_value "RESOURCE_SPACE_API_KEY" "${RESOURCE_SPACE_API_SCRAMBLE_KEY_VALUE:-coppermind-local-rs-api-scramble-key-2026}"
set_env_value "RESOURCE_SPACE_SEARCH_LIMIT" "$RESOURCE_SPACE_SEARCH_LIMIT_VALUE"
set_env_value "RESOURCE_SPACE_TIMEOUT_SECONDS" "$RESOURCE_SPACE_TIMEOUT_SECONDS_VALUE"
set_env_value "RESOURCE_SPACE_WRITEBACK_ENABLED" "1"
set_env_value "RESOURCE_SPACE_WRITEBACK_IDENTIFIER_FIELD" "$RESOURCE_SPACE_WRITEBACK_IDENTIFIER_FIELD_VALUE"
set_env_value "RESOURCE_SPACE_WRITEBACK_UUID_FIELD" "$RESOURCE_SPACE_WRITEBACK_UUID_FIELD_VALUE"
set_env_value "RESOURCE_SPACE_WRITEBACK_OWNER_TYPE_FIELD" "$RESOURCE_SPACE_WRITEBACK_OWNER_TYPE_FIELD_VALUE"
set_env_value "RESOURCE_SPACE_WRITEBACK_LINKS_FIELD" "$RESOURCE_SPACE_WRITEBACK_LINKS_FIELD_VALUE"
set_env_value "RESOURCE_SPACE_DEFAULT_ATTRIBUTE_CODE" "${RESOURCE_SPACE_DEFAULT_ATTRIBUTE_CODE_VALUE:-}"
set_env_value "COPPERMIND_DEFAULT_TENANT_CODE" "$COPPERMIND_DEFAULT_TENANT_CODE_VALUE"
set_env_value "MARKETPLACE_ORCHESTRATOR_BASE_URI" "$MARKETPLACE_ORCHESTRATOR_BASE_URI_VALUE"

APP_SECRET_VALUE="${APP_SECRET_VALUE:-$(openssl rand -hex 32)}" bash "$PROJECT_ROOT/scripts/aws-first-run.sh" "$TARGET"

custom_migrations=(
  "Pim\\Upgrade\\Schema\\Version_7_0_20260316110000_create_resourcespace_asset_link_table"
  "Pim\\Upgrade\\Schema\\Version_7_0_20260323110000_add_resourcespace_writeback_job_table"
  "Pim\\Upgrade\\Schema\\Version_7_0_20260324110000_add_tenant_scoped_resourcespace_configuration"
  "Pim\\Upgrade\\Schema\\Version_7_0_20260406120000_add_governance_outbox_ingest_tables"
)

# Akeneo's installer baselines every discovered migration as executed on a fresh install.
# Replay only the Coppermind migrations so their schema is actually created.
for migration in "${custom_migrations[@]}"; do
  sg docker -c "cd '$PROJECT_ROOT' && docker compose run -u www-data --rm php php bin/console doctrine:migrations:version '$migration' --delete --env=prod --no-interaction"
done

sg docker -c "cd '$PROJECT_ROOT' && docker compose run -u www-data --rm php php bin/console doctrine:migrations:migrate --env=prod --no-interaction"
sg docker -c "cd '$PROJECT_ROOT' && make resourcespace-up"
sg docker -c "cd '$PROJECT_ROOT' && make marketplace-up"

sg docker -c "cd '$PROJECT_ROOT' && docker compose run -u www-data --rm php php bin/console coppermind:resourcespace:tenant:configure --env=prod --no-interaction --tenant='$RESOURCE_SPACE_TENANT_CODE' --label='Epic Global Default Tenant' --status='active' --enabled=true --base-uri='$RESOURCE_SPACE_BASE_URI_VALUE' --internal-base-uri='$RESOURCE_SPACE_INTERNAL_BASE_URI_VALUE' --api-user='$RESOURCE_SPACE_ADMIN_USERNAME_VALUE' --api-key='${RESOURCE_SPACE_API_SCRAMBLE_KEY_VALUE:-coppermind-local-rs-api-scramble-key-2026}' --default-attribute='${RESOURCE_SPACE_DEFAULT_ATTRIBUTE_CODE_VALUE:-}' --writeback-enabled=true --writeback-identifier-field='akeneo_identifier' --writeback-uuid-field='akeneo_product_uuid' --writeback-owner-type-field='akeneo_owner_type' --writeback-links-field='akeneo_links'"

sg docker -c "cd '$PROJECT_ROOT' && docker compose stop php node selenium blackfire pubsub-emulator || true"

curl -fsS "$PIM_URL" > /dev/null
curl -fsS "$RESOURCE_SPACE_BASE_URI_VALUE" > /dev/null
curl -fsS http://127.0.0.1:8090/health > /dev/null

echo "Epic Global Akeneo deployment completed."
echo "PIM URL: $PIM_URL"
echo "DAM URL: $RESOURCE_SPACE_BASE_URI_VALUE"
