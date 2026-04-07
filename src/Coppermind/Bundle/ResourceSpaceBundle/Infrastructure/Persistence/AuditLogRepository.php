<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence;

use Doctrine\DBAL\Connection;

final class AuditLogRepository
{
    private const TABLE_NAME = 'coppermind_audit_log';
    private const DEFAULT_TENANT_CODE = 'default';

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @param array<string, mixed> $context
     */
    public function record(
        string $actionCode,
        string $subjectType,
        string $subjectId,
        array $context = [],
        ?int $actorUserId = null,
        ?string $actorIdentifier = null,
        ?string $tenantCode = null,
    ): void {
        $tenantCode = $this->normalizeTenantCode($tenantCode);

        $this->connection->insert(self::TABLE_NAME, [
            'tenant_code' => $tenantCode,
            'actor_user_id' => $actorUserId,
            'actor_identifier' => trim((string) $actorIdentifier),
            'action_code' => substr(trim($actionCode), 0, 100),
            'subject_type' => substr(trim($subjectType), 0, 64),
            'subject_id' => substr(trim($subjectId), 0, 191),
            'context_json' => [] !== $context ? json_encode($context, JSON_THROW_ON_ERROR) : null,
            'created_at' => $this->now(),
        ]);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function findBySubject(string $subjectType, string $subjectId, int $limit = 12, ?string $tenantCode = null): array
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT id, tenant_code, actor_user_id, actor_identifier, action_code, subject_type, subject_id, context_json, created_at
                FROM %s
                WHERE tenant_code = :tenant_code AND subject_type = :subject_type AND subject_id = :subject_id
                ORDER BY created_at DESC, id DESC
                LIMIT %d
                SQL,
                self::TABLE_NAME,
                max(1, $limit)
            ),
            [
                'tenant_code' => $tenantCode,
                'subject_type' => $subjectType,
                'subject_id' => $subjectId,
            ]
        );

        return array_map([$this, 'normalizeRow'], $statement->fetchAllAssociative());
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
            'actor_user_id' => null !== $row['actor_user_id'] ? (int) $row['actor_user_id'] : null,
            'actor_identifier' => (string) ($row['actor_identifier'] ?? ''),
            'action_code' => (string) ($row['action_code'] ?? ''),
            'subject_type' => (string) ($row['subject_type'] ?? ''),
            'subject_id' => (string) ($row['subject_id'] ?? ''),
            'context' => $this->decodeJson($row['context_json'] ?? null),
            'created_at' => null !== $row['created_at'] ? (string) $row['created_at'] : null,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function decodeJson(mixed $value): ?array
    {
        if (!\is_string($value) || '' === trim($value)) {
            return null;
        }

        $decoded = json_decode($value, true);

        return \is_array($decoded) ? $decoded : null;
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
