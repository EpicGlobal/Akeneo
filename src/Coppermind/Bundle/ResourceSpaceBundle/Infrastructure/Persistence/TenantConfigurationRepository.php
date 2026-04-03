<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence;

use Coppermind\Bundle\ResourceSpaceBundle\Application\TenantAwareResourceSpaceConfigurationProvider;
use Doctrine\DBAL\Connection;

final class TenantConfigurationRepository
{
    private const TENANT_TABLE = 'coppermind_tenant';
    private const CONFIGURATION_TABLE = 'coppermind_resourcespace_tenant_configuration';

    private ?bool $hasTenantTable = null;
    private ?bool $hasConfigurationTable = null;

    public function __construct(
        private readonly Connection $connection,
        private readonly TenantAwareResourceSpaceConfigurationProvider $configurationProvider,
    ) {
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function all(): array
    {
        if (!$this->tablesReady()) {
            return [];
        }

        return $this->connection->fetchAllAssociative(
            <<<SQL
            SELECT
                t.code AS tenant_code,
                t.label,
                t.status AS tenant_status,
                COALESCE(c.enabled, 0) AS enabled,
                COALESCE(c.base_uri, '') AS base_uri,
                COALESCE(c.internal_base_uri, '') AS internal_base_uri,
                COALESCE(c.api_user, '') AS api_user,
                COALESCE(c.default_attribute_code, '') AS default_attribute_code,
                COALESCE(c.writeback_enabled, 0) AS writeback_enabled,
                COALESCE(c.updated_at, t.updated_at) AS updated_at
            FROM coppermind_tenant t
            LEFT JOIN coppermind_resourcespace_tenant_configuration c ON c.tenant_code = t.code
            ORDER BY t.code ASC
            SQL
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(string $tenantCode): ?array
    {
        if (!$this->tablesReady()) {
            return null;
        }

        $row = $this->connection->fetchAssociative(
            <<<SQL
            SELECT
                t.code AS tenant_code,
                t.label,
                t.status AS tenant_status,
                COALESCE(c.enabled, 0) AS enabled,
                COALESCE(c.base_uri, '') AS base_uri,
                COALESCE(c.internal_base_uri, '') AS internal_base_uri,
                COALESCE(c.api_user, '') AS api_user,
                COALESCE(c.api_key, '') AS api_key,
                COALESCE(c.search_template, '') AS search_template,
                COALESCE(c.default_attribute_code, '') AS default_attribute_code,
                COALESCE(c.search_limit, 24) AS search_limit,
                COALESCE(c.timeout_seconds, 20) AS timeout_seconds,
                COALESCE(c.writeback_enabled, 0) AS writeback_enabled,
                COALESCE(c.writeback_identifier_field, '') AS writeback_identifier_field,
                COALESCE(c.writeback_uuid_field, '') AS writeback_uuid_field,
                COALESCE(c.writeback_owner_type_field, '') AS writeback_owner_type_field,
                COALESCE(c.writeback_links_field, '') AS writeback_links_field
            FROM coppermind_tenant t
            LEFT JOIN coppermind_resourcespace_tenant_configuration c ON c.tenant_code = t.code
            WHERE t.code = :tenant_code
            LIMIT 1
            SQL,
            ['tenant_code' => $this->configurationProvider->resolveTenantCode($tenantCode)]
        );

        return false !== $row ? $row : null;
    }

    /**
     * @param array<string, mixed> $configuration
     */
    public function upsert(string $tenantCode, string $label, string $status, array $configuration): void
    {
        if (!$this->tablesReady()) {
            throw new \RuntimeException('Tenant-scoped ResourceSpace configuration tables are not available. Run the tenant configuration migration first.');
        }

        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);
        $status = '' !== trim($status) ? strtolower(trim($status)) : 'active';

        $this->connection->beginTransaction();

        try {
            $this->connection->executeStatement(
                <<<SQL
                INSERT INTO coppermind_tenant (code, label, status, created_at, updated_at)
                VALUES (:code, :label, :status, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    label = VALUES(label),
                    status = VALUES(status),
                    updated_at = VALUES(updated_at)
                SQL,
                [
                    'code' => $tenantCode,
                    'label' => $label,
                    'status' => $status,
                ]
            );

            $this->connection->executeStatement(
                <<<SQL
                INSERT INTO coppermind_resourcespace_tenant_configuration (
                    tenant_code, enabled, base_uri, internal_base_uri, api_user, api_key, search_template,
                    default_attribute_code, search_limit, timeout_seconds, writeback_enabled,
                    writeback_identifier_field, writeback_uuid_field, writeback_owner_type_field, writeback_links_field,
                    created_at, updated_at
                ) VALUES (
                    :tenant_code, :enabled, :base_uri, :internal_base_uri, :api_user, :api_key, :search_template,
                    :default_attribute_code, :search_limit, :timeout_seconds, :writeback_enabled,
                    :writeback_identifier_field, :writeback_uuid_field, :writeback_owner_type_field, :writeback_links_field,
                    NOW(), NOW()
                )
                ON DUPLICATE KEY UPDATE
                    enabled = VALUES(enabled),
                    base_uri = VALUES(base_uri),
                    internal_base_uri = VALUES(internal_base_uri),
                    api_user = VALUES(api_user),
                    api_key = VALUES(api_key),
                    search_template = VALUES(search_template),
                    default_attribute_code = VALUES(default_attribute_code),
                    search_limit = VALUES(search_limit),
                    timeout_seconds = VALUES(timeout_seconds),
                    writeback_enabled = VALUES(writeback_enabled),
                    writeback_identifier_field = VALUES(writeback_identifier_field),
                    writeback_uuid_field = VALUES(writeback_uuid_field),
                    writeback_owner_type_field = VALUES(writeback_owner_type_field),
                    writeback_links_field = VALUES(writeback_links_field),
                    updated_at = VALUES(updated_at)
                SQL,
                [
                    'tenant_code' => $tenantCode,
                    'enabled' => $this->toInt((bool) ($configuration['enabled'] ?? true)),
                    'base_uri' => (string) ($configuration['base_uri'] ?? ''),
                    'internal_base_uri' => (string) ($configuration['internal_base_uri'] ?? ''),
                    'api_user' => (string) ($configuration['api_user'] ?? ''),
                    'api_key' => (string) ($configuration['api_key'] ?? ''),
                    'search_template' => (string) ($configuration['search_template'] ?? '%s'),
                    'default_attribute_code' => (string) ($configuration['default_attribute_code'] ?? ''),
                    'search_limit' => max(1, (int) ($configuration['search_limit'] ?? 24)),
                    'timeout_seconds' => max(1, (int) ($configuration['timeout_seconds'] ?? 20)),
                    'writeback_enabled' => $this->toInt((bool) ($configuration['writeback_enabled'] ?? false)),
                    'writeback_identifier_field' => (string) ($configuration['writeback_identifier_field'] ?? ''),
                    'writeback_uuid_field' => (string) ($configuration['writeback_uuid_field'] ?? ''),
                    'writeback_owner_type_field' => (string) ($configuration['writeback_owner_type_field'] ?? ''),
                    'writeback_links_field' => (string) ($configuration['writeback_links_field'] ?? ''),
                ]
            );

            $this->connection->commit();
        } catch (\Throwable $throwable) {
            $this->connection->rollBack();

            throw $throwable;
        }
    }

    private function tablesReady(): bool
    {
        return $this->hasTenantTable() && $this->hasConfigurationTable();
    }

    private function hasTenantTable(): bool
    {
        if (null === $this->hasTenantTable) {
            $this->hasTenantTable = $this->schemaManager()->tablesExist([self::TENANT_TABLE]);
        }

        return $this->hasTenantTable;
    }

    private function hasConfigurationTable(): bool
    {
        if (null === $this->hasConfigurationTable) {
            $this->hasConfigurationTable = $this->schemaManager()->tablesExist([self::CONFIGURATION_TABLE]);
        }

        return $this->hasConfigurationTable;
    }

    private function schemaManager(): object
    {
        if (method_exists($this->connection, 'createSchemaManager')) {
            return $this->connection->createSchemaManager();
        }

        return $this->connection->getSchemaManager();
    }

    private function toInt(bool $value): int
    {
        return $value ? 1 : 0;
    }
}
