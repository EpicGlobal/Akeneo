<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence;

use Doctrine\DBAL\Connection;

final class AssetLinkRepository
{
    private const TABLE_NAME = 'coppermind_resourcespace_asset_link';
    private const DEFAULT_TENANT_CODE = 'default';

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function findByOwner(string $ownerType, string $ownerId, ?string $tenantCode = null): array
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT tenant_code, owner_type, owner_id, resource_ref, resource_title, resource_extension, preview_url, download_url, ui_url,
                       asset_role,
                       is_primary, synced_attribute, synced_at, linked_by, linked_at
                FROM %s
                WHERE tenant_code = :tenant_code AND owner_type = :owner_type AND owner_id = :owner_id
                ORDER BY is_primary DESC, linked_at DESC
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
            ]
        );

        return array_map([$this, 'normalizeRow'], $statement->fetchAllAssociative());
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function findByResourceRef(int $resourceRef, ?string $tenantCode = null): array
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT tenant_code, owner_type, owner_id, resource_ref, resource_title, resource_extension, preview_url, download_url, ui_url,
                       asset_role,
                       is_primary, synced_attribute, synced_at, linked_by, linked_at
                FROM %s
                WHERE tenant_code = :tenant_code AND resource_ref = :resource_ref
                ORDER BY is_primary DESC, linked_at DESC
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'resource_ref' => $resourceRef,
            ]
        );

        return array_map([$this, 'normalizeRow'], $statement->fetchAllAssociative());
    }

    /**
     * @param array<string, mixed> $asset
     */
    public function upsertLink(
        string $ownerType,
        string $ownerId,
        array $asset,
        ?int $linkedBy,
        bool $isPrimary = false,
        ?string $assetRole = null,
        ?string $tenantCode = null,
    ): void {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $resourceRef = (int) ($asset['resource_ref'] ?? 0);
        if ($resourceRef <= 0) {
            throw new \RuntimeException('A valid ResourceSpace resource reference is required.');
        }

        $this->connection->transactional(function (Connection $connection) use (
            $tenantCode,
            $ownerType,
            $ownerId,
            $asset,
            $linkedBy,
            $isPrimary,
            $resourceRef
        ): void {
            $existingLink = $this->findRawLink($ownerType, $ownerId, $resourceRef, $tenantCode);
            $shouldBePrimary = $isPrimary
                || (null !== $existingLink && (bool) $existingLink['is_primary'])
                || !$this->ownerHasPrimaryLink($ownerType, $ownerId, $tenantCode);
            $normalizedAssetRole = $this->normalizeAssetRole($assetRole);
            if (null === $normalizedAssetRole && null !== $existingLink && isset($existingLink['asset_role'])) {
                $normalizedAssetRole = $this->normalizeAssetRole((string) $existingLink['asset_role']);
            }

            if ($shouldBePrimary) {
                $this->clearPrimaryFlag($ownerType, $ownerId, $tenantCode);
            }

            $connection->executeStatement(
                sprintf(
                    <<<SQL
                    INSERT INTO %s (
                        tenant_code, owner_type, owner_id, resource_ref, resource_title, resource_extension, preview_url, download_url, ui_url,
                        asset_role, is_primary, linked_by, linked_at
                    ) VALUES (
                        :tenant_code, :owner_type, :owner_id, :resource_ref, :resource_title, :resource_extension, :preview_url, :download_url, :ui_url,
                        :asset_role, :is_primary, :linked_by, :linked_at
                    )
                    ON DUPLICATE KEY UPDATE
                        resource_title = VALUES(resource_title),
                        resource_extension = VALUES(resource_extension),
                        preview_url = VALUES(preview_url),
                        download_url = VALUES(download_url),
                        ui_url = VALUES(ui_url),
                        asset_role = VALUES(asset_role),
                        is_primary = VALUES(is_primary),
                        linked_by = VALUES(linked_by),
                        linked_at = VALUES(linked_at)
                    SQL,
                    self::TABLE_NAME
                ),
                [
                    'tenant_code' => $tenantCode,
                    'owner_type' => $ownerType,
                    'owner_id' => $ownerId,
                    'resource_ref' => $resourceRef,
                    'resource_title' => (string) ($asset['title'] ?? ''),
                    'resource_extension' => (string) ($asset['file_extension'] ?? ''),
                    'preview_url' => (string) ($asset['preview_url'] ?? ''),
                    'download_url' => (string) ($asset['download_url'] ?? ''),
                    'ui_url' => (string) ($asset['ui_url'] ?? ''),
                    'asset_role' => $normalizedAssetRole ?? '',
                    'is_primary' => $shouldBePrimary ? 1 : 0,
                    'linked_by' => $linkedBy,
                    'linked_at' => (new \DateTimeImmutable())->format('Y-m-d H:i:s'),
                ]
            );
        });
    }

    public function removeLink(string $ownerType, string $ownerId, int $resourceRef, ?string $tenantCode = null): void
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);

        $this->connection->transactional(function (Connection $connection) use ($tenantCode, $ownerType, $ownerId, $resourceRef): void {
            $connection->delete(self::TABLE_NAME, [
                'tenant_code' => $tenantCode,
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
                'resource_ref' => $resourceRef,
            ]);

            if (!$this->ownerHasPrimaryLink($ownerType, $ownerId, $tenantCode)) {
                $this->promoteMostRecentLink($ownerType, $ownerId, $tenantCode);
            }
        });
    }

    public function markSynced(
        string $ownerType,
        string $ownerId,
        int $resourceRef,
        string $attributeCode,
        ?string $tenantCode = null,
    ): void {
        $tenantCode = $this->normalizeTenantCode($tenantCode);

        $this->connection->update(self::TABLE_NAME, [
            'synced_attribute' => $attributeCode,
            'synced_at' => (new \DateTimeImmutable())->format('Y-m-d H:i:s'),
        ], [
            'tenant_code' => $tenantCode,
            'owner_type' => $ownerType,
            'owner_id' => $ownerId,
            'resource_ref' => $resourceRef,
        ]);
    }

    /**
     * @param array<int, int> $resourceRefs
     *
     * @return array<int, int>
     */
    public function getWhereUsedMap(array $resourceRefs, ?string $tenantCode = null): array
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $resourceRefs = array_values(array_unique(array_filter(array_map(
            static fn (mixed $resourceRef): int => (int) $resourceRef,
            $resourceRefs
        ), static fn (int $resourceRef): bool => $resourceRef > 0)));

        if ([] === $resourceRefs) {
            return [];
        }

        $parameters = ['tenant_code' => $tenantCode];
        $placeholders = [];

        foreach ($resourceRefs as $index => $resourceRef) {
            $parameter = sprintf('resource_ref_%d', $index);
            $parameters[$parameter] = $resourceRef;
            $placeholders[] = sprintf(':%s', $parameter);
        }

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT resource_ref, COUNT(DISTINCT CONCAT(owner_type, ':', owner_id)) AS where_used_count
                FROM %s
                WHERE tenant_code = :tenant_code AND resource_ref IN (%s)
                GROUP BY resource_ref
                SQL,
                self::TABLE_NAME,
                implode(', ', $placeholders)
            ),
            $parameters
        );

        $whereUsedMap = [];
        foreach ($statement->fetchAllAssociative() as $row) {
            $whereUsedMap[(int) $row['resource_ref']] = (int) $row['where_used_count'];
        }

        return $whereUsedMap;
    }

    private function clearPrimaryFlag(string $ownerType, string $ownerId, string $tenantCode): void
    {
        $this->connection->update(self::TABLE_NAME, ['is_primary' => 0], [
            'tenant_code' => $tenantCode,
            'owner_type' => $ownerType,
            'owner_id' => $ownerId,
        ]);
    }

    private function ownerHasPrimaryLink(string $ownerType, string $ownerId, string $tenantCode): bool
    {
        $result = $this->connection->fetchOne(
            sprintf(
                'SELECT 1 FROM %s WHERE tenant_code = :tenant_code AND owner_type = :owner_type AND owner_id = :owner_id AND is_primary = 1 LIMIT 1',
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
            ]
        );

        return false !== $result;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findRawLink(string $ownerType, string $ownerId, int $resourceRef, string $tenantCode): ?array
    {
        $row = $this->connection->fetchAssociative(
            sprintf(
                <<<SQL
                SELECT tenant_code, owner_type, owner_id, resource_ref, asset_role, is_primary
                FROM %s
                WHERE tenant_code = :tenant_code AND owner_type = :owner_type AND owner_id = :owner_id AND resource_ref = :resource_ref
                LIMIT 1
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
                'resource_ref' => $resourceRef,
            ]
        );

        return false !== $row ? $row : null;
    }

    private function promoteMostRecentLink(string $ownerType, string $ownerId, string $tenantCode): void
    {
        $resourceRef = $this->connection->fetchOne(
            sprintf(
                <<<SQL
                SELECT resource_ref
                FROM %s
                WHERE tenant_code = :tenant_code AND owner_type = :owner_type AND owner_id = :owner_id
                ORDER BY linked_at DESC, resource_ref DESC
                LIMIT 1
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
            ]
        );

        if (false === $resourceRef) {
            return;
        }

        $this->connection->update(
            self::TABLE_NAME,
            ['is_primary' => 1],
            [
                'tenant_code' => $tenantCode,
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
                'resource_ref' => (int) $resourceRef,
            ]
        );
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    private function normalizeRow(array $row): array
    {
        return [
            'tenant_code' => (string) ($row['tenant_code'] ?? self::DEFAULT_TENANT_CODE),
            'owner_type' => (string) $row['owner_type'],
            'owner_id' => (string) $row['owner_id'],
            'resource_ref' => (int) $row['resource_ref'],
            'title' => (string) ($row['resource_title'] ?? ''),
            'file_extension' => (string) ($row['resource_extension'] ?? ''),
            'preview_url' => (string) ($row['preview_url'] ?? ''),
            'download_url' => (string) ($row['download_url'] ?? ''),
            'ui_url' => (string) ($row['ui_url'] ?? ''),
            'asset_role' => '' !== trim((string) ($row['asset_role'] ?? '')) ? (string) $row['asset_role'] : null,
            'is_primary' => (bool) $row['is_primary'],
            'synced_attribute' => null !== $row['synced_attribute'] ? (string) $row['synced_attribute'] : null,
            'synced_at' => null !== $row['synced_at'] ? (string) $row['synced_at'] : null,
            'linked_by' => null !== $row['linked_by'] ? (int) $row['linked_by'] : null,
            'linked_at' => (string) $row['linked_at'],
            'is_linked' => true,
        ];
    }

    private function normalizeAssetRole(?string $assetRole): ?string
    {
        $assetRole = strtolower(trim((string) $assetRole));
        if ('' === $assetRole) {
            return null;
        }

        $assetRole = preg_replace('/[^a-z0-9._-]+/', '_', $assetRole) ?? '';
        $assetRole = trim($assetRole, '._-');

        return '' !== $assetRole ? substr($assetRole, 0, 100) : null;
    }

    private function normalizeTenantCode(?string $tenantCode): string
    {
        $tenantCode = strtolower(trim((string) $tenantCode));

        return '' !== $tenantCode ? substr($tenantCode, 0, 64) : self::DEFAULT_TENANT_CODE;
    }
}
