<?php

declare(strict_types=1);

namespace Pim\Upgrade\Schema;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version_7_0_20260406120000_add_governance_outbox_ingest_tables extends AbstractMigration
{
    private const DEFAULT_TENANT_CODE = 'default';

    public function up(Schema $schema): void
    {
        if ($schema->hasTable('coppermind_resourcespace_asset_link')) {
            $assetLinkTable = $schema->getTable('coppermind_resourcespace_asset_link');

            if (!$assetLinkTable->hasColumn('asset_role')) {
                $this->addSql(
                    "ALTER TABLE coppermind_resourcespace_asset_link ADD asset_role VARCHAR(100) NOT NULL DEFAULT '' AFTER ui_url"
                );
            }

            if (!$assetLinkTable->hasIndex('idx_tenant_owner_role_lookup')) {
                $this->addSql(
                    'CREATE INDEX idx_tenant_owner_role_lookup ON coppermind_resourcespace_asset_link (tenant_code, owner_type, owner_id, asset_role)'
                );
            }
        }

        if (!$schema->hasTable('coppermind_resourcespace_asset_metadata')) {
            $this->addSql(
                <<<SQL
                CREATE TABLE coppermind_resourcespace_asset_metadata (
                    tenant_code VARCHAR(64) NOT NULL,
                    resource_ref INT NOT NULL,
                    rights_status VARCHAR(64) NOT NULL DEFAULT '',
                    license_code VARCHAR(100) NOT NULL DEFAULT '',
                    expires_at DATETIME DEFAULT NULL,
                    rendition_key VARCHAR(100) NOT NULL DEFAULT '',
                    derivative_of_resource_ref INT DEFAULT NULL,
                    metadata_json LONGTEXT DEFAULT NULL,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (tenant_code, resource_ref),
                    INDEX idx_asset_metadata_expiry (tenant_code, expires_at),
                    INDEX idx_asset_metadata_derivative (tenant_code, derivative_of_resource_ref)
                ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
                SQL
            );
        }

        if (!$schema->hasTable('coppermind_governance_rule')) {
            $this->addSql(
                <<<SQL
                CREATE TABLE coppermind_governance_rule (
                    id INT AUTO_INCREMENT NOT NULL,
                    tenant_code VARCHAR(64) NOT NULL,
                    rule_code VARCHAR(120) NOT NULL,
                    owner_type VARCHAR(32) NOT NULL,
                    family_code VARCHAR(100) NOT NULL DEFAULT '',
                    target_code VARCHAR(120) NOT NULL DEFAULT '',
                    label VARCHAR(191) NOT NULL,
                    channel_code VARCHAR(100) NOT NULL DEFAULT '',
                    market_code VARCHAR(100) NOT NULL DEFAULT '',
                    locale_code VARCHAR(25) NOT NULL DEFAULT '',
                    required_attributes_json LONGTEXT NOT NULL,
                    required_asset_roles_json LONGTEXT NOT NULL,
                    required_approvals_json LONGTEXT NOT NULL,
                    minimum_asset_count INT NOT NULL DEFAULT 0,
                    enabled TINYINT(1) NOT NULL DEFAULT 1,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE INDEX uniq_governance_rule (tenant_code, rule_code),
                    INDEX idx_governance_rule_lookup (tenant_code, owner_type, family_code, enabled),
                    PRIMARY KEY(id)
                ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
                SQL
            );
        }

        if (!$schema->hasTable('coppermind_governance_approval')) {
            $this->addSql(
                <<<SQL
                CREATE TABLE coppermind_governance_approval (
                    id BIGINT AUTO_INCREMENT NOT NULL,
                    tenant_code VARCHAR(64) NOT NULL,
                    owner_type VARCHAR(32) NOT NULL,
                    owner_id VARCHAR(191) NOT NULL,
                    stage_code VARCHAR(100) NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'not_requested',
                    comment_text VARCHAR(1000) DEFAULT NULL,
                    requested_at DATETIME DEFAULT NULL,
                    approved_at DATETIME DEFAULT NULL,
                    approved_by INT DEFAULT NULL,
                    rejected_at DATETIME DEFAULT NULL,
                    rejected_by INT DEFAULT NULL,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE INDEX uniq_governance_approval (tenant_code, owner_type, owner_id, stage_code),
                    INDEX idx_governance_approval_status (tenant_code, status, updated_at),
                    PRIMARY KEY(id)
                ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
                SQL
            );
        }

        if (!$schema->hasTable('coppermind_governance_state')) {
            $this->addSql(
                <<<SQL
                CREATE TABLE coppermind_governance_state (
                    tenant_code VARCHAR(64) NOT NULL,
                    owner_type VARCHAR(32) NOT NULL,
                    owner_id VARCHAR(191) NOT NULL,
                    family_code VARCHAR(100) NOT NULL DEFAULT '',
                    approval_status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    publish_status VARCHAR(32) NOT NULL DEFAULT 'blocked',
                    completeness_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
                    blocker_count INT NOT NULL DEFAULT 0,
                    blockers_json LONGTEXT NOT NULL,
                    targets_json LONGTEXT NOT NULL,
                    approvals_json LONGTEXT NOT NULL,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (tenant_code, owner_type, owner_id),
                    INDEX idx_governance_state_publish (tenant_code, publish_status, updated_at),
                    INDEX idx_governance_state_approval (tenant_code, approval_status, updated_at)
                ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
                SQL
            );
        }

        if (!$schema->hasTable('coppermind_audit_log')) {
            $this->addSql(
                <<<SQL
                CREATE TABLE coppermind_audit_log (
                    id BIGINT AUTO_INCREMENT NOT NULL,
                    tenant_code VARCHAR(64) NOT NULL,
                    actor_user_id INT DEFAULT NULL,
                    actor_identifier VARCHAR(191) NOT NULL DEFAULT '',
                    action_code VARCHAR(100) NOT NULL,
                    subject_type VARCHAR(64) NOT NULL,
                    subject_id VARCHAR(191) NOT NULL,
                    context_json LONGTEXT DEFAULT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_audit_subject_lookup (tenant_code, subject_type, subject_id, created_at),
                    INDEX idx_audit_action_lookup (tenant_code, action_code, created_at),
                    PRIMARY KEY(id)
                ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
                SQL
            );
        }

        if (!$schema->hasTable('coppermind_outbox_event')) {
            $this->addSql(
                <<<SQL
                CREATE TABLE coppermind_outbox_event (
                    id BIGINT AUTO_INCREMENT NOT NULL,
                    tenant_code VARCHAR(64) NOT NULL,
                    event_type VARCHAR(100) NOT NULL,
                    owner_type VARCHAR(32) NOT NULL,
                    owner_id VARCHAR(191) NOT NULL,
                    dedupe_key VARCHAR(255) NOT NULL,
                    payload_json LONGTEXT NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    attempt_count INT NOT NULL DEFAULT 0,
                    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    processed_at DATETIME DEFAULT NULL,
                    last_error VARCHAR(2000) DEFAULT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE INDEX uniq_outbox_dedupe (dedupe_key),
                    INDEX idx_outbox_status_available (tenant_code, status, available_at),
                    INDEX idx_outbox_owner_lookup (tenant_code, owner_type, owner_id, created_at),
                    PRIMARY KEY(id)
                ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
                SQL
            );
        }

        if (!$schema->hasTable('coppermind_resourcespace_media_ingest_job')) {
            $this->addSql(
                <<<SQL
                CREATE TABLE coppermind_resourcespace_media_ingest_job (
                    id BIGINT AUTO_INCREMENT NOT NULL,
                    queue_key VARCHAR(255) NOT NULL,
                    tenant_code VARCHAR(64) NOT NULL,
                    owner_type VARCHAR(32) NOT NULL,
                    owner_id VARCHAR(191) NOT NULL,
                    resource_ref INT NOT NULL,
                    attribute_code VARCHAR(100) NOT NULL,
                    locale_code VARCHAR(25) DEFAULT NULL,
                    scope_code VARCHAR(100) DEFAULT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    last_error VARCHAR(2000) DEFAULT NULL,
                    attempt_count INT NOT NULL DEFAULT 0,
                    requested_by INT DEFAULT NULL,
                    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    attempted_at DATETIME DEFAULT NULL,
                    processed_at DATETIME DEFAULT NULL,
                    file_key VARCHAR(255) DEFAULT NULL,
                    UNIQUE INDEX uniq_media_ingest_queue_key (queue_key),
                    INDEX idx_media_ingest_status_requested (tenant_code, status, requested_at),
                    INDEX idx_media_ingest_owner_lookup (tenant_code, owner_type, owner_id, resource_ref),
                    PRIMARY KEY(id)
                ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
                SQL
            );
        }

        $this->seedGovernanceRulesFromMarketplaceConfig();
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException();
    }

    private function seedGovernanceRulesFromMarketplaceConfig(): void
    {
        $configPath = dirname(__DIR__, 2) . '/services/marketplace-orchestrator/config/tenants.json';
        if (!is_file($configPath)) {
            return;
        }

        $decoded = json_decode((string) file_get_contents($configPath), true);
        if (!is_array($decoded) || !isset($decoded['tenants']) || !is_array($decoded['tenants'])) {
            return;
        }

        foreach ($decoded['tenants'] as $tenant) {
            if (!is_array($tenant)) {
                continue;
            }

            $tenantCode = $this->normalizeCode((string) ($tenant['code'] ?? self::DEFAULT_TENANT_CODE), 64);
            $tenantLabel = trim((string) ($tenant['label'] ?? ucfirst($tenantCode)));

            $this->addSql(
                <<<SQL
                INSERT INTO coppermind_tenant (code, label, status, created_at, updated_at)
                VALUES (:code, :label, 'active', NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    label = VALUES(label),
                    status = 'active',
                    updated_at = VALUES(updated_at)
                SQL,
                [
                    'code' => $tenantCode,
                    'label' => '' !== $tenantLabel ? $tenantLabel : ucfirst($tenantCode),
                ]
            );

            $marketplaces = is_array($tenant['marketplaces'] ?? null) ? $tenant['marketplaces'] : [];
            foreach ($marketplaces as $marketplace) {
                if (!is_array($marketplace)) {
                    continue;
                }

                $targetCode = $this->normalizeCode((string) ($marketplace['code'] ?? ''), 120);
                if ('' === $targetCode) {
                    continue;
                }

                $label = trim((string) ($marketplace['label'] ?? $targetCode));
                $channelCode = $this->normalizeCode((string) ($marketplace['channel'] ?? ''), 100);
                $marketCode = $this->normalizeCode((string) ($marketplace['market'] ?? ''), 100);
                $localeCode = trim((string) ($marketplace['locale'] ?? ''));
                $requiredAttributes = $this->jsonArray($marketplace['requiredAttributes'] ?? []);
                $requiredAssetRoles = $this->jsonArray($marketplace['requiredAssetRoles'] ?? []);
                $requiredApprovals = $this->jsonArray($marketplace['requiredApprovals'] ?? []);
                $minimumAssetCount = max(0, (int) ($marketplace['minimumImageCount'] ?? 0));

                foreach (['product', 'product_model'] as $ownerType) {
                    $ruleCode = $this->normalizeCode(sprintf('%s_%s_%s', $tenantCode, $targetCode, $ownerType), 120);

                    $this->addSql(
                        <<<SQL
                        INSERT INTO coppermind_governance_rule (
                            tenant_code, rule_code, owner_type, family_code, target_code, label, channel_code, market_code, locale_code,
                            required_attributes_json, required_asset_roles_json, required_approvals_json, minimum_asset_count, enabled, created_at, updated_at
                        ) VALUES (
                            :tenant_code, :rule_code, :owner_type, '', :target_code, :label, :channel_code, :market_code, :locale_code,
                            :required_attributes_json, :required_asset_roles_json, :required_approvals_json, :minimum_asset_count, 1, NOW(), NOW()
                        )
                        ON DUPLICATE KEY UPDATE
                            target_code = VALUES(target_code),
                            label = VALUES(label),
                            channel_code = VALUES(channel_code),
                            market_code = VALUES(market_code),
                            locale_code = VALUES(locale_code),
                            required_attributes_json = VALUES(required_attributes_json),
                            required_asset_roles_json = VALUES(required_asset_roles_json),
                            required_approvals_json = VALUES(required_approvals_json),
                            minimum_asset_count = VALUES(minimum_asset_count),
                            enabled = 1,
                            updated_at = VALUES(updated_at)
                        SQL,
                        [
                            'tenant_code' => $tenantCode,
                            'rule_code' => $ruleCode,
                            'owner_type' => $ownerType,
                            'target_code' => $targetCode,
                            'label' => '' !== $label ? $label : $targetCode,
                            'channel_code' => $channelCode,
                            'market_code' => $marketCode,
                            'locale_code' => $localeCode,
                            'required_attributes_json' => json_encode($requiredAttributes, JSON_THROW_ON_ERROR),
                            'required_asset_roles_json' => json_encode($requiredAssetRoles, JSON_THROW_ON_ERROR),
                            'required_approvals_json' => json_encode($requiredApprovals, JSON_THROW_ON_ERROR),
                            'minimum_asset_count' => $minimumAssetCount,
                        ]
                    );
                }
            }
        }
    }

    /**
     * @param mixed $value
     *
     * @return array<int, string>
     */
    private function jsonArray(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $normalized = [];
        foreach ($value as $item) {
            $normalizedItem = trim((string) $item);
            if ('' === $normalizedItem) {
                continue;
            }

            $normalized[] = $normalizedItem;
        }

        return array_values(array_unique($normalized));
    }

    private function normalizeCode(string $value, int $maxLength): string
    {
        $value = strtolower(trim($value));
        $value = preg_replace('/[^a-z0-9._-]+/', '_', $value) ?? '';
        $value = trim($value, '._-');

        return '' !== $value ? substr($value, 0, $maxLength) : '';
    }
}
