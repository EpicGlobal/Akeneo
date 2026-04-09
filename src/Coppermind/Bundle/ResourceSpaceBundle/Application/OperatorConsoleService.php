<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\AuditLogRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\GovernanceApprovalRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\GovernanceStateRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\MediaIngestJobRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\OutboxEventRepository;

final class OperatorConsoleService
{
    public function __construct(
        private readonly GovernanceStateRepository $governanceStateRepository,
        private readonly GovernanceApprovalRepository $governanceApprovalRepository,
        private readonly OutboxEventRepository $outboxEventRepository,
        private readonly MediaIngestJobRepository $mediaIngestJobRepository,
        private readonly AuditLogRepository $auditLogRepository,
        private readonly AssetGovernanceService $assetGovernanceService,
        private readonly ResourceSpaceOwnerResolver $ownerResolver,
        private readonly TenantContext $tenantContext,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function dashboard(?string $tenantCode = null, int $windowDays = 30, int $limit = 12): array
    {
        $tenantCode = $this->tenantContext->normalizeTenantCode($tenantCode);

        return [
            'tenant_code' => $tenantCode,
            'generated_at' => (new \DateTimeImmutable())->format(\DATE_ATOM),
            'governance' => $this->governanceStateRepository->summarize($tenantCode),
            'approvals' => [
                'items' => $this->approvals($tenantCode, $limit),
            ],
            'rights' => [
                'items' => $this->assetGovernanceService->listComplianceItems($windowDays, $limit, $tenantCode),
            ],
            'exceptions' => $this->exceptions($tenantCode, $limit),
            'audit' => $this->audit($tenantCode, $limit),
        ];
    }

    /**
     * @param array<int, string>|null $statuses
     *
     * @return array<int, array<string, mixed>>
     */
    public function approvals(?string $tenantCode = null, int $limit = 50, ?array $statuses = null): array
    {
        $tenantCode = $this->tenantContext->normalizeTenantCode($tenantCode);
        $statuses ??= ['pending', 'rejected'];

        return array_map(
            function (array $approval): array {
                return array_merge($approval, [
                    'owner' => $this->decorateOwner((string) $approval['owner_type'], (string) $approval['owner_id']),
                ]);
            },
            $this->governanceApprovalRepository->listByStatuses($statuses, $limit, $tenantCode)
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function exceptions(?string $tenantCode = null, int $limit = 25): array
    {
        $tenantCode = $this->tenantContext->normalizeTenantCode($tenantCode);

        return [
            'blocked_publish' => array_map(
                fn (array $state): array => $this->decorateGovernanceState($state),
                $this->governanceStateRepository->listStates($limit, $tenantCode, 'blocked')
            ),
            'failed_outbox_events' => $this->outboxEventRepository->listEvents($limit, $tenantCode, 'failed'),
            'failed_ingest_jobs' => $this->mediaIngestJobRepository->listJobs($limit, $tenantCode, 'failed'),
            'outbox_summary' => $this->outboxEventRepository->summarizeByStatus($tenantCode),
            'ingest_summary' => $this->mediaIngestJobRepository->summarizeByStatus($tenantCode),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function audit(?string $tenantCode = null, int $limit = 50): array
    {
        $tenantCode = $this->tenantContext->normalizeTenantCode($tenantCode);

        return array_map(function (array $entry): array {
            $subject = [
                'type' => (string) ($entry['subject_type'] ?? ''),
                'id' => (string) ($entry['subject_id'] ?? ''),
                'label' => (string) ($entry['subject_id'] ?? ''),
            ];

            if (\in_array($subject['type'], ['product', 'product_model'], true)) {
                $subject = array_merge($subject, $this->decorateOwner($subject['type'], $subject['id']));
            } elseif ('asset' === $subject['type']) {
                $subject['label'] = sprintf('Asset #%s', $subject['id']);
            }

            return array_merge($entry, ['subject' => $subject]);
        }, $this->auditLogRepository->findRecent($limit, $tenantCode));
    }

    /**
     * @param array<string, mixed> $state
     *
     * @return array<string, mixed>
     */
    private function decorateGovernanceState(array $state): array
    {
        return array_merge($state, [
            'owner' => $this->decorateOwner((string) ($state['owner_type'] ?? ''), (string) ($state['owner_id'] ?? '')),
        ]);
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
