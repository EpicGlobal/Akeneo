<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence;

use Coppermind\Bundle\ResourceSpaceBundle\Domain\MediaIngestStatus;
use Doctrine\DBAL\Connection;

final class MediaIngestJobRepository
{
    private const TABLE_NAME = 'coppermind_resourcespace_media_ingest_job';
    private const DEFAULT_TENANT_CODE = 'default';
    private const MAX_ERROR_LENGTH = 2000;

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function schedule(
        string $ownerType,
        string $ownerId,
        int $resourceRef,
        string $attributeCode,
        ?string $localeCode = null,
        ?string $scopeCode = null,
        ?int $requestedBy = null,
        ?string $tenantCode = null,
    ): array {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $attributeCode = trim($attributeCode);
        if ($resourceRef <= 0 || '' === $attributeCode) {
            throw new \RuntimeException('A ResourceSpace ingest job requires a valid resource reference and attribute code.');
        }

        $queueKey = $this->buildQueueKey($tenantCode, $ownerType, $ownerId, $resourceRef, $attributeCode, $localeCode, $scopeCode);
        $requestedAt = $this->now();

        $this->connection->executeStatement(
            sprintf(
                <<<SQL
                INSERT INTO %s (
                    queue_key, tenant_code, owner_type, owner_id, resource_ref, attribute_code, locale_code, scope_code,
                    status, last_error, attempt_count, requested_by, requested_at, attempted_at, processed_at, file_key
                ) VALUES (
                    :queue_key, :tenant_code, :owner_type, :owner_id, :resource_ref, :attribute_code, :locale_code, :scope_code,
                    :status, NULL, 0, :requested_by, :requested_at, NULL, NULL, NULL
                )
                ON DUPLICATE KEY UPDATE
                    status = VALUES(status),
                    last_error = VALUES(last_error),
                    requested_by = VALUES(requested_by),
                    requested_at = VALUES(requested_at),
                    attempted_at = VALUES(attempted_at),
                    processed_at = VALUES(processed_at),
                    file_key = VALUES(file_key)
                SQL,
                self::TABLE_NAME
            ),
            [
                'queue_key' => $queueKey,
                'tenant_code' => $tenantCode,
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
                'resource_ref' => $resourceRef,
                'attribute_code' => $attributeCode,
                'locale_code' => $this->normalizeNullable($localeCode, 25),
                'scope_code' => $this->normalizeNullable($scopeCode, 100),
                'status' => MediaIngestStatus::PENDING,
                'requested_by' => $requestedBy,
                'requested_at' => $requestedAt,
            ]
        );

        $row = $this->findByQueueKey($queueKey);
        if (null === $row) {
            throw new \RuntimeException('The ResourceSpace ingest job could not be queued.');
        }

        return $row;
    }

    /**
     * @param array<int, int> $resourceRefs
     *
     * @return array<int, array<string, mixed>>
     */
    public function getLatestStatusMap(
        string $ownerType,
        string $ownerId,
        array $resourceRefs,
        ?string $tenantCode = null,
    ): array {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $resourceRefs = $this->normalizeResourceRefs($resourceRefs);
        if ([] === $resourceRefs) {
            return [];
        }

        $parameters = [
            'tenant_code' => $tenantCode,
            'owner_type' => $ownerType,
            'owner_id' => $ownerId,
        ];
        $placeholders = [];

        foreach ($resourceRefs as $index => $resourceRef) {
            $parameter = sprintf('resource_ref_%d', $index);
            $parameters[$parameter] = $resourceRef;
            $placeholders[] = sprintf(':%s', $parameter);
        }

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT id, queue_key, tenant_code, owner_type, owner_id, resource_ref, attribute_code, locale_code, scope_code,
                       status, last_error, attempt_count, requested_by, requested_at, attempted_at, processed_at, file_key
                FROM %s
                WHERE tenant_code = :tenant_code
                    AND owner_type = :owner_type
                    AND owner_id = :owner_id
                    AND resource_ref IN (%s)
                ORDER BY requested_at DESC, id DESC
                SQL,
                self::TABLE_NAME,
                implode(', ', $placeholders)
            ),
            $parameters
        );

        $statusMap = [];
        foreach ($statement->fetchAllAssociative() as $row) {
            $resourceRef = (int) $row['resource_ref'];
            if (isset($statusMap[$resourceRef])) {
                continue;
            }

            $statusMap[$resourceRef] = $this->normalizeRow($row);
        }

        return $statusMap;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function findJobsToProcess(int $limit, bool $retryFailed, ?string $tenantCode = null): array
    {
        $statuses = [MediaIngestStatus::PENDING];
        if ($retryFailed) {
            $statuses[] = MediaIngestStatus::FAILED;
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
                SELECT id, queue_key, tenant_code, owner_type, owner_id, resource_ref, attribute_code, locale_code, scope_code,
                       status, last_error, attempt_count, requested_by, requested_at, attempted_at, processed_at, file_key
                FROM %s
                WHERE status IN (%s) %s
                ORDER BY
                    CASE status
                        WHEN '%s' THEN 0
                        WHEN '%s' THEN 1
                        ELSE 2
                    END,
                    requested_at ASC,
                    id ASC
                LIMIT %d
                SQL,
                self::TABLE_NAME,
                implode(', ', $placeholders),
                $tenantSql,
                MediaIngestStatus::PENDING,
                MediaIngestStatus::FAILED,
                max(1, $limit)
            ),
            $parameters
        );

        return array_map([$this, 'normalizeRow'], $statement->fetchAllAssociative());
    }

    public function markAttempted(int $jobId): void
    {
        $this->connection->executeStatement(
            sprintf(
                'UPDATE %s SET attempted_at = :attempted_at, attempt_count = attempt_count + 1 WHERE id = :id',
                self::TABLE_NAME
            ),
            [
                'id' => $jobId,
                'attempted_at' => $this->now(),
            ]
        );
    }

    public function markSucceeded(int $jobId, string $fileKey): void
    {
        $this->connection->update(self::TABLE_NAME, [
            'status' => MediaIngestStatus::SUCCEEDED,
            'last_error' => null,
            'processed_at' => $this->now(),
            'file_key' => substr(trim($fileKey), 0, 255),
        ], ['id' => $jobId]);
    }

    public function markFailed(int $jobId, string $error): void
    {
        $this->connection->update(self::TABLE_NAME, [
            'status' => MediaIngestStatus::FAILED,
            'last_error' => substr(trim($error), 0, self::MAX_ERROR_LENGTH),
            'processed_at' => null,
        ], ['id' => $jobId]);
    }

    public function countActiveByOwner(string $ownerType, string $ownerId, ?string $tenantCode = null): int
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
                'pending_status' => MediaIngestStatus::PENDING,
                'failed_status' => MediaIngestStatus::FAILED,
            ]
        );
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function listJobs(
        int $limit = 50,
        ?string $tenantCode = null,
        ?string $status = null,
        ?string $ownerType = null,
    ): array {
        $where = [];
        $parameters = [];
        $tenantCode = $this->normalizeOptionalTenantCode($tenantCode);

        if (null !== $tenantCode) {
            $where[] = 'tenant_code = :tenant_code';
            $parameters['tenant_code'] = $tenantCode;
        }

        $status = trim((string) $status);
        if ('' !== $status) {
            $where[] = 'status = :status';
            $parameters['status'] = substr($status, 0, 32);
        }

        $ownerType = trim((string) $ownerType);
        if ('' !== $ownerType) {
            $where[] = 'owner_type = :owner_type';
            $parameters['owner_type'] = substr($ownerType, 0, 32);
        }

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT id, queue_key, tenant_code, owner_type, owner_id, resource_ref, attribute_code, locale_code, scope_code,
                       status, last_error, attempt_count, requested_by, requested_at, attempted_at, processed_at, file_key
                FROM %s
                %s
                ORDER BY requested_at DESC, id DESC
                LIMIT %d
                SQL,
                self::TABLE_NAME,
                [] !== $where ? 'WHERE ' . implode(' AND ', $where) : '',
                max(1, $limit)
            ),
            $parameters
        );

        return array_map([$this, 'normalizeRow'], $statement->fetchAllAssociative());
    }

    /**
     * @return array<string, int>
     */
    public function summarizeByStatus(?string $tenantCode = null): array
    {
        $tenantCode = $this->normalizeOptionalTenantCode($tenantCode);
        $parameters = [];
        $where = '';

        if (null !== $tenantCode) {
            $where = 'WHERE tenant_code = :tenant_code';
            $parameters['tenant_code'] = $tenantCode;
        }

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT status, COUNT(1) AS status_count
                FROM %s
                %s
                GROUP BY status
                SQL,
                self::TABLE_NAME,
                $where
            ),
            $parameters
        );

        $summary = [];
        foreach ($statement->fetchAllAssociative() as $row) {
            $summary[(string) ($row['status'] ?? 'unknown')] = max(0, (int) ($row['status_count'] ?? 0));
        }

        return $summary;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findByQueueKey(string $queueKey): ?array
    {
        $row = $this->connection->fetchAssociative(
            sprintf(
                <<<SQL
                SELECT id, queue_key, tenant_code, owner_type, owner_id, resource_ref, attribute_code, locale_code, scope_code,
                       status, last_error, attempt_count, requested_by, requested_at, attempted_at, processed_at, file_key
                FROM %s
                WHERE queue_key = :queue_key
                LIMIT 1
                SQL,
                self::TABLE_NAME
            ),
            ['queue_key' => $queueKey]
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
            'id' => (int) ($row['id'] ?? 0),
            'queue_key' => (string) ($row['queue_key'] ?? ''),
            'tenant_code' => (string) ($row['tenant_code'] ?? self::DEFAULT_TENANT_CODE),
            'owner_type' => (string) ($row['owner_type'] ?? ''),
            'owner_id' => (string) ($row['owner_id'] ?? ''),
            'resource_ref' => (int) ($row['resource_ref'] ?? 0),
            'attribute_code' => (string) ($row['attribute_code'] ?? ''),
            'locale_code' => null !== $row['locale_code'] ? (string) $row['locale_code'] : null,
            'scope_code' => null !== $row['scope_code'] ? (string) $row['scope_code'] : null,
            'status' => (string) ($row['status'] ?? MediaIngestStatus::PENDING),
            'error' => null !== $row['last_error'] ? (string) $row['last_error'] : null,
            'attempt_count' => (int) ($row['attempt_count'] ?? 0),
            'requested_by' => null !== $row['requested_by'] ? (int) $row['requested_by'] : null,
            'requested_at' => null !== $row['requested_at'] ? (string) $row['requested_at'] : null,
            'attempted_at' => null !== $row['attempted_at'] ? (string) $row['attempted_at'] : null,
            'processed_at' => null !== $row['processed_at'] ? (string) $row['processed_at'] : null,
            'file_key' => null !== $row['file_key'] ? (string) $row['file_key'] : null,
        ];
    }

    /**
     * @param array<int, mixed> $resourceRefs
     *
     * @return array<int, int>
     */
    private function normalizeResourceRefs(array $resourceRefs): array
    {
        return array_values(array_unique(array_filter(
            array_map(static fn (mixed $resourceRef): int => (int) $resourceRef, $resourceRefs),
            static fn (int $resourceRef): bool => $resourceRef > 0
        )));
    }

    private function buildQueueKey(
        string $tenantCode,
        string $ownerType,
        string $ownerId,
        int $resourceRef,
        string $attributeCode,
        ?string $localeCode,
        ?string $scopeCode,
    ): string {
        return implode(':', [
            $tenantCode,
            $ownerType,
            $ownerId,
            $resourceRef,
            $attributeCode,
            $this->normalizeNullable($localeCode, 25) ?? '<all_locales>',
            $this->normalizeNullable($scopeCode, 100) ?? '<all_scopes>',
        ]);
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

    private function normalizeNullable(?string $value, int $maxLength): ?string
    {
        $value = trim((string) $value);

        return '' !== $value ? substr($value, 0, $maxLength) : null;
    }

    private function now(): string
    {
        return (new \DateTimeImmutable())->format('Y-m-d H:i:s');
    }
}
