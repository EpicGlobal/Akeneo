<?php

declare(strict_types=1);

namespace Pim\Upgrade\Schema;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version_7_0_20260316110000_create_resourcespace_asset_link_table extends AbstractMigration
{
    public function up(Schema $schema): void
    {
        if ($schema->hasTable('coppermind_resourcespace_asset_link')) {
            $this->addSql('SELECT 1');

            return;
        }

        $this->addSql(
            <<<SQL
            CREATE TABLE coppermind_resourcespace_asset_link (
                id INT AUTO_INCREMENT NOT NULL,
                owner_type VARCHAR(32) NOT NULL,
                owner_id VARCHAR(191) NOT NULL,
                resource_ref INT NOT NULL,
                resource_title VARCHAR(255) NOT NULL,
                resource_extension VARCHAR(32) NOT NULL,
                preview_url TEXT DEFAULT NULL,
                download_url TEXT DEFAULT NULL,
                ui_url TEXT DEFAULT NULL,
                is_primary TINYINT(1) NOT NULL DEFAULT 0,
                synced_attribute VARCHAR(100) DEFAULT NULL,
                synced_at DATETIME DEFAULT NULL,
                linked_by INT DEFAULT NULL,
                linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE INDEX uniq_owner_resource (owner_type, owner_id, resource_ref),
                INDEX idx_owner_lookup (owner_type, owner_id),
                INDEX idx_primary_lookup (owner_type, owner_id, is_primary),
                PRIMARY KEY(id)
            ) DEFAULT CHARACTER SET utf8mb4 COLLATE `utf8mb4_unicode_ci` ENGINE = InnoDB
            SQL
        );
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException();
    }
}
