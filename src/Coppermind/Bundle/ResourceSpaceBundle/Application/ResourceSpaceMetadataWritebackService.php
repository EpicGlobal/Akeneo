<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Coppermind\Bundle\ResourceSpaceBundle\Domain\WritebackStatus;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\AssetLinkRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\WritebackJobRepository;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

final class ResourceSpaceMetadataWritebackService
{
    public function __construct(
        private readonly TenantAwareResourceSpaceConfigurationProvider $configurationProvider,
        private readonly ResourceSpaceApiClient $apiClient,
        private readonly AssetLinkRepository $assetLinkRepository,
        private readonly WritebackJobRepository $writebackJobRepository,
        private readonly ResourceSpaceOwnerResolver $ownerResolver,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function scheduleResource(int $resourceRef, ?string $tenantCode = null): void
    {
        if ($resourceRef <= 0) {
            return;
        }

        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);
        $this->writebackJobRepository->schedule($resourceRef, $tenantCode);
    }

    /**
     * @param array<int, int> $resourceRefs
     *
     * @return array<int, array<string, mixed>>
     */
    public function getStatusMap(array $resourceRefs, ?string $tenantCode = null): array
    {
        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);

        return $this->writebackJobRepository->getStatusMap($resourceRefs, $tenantCode);
    }

    /**
     * @return array{status:string, message:?string}
     */
    public function processResource(int $resourceRef, ?string $tenantCode = null): array
    {
        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);

        if ($resourceRef <= 0) {
            return [
                'status' => WritebackStatus::SKIPPED,
                'message' => 'No ResourceSpace resource reference was provided for metadata write-back.',
            ];
        }

        $configuration = $this->configurationProvider->get($tenantCode);
        if (!$configuration->writebackEnabled()) {
            $message = 'ResourceSpace metadata write-back is disabled or not fully configured.';
            $this->writebackJobRepository->markSkipped($resourceRef, $message, $tenantCode);

            return [
                'status' => WritebackStatus::SKIPPED,
                'message' => $message,
            ];
        }

        $this->writebackJobRepository->markAttempted($resourceRef, $tenantCode);

        try {
            foreach ($this->buildUpdates($resourceRef, $tenantCode) as $field => $value) {
                $this->apiClient->updateField($resourceRef, $field, $value, $tenantCode);
            }
        } catch (\RuntimeException $exception) {
            $message = $this->truncateMessage($exception->getMessage());
            $this->writebackJobRepository->markFailed($resourceRef, $message, $tenantCode);
            $this->logger->warning('ResourceSpace metadata write-back failed.', [
                'tenant_code' => $tenantCode,
                'resource_ref' => $resourceRef,
                'error' => $message,
                'exception' => $exception,
            ]);

            return [
                'status' => WritebackStatus::FAILED,
                'message' => $message,
            ];
        }

        $this->writebackJobRepository->markSucceeded($resourceRef, $tenantCode);

        return [
            'status' => WritebackStatus::SUCCEEDED,
            'message' => null,
        ];
    }

    /**
     * @return array{processed:int, succeeded:int, failed:int, skipped:int}
     */
    public function processQueuedResources(int $limit, bool $retryFailed, ?string $tenantCode = null): array
    {
        $summary = [
            'processed' => 0,
            'succeeded' => 0,
            'failed' => 0,
            'skipped' => 0,
        ];

        foreach ($this->writebackJobRepository->findJobsToProcess($limit, $retryFailed, $tenantCode) as $job) {
            ++$summary['processed'];
            $result = $this->processResource((int) $job['resource_ref'], (string) $job['tenant_code']);

            if (WritebackStatus::SUCCEEDED === $result['status']) {
                ++$summary['succeeded'];

                continue;
            }

            if (WritebackStatus::FAILED === $result['status']) {
                ++$summary['failed'];

                continue;
            }

            ++$summary['skipped'];
        }

        return $summary;
    }

    /**
     * @return array<string, string>
     */
    private function buildUpdates(int $resourceRef, string $tenantCode): array
    {
        $configuration = $this->configurationProvider->get($tenantCode);
        $resolvedLinks = [];
        foreach ($this->assetLinkRepository->findByResourceRef($resourceRef, $tenantCode) as $link) {
            try {
                $resolvedLinks[] = [
                    'link' => $link,
                    'owner' => $this->ownerResolver->resolve((string) $link['owner_type'], (string) $link['owner_id']),
                ];
            } catch (NotFoundHttpException) {
                continue;
            }
        }

        $primaryOwner = $resolvedLinks[0]['owner'] ?? null;
        $searchSeeds = array_values(array_unique(array_map(
            static fn (array $item): string => (string) $item['owner']['search_seed'],
            $resolvedLinks
        )));

        $updates = [];

        if (null !== ($field = $configuration->writebackIdentifierField())) {
            $updates[$field] = (string) ($primaryOwner['search_seed'] ?? '');
        }

        if (null !== ($field = $configuration->writebackUuidField())) {
            $updates[$field] = (string) ($primaryOwner['uuid'] ?? '');
        }

        if (null !== ($field = $configuration->writebackOwnerTypeField())) {
            $updates[$field] = (string) ($primaryOwner['type'] ?? '');
        }

        if (null !== ($field = $configuration->writebackLinksField())) {
            $updates[$field] = implode(', ', $searchSeeds);
        }

        return $updates;
    }

    private function truncateMessage(string $message): string
    {
        return substr(trim($message), 0, 2000);
    }
}
