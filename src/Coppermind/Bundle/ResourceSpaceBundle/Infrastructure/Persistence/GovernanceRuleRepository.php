<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence;

use Doctrine\DBAL\Connection;

final class GovernanceRuleRepository
{
    private const TABLE_NAME = 'coppermind_governance_rule';
    private const DEFAULT_TENANT_CODE = 'default';

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function findApplicableRules(string $ownerType, ?string $familyCode = null, ?string $tenantCode = null): array
    {
        $tenantCode = $this->normalizeTenantCode($tenantCode);
        $familyCode = trim((string) $familyCode);

        $statement = $this->connection->executeQuery(
            sprintf(
                <<<SQL
                SELECT tenant_code, rule_code, owner_type, family_code, target_code, label, channel_code, market_code, locale_code,
                       required_attributes_json, required_asset_roles_json, required_approvals_json, minimum_asset_count, enabled
                FROM %s
                WHERE tenant_code = :tenant_code
                    AND enabled = 1
                    AND owner_type IN (:owner_type, 'all')
                    AND (family_code = '' OR family_code = :family_code)
                ORDER BY
                    CASE WHEN family_code = :family_code AND family_code <> '' THEN 0 ELSE 1 END,
                    target_code ASC,
                    rule_code ASC
                SQL,
                self::TABLE_NAME
            ),
            [
                'tenant_code' => $tenantCode,
                'owner_type' => $ownerType,
                'family_code' => $familyCode,
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
            'tenant_code' => (string) ($row['tenant_code'] ?? self::DEFAULT_TENANT_CODE),
            'rule_code' => (string) ($row['rule_code'] ?? ''),
            'owner_type' => (string) ($row['owner_type'] ?? ''),
            'family_code' => (string) ($row['family_code'] ?? ''),
            'target_code' => (string) ($row['target_code'] ?? ''),
            'label' => (string) ($row['label'] ?? ''),
            'channel_code' => (string) ($row['channel_code'] ?? ''),
            'market_code' => (string) ($row['market_code'] ?? ''),
            'locale_code' => (string) ($row['locale_code'] ?? ''),
            'required_attributes' => $this->decodeStringArray($row['required_attributes_json'] ?? null),
            'required_asset_roles' => $this->decodeStringArray($row['required_asset_roles_json'] ?? null),
            'required_approvals' => $this->decodeStringArray($row['required_approvals_json'] ?? null),
            'minimum_asset_count' => max(0, (int) ($row['minimum_asset_count'] ?? 0)),
            'enabled' => (bool) ($row['enabled'] ?? false),
        ];
    }

    /**
     * @return array<int, string>
     */
    private function decodeStringArray(mixed $value): array
    {
        if (!\is_string($value) || '' === trim($value)) {
            return [];
        }

        $decoded = json_decode($value, true);
        if (!\is_array($decoded)) {
            return [];
        }

        return array_values(array_unique(array_filter(array_map(static fn (mixed $item): string => trim((string) $item), $decoded))));
    }

    private function normalizeTenantCode(?string $tenantCode): string
    {
        $tenantCode = strtolower(trim((string) $tenantCode));

        return '' !== $tenantCode ? substr($tenantCode, 0, 64) : self::DEFAULT_TENANT_CODE;
    }
}
