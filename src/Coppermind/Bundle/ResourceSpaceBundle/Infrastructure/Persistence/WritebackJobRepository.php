<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence;

use Coppermind\Bundle\ResourceSpaceBundle\Domain\WritebackStatus;
use Doctrine\DBAL\Connection;

final class WritebackJobRepository
{
    private const TABLE_NAME = 'coppermind_resourcespace_writeback_job';
    private const MAX_ERROR_LENGTH = 2000;
    private const DEFAULT_TENANT_CODE = 'default';

    public function __construct(private readonly Connection $connection)
    {
    }

    public function schedule(int $resourceRef, ?string $tenantCode = null): void
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        if ($resourceRef <= 0) {
            return;
        }

        $this->connection->executeStatement(
            sprintf(
                <<<SQL
                INSERT INTO %s (
                    tenant_code, resource_ref, status, last_error, attempt_count, requested_at, attempted_at, processed_at
                ) VALUES (
                    :tenant_code, :resource_ref, :status, NULL, 0, :requested_at, NULL, NULL
                )
                ON DUPLICATE KEY UPDATE
                    status = VALUES(status),
                    last_error = VALUES(last_error),
                    requested_at = VALUES(requested_at),
                    attempted_at = VALUES(attempted_at),
                    processed_at = VALUES(processed_at)
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'resource_ref' => $resourceRef,
                'status' => WritebackStatus::PENDING,
                'requested_at' => $this->now(),
            ]
        );
    }

    public function markAttempted(int $resourceRef, ?string $tenantCode = null): void
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);

        $this->connection->executeStatement(
            sprintf(
                <<<SQL
                UPDATE %s
                SET attempted_at = :attempted_at, attempt_count = attempt_count + 1
                WHERE tenant_code = :tenant_code AND resource_ref = :resource_ref
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'resource_ref' => $resourceRef,
                'attempted_at' => $this->now(),
            ]
        );
    }

    public function markSucceeded(int $resourceRef, ?string $tenantCode = null): void
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);

        $this->connection->update(
            self::TABLE_NAME,
            [
                'status' => WritebackStatus::SUCCEEDED,
                'last_error' => null,
                'processed_at' => $this->now(),
            ],
            [
                'tenant_code' => $tenantCode,
                'resource_ref' => $resourceRef,
            ]
        );
    }

    public function markFailed(int $resourceRef, string $error, ?string $tenantCode = null): void
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);

        $this->connection->update(
            self::TABLE_NAME,
            [
                'status' => WritebackStatus::FAILED,
                'last_error' => $this->truncateError($error),
                'processed_at' => null,
            ],
            [
                'tenant_code' => $tenantCode,
                'resource_ref' => $resourceRef,
            ]
        );
    }

    public function markSkipped(int $resourceRef, string $message, ?string $tenantCode = null): void
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);

        $this->connection->update(
            self::TABLE_NAME,
            [
                'status' => WritebackStatus::SKIPPED,
                'last_error' => $this->truncateError($message),
                'processed_at' => $this->now(),
            ],
            [
                'tenant_code' => $tenantCode,
                'resource_ref' => $resourceRef,
            ]
        );
    }

    /**
     * @param array<int, int> $resourceRefs
     *
     * @return array<int, array<string, mixed>>
     */
    public function getStatusMap(array $resourceRefs, ?string $tenantCode = null): array
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $resourceRefs = $this->normalizeResourceRefs($resourceRefs);
        if ([] === $resourceRefs) {
            return [];
        }

        $parameters = ['tenant_code' => $tenantCode];
        $placeholders = [];

        foreach ($resourceRefs as $index => $resourceRef) {
            $parameter = sprintf('resource_ref_%d', $index);
            $placeholders[] = sprintf(':%s', $parameter);
            $parameters[$parameter] = $resourceRef;
        }

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT tenant_code, resource_ref, status, last_error, attempt_count, requested_at, attempted_at, processed_at
                FROM %s
                WHERE tenant_code = :tenant_code AND resource_ref IN (%s)
                SQL,
                self::TABLE_NAME,
                implode(', ', $placeholders)
            ),
            $parameters
        );

        $statusMap = [];
        foreach ($statement->fetchAllAssociative() as $row) {
            $statusMap[(int) $row['resource_ref']] = $this->normalizeRow($row);
        }

        return $statusMap;
    }

    /**
     * @return array<int, array{tenant_code:string,resource_ref:int}>
     */
    public function findJobsToProcess(int $limit, bool $retryFailed, ?string $tenantCode = null): array
    {
        $statuses = [WritebackStatus::PENDING];
        if ($retryFailed) {
            $statuses[] = WritebackStatus::FAILED;
        }

        $parameters = [];
        $placeholders = [];

        foreach ($statuses as $index => $status) {
            $parameter = sprintf('status_%d', $index);
            $placeholders[] = sprintf(':%s', $parameter);
            $parameters[$parameter] = $status;
        }

        $tenantSql = '';
        $tenantCode = $this->normalizeOptionalTenantCode($tenantCode);
        if (null !== $tenantCode) {
            $tenantSql = 'AND tenant_code = :tenant_code';
            $parameters['tenant_code'] = $tenantCode;
        }

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT tenant_code, resource_ref
                FROM %s
                WHERE status IN (%s) %s
                ORDER BY
                    CASE status
                        WHEN '%s' THEN 0
                        WHEN '%s' THEN 1
                        ELSE 2
                    END,
                    requested_at ASC
                LIMIT %d
                SQL,
                self::TABLE_NAME,
                implode(', ', $placeholders),
                $tenantSql,
                WritebackStatus::PENDING,
                WritebackStatus::FAILED,
                max(1, $limit)
            ),
            $parameters
        );

        return array_map(function (array $row): array {
            return [
                'tenant_code' => (string) ($row['tenant_code'] ?? self::DEFAULT_TENANT_CODE),
                'resource_ref' => (int) $row['resource_ref'],
            ];
        }, $statement->fetchAllAssociative());
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

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    private function normalizeRow(array $row): array
    {
        return [
            'tenant_code' => (string) ($row['tenant_code'] ?? self::DEFAULT_TENANT_CODE),
            'status' => (string) $row['status'],
            'error' => null !== $row['last_error'] ? (string) $row['last_error'] : null,
            'attempt_count' => (int) $row['attempt_count'],
            'requested_at' => null !== $row['requested_at'] ? (string) $row['requested_at'] : null,
            'attempted_at' => null !== $row['attempted_at'] ? (string) $row['attempted_at'] : null,
            'processed_at' => null !== $row['processed_at'] ? (string) $row['processed_at'] : null,
        ];
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

    private function truncateError(string $error): string
    {
        return substr(trim($error), 0, self::MAX_ERROR_LENGTH);
    }
}
