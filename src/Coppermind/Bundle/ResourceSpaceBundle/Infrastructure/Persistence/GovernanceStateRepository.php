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
     * @return array<int, array<string, mixed>>
     */
    public function listStates(
        int $limit = 100,
        ?string $tenantCode = null,
        ?string $publishStatus = null,
        ?string $approvalStatus = null,
        ?string $ownerType = null,
    ): array {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $where = ['tenant_code = :tenant_code'];
        $parameters = ['tenant_code' => $tenantCode];

        $publishStatus = trim((string) $publishStatus);
        if ('' !== $publishStatus) {
            $where[] = 'publish_status = :publish_status';
            $parameters['publish_status'] = substr($publishStatus, 0, 32);
        }

        $approvalStatus = trim((string) $approvalStatus);
        if ('' !== $approvalStatus) {
            $where[] = 'approval_status = :approval_status';
            $parameters['approval_status'] = substr($approvalStatus, 0, 32);
        }

        $ownerType = trim((string) $ownerType);
        if ('' !== $ownerType) {
            $where[] = 'owner_type = :owner_type';
            $parameters['owner_type'] = substr($ownerType, 0, 32);
        }

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT tenant_code, owner_type, owner_id, family_code, approval_status, publish_status,
                       completeness_score, blocker_count, blockers_json, targets_json, approvals_json, updated_at
                FROM %s
                WHERE %s
                ORDER BY
                    CASE publish_status WHEN 'blocked' THEN 0 ELSE 1 END ASC,
                    blocker_count DESC,
                    completeness_score ASC,
                    updated_at DESC
                LIMIT %d
                SQL,
                self::TABLE_NAME,
                implode(' AND ', $where),
                max(1, $limit)
            ),
            $parameters
        );

        return array_map([$this, 'normalizeRow'], $statement->fetchAllAssociative());
    }

    /**
     * @return array<string, int|float>
     */
    public function summarize(?string $tenantCode = null): array
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $row = $this->connection->fetchAssociative(
            sprintf(
                <<<SQL
                SELECT
                    COUNT(1) AS total_owners,
                    SUM(CASE WHEN publish_status = 'ready' THEN 1 ELSE 0 END) AS ready_owners,
                    SUM(CASE WHEN publish_status = 'blocked' THEN 1 ELSE 0 END) AS blocked_owners,
                    SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS approved_owners,
                    SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END) AS pending_owners,
                    SUM(CASE WHEN approval_status = 'rejected' THEN 1 ELSE 0 END) AS rejected_owners,
                    AVG(completeness_score) AS average_completeness,
                    SUM(blocker_count) AS total_blockers
                FROM %s
                WHERE tenant_code = :tenant_code
                SQL,
                self::TABLE_NAME
            ),
            ['tenant_code' => $tenantCode]
        );

        return [
            'total_owners' => max(0, (int) ($row['total_owners'] ?? 0)),
            'ready_owners' => max(0, (int) ($row['ready_owners'] ?? 0)),
            'blocked_owners' => max(0, (int) ($row['blocked_owners'] ?? 0)),
            'approved_owners' => max(0, (int) ($row['approved_owners'] ?? 0)),
            'pending_owners' => max(0, (int) ($row['pending_owners'] ?? 0)),
            'rejected_owners' => max(0, (int) ($row['rejected_owners'] ?? 0)),
            'average_completeness' => round((float) ($row['average_completeness'] ?? 0), 2),
            'total_blockers' => max(0, (int) ($row['total_blockers'] ?? 0)),
        ];
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
