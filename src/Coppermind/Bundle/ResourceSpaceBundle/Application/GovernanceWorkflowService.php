<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Akeneo\Pim\Enrichment\Component\Product\Model\ProductInterface;
use Akeneo\Pim\Enrichment\Component\Product\Model\ProductModelInterface;
use Akeneo\Pim\Enrichment\Component\Product\Query\FindIdentifier;
use Akeneo\Pim\Enrichment\Component\Product\Repository\ProductModelRepositoryInterface;
use Akeneo\Pim\Enrichment\Component\Product\Repository\ProductRepositoryInterface;
use Coppermind\Bundle\ResourceSpaceBundle\Domain\ApprovalStatus;
use Coppermind\Bundle\ResourceSpaceBundle\Domain\OwnerType;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\AssetLinkRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\AssetMetadataRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\GovernanceApprovalRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\GovernanceRuleRepository;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\GovernanceStateRepository;

final class GovernanceWorkflowService
{
    /**
     * @var array<int, string>
     */
    private const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tiff', 'svg'];

    public function __construct(
        private readonly ProductRepositoryInterface $productRepository,
        private readonly ProductModelRepositoryInterface $productModelRepository,
        private readonly FindIdentifier $findIdentifier,
        private readonly GovernanceRuleRepository $governanceRuleRepository,
        private readonly GovernanceApprovalRepository $governanceApprovalRepository,
        private readonly GovernanceStateRepository $governanceStateRepository,
        private readonly AssetLinkRepository $assetLinkRepository,
        private readonly AssetMetadataRepository $assetMetadataRepository,
        private readonly TenantContext $tenantContext,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function evaluateOwner(string $ownerType, string $ownerId, ?string $tenantCode = null): array
    {
        $tenantCode = $this->tenantContext->normalizeTenantCode($tenantCode);
        $context = $this->resolveOwnerContext($ownerType, $ownerId);
        $rules = $this->governanceRuleRepository->findApplicableRules($ownerType, $context['family_code'], $tenantCode);
        $links = $this->assetLinkRepository->findByOwner($ownerType, $ownerId, $tenantCode);
        $resourceRefs = array_map(static fn (array $link): int => (int) $link['resource_ref'], $links);
        $assetMetadata = $this->assetMetadataRepository->findByResourceRefs($resourceRefs, $tenantCode);
        $whereUsed = $this->assetLinkRepository->getWhereUsedMap($resourceRefs, $tenantCode);
        $approvals = $this->governanceApprovalRepository->findByOwner($ownerType, $ownerId, $tenantCode);
        $approvalStages = $this->buildApprovalStages($rules, $approvals);
        $flatAttributes = $this->flattenAttributes($context['raw_values']);
        $assets = $this->buildAssetSnapshot($links, $assetMetadata, $whereUsed);

        $targets = [];
        $blockers = [];
        $satisfiedChecks = 0;
        $totalChecks = 0;

        foreach ($rules as $rule) {
            $missingAttributes = array_values(array_filter(
                $rule['required_attributes'],
                fn (string $attributeCode): bool => !$this->hasMeaningfulAttribute($context['raw_values'], $attributeCode)
            ));

            $presentRoles = array_values(array_unique(array_filter(array_map(
                static fn (array $asset): string => trim((string) ($asset['role'] ?? '')),
                $assets
            ))));

            $missingAssetRoles = array_values(array_filter(
                $rule['required_asset_roles'],
                static fn (string $role): bool => !\in_array($role, $presentRoles, true)
            ));

            $imageCount = count(array_filter($assets, static fn (array $asset): bool => 'image' === $asset['type']));
            $minimumAssetCountMet = $imageCount >= (int) $rule['minimum_asset_count'];

            $pendingApprovals = array_values(array_filter(
                $rule['required_approvals'],
                function (string $stageCode) use ($approvalStages): bool {
                    $status = $approvalStages[$stageCode]['status'] ?? ApprovalStatus::NOT_REQUESTED;

                    return ApprovalStatus::APPROVED !== $status;
                }
            ));

            $assetComplianceIssues = $this->buildAssetComplianceIssues($assets);

            $targetBlockers = [];
            if ([] !== $missingAttributes) {
                $targetBlockers[] = $this->blocker(
                    'missing_required_attributes',
                    sprintf('Missing required attributes: %s.', implode(', ', $missingAttributes)),
                    (string) $rule['target_code']
                );
            }

            if ([] !== $missingAssetRoles) {
                $targetBlockers[] = $this->blocker(
                    'missing_required_assets',
                    sprintf('Missing required asset roles: %s.', implode(', ', $missingAssetRoles)),
                    (string) $rule['target_code']
                );
            }

            if (!$minimumAssetCountMet && (int) $rule['minimum_asset_count'] > 0) {
                $targetBlockers[] = $this->blocker(
                    'insufficient_asset_count',
                    sprintf(
                        'Requires at least %d marketplace-ready images, but only %d are linked.',
                        (int) $rule['minimum_asset_count'],
                        $imageCount
                    ),
                    (string) $rule['target_code']
                );
            }

            if ([] !== $pendingApprovals) {
                $targetBlockers[] = $this->blocker(
                    'pending_approval',
                    sprintf('Outstanding approvals: %s.', implode(', ', $pendingApprovals)),
                    (string) $rule['target_code']
                );
            }

            foreach ($assetComplianceIssues as $issue) {
                $targetBlockers[] = $issue + ['target_code' => (string) $rule['target_code']];
            }

            $targetChecks = count($rule['required_attributes']) + count($rule['required_asset_roles']) + count($rule['required_approvals']);
            if ((int) $rule['minimum_asset_count'] > 0) {
                ++$targetChecks;
            }
            if ([] !== $assetComplianceIssues) {
                $targetChecks += count($assetComplianceIssues);
            }

            $targetSatisfied = count($rule['required_attributes']) - count($missingAttributes);
            $targetSatisfied += count($rule['required_asset_roles']) - count($missingAssetRoles);
            $targetSatisfied += count($rule['required_approvals']) - count($pendingApprovals);
            if ((int) $rule['minimum_asset_count'] > 0 && $minimumAssetCountMet) {
                ++$targetSatisfied;
            }

            $satisfiedChecks += max(0, $targetSatisfied);
            $totalChecks += max(0, $targetChecks);
            $blockers = array_merge($blockers, $targetBlockers);

            $targets[] = [
                'rule_code' => $rule['rule_code'],
                'target_code' => $rule['target_code'],
                'label' => $rule['label'],
                'channel_code' => $rule['channel_code'],
                'market_code' => $rule['market_code'],
                'locale_code' => $rule['locale_code'],
                'status' => [] === $targetBlockers ? 'ready' : 'blocked',
                'missing_attributes' => $missingAttributes,
                'missing_asset_roles' => $missingAssetRoles,
                'pending_approvals' => $pendingApprovals,
                'image_count' => $imageCount,
                'minimum_asset_count' => (int) $rule['minimum_asset_count'],
                'required_attributes' => $rule['required_attributes'],
                'required_asset_roles' => $rule['required_asset_roles'],
                'required_approvals' => $rule['required_approvals'],
                'blockers' => $targetBlockers,
            ];
        }

        $approvalsList = array_values($approvalStages);
        $approvalStatus = $this->resolveApprovalStatus($approvalsList);
        $state = [
            'tenant_code' => $tenantCode,
            'owner_type' => $ownerType,
            'owner_id' => $ownerId,
            'label' => $context['label'],
            'family_code' => $context['family_code'],
            'variation_level' => $context['variation_level'],
            'publish_status' => [] === $blockers ? 'ready' : 'blocked',
            'approval_status' => $approvalStatus,
            'completeness_score' => $totalChecks > 0 ? round(($satisfiedChecks / $totalChecks) * 100, 2) : 100.0,
            'blocker_count' => count($blockers),
            'blockers' => array_values($blockers),
            'targets' => $targets,
            'approvals' => $approvalsList,
            'attributes' => $flatAttributes,
            'assets' => $assets,
        ];

        $this->governanceStateRepository->upsert($ownerType, $ownerId, $state, $tenantCode);

        return $state;
    }

    /**
     * @return array<string, mixed>
     */
    public function buildMarketplacePayload(
        string $ownerType,
        string $ownerId,
        ?string $tenantCode = null,
        ?string $eventType = null,
        array $eventContext = [],
    ): array {
        $tenantCode = $this->tenantContext->normalizeTenantCode($tenantCode);
        $state = $this->evaluateOwner($ownerType, $ownerId, $tenantCode);
        $context = $this->resolveOwnerContext($ownerType, $ownerId);

        return [
            'tenantCode' => $tenantCode,
            'eventType' => $eventType ?? 'product.changed',
            'eventContext' => $eventContext,
            'marketplaces' => array_values(array_filter(array_map(
                static fn (array $target): string => (string) ($target['target_code'] ?? ''),
                $state['targets']
            ))),
            'product' => [
                'ownerType' => $ownerType,
                'ownerId' => $ownerId,
                'identifier' => $context['identifier'],
                'label' => $context['label'],
                'uuid' => $context['uuid'],
                'code' => OwnerType::PRODUCT_MODEL === $ownerType ? $ownerId : null,
                'familyCode' => $context['family_code'],
                'variationLevel' => $context['variation_level'],
                'attributes' => $state['attributes'],
                'assets' => $state['assets'],
                'approvals' => array_values(array_map(
                    static fn (array $stage): string => (string) $stage['stage_code'],
                    array_filter(
                        $state['approvals'],
                        static fn (array $stage): bool => ApprovalStatus::APPROVED === ($stage['status'] ?? '')
                    )
                )),
                'approvalStages' => $state['approvals'],
                'governance' => [
                    'publishStatus' => $state['publish_status'],
                    'approvalStatus' => $state['approval_status'],
                    'completenessScore' => $state['completeness_score'],
                    'blockers' => $state['blockers'],
                    'targets' => $state['targets'],
                ],
            ],
        ];
    }

    /**
     * @return array{owner_type:string,owner_id:string,identifier:string,label:string,uuid:?string,family_code:string,variation_level:int,raw_values:array<string, mixed>}
     */
    private function resolveOwnerContext(string $ownerType, string $ownerId): array
    {
        if (OwnerType::PRODUCT === $ownerType) {
            $product = $this->productRepository->find($ownerId);
            if (!$product instanceof ProductInterface) {
                throw new \RuntimeException(sprintf('Product %s could not be found for governance evaluation.', $ownerId));
            }

            $uuid = (string) $product->getUuid();
            $identifier = $this->findIdentifier->fromUuid($uuid) ?? '';
            $identifier = '' !== $identifier ? $identifier : $uuid;
            $familyCode = $product->getFamily()?->getCode()
                ?? $product->getFamilyVariant()?->getFamily()?->getCode()
                ?? '';

            return [
                'owner_type' => OwnerType::PRODUCT,
                'owner_id' => (string) $ownerId,
                'identifier' => $identifier,
                'label' => $identifier,
                'uuid' => $uuid,
                'family_code' => (string) $familyCode,
                'variation_level' => method_exists($product, 'getVariationLevel') ? (int) $product->getVariationLevel() : 0,
                'raw_values' => \is_array($product->getRawValues()) ? $product->getRawValues() : [],
            ];
        }

        if (OwnerType::PRODUCT_MODEL !== $ownerType) {
            throw new \RuntimeException(sprintf('Unsupported owner type "%s" for governance evaluation.', $ownerType));
        }

        $productModel = $this->productModelRepository->findOneByIdentifier($ownerId);
        if (!$productModel instanceof ProductModelInterface) {
            throw new \RuntimeException(sprintf('Product model %s could not be found for governance evaluation.', $ownerId));
        }

        return [
            'owner_type' => OwnerType::PRODUCT_MODEL,
            'owner_id' => (string) $productModel->getCode(),
            'identifier' => (string) $productModel->getCode(),
            'label' => (string) $productModel->getCode(),
            'uuid' => null,
            'family_code' => (string) ($productModel->getFamilyVariant()?->getFamily()?->getCode() ?? ''),
            'variation_level' => (int) $productModel->getVariationLevel(),
            'raw_values' => \is_array($productModel->getRawValues()) ? $productModel->getRawValues() : [],
        ];
    }

    /**
     * @param array<int, array<string, mixed>> $rules
     * @param array<int, array<string, mixed>> $approvals
     *
     * @return array<string, array<string, mixed>>
     */
    private function buildApprovalStages(array $rules, array $approvals): array
    {
        $requiredStages = [];
        foreach ($rules as $rule) {
            foreach ($rule['required_approvals'] as $stageCode) {
                $requiredStages[$stageCode] = [
                    'stage_code' => $stageCode,
                    'status' => ApprovalStatus::NOT_REQUESTED,
                    'required' => true,
                    'requested_at' => null,
                    'approved_at' => null,
                    'approved_by' => null,
                    'rejected_at' => null,
                    'rejected_by' => null,
                    'comment' => null,
                ];
            }
        }

        foreach ($approvals as $approval) {
            $stageCode = (string) ($approval['stage_code'] ?? '');
            if ('' === $stageCode) {
                continue;
            }

            $requiredStages[$stageCode] = array_replace($requiredStages[$stageCode] ?? [
                'stage_code' => $stageCode,
                'required' => false,
            ], $approval);
            $requiredStages[$stageCode]['required'] ??= false;
        }

        ksort($requiredStages);

        return $requiredStages;
    }

    /**
     * @param array<int, array<string, mixed>> $links
     * @param array<int, array<string, mixed>> $assetMetadata
     * @param array<int, int> $whereUsed
     *
     * @return array<int, array<string, mixed>>
     */
    private function buildAssetSnapshot(array $links, array $assetMetadata, array $whereUsed): array
    {
        return array_map(function (array $link) use ($assetMetadata, $whereUsed): array {
            $resourceRef = (int) $link['resource_ref'];
            $metadata = $assetMetadata[$resourceRef] ?? [];
            $fileExtension = strtolower((string) ($link['file_extension'] ?? ''));

            return [
                'resource_ref' => $resourceRef,
                'ref' => $resourceRef,
                'title' => (string) ($link['title'] ?? ''),
                'role' => '' !== trim((string) ($link['asset_role'] ?? '')) ? (string) $link['asset_role'] : null,
                'is_primary' => (bool) ($link['is_primary'] ?? false),
                'type' => \in_array($fileExtension, self::IMAGE_EXTENSIONS, true) ? 'image' : 'file',
                'file_extension' => $fileExtension,
                'rights_status' => (string) ($metadata['rights_status'] ?? ''),
                'license_code' => (string) ($metadata['license_code'] ?? ''),
                'expires_at' => $metadata['expires_at'] ?? null,
                'rendition_key' => (string) ($metadata['rendition_key'] ?? ''),
                'derivative_of_resource_ref' => $metadata['derivative_of_resource_ref'] ?? null,
                'where_used_count' => max(0, (int) ($whereUsed[$resourceRef] ?? 0)),
            ];
        }, $links);
    }

    /**
     * @param array<int, array<string, mixed>> $assets
     *
     * @return array<int, array<string, mixed>>
     */
    private function buildAssetComplianceIssues(array $assets): array
    {
        $issues = [];
        $now = new \DateTimeImmutable('now');

        foreach ($assets as $asset) {
            if (null !== ($expiresAt = $asset['expires_at'] ?? null)) {
                try {
                    if (new \DateTimeImmutable((string) $expiresAt) < $now) {
                        $issues[] = $this->blocker(
                            'expired_asset_license',
                            sprintf('Linked asset #%d has an expired license window.', (int) $asset['resource_ref'])
                        );
                    }
                } catch (\Throwable) {
                }
            }

            if (\in_array((string) ($asset['rights_status'] ?? ''), ['restricted', 'expired'], true)) {
                $issues[] = $this->blocker(
                    'asset_rights_restricted',
                    sprintf('Linked asset #%d is marked as %s.', (int) $asset['resource_ref'], (string) $asset['rights_status'])
                );
            }
        }

        return $issues;
    }

    /**
     * @param array<string, mixed> $rawValues
     *
     * @return array<string, mixed>
     */
    private function flattenAttributes(array $rawValues): array
    {
        $attributes = [];
        foreach ($rawValues as $attributeCode => $value) {
            $flattenedValue = $this->firstMeaningfulLeaf($value);
            if (null === $flattenedValue) {
                continue;
            }

            $attributes[(string) $attributeCode] = $flattenedValue;
        }

        return $attributes;
    }

    /**
     * @param array<string, mixed> $rawValues
     */
    private function hasMeaningfulAttribute(array $rawValues, string $attributeCode): bool
    {
        if (!array_key_exists($attributeCode, $rawValues)) {
            return false;
        }

        return null !== $this->firstMeaningfulLeaf($rawValues[$attributeCode]);
    }

    private function firstMeaningfulLeaf(mixed $value): mixed
    {
        if (null === $value) {
            return null;
        }

        if (\is_bool($value) || \is_int($value) || \is_float($value)) {
            return $value;
        }

        if (\is_string($value)) {
            $value = trim($value);

            return '' !== $value ? $value : null;
        }

        if (!\is_array($value)) {
            return null;
        }

        foreach ($value as $nested) {
            $meaningful = $this->firstMeaningfulLeaf($nested);
            if (null !== $meaningful) {
                return $meaningful;
            }
        }

        return null;
    }

    /**
     * @param array<int, array<string, mixed>> $approvals
     */
    private function resolveApprovalStatus(array $approvals): string
    {
        if ([] === $approvals) {
            return 'not_required';
        }

        foreach ($approvals as $approval) {
            if (ApprovalStatus::REJECTED === ($approval['status'] ?? '')) {
                return 'rejected';
            }
        }

        foreach ($approvals as $approval) {
            if (ApprovalStatus::APPROVED !== ($approval['status'] ?? '')) {
                return 'pending';
            }
        }

        return 'approved';
    }

    /**
     * @return array<string, string>
     */
    private function blocker(string $code, string $message, ?string $targetCode = null): array
    {
        $blocker = [
            'code' => $code,
            'message' => $message,
            'severity' => 'blocking',
        ];

        if (null !== $targetCode && '' !== $targetCode) {
            $blocker['target_code'] = $targetCode;
        }

        return $blocker;
    }
}
