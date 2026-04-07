<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Coppermind\Bundle\ResourceSpaceBundle\Domain\MediaIngestStatus;
use Coppermind\Bundle\ResourceSpaceBundle\Domain\OwnerType;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\AssetLinkRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\MediaIngestJobRepository;
use Psr\Log\LoggerInterface;

final class ResourceSpaceMediaIngestService
{
    public function __construct(
        private readonly TenantAwareResourceSpaceConfigurationProvider $configurationProvider,
        private readonly ResourceSpaceAssetSyncService $assetSyncService,
        private readonly MediaIngestJobRepository $mediaIngestJobRepository,
        private readonly AssetLinkRepository $assetLinkRepository,
        private readonly LoggerInterface $logger,
    ) {
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
        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);

        return $this->mediaIngestJobRepository->schedule(
            $ownerType,
            $ownerId,
            $resourceRef,
            $attributeCode,
            $localeCode,
            $scopeCode,
            $requestedBy,
            $tenantCode
        );
    }

    /**
     * @param array<int, int> $resourceRefs
     *
     * @return array<int, array<string, mixed>>
     */
    public function getStatusMap(
        string $ownerType,
        string $ownerId,
        array $resourceRefs,
        ?string $tenantCode = null,
    ): array {
        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);

        return $this->mediaIngestJobRepository->getLatestStatusMap($ownerType, $ownerId, $resourceRefs, $tenantCode);
    }

    public function countActiveJobs(string $ownerType, string $ownerId, ?string $tenantCode = null): int
    {
        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);

        return $this->mediaIngestJobRepository->countActiveByOwner($ownerType, $ownerId, $tenantCode);
    }

    /**
     * @return array{processed:int, succeeded:int, failed:int, skipped:int}
     */
    public function processQueuedJobs(int $limit, bool $retryFailed, ?string $tenantCode = null): array
    {
        $summary = [
            'processed' => 0,
            'succeeded' => 0,
            'failed' => 0,
            'skipped' => 0,
        ];

        foreach ($this->mediaIngestJobRepository->findJobsToProcess($limit, $retryFailed, $tenantCode) as $job) {
            ++$summary['processed'];
            $result = $this->processJob($job);

            if (MediaIngestStatus::SUCCEEDED === $result['status']) {
                ++$summary['succeeded'];

                continue;
            }

            if (MediaIngestStatus::FAILED === $result['status']) {
                ++$summary['failed'];

                continue;
            }

            ++$summary['skipped'];
        }

        return $summary;
    }

    /**
     * @param array<string, mixed> $job
     *
     * @return array{status:string, message:?string}
     */
    private function processJob(array $job): array
    {
        $jobId = (int) ($job['id'] ?? 0);
        $tenantCode = (string) ($job['tenant_code'] ?? '');
        $ownerType = (string) ($job['owner_type'] ?? '');
        $ownerId = (string) ($job['owner_id'] ?? '');
        $resourceRef = (int) ($job['resource_ref'] ?? 0);
        $attributeCode = trim((string) ($job['attribute_code'] ?? ''));
        $localeCode = $job['locale_code'] ?? null;
        $scopeCode = $job['scope_code'] ?? null;

        if ($jobId <= 0 || $resourceRef <= 0 || '' === $attributeCode) {
            return [
                'status' => MediaIngestStatus::SKIPPED,
                'message' => 'The ingest job was missing required data.',
            ];
        }

        $this->mediaIngestJobRepository->markAttempted($jobId);

        try {
            $result = OwnerType::PRODUCT === $ownerType
                ? $this->assetSyncService->syncProductAsset($ownerId, $resourceRef, $attributeCode, $localeCode, $scopeCode, $tenantCode)
                : $this->assetSyncService->syncProductModelAsset($ownerId, $resourceRef, $attributeCode, $localeCode, $scopeCode, $tenantCode);

            $this->assetLinkRepository->markSynced($ownerType, $ownerId, $resourceRef, $attributeCode, $tenantCode);
            $this->mediaIngestJobRepository->markSucceeded($jobId, (string) ($result['file_key'] ?? ''));

            return [
                'status' => MediaIngestStatus::SUCCEEDED,
                'message' => null,
            ];
        } catch (\Throwable $exception) {
            $message = substr(trim($exception->getMessage()), 0, 2000);
            $this->mediaIngestJobRepository->markFailed($jobId, $message);
            $this->logger->warning('ResourceSpace media ingest failed.', [
                'job' => $job,
                'error' => $message,
                'exception' => $exception,
            ]);

            return [
                'status' => MediaIngestStatus::FAILED,
                'message' => $message,
            ];
        }
    }
}
