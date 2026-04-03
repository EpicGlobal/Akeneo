<?php

declare(strict_types=1);

namespace Pim\Upgrade\Schema;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version_7_0_20260324110000_add_tenant_scoped_resourcespace_configuration extends AbstractMigration
{
    private const DEFAULT_TENANT_CODE = 'default';

    public function up(Schema $schema): void
    {
        if (!$schema->hasTable('coppermind_tenant')) {
            $this->addSql(
                <<<SQL
                CREATE TABLE coppermind_tenant (
                    code VARCHAR(64) NOT NULL,
                    label VARCHAR(191) NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'active',
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(code),
                    INDEX idx_coppermind_tenant_status (status)
                ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
                SQL
            );
        }

        if (!$schema->hasTable('coppermind_resourcespace_tenant_configuration')) {
            $this->addSql(
                <<<SQL
                CREATE TABLE coppermind_resourcespace_tenant_configuration (
                    tenant_code VARCHAR(64) NOT NULL,
                    enabled TINYINT(1) NOT NULL DEFAULT 1,
                    base_uri VARCHAR(255) NOT NULL DEFAULT '',
                    internal_base_uri VARCHAR(255) NOT NULL DEFAULT '',
                    api_user VARCHAR(191) NOT NULL DEFAULT '',
                    api_key VARCHAR(255) NOT NULL DEFAULT '',
                    search_template VARCHAR(255) NOT NULL DEFAULT '%s',
                    default_attribute_code VARCHAR(100) NOT NULL DEFAULT '',
                    search_limit INT NOT NULL DEFAULT 24,
                    timeout_seconds INT NOT NULL DEFAULT 20,
                    writeback_enabled TINYINT(1) NOT NULL DEFAULT 0,
                    writeback_identifier_field VARCHAR(100) NOT NULL DEFAULT '',
                    writeback_uuid_field VARCHAR(100) NOT NULL DEFAULT '',
                    writeback_owner_type_field VARCHAR(100) NOT NULL DEFAULT '',
                    writeback_links_field VARCHAR(100) NOT NULL DEFAULT '',
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(tenant_code),
                    INDEX idx_resourcespace_tenant_enabled (enabled)
                ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
                SQL
            );
        }

        $this->addSql(
            <<<SQL
            INSERT INTO coppermind_tenant (code, label, status, created_at, updated_at)
            VALUES (:tenant_code, :label, 'active', NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                label = VALUES(label),
                status = 'active',
                updated_at = VALUES(updated_at)
            SQL,
            [
                'tenant_code' => self::DEFAULT_TENANT_CODE,
                'label' => 'Default Tenant',
            ]
        );

        $this->addSql(
            <<<SQL
            INSERT INTO coppermind_resourcespace_tenant_configuration (
                tenant_code, enabled, base_uri, internal_base_uri, api_user, api_key, search_template,
                default_attribute_code, search_limit, timeout_seconds, writeback_enabled,
                writeback_identifier_field, writeback_uuid_field, writeback_owner_type_field, writeback_links_field,
                created_at, updated_at
            ) VALUES (
                :tenant_code, 1, :base_uri, :internal_base_uri, :api_user, :api_key, :search_template,
                :default_attribute_code, :search_limit, :timeout_seconds, :writeback_enabled,
                :writeback_identifier_field, :writeback_uuid_field, :writeback_owner_type_field, :writeback_links_field,
                NOW(), NOW()
            )
            ON DUPLICATE KEY UPDATE
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
                'tenant_code' => self::DEFAULT_TENANT_CODE,
                'base_uri' => (string) getenv('RESOURCE_SPACE_BASE_URI'),
                'internal_base_uri' => (string) getenv('RESOURCE_SPACE_INTERNAL_BASE_URI'),
                'api_user' => (string) getenv('RESOURCE_SPACE_API_USER'),
                'api_key' => (string) getenv('RESOURCE_SPACE_API_KEY'),
                'search_template' => '' !== trim((string) getenv('RESOURCE_SPACE_SEARCH_TEMPLATE'))
                    ? (string) getenv('RESOURCE_SPACE_SEARCH_TEMPLATE')
                    : '%s',
                'default_attribute_code' => (string) getenv('RESOURCE_SPACE_DEFAULT_ATTRIBUTE_CODE'),
                'search_limit' => (int) (getenv('RESOURCE_SPACE_SEARCH_LIMIT') ?: 24),
                'timeout_seconds' => (int) (getenv('RESOURCE_SPACE_TIMEOUT_SECONDS') ?: 20),
                'writeback_enabled' => (int) filter_var(getenv('RESOURCE_SPACE_WRITEBACK_ENABLED') ?: false, FILTER_VALIDATE_BOOLEAN),
                'writeback_identifier_field' => (string) getenv('RESOURCE_SPACE_WRITEBACK_IDENTIFIER_FIELD'),
                'writeback_uuid_field' => (string) getenv('RESOURCE_SPACE_WRITEBACK_UUID_FIELD'),
                'writeback_owner_type_field' => (string) getenv('RESOURCE_SPACE_WRITEBACK_OWNER_TYPE_FIELD'),
                'writeback_links_field' => (string) getenv('RESOURCE_SPACE_WRITEBACK_LINKS_FIELD'),
            ]
        );

        if ($schema->hasTable('coppermind_resourcespace_asset_link')) {
            $assetLinkTable = $schema->getTable('coppermind_resourcespace_asset_link');
            if (!$assetLinkTable->hasColumn('tenant_code')) {
                $this->addSql(
                    "ALTER TABLE coppermind_resourcespace_asset_link ADD tenant_code VARCHAR(64) NOT NULL DEFAULT 'default' AFTER id"
                );
            }

            if ($assetLinkTable->hasIndex('uniq_owner_resource')) {
                $this->addSql('DROP INDEX uniq_owner_resource ON coppermind_resourcespace_asset_link');
            }
            if ($assetLinkTable->hasIndex('idx_owner_lookup')) {
                $this->addSql('DROP INDEX idx_owner_lookup ON coppermind_resourcespace_asset_link');
            }
            if ($assetLinkTable->hasIndex('idx_primary_lookup')) {
                $this->addSql('DROP INDEX idx_primary_lookup ON coppermind_resourcespace_asset_link');
            }
            if ($assetLinkTable->hasIndex('idx_resource_ref_lookup')) {
                $this->addSql('DROP INDEX idx_resource_ref_lookup ON coppermind_resourcespace_asset_link');
            }

            if (!$assetLinkTable->hasIndex('uniq_tenant_owner_resource')) {
                $this->addSql(
                    'CREATE UNIQUE INDEX uniq_tenant_owner_resource ON coppermind_resourcespace_asset_link (tenant_code, owner_type, owner_id, resource_ref)'
                );
            }
            if (!$assetLinkTable->hasIndex('idx_tenant_owner_lookup')) {
                $this->addSql(
                    'CREATE INDEX idx_tenant_owner_lookup ON coppermind_resourcespace_asset_link (tenant_code, owner_type, owner_id)'
                );
            }
            if (!$assetLinkTable->hasIndex('idx_tenant_primary_lookup')) {
                $this->addSql(
                    'CREATE INDEX idx_tenant_primary_lookup ON coppermind_resourcespace_asset_link (tenant_code, owner_type, owner_id, is_primary)'
                );
            }
            if (!$assetLinkTable->hasIndex('idx_tenant_resource_ref_lookup')) {
                $this->addSql(
                    'CREATE INDEX idx_tenant_resource_ref_lookup ON coppermind_resourcespace_asset_link (tenant_code, resource_ref)'
                );
            }
        }

        if ($schema->hasTable('coppermind_resourcespace_writeback_job')) {
            $writebackTable = $schema->getTable('coppermind_resourcespace_writeback_job');
            if (!$writebackTable->hasColumn('tenant_code')) {
                $this->addSql(
                    "ALTER TABLE coppermind_resourcespace_writeback_job ADD tenant_code VARCHAR(64) NOT NULL DEFAULT 'default' FIRST"
                );
                $this->addSql('ALTER TABLE coppermind_resourcespace_writeback_job DROP PRIMARY KEY, ADD PRIMARY KEY (tenant_code, resource_ref)');
            }

            if (!$writebackTable->hasIndex('idx_tenant_status_requested')) {
                $this->addSql(
                    'CREATE INDEX idx_tenant_status_requested ON coppermind_resourcespace_writeback_job (tenant_code, status, requested_at)'
                );
            }
        }
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException();
    }
}
