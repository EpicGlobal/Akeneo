<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence;

use Doctrine\DBAL\Connection;

final class AssetMetadataRepository
{
    private const TABLE_NAME = 'coppermind_resourcespace_asset_metadata';
    private const DEFAULT_TENANT_CODE = 'default';

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @param array<int, int> $resourceRefs
     *
     * @return array<int, array<string, mixed>>
     */
    public function findByResourceRefs(array $resourceRefs, ?string $tenantCode = null): array
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
            $parameters[$parameter] = $resourceRef;
            $placeholders[] = sprintf(':%s', $parameter);
        }

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT tenant_code, resource_ref, rights_status, license_code, expires_at, rendition_key,
                       derivative_of_resource_ref, metadata_json, updated_at
                FROM %s
                WHERE tenant_code = :tenant_code AND resource_ref IN (%s)
                SQL,
                self::TABLE_NAME,
                implode(', ', $placeholders)
            ),
            $parameters
        );

        $metadata = [];
        foreach ($statement->fetchAllAssociative() as $row) {
            $metadata[(int) $row['resource_ref']] = $this->normalizeRow($row);
        }

        return $metadata;
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function upsertFromPayload(int $resourceRef, array $payload, ?string $tenantCode = null): void
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        if ($resourceRef <= 0) {
            return;
        }

        $rightsStatus = $this->normalizeScalar($payload['rightsStatus'] ?? $payload['rights_status'] ?? null, 64);
        $licenseCode = $this->normalizeScalar($payload['licenseCode'] ?? $payload['license_code'] ?? null, 100);
        $renditionKey = $this->normalizeScalar($payload['renditionKey'] ?? $payload['rendition_key'] ?? null, 100);
        $expiresAt = $this->normalizeDateTime($payload['expiresAt'] ?? $payload['expires_at'] ?? null);
        $derivativeOf = (int) ($payload['derivativeOfResourceRef'] ?? $payload['derivative_of_resource_ref'] ?? 0);
        $metadata = $payload['assetMetadata'] ?? $payload['asset_metadata'] ?? null;

        if (
            '' === $rightsStatus
            && '' === $licenseCode
            && '' === $renditionKey
            && null === $expiresAt
            && $derivativeOf <= 0
            && !\is_array($metadata)
        ) {
            return;
        }

        $this->connection->executeStatement(
            sprintf(
                <<<SQL
                INSERT INTO %s (
                    tenant_code, resource_ref, rights_status, license_code, expires_at, rendition_key,
                    derivative_of_resource_ref, metadata_json, updated_at
                ) VALUES (
                    :tenant_code, :resource_ref, :rights_status, :license_code, :expires_at, :rendition_key,
                    :derivative_of_resource_ref, :metadata_json, :updated_at
                )
                ON DUPLICATE KEY UPDATE
                    rights_status = VALUES(rights_status),
                    license_code = VALUES(license_code),
                    expires_at = VALUES(expires_at),
                    rendition_key = VALUES(rendition_key),
                    derivative_of_resource_ref = VALUES(derivative_of_resource_ref),
                    metadata_json = VALUES(metadata_json),
                    updated_at = VALUES(updated_at)
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'resource_ref' => $resourceRef,
                'rights_status' => $rightsStatus,
                'license_code' => $licenseCode,
                'expires_at' => $expiresAt,
                'rendition_key' => $renditionKey,
                'derivative_of_resource_ref' => $derivativeOf > 0 ? $derivativeOf : null,
                'metadata_json' => \is_array($metadata) ? json_encode($metadata, JSON_THROW_ON_ERROR) : null,
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
            'resource_ref' => (int) ($row['resource_ref'] ?? 0),
            'rights_status' => (string) ($row['rights_status'] ?? ''),
            'license_code' => (string) ($row['license_code'] ?? ''),
            'expires_at' => null !== $row['expires_at'] ? (string) $row['expires_at'] : null,
            'rendition_key' => (string) ($row['rendition_key'] ?? ''),
            'derivative_of_resource_ref' => null !== $row['derivative_of_resource_ref']
                ? (int) $row['derivative_of_resource_ref']
                : null,
            'metadata' => $this->decodeJson($row['metadata_json'] ?? null),
            'updated_at' => null !== $row['updated_at'] ? (string) $row['updated_at'] : null,
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

    private function normalizeScalar(mixed $value, int $maxLength): string
    {
        $normalized = trim((string) $value);
        if ('' === $normalized) {
            return '';
        }

        return substr($normalized, 0, $maxLength);
    }

    private function normalizeDateTime(mixed $value): ?string
    {
        if (null === $value || '' === trim((string) $value)) {
            return null;
        }

        try {
            return (new \DateTimeImmutable((string) $value))->format('Y-m-d H:i:s');
        } catch (\Throwable) {
            return null;
        }
    }

    private function now(): string
    {
        return (new \DateTimeImmutable())->format('Y-m-d H:i:s');
    }
}
