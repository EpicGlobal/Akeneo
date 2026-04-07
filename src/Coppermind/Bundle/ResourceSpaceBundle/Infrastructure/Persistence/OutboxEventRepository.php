<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence;

use Coppermind\Bundle\ResourceSpaceBundle\Domain\OutboxStatus;
use Doctrine\DBAL\Connection;

final class OutboxEventRepository
{
    private const TABLE_NAME = 'coppermind_outbox_event';
    private const DEFAULT_TENANT_CODE = 'default';
    private const MAX_ERROR_LENGTH = 2000;

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function schedule(
        string $eventType,
        string $ownerType,
        string $ownerId,
        array $payload,
        ?string $tenantCode = null,
        ?string $dedupeKey = null,
    ): void {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $eventType = substr(trim($eventType), 0, 100);
        if ('' === $eventType) {
            return;
        }

        $dedupeKey = '' !== trim((string) $dedupeKey)
            ? substr(trim((string) $dedupeKey), 0, 255)
            : $this->defaultDedupeKey($tenantCode, $eventType, $ownerType, $ownerId);

        $now = $this->now();

        $this->connection->executeStatement(
            sprintf(
                <<<SQL
                INSERT INTO %s (
                    tenant_code, event_type, owner_type, owner_id, dedupe_key, payload_json,
                    status, attempt_count, available_at, processed_at, last_error, created_at, updated_at
                ) VALUES (
                    :tenant_code, :event_type, :owner_type, :owner_id, :dedupe_key, :payload_json,
                    :status, 0, :available_at, NULL, NULL, :created_at, :updated_at
                )
                ON DUPLICATE KEY UPDATE
                    payload_json = VALUES(payload_json),
                    status = VALUES(status),
                    available_at = VALUES(available_at),
                    processed_at = VALUES(processed_at),
                    last_error = VALUES(last_error),
                    updated_at = VALUES(updated_at)
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'event_type' => $eventType,
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
                'dedupe_key' => $dedupeKey,
                'payload_json' => json_encode($payload, JSON_THROW_ON_ERROR),
                'status' => OutboxStatus::PENDING,
                'available_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]
        );
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function findEventsToPublish(int $limit, bool $retryFailed, ?string $tenantCode = null): array
    {
        $statuses = [OutboxStatus::PENDING];
        if ($retryFailed) {
            $statuses[] = OutboxStatus::FAILED;
        }

        $parameters = [];
        $placeholders = [];

        foreach ($statuses as $index => $status) {
            $parameter = sprintf('status_%d', $index);
            $parameters[$parameter] = $status;
            $placeholders[] = sprintf(':%s', $parameter);
        }

        $tenantCode = $this->normalizeOptionalTenantCode($tenantCode);
        $tenantSql = '';
        if (null !== $tenantCode) {
            $tenantSql = 'AND tenant_code = :tenant_code';
            $parameters['tenant_code'] = $tenantCode;
        }

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT id, tenant_code, event_type, owner_type, owner_id, dedupe_key, payload_json,
                       status, attempt_count, available_at, processed_at, last_error, created_at, updated_at
                FROM %s
                WHERE status IN (%s) %s
                ORDER BY
                    CASE status
                        WHEN '%s' THEN 0
                        WHEN '%s' THEN 1
                        ELSE 2
                    END,
                    available_at ASC,
                    id ASC
                LIMIT %d
                SQL,
                self::TABLE_NAME,
                implode(', ', $placeholders),
                $tenantSql,
                OutboxStatus::PENDING,
                OutboxStatus::FAILED,
                max(1, $limit)
            ),
            $parameters
        );

        return array_map([$this, 'normalizeRow'], $statement->fetchAllAssociative());
    }

    public function markAttempted(int $id): void
    {
        $this->connection->executeStatement(
            sprintf(
                'UPDATE %s SET attempt_count = attempt_count + 1, updated_at = :updated_at WHERE id = :id',
                self::TABLE_NAME
            ),
            [
                'id' => $id,
                'updated_at' => $this->now(),
            ]
        );
    }

    public function markSucceeded(int $id): void
    {
        $this->connection->update(self::TABLE_NAME, [
            'status' => OutboxStatus::SUCCEEDED,
            'processed_at' => $this->now(),
            'last_error' => null,
            'updated_at' => $this->now(),
        ], ['id' => $id]);
    }

    public function markFailed(int $id, string $error): void
    {
        $this->connection->update(self::TABLE_NAME, [
            'status' => OutboxStatus::FAILED,
            'processed_at' => null,
            'last_error' => substr(trim($error), 0, self::MAX_ERROR_LENGTH),
            'updated_at' => $this->now(),
        ], ['id' => $id]);
    }

    public function countPendingByOwner(string $ownerType, string $ownerId, ?string $tenantCode = null): int
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);

        return (int) $this->connection->fetchOne(
            sprintf(
                <<<SQL
                SELECT COUNT(1)
                FROM %s
                WHERE tenant_code = :tenant_code
                    AND owner_type = :owner_type
                    AND owner_id = :owner_id
                    AND status IN (:pending_status, :failed_status)
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
                'pending_status' => OutboxStatus::PENDING,
                'failed_status' => OutboxStatus::FAILED,
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
            'id' => (int) ($row['id'] ?? 0),
            'tenant_code' => (string) ($row['tenant_code'] ?? self::DEFAULT_TENANT_CODE),
            'event_type' => (string) ($row['event_type'] ?? ''),
            'owner_type' => (string) ($row['owner_type'] ?? ''),
            'owner_id' => (string) ($row['owner_id'] ?? ''),
            'dedupe_key' => (string) ($row['dedupe_key'] ?? ''),
            'payload' => $this->decodeJson($row['payload_json'] ?? null),
            'status' => (string) ($row['status'] ?? OutboxStatus::PENDING),
            'attempt_count' => (int) ($row['attempt_count'] ?? 0),
            'available_at' => null !== $row['available_at'] ? (string) $row['available_at'] : null,
            'processed_at' => null !== $row['processed_at'] ? (string) $row['processed_at'] : null,
            'error' => null !== $row['last_error'] ? (string) $row['last_error'] : null,
            'created_at' => null !== $row['created_at'] ? (string) $row['created_at'] : null,
            'updated_at' => null !== $row['updated_at'] ? (string) $row['updated_at'] : null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeJson(mixed $value): array
    {
        if (!\is_string($value) || '' === trim($value)) {
            return [];
        }

        $decoded = json_decode($value, true);

        return \is_array($decoded) ? $decoded : [];
    }

    private function defaultDedupeKey(string $tenantCode, string $eventType, string $ownerType, string $ownerId): string
    {
        return substr(sprintf('%s:%s:%s:%s', $tenantCode, $eventType, $ownerType, $ownerId), 0, 255);
    }

    private function normalizeTenantCode(?string $tenantCode): string
    {
        $tenantCode = strtolower(trim((string) $tenantCode));

        return '' !== $tenantCode ? substr($tenantCode, 0, 64) : self::DEFAULT_TENANT_CODE;
    }

    private function normalizeOptionalTenantCode(?string $tenantCode): ?string
    {
        $tenantCode = strtolower(trim((string) $tenantCode));

        return '' !== $tenantCode ? substr($tenantCode, 0, 64) : null;
    }

    private function now(): string
    {
        return (new \DateTimeImmutable())->format('Y-m-d H:i:s');
    }
}
