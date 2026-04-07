<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\AuditLogRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\GovernanceApprovalRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\OutboxEventRepository;

final class ProductLifecycleService
{
    public function __construct(
        private readonly GovernanceWorkflowService $governanceWorkflowService,
        private readonly GovernanceApprovalRepository $governanceApprovalRepository,
        private readonly AuditLogRepository $auditLogRepository,
        private readonly OutboxEventRepository $outboxEventRepository,
        private readonly TenantContext $tenantContext,
    ) {
    }

    /**
     * @param array<string, mixed> $context
     *
     * @return array<string, mixed>
     */
    public function syncOwnerStateAndQueueEvent(
        string $ownerType,
        string $ownerId,
        string $eventType,
        array $context = [],
        ?int $actorUserId = null,
        ?string $actorIdentifier = null,
        ?string $tenantCode = null,
    ): array {
        $tenantCode = $this->tenantContext->normalizeTenantCode($tenantCode);
        try {
            $payload = $this->governanceWorkflowService->buildMarketplacePayload(
                $ownerType,
                $ownerId,
                $tenantCode,
                $eventType,
                $context
            );
        } catch (\Throwable $exception) {
            return [];
        }

        $this->auditLogRepository->record(
            $eventType,
            $ownerType,
            $ownerId,
            $context,
            $actorUserId,
            $this->normalizeActorIdentifier($actorUserId, $actorIdentifier),
            $tenantCode
        );

        $this->outboxEventRepository->schedule(
            $eventType,
            $ownerType,
            $ownerId,
            $payload,
            $tenantCode,
            $this->buildDedupeKey($tenantCode, $eventType, $ownerType, $ownerId, $context)
        );

        return $payload['product']['governance'] ?? [];
    }

    /**
     * @param array<string, mixed> $context
     *
     * @return array<string, mixed>
     */
    public function updateApproval(
        string $ownerType,
        string $ownerId,
        string $stageCode,
        string $action,
        ?string $comment = null,
        ?int $actorUserId = null,
        ?string $actorIdentifier = null,
        array $context = [],
        ?string $tenantCode = null,
    ): array {
        $tenantCode = $this->tenantContext->normalizeTenantCode($tenantCode);
        $stageCode = trim($stageCode);
        if ('' === $stageCode) {
            throw new \RuntimeException('A workflow stage code is required.');
        }

        switch ($action) {
            case 'request':
                $this->governanceApprovalRepository->requestStage(
                    $ownerType,
                    $ownerId,
                    $stageCode,
                    $comment,
                    $actorUserId,
                    $tenantCode
                );
                $eventType = 'product.approval.requested';
                break;

            case 'approve':
                $this->governanceApprovalRepository->approveStage(
                    $ownerType,
                    $ownerId,
                    $stageCode,
                    $comment,
                    $actorUserId,
                    $tenantCode
                );
                $eventType = 'product.approval.approved';
                break;

            case 'reject':
                $this->governanceApprovalRepository->rejectStage(
                    $ownerType,
                    $ownerId,
                    $stageCode,
                    $comment,
                    $actorUserId,
                    $tenantCode
                );
                $eventType = 'product.approval.rejected';
                break;

            default:
                throw new \RuntimeException(sprintf('Unsupported workflow action "%s".', $action));
        }

        return $this->syncOwnerStateAndQueueEvent(
            $ownerType,
            $ownerId,
            $eventType,
            array_merge($context, [
                'stage_code' => $stageCode,
                'workflow_action' => $action,
                'comment' => $comment,
            ]),
            $actorUserId,
            $actorIdentifier,
            $tenantCode
        );
    }

    private function buildDedupeKey(
        string $tenantCode,
        string $eventType,
        string $ownerType,
        string $ownerId,
        array $context,
    ): string {
        $parts = [$tenantCode, $eventType, $ownerType, $ownerId];

        foreach (['stage_code', 'resource_ref', 'attribute_code'] as $key) {
            if (isset($context[$key]) && '' !== trim((string) $context[$key])) {
                $parts[] = trim((string) $context[$key]);
            }
        }

        return substr(implode(':', $parts), 0, 255);
    }

    private function normalizeActorIdentifier(?int $actorUserId, ?string $actorIdentifier): string
    {
        $actorIdentifier = trim((string) $actorIdentifier);
        if ('' !== $actorIdentifier) {
            return substr($actorIdentifier, 0, 191);
        }

        if (null !== $actorUserId) {
            return sprintf('user:%d', $actorUserId);
        }

        return 'system';
    }
}
