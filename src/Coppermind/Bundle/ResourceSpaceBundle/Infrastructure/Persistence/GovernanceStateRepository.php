<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence;

use Doctrine\DBAL\Connection;

final class GovernanceStateRepository
{
    private const TABLE_NAME = 'coppermind_governance_state';
    private const DEFAULT_TENANT_CODE = 'default';

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @param array<string, mixed> $state
     */
    public function upsert(string $ownerType, string $ownerId, array $state, ?string $tenantCode = null): void
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);

        $this->connection->executeStatement(
            sprintf(
                <<<SQL
                INSERT INTO %s (
                    tenant_code, owner_type, owner_id, family_code, approval_status, publish_status,
                    completeness_score, blocker_count, blockers_json, targets_json, approvals_json, updated_at
                ) VALUES (
                    :tenant_code, :owner_type, :owner_id, :family_code, :approval_status, :publish_status,
                    :completeness_score, :blocker_count, :blockers_json, :targets_json, :approvals_json, :updated_at
                )
                ON DUPLICATE KEY UPDATE
                    family_code = VALUES(family_code),
                    approval_status = VALUES(approval_status),
                    publish_status = VALUES(publish_status),
                    completeness_score = VALUES(completeness_score),
                    blocker_count = VALUES(blocker_count),
                    blockers_json = VALUES(blockers_json),
                    targets_json = VALUES(targets_json),
                    approvals_json = VALUES(approvals_json),
                    updated_at = VALUES(updated_at)
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
                'family_code' => substr(trim((string) ($state['family_code'] ?? '')), 0, 100),
                'approval_status' => substr(trim((string) ($state['approval_status'] ?? 'pending')), 0, 32),
                'publish_status' => substr(trim((string) ($state['publish_status'] ?? 'blocked')), 0, 32),
                'completeness_score' => round((float) ($state['completeness_score'] ?? 0), 2),
                'blocker_count' => max(0, (int) ($state['blocker_count'] ?? 0)),
                'blockers_json' => json_encode($state['blockers'] ?? [], JSON_THROW_ON_ERROR),
                'targets_json' => json_encode($state['targets'] ?? [], JSON_THROW_ON_ERROR),
                'approvals_json' => json_encode($state['approvals'] ?? [], JSON_THROW_ON_ERROR),
                'updated_at' => $this->now(),
            ]
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findByOwner(string $ownerType, string $ownerId, ?string $tenantCode = null): ?array
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);

        $row = $this->connection->fetchAssociative(
            sprintf(
                <<<SQL
                SELECT tenant_code, owner_type, owner_id, family_code, approval_status, publish_status,
                       completeness_score, blocker_count, blockers_json, targets_json, approvals_json, updated_at
                FROM %s
                WHERE tenant_code = :tenant_code AND owner_type = :owner_type AND owner_id = :owner_id
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

        return false !== $row ? $this->normalizeRow($row) : null;
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
            'owner_type' => (string) ($row['owner_type'] ?? ''),
            'owner_id' => (string) ($row['owner_id'] ?? ''),
            'family_code' => (string) ($row['family_code'] ?? ''),
            'approval_status' => (string) ($row['approval_status'] ?? 'pending'),
            'publish_status' => (string) ($row['publish_status'] ?? 'blocked'),
            'completeness_score' => round((float) ($row['completeness_score'] ?? 0), 2),
            'blocker_count' => max(0, (int) ($row['blocker_count'] ?? 0)),
            'blockers' => $this->decodeJson($row['blockers_json'] ?? null),
            'targets' => $this->decodeJson($row['targets_json'] ?? null),
            'approvals' => $this->decodeJson($row['approvals_json'] ?? null),
            'updated_at' => null !== $row['updated_at'] ? (string) $row['updated_at'] : null,
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function decodeJson(mixed $value): array
    {
        if (!\is_string($value) || '' === trim($value)) {
            return [];
        }

        $decoded = json_decode($value, true);

        return \is_array($decoded) ? $decoded : [];
    }

    private function normalizeTenantCode(?string $tenantCode): string
    {
        $tenantCode = strtolower(trim((string) $tenantCode));

        return '' !== $tenantCode ? substr($tenantCode, 0, 64) : self::DEFAULT_TENANT_CODE;
    }

    private function now(): string
    {
        return (new \DateTimeImmutable())->format('Y-m-d H:i:s');
    }
}
