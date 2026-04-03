<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Coppermind\Bundle\ResourceSpaceBundle\Domain\ResourceSpaceConfiguration;
use Doctrine\DBAL\Connection;

final class TenantAwareResourceSpaceConfigurationProvider
{
    private const TENANT_TABLE = 'coppermind_tenant';
    private const CONFIGURATION_TABLE = 'coppermind_resourcespace_tenant_configuration';

    private ?bool $hasTenantTable = null;
    private ?bool $hasConfigurationTable = null;

    public function __construct(
        private readonly Connection $connection,
        private readonly ResourceSpaceConfiguration $defaultConfiguration,
        private readonly string $defaultTenantCode,
    ) {
    }

    public function defaultTenantCode(): string
    {
        return $this->normalizeTenantCode($this->defaultTenantCode);
    }

    public function get(?string $tenantCode = null): ResourceSpaceConfiguration
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $row = $this->findConfigurationRow($tenantCode);

        if (null === $row) {
            return $tenantCode === $this->defaultTenantCode()
                ? $this->defaultConfiguration
                : $this->blankConfiguration();
        }

        if (!(bool) ($row['enabled'] ?? false) || 'active' !== strtolower((string) ($row['tenant_status'] ?? 'active'))) {
            return $this->blankConfiguration();
        }

        return new ResourceSpaceConfiguration(
            (string) ($row['base_uri'] ?? ''),
            (string) ($row['internal_base_uri'] ?? ''),
            (string) ($row['api_user'] ?? ''),
            (string) ($row['api_key'] ?? ''),
            (string) ($row['search_template'] ?? $this->defaultConfiguration->searchTemplate()),
            (string) ($row['default_attribute_code'] ?? $this->defaultConfiguration->defaultAttributeCode() ?? ''),
            (int) ($row['search_limit'] ?? $this->defaultConfiguration->searchLimit()),
            (int) ($row['timeout_seconds'] ?? $this->defaultConfiguration->timeoutSeconds()),
            (bool) ($row['writeback_enabled'] ?? false),
            (string) ($row['writeback_identifier_field'] ?? ''),
            (string) ($row['writeback_uuid_field'] ?? ''),
            (string) ($row['writeback_owner_type_field'] ?? ''),
            (string) ($row['writeback_links_field'] ?? '')
        );
    }

    public function resolveTenantCode(?string $tenantCode = null): string
    {
        return $this->normalizeTenantCode($tenantCode);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findConfigurationRow(string $tenantCode): ?array
    {
        if (!$this->hasConfigurationTable()) {
            return null;
        }

        $sql = sprintf(
            <<<SQL
            SELECT c.tenant_code, c.enabled, c.base_uri, c.internal_base_uri, c.api_user, c.api_key,
                   c.search_template, c.default_attribute_code, c.search_limit, c.timeout_seconds,
                   c.writeback_enabled, c.writeback_identifier_field, c.writeback_uuid_field,
                   c.writeback_owner_type_field, c.writeback_links_field, %s AS tenant_status
            FROM %s c
            %s
            WHERE c.tenant_code = :tenant_code
            LIMIT 1
            SQL,
            $this->hasTenantTable() ? 't.status' : "'active'",
            self::CONFIGURATION_TABLE,
            $this->hasTenantTable() ? 'LEFT JOIN ' . self::TENANT_TABLE . ' t ON t.code = c.tenant_code' : ''
        );

        $row = $this->connection->fetchAssociative($sql, ['tenant_code' => $tenantCode]);

        return false !== $row ? $row : null;
    }

    private function hasConfigurationTable(): bool
    {
        if (null === $this->hasConfigurationTable) {
            $schemaManager = $this->schemaManager();
            $this->hasConfigurationTable = $schemaManager->tablesExist([self::CONFIGURATION_TABLE]);
        }

        return $this->hasConfigurationTable;
    }

    private function hasTenantTable(): bool
    {
        if (null === $this->hasTenantTable) {
            $schemaManager = $this->schemaManager();
            $this->hasTenantTable = $schemaManager->tablesExist([self::TENANT_TABLE]);
        }

        return $this->hasTenantTable;
    }

    private function blankConfiguration(): ResourceSpaceConfiguration
    {
        return new ResourceSpaceConfiguration(
            '',
            '',
            '',
            '',
            $this->defaultConfiguration->searchTemplate(),
            $this->defaultConfiguration->defaultAttributeCode() ?? '',
            $this->defaultConfiguration->searchLimit(),
            $this->defaultConfiguration->timeoutSeconds(),
            false,
            '',
            '',
            '',
            ''
        );
    }

    private function normalizeTenantCode(?string $tenantCode): string
    {
        $tenantCode = strtolower(trim((string) $tenantCode));
        if ('' === $tenantCode) {
            return strtolower(trim($this->defaultTenantCode));
        }

        $tenantCode = preg_replace('/[^a-z0-9._-]+/', '-', $tenantCode) ?? '';
        $tenantCode = trim($tenantCode, '-.');

        return '' !== $tenantCode ? substr($tenantCode, 0, 64) : strtolower(trim($this->defaultTenantCode));
    }

    private function schemaManager(): object
    {
        if (method_exists($this->connection, 'createSchemaManager')) {
            return $this->connection->createSchemaManager();
        }

        return $this->connection->getSchemaManager();
    }
}
