<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence;

use Coppermind\Bundle\ResourceSpaceBundle\Domain\ApprovalStatus;
use Doctrine\DBAL\Connection;

final class GovernanceApprovalRepository
{
    private const TABLE_NAME = 'coppermind_governance_approval';
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
                SELECT tenant_code, owner_type, owner_id, stage_code, status, comment_text, requested_at,
                       approved_at, approved_by, rejected_at, rejected_by, updated_at
                FROM %s
                WHERE tenant_code = :tenant_code AND owner_type = :owner_type AND owner_id = :owner_id
                ORDER BY stage_code ASC
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
     * @param array<int, string> $statuses
     *
     * @return array<int, array<string, mixed>>
     */
    public function listByStatuses(array $statuses, int $limit = 100, ?string $tenantCode = null): array
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $statuses = array_values(array_unique(array_filter(array_map(
            static fn (string $status): string => trim($status),
            $statuses
        ))));

        if ([] === $statuses) {
            return [];
        }

        $parameters = ['tenant_code' => $tenantCode];
        $placeholders = [];

        foreach ($statuses as $index => $status) {
            $parameter = sprintf('status_%d', $index);
            $parameters[$parameter] = substr($status, 0, 32);
            $placeholders[] = sprintf(':%s', $parameter);
        }

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT tenant_code, owner_type, owner_id, stage_code, status, comment_text, requested_at,
                       approved_at, approved_by, rejected_at, rejected_by, updated_at
                FROM %s
                WHERE tenant_code = :tenant_code AND status IN (%s)
                ORDER BY
                    CASE status
                        WHEN 'pending' THEN 0
                        WHEN 'rejected' THEN 1
                        ELSE 2
                    END,
                    updated_at DESC,
                    stage_code ASC
                LIMIT %d
                SQL,
                self::TABLE_NAME,
                implode(', ', $placeholders),
                max(1, $limit)
            ),
            $parameters
        );

        return array_map([$this, 'normalizeRow'], $statement->fetchAllAssociative());
    }

    public function requestStage(
        string $ownerType,
        string $ownerId,
        string $stageCode,
        ?string $comment = null,
        ?int $requestedBy = null,
        ?string $tenantCode = null,
    ): void {
        $this->upsertStage($ownerType, $ownerId, $stageCode, ApprovalStatus::PENDING, $comment, $requestedBy, $tenantCode);
    }

    public function approveStage(
        string $ownerType,
        string $ownerId,
        string $stageCode,
        ?string $comment = null,
        ?int $approvedBy = null,
        ?string $tenantCode = null,
    ): void {
        $this->upsertStage($ownerType, $ownerId, $stageCode, ApprovalStatus::APPROVED, $comment, $approvedBy, $tenantCode);
    }

    public function rejectStage(
        string $ownerType,
        string $ownerId,
        string $stageCode,
        ?string $comment = null,
        ?int $rejectedBy = null,
        ?string $tenantCode = null,
    ): void {
        $this->upsertStage($ownerType, $ownerId, $stageCode, ApprovalStatus::REJECTED, $comment, $rejectedBy, $tenantCode);
    }

    private function upsertStage(
        string $ownerType,
        string $ownerId,
        string $stageCode,
        string $status,
        ?string $comment,
        ?int $actorUserId,
        ?string $tenantCode,
    ): void {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $stageCode = substr(trim($stageCode), 0, 100);
        if ('' === $stageCode) {
            return;
        }

        $requestedAt = ApprovalStatus::PENDING === $status ? $this->now() : null;
        $approvedAt = ApprovalStatus::APPROVED === $status ? $this->now() : null;
        $rejectedAt = ApprovalStatus::REJECTED === $status ? $this->now() : null;

        $this->connection->executeStatement(
            sprintf(
                <<<SQL
                INSERT INTO %s (
                    tenant_code, owner_type, owner_id, stage_code, status, comment_text, requested_at,
                    approved_at, approved_by, rejected_at, rejected_by, updated_at
                ) VALUES (
                    :tenant_code, :owner_type, :owner_id, :stage_code, :status, :comment_text, :requested_at,
                    :approved_at, :approved_by, :rejected_at, :rejected_by, :updated_at
                )
                ON DUPLICATE KEY UPDATE
                    status = VALUES(status),
                    comment_text = VALUES(comment_text),
                    requested_at = VALUES(requested_at),
                    approved_at = VALUES(approved_at),
                    approved_by = VALUES(approved_by),
                    rejected_at = VALUES(rejected_at),
                    rejected_by = VALUES(rejected_by),
                    updated_at = VALUES(updated_at)
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
                'stage_code' => $stageCode,
                'status' => $status,
                'comment_text' => $this->normalizeComment($comment),
                'requested_at' => $requestedAt,
                'approved_at' => $approvedAt,
                'approved_by' => ApprovalStatus::APPROVED === $status ? $actorUserId : null,
                'rejected_at' => $rejectedAt,
                'rejected_by' => ApprovalStatus::REJECTED === $status ? $actorUserId : null,
                'updated_at' => $this->now(),
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
            'owner_type' => (string) ($row['owner_type'] ?? ''),
            'owner_id' => (string) ($row['owner_id'] ?? ''),
            'stage_code' => (string) ($row['stage_code'] ?? ''),
            'status' => (string) ($row['status'] ?? ApprovalStatus::NOT_REQUESTED),
            'comment' => null !== $row['comment_text'] ? (string) $row['comment_text'] : null,
            'requested_at' => null !== $row['requested_at'] ? (string) $row['requested_at'] : null,
            'approved_at' => null !== $row['approved_at'] ? (string) $row['approved_at'] : null,
            'approved_by' => null !== $row['approved_by'] ? (int) $row['approved_by'] : null,
            'rejected_at' => null !== $row['rejected_at'] ? (string) $row['rejected_at'] : null,
            'rejected_by' => null !== $row['rejected_by'] ? (int) $row['rejected_by'] : null,
            'updated_at' => null !== $row['updated_at'] ? (string) $row['updated_at'] : null,
        ];
    }

    private function normalizeTenantCode(?string $tenantCode): string
    {
        $tenantCode = strtolower(trim((string) $tenantCode));

        return '' !== $tenantCode ? substr($tenantCode, 0, 64) : self::DEFAULT_TENANT_CODE;
    }

    private function normalizeComment(?string $comment): ?string
    {
        $comment = trim((string) $comment);

        return '' !== $comment ? substr($comment, 0, 1000) : null;
    }

    private function now(): string
    {
        return (new \DateTimeImmutable())->format('Y-m-d H:i:s');
    }
}
