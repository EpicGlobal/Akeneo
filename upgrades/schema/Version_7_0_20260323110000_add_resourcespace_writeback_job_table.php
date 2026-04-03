<?php

declare(strict_types=1);

namespace Pim\Upgrade\Schema;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version_7_0_20260323110000_add_resourcespace_writeback_job_table extends AbstractMigration
{
    public function up(Schema $schema): void
    {
        if ($schema->hasTable('coppermind_resourcespace_asset_link')) {
            $assetLinkTable = $schema->getTable('coppermind_resourcespace_asset_link');
            if (!$assetLinkTable->hasIndex('idx_resource_ref_lookup')) {
                $this->addSql(
                    'CREATE INDEX idx_resource_ref_lookup ON coppermind_resourcespace_asset_link (resource_ref)'
                );
            }
        }

        if ($schema->hasTable('coppermind_resourcespace_writeback_job')) {
            return;
        }

        $this->addSql(
            <<<SQL
            CREATE TABLE coppermind_resourcespace_writeback_job (
                resource_ref INT NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                last_error TEXT DEFAULT NULL,
                attempt_count INT NOT NULL DEFAULT 0,
                requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                attempted_at DATETIME DEFAULT NULL,
                processed_at DATETIME DEFAULT NULL,
                PRIMARY KEY(resource_ref),
                INDEX idx_status_requested (status, requested_at)
            ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
            SQL
        );
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException();
    }
}
