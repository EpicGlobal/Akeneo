<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\AssetLinkRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\AssetMetadataRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\AuditLogRepository;

final class AssetGovernanceService
{
    public function __construct(
        private readonly AssetMetadataRepository $assetMetadataRepository,
        private readonly AssetLinkRepository $assetLinkRepository,
        private readonly ProductLifecycleService $productLifecycleService,
        private readonly AuditLogRepository $auditLogRepository,
        private readonly ResourceSpaceOwnerResolver $ownerResolver,
        private readonly TenantContext $tenantContext,
    ) {
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function listComplianceItems(int $windowDays = 30, int $limit = 100, ?string $tenantCode = null): array
    {
        $tenantCode = $this->tenantContext->normalizeTenantCode($tenantCode);
        $items = [];

        foreach ($this->assetMetadataRepository->findComplianceQueue($windowDays, $limit, $tenantCode) as $metadata) {
            $items[] = $this->decorateMetadata($metadata, $tenantCode, $windowDays);
        }

        return $items;
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>
     */
    public function updateAssetMetadata(
        int $resourceRef,
        array $payload,
        ?int $actorUserId = null,
        ?string $actorIdentifier = null,
        ?string $tenantCode = null,
    ): array {
        $tenantCode = $this->tenantContext->normalizeTenantCode($tenantCode);
        if ($resourceRef <= 0) {
            throw new \RuntimeException('A valid ResourceSpace asset reference is required.');
        }

        $this->assetMetadataRepository->upsertFromPayload($resourceRef, $payload, $tenantCode);
        $metadata = $this->assetMetadataRepository->findByResourceRef($resourceRef, $tenantCode);
        if (null === $metadata) {
            throw new \RuntimeException(sprintf('ResourceSpace asset #%d metadata could not be loaded after update.', $resourceRef));
        }

        $context = [
            'resource_ref' => $resourceRef,
            'rights_status' => $metadata['rights_status'] ?? null,
            'license_code' => $metadata['license_code'] ?? null,
            'expires_at' => $metadata['expires_at'] ?? null,
            'rendition_key' => $metadata['rendition_key'] ?? null,
            'derivative_of_resource_ref' => $metadata['derivative_of_resource_ref'] ?? null,
        ];

        $this->auditLogRepository->record(
            'asset.metadata.updated',
            'asset',
            (string) $resourceRef,
            $context,
            $actorUserId,
            $actorIdentifier,
            $tenantCode
        );

        foreach ($this->assetLinkRepository->findByResourceRef($resourceRef, $tenantCode) as $link) {
            $this->productLifecycleService->syncOwnerStateAndQueueEvent(
                (string) $link['owner_type'],
                (string) $link['owner_id'],
                'asset.metadata.updated',
                $context,
                $actorUserId,
                $actorIdentifier,
                $tenantCode
            );
        }

        return $this->decorateMetadata($metadata, $tenantCode, 30);
    }

    /**
     * @return array{processed_assets:int, notified_links:int}
     */
    public function monitorComplianceQueue(int $windowDays = 30, int $limit = 100, ?string $tenantCode = null): array
    {
        $tenantCode = $this->tenantContext->normalizeTenantCode($tenantCode);
        $processedAssets = 0;
        $notifiedLinks = 0;
        $dedupe = [];

        foreach ($this->assetMetadataRepository->findComplianceQueue($windowDays, $limit, $tenantCode) as $metadata) {
            ++$processedAssets;
            $resourceRef = (int) ($metadata['resource_ref'] ?? 0);
            if ($resourceRef <= 0) {
                continue;
            }

            $eventType = $this->eventTypeForMetadata($metadata);
            $context = [
                'resource_ref' => $resourceRef,
                'rights_status' => $metadata['rights_status'] ?? null,
                'license_code' => $metadata['license_code'] ?? null,
                'expires_at' => $metadata['expires_at'] ?? null,
                'monitor_window_days' => $windowDays,
            ];

            foreach ($this->assetLinkRepository->findByResourceRef($resourceRef, $tenantCode) as $link) {
                $key = sprintf(
                    '%s:%s:%s:%d',
                    (string) $link['owner_type'],
                    (string) $link['owner_id'],
                    $eventType,
                    $resourceRef
                );

                if (isset($dedupe[$key])) {
                    continue;
                }

                $dedupe[$key] = true;
                ++$notifiedLinks;
                $this->productLifecycleService->syncOwnerStateAndQueueEvent(
                    (string) $link['owner_type'],
                    (string) $link['owner_id'],
                    $eventType,
                    $context,
                    null,
                    'system:asset-governance-monitor',
                    $tenantCode
                );
            }
        }

        return [
            'processed_assets' => $processedAssets,
            'notified_links' => $notifiedLinks,
        ];
    }

    /**
     * @param array<string, mixed> $metadata
     *
     * @return array<string, mixed>
     */
    private function decorateMetadata(array $metadata, string $tenantCode, int $windowDays): array
    {
        $resourceRef = (int) ($metadata['resource_ref'] ?? 0);
        $whereUsed = array_map(
            fn (array $link): array => array_merge(
                $this->decorateOwner((string) $link['owner_type'], (string) $link['owner_id']),
                [
                    'asset_role' => $link['asset_role'] ?? null,
                    'is_primary' => (bool) ($link['is_primary'] ?? false),
                    'synced_attribute' => $link['synced_attribute'] ?? null,
                    'linked_at' => $link['linked_at'] ?? null,
                ]
            ),
            $this->assetLinkRepository->findByResourceRef($resourceRef, $tenantCode)
        );

        return [
            'resource_ref' => $resourceRef,
            'rights_status' => (string) ($metadata['rights_status'] ?? ''),
            'license_code' => (string) ($metadata['license_code'] ?? ''),
            'expires_at' => $metadata['expires_at'] ?? null,
            'rendition_key' => (string) ($metadata['rendition_key'] ?? ''),
            'derivative_of_resource_ref' => $metadata['derivative_of_resource_ref'] ?? null,
            'metadata' => $metadata['metadata'] ?? null,
            'updated_at' => $metadata['updated_at'] ?? null,
            'compliance_status' => $this->complianceStatus($metadata, $windowDays),
            'days_until_expiry' => $this->daysUntilExpiry($metadata['expires_at'] ?? null),
            'where_used_count' => count($whereUsed),
            'where_used' => $whereUsed,
        ];
    }

    /**
     * @param array<string, mixed> $metadata
     */
    private function complianceStatus(array $metadata, int $windowDays): string
    {
        $rightsStatus = strtolower(trim((string) ($metadata['rights_status'] ?? '')));
        if (\in_array($rightsStatus, ['restricted', 'expired'], true)) {
            return $rightsStatus;
        }

        $expiresAt = $metadata['expires_at'] ?? null;
        if (null === $expiresAt) {
            return 'ok';
        }

        try {
            $expires = new \DateTimeImmutable((string) $expiresAt);
            $now = new \DateTimeImmutable('now');
            if ($expires < $now) {
                return 'expired';
            }

            $cutoff = $now->modify(sprintf('+%d days', max(0, $windowDays)));
            if ($expires <= $cutoff) {
                return 'expiring';
            }
        } catch (\Throwable) {
        }

        return 'ok';
    }

    private function daysUntilExpiry(?string $expiresAt): ?int
    {
        if (null === $expiresAt || '' === trim($expiresAt)) {
            return null;
        }

        try {
            $expires = new \DateTimeImmutable($expiresAt);
            $now = new \DateTimeImmutable('today');

            return (int) $now->diff($expires)->format('%r%a');
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * @param array<string, mixed> $metadata
     */
    private function eventTypeForMetadata(array $metadata): string
    {
        $rightsStatus = strtolower(trim((string) ($metadata['rights_status'] ?? '')));
        if (\in_array($rightsStatus, ['restricted', 'expired'], true)) {
            return 'asset.rights.restricted';
        }

        $expiresAt = $metadata['expires_at'] ?? null;
        if (null === $expiresAt || '' === trim((string) $expiresAt)) {
            return 'asset.governance.review';
        }

        try {
            $expires = new \DateTimeImmutable((string) $expiresAt);
            $now = new \DateTimeImmutable('now');

            return $expires < $now ? 'asset.license.expired' : 'asset.license.expiring';
        } catch (\Throwable) {
            return 'asset.governance.review';
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function decorateOwner(string $ownerType, string $ownerId): array
    {
        try {
            $owner = $this->ownerResolver->resolve($ownerType, $ownerId);

            return [
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
                'label' => (string) ($owner['label'] ?? $ownerId),
                'uuid' => $owner['uuid'] ?? null,
            ];
        } catch (\Throwable) {
            return [
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
                'label' => $ownerId,
                'uuid' => null,
            ];
        }
    }
}
