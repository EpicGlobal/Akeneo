<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Controller\InternalApi;

use Akeneo\UserManagement\Bundle\Context\UserContext;
use Coppermind\Bundle\ResourceSpaceBundle\Application\ResourceSpaceApiClient;
use Coppermind\Bundle\ResourceSpaceBundle\Application\ResourceSpaceAssetSyncService;
use Coppermind\Bundle\ResourceSpaceBundle\Application\ResourceSpaceMetadataWritebackService;
use Coppermind\Bundle\ResourceSpaceBundle\Application\ResourceSpaceOwnerResolver;
use Coppermind\Bundle\ResourceSpaceBundle\Application\TenantAwareResourceSpaceConfigurationProvider;
use Coppermind\Bundle\ResourceSpaceBundle\Application\TenantContext;
use Coppermind\Bundle\ResourceSpaceBundle\Domain\OwnerType;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\AssetLinkRepository;
use Oro\Bundle\SecurityBundle\SecurityFacade;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

final class DamController
{
    public function __construct(
        private readonly TenantAwareResourceSpaceConfigurationProvider $configurationProvider,
        private readonly TenantContext $tenantContext,
        private readonly ResourceSpaceApiClient $apiClient,
        private readonly ResourceSpaceAssetSyncService $assetSyncService,
        private readonly ResourceSpaceMetadataWritebackService $metadataWritebackService,
        private readonly AssetLinkRepository $assetLinkRepository,
        private readonly ResourceSpaceOwnerResolver $ownerResolver,
        private readonly SecurityFacade $securityFacade,
        private readonly UserContext $userContext,
    ) {
    }

    public function listProductAction(Request $request, string $uuid): JsonResponse
    {
        $this->assertGranted('pim_enrich_product_edit_attributes');

        try {
            return new JsonResponse($this->buildPayload(
                OwnerType::PRODUCT,
                $uuid,
                trim((string) $request->query->get('q', '')),
                $this->tenantContext->currentTenantCode()
            ));
        } catch (\RuntimeException $exception) {
            return $this->createErrorResponse($exception, Response::HTTP_BAD_GATEWAY);
        }
    }

    public function listProductModelAction(Request $request, string $code): JsonResponse
    {
        $this->assertGranted('pim_enrich_product_model_edit_attributes');

        try {
            return new JsonResponse($this->buildPayload(
                OwnerType::PRODUCT_MODEL,
                $code,
                trim((string) $request->query->get('q', '')),
                $this->tenantContext->currentTenantCode()
            ));
        } catch (\RuntimeException $exception) {
            return $this->createErrorResponse($exception, Response::HTTP_BAD_GATEWAY);
        }
    }

    public function linkProductAction(Request $request, string $uuid): JsonResponse
    {
        $this->assertGranted('pim_enrich_product_edit_attributes');

        try {
            return $this->linkAsset(
                OwnerType::PRODUCT,
                $uuid,
                $this->parsePayload($request),
                $this->tenantContext->currentTenantCode()
            );
        } catch (\RuntimeException $exception) {
            return $this->createErrorResponse($exception, Response::HTTP_UNPROCESSABLE_ENTITY);
        }
    }

    public function linkProductModelAction(Request $request, string $code): JsonResponse
    {
        $this->assertGranted('pim_enrich_product_model_edit_attributes');

        try {
            return $this->linkAsset(
                OwnerType::PRODUCT_MODEL,
                $code,
                $this->parsePayload($request),
                $this->tenantContext->currentTenantCode()
            );
        } catch (\RuntimeException $exception) {
            return $this->createErrorResponse($exception, Response::HTTP_UNPROCESSABLE_ENTITY);
        }
    }

    public function unlinkProductAction(string $uuid, int $resourceRef): JsonResponse
    {
        $this->assertGranted('pim_enrich_product_edit_attributes');

        try {
            return $this->unlinkAsset(OwnerType::PRODUCT, $uuid, $resourceRef, $this->tenantContext->currentTenantCode());
        } catch (\RuntimeException $exception) {
            return $this->createErrorResponse($exception, Response::HTTP_UNPROCESSABLE_ENTITY);
        }
    }

    public function unlinkProductModelAction(string $code, int $resourceRef): JsonResponse
    {
        $this->assertGranted('pim_enrich_product_model_edit_attributes');

        try {
            return $this->unlinkAsset(
                OwnerType::PRODUCT_MODEL,
                $code,
                $resourceRef,
                $this->tenantContext->currentTenantCode()
            );
        } catch (\RuntimeException $exception) {
            return $this->createErrorResponse($exception, Response::HTTP_UNPROCESSABLE_ENTITY);
        }
    }

    public function syncProductAction(Request $request, string $uuid, int $resourceRef): JsonResponse
    {
        $this->assertGranted('pim_enrich_product_edit_attributes');

        try {
            return $this->syncAsset(
                OwnerType::PRODUCT,
                $uuid,
                $resourceRef,
                $this->parsePayload($request),
                $this->tenantContext->currentTenantCode()
            );
        } catch (\RuntimeException $exception) {
            return $this->createErrorResponse($exception, Response::HTTP_UNPROCESSABLE_ENTITY);
        }
    }

    public function syncProductModelAction(Request $request, string $code, int $resourceRef): JsonResponse
    {
        $this->assertGranted('pim_enrich_product_model_edit_attributes');

        try {
            return $this->syncAsset(
                OwnerType::PRODUCT_MODEL,
                $code,
                $resourceRef,
                $this->parsePayload($request),
                $this->tenantContext->currentTenantCode()
            );
        } catch (\RuntimeException $exception) {
            return $this->createErrorResponse($exception, Response::HTTP_UNPROCESSABLE_ENTITY);
        }
    }

    public function retryWritebackAction(int $resourceRef): JsonResponse
    {
        $this->assertGrantedAny([
            'pim_enrich_product_edit_attributes',
            'pim_enrich_product_model_edit_attributes',
        ]);

        return $this->createSuccessResponse(
            ['writeback_retried' => true],
            $this->processWriteback($resourceRef, $this->tenantContext->currentTenantCode())
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function buildPayload(string $ownerType, string $ownerId, string $query, string $tenantCode): array
    {
        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);
        $configuration = $this->configurationProvider->get($tenantCode);
        $owner = $this->resolveOwner($ownerType, $ownerId);
        $links = $this->assetLinkRepository->findByOwner($ownerType, (string) $owner['owner_id'], $tenantCode);

        if ('' === $query) {
            $query = $configuration->buildSearchQuery((string) $owner['search_seed']);
        }

        $results = [];
        if ($configuration->isConfigured() && '' !== $query) {
            $results = $this->apiClient->searchAssets($query, null, $tenantCode);
        }

        $statusMap = $this->metadataWritebackService->getStatusMap(
            $this->collectResourceRefs(array_merge($links, $results)),
            $tenantCode
        );

        $linkedResources = [];
        $links = array_map(function (array $link) use (&$linkedResources, $statusMap): array {
            $link = $this->attachWritebackStatus($link, $statusMap);
            $linkedResources[(int) $link['resource_ref']] = $link;

            return $link;
        }, $links);

        $response = [
            'configuration' => [
                'tenant_code' => $tenantCode,
                'configured' => $configuration->isConfigured(),
                'default_attribute_code' => $configuration->defaultAttributeCode(),
                'search_template' => $configuration->searchTemplate(),
            ],
            'owner' => $owner,
            'query' => $query,
            'links' => $links,
            'results' => [],
        ];

        if (!$configuration->isConfigured()) {
            return $response + ['message' => 'ResourceSpace is not configured yet for this tenant.'];
        }

        if ('' === $query) {
            return $response;
        }

        $response['results'] = array_map(function (array $result) use ($linkedResources, $statusMap): array {
            $resourceRef = (int) $result['resource_ref'];
            $linked = $linkedResources[$resourceRef] ?? null;

            if (null === $linked) {
                return $this->attachWritebackStatus($result, $statusMap);
            }

            return $this->attachWritebackStatus(array_replace($result, [
                'is_linked' => true,
                'is_primary' => (bool) $linked['is_primary'],
                'synced_attribute' => $linked['synced_attribute'],
            ]), $statusMap);
        }, $results);

        return $response;
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function linkAsset(string $ownerType, string $ownerId, array $payload, string $tenantCode): JsonResponse
    {
        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);
        $configuration = $this->configurationProvider->get($tenantCode);
        if (!$configuration->isConfigured()) {
            return new JsonResponse(
                ['message' => 'ResourceSpace is not configured yet for this tenant.'],
                Response::HTTP_SERVICE_UNAVAILABLE
            );
        }

        $owner = $this->resolveOwner($ownerType, $ownerId);
        $resourceRef = $this->getRequiredResourceRef($payload);
        $setPrimary = (bool) ($payload['setPrimary'] ?? false);
        $shouldSync = (bool) ($payload['syncToAkeneo'] ?? false);

        $asset = $this->apiClient->getAsset($resourceRef, $tenantCode);
        $this->assetLinkRepository->upsertLink(
            $ownerType,
            (string) $owner['owner_id'],
            $asset,
            $this->userContext->getUser()?->getId(),
            $setPrimary,
            $tenantCode
        );
        $warning = $this->processWriteback($resourceRef, $tenantCode);

        if ($shouldSync) {
            try {
                return $this->syncAsset(
                    $ownerType,
                    (string) $owner['owner_id'],
                    $resourceRef,
                    [
                        'attributeCode' => $payload['attributeCode'] ?? $configuration->defaultAttributeCode(),
                        'locale' => $payload['locale'] ?? null,
                        'scope' => $payload['scope'] ?? null,
                    ],
                    $tenantCode,
                    false,
                    $warning
                );
            } catch (\RuntimeException $exception) {
                return $this->createSuccessResponse(
                    [
                        'linked' => true,
                        'synced' => false,
                    ],
                    $this->combineWarnings(
                        $warning,
                        sprintf('The asset was linked in Akeneo, but syncing it into Akeneo failed: %s', $exception->getMessage())
                    )
                );
            }
        }

        return $this->createSuccessResponse(['linked' => true], $warning);
    }

    private function unlinkAsset(string $ownerType, string $ownerId, int $resourceRef, string $tenantCode): JsonResponse
    {
        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);
        $owner = $this->resolveOwner($ownerType, $ownerId);
        $this->assetLinkRepository->removeLink($ownerType, (string) $owner['owner_id'], $resourceRef, $tenantCode);
        $warning = $this->processWriteback($resourceRef, $tenantCode);

        return $this->createSuccessResponse(['unlinked' => true], $warning);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function syncAsset(
        string $ownerType,
        string $ownerId,
        int $resourceRef,
        array $payload,
        string $tenantCode,
        bool $ensureLink = true,
        ?string $warning = null,
    ): JsonResponse {
        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);
        $configuration = $this->configurationProvider->get($tenantCode);
        if (!$configuration->isConfigured()) {
            return new JsonResponse(
                ['message' => 'ResourceSpace is not configured yet for this tenant.'],
                Response::HTTP_SERVICE_UNAVAILABLE
            );
        }

        $owner = $this->resolveOwner($ownerType, $ownerId);
        $attributeCode = trim((string) ($payload['attributeCode'] ?? $configuration->defaultAttributeCode() ?? ''));
        if ('' === $attributeCode) {
            throw new UnprocessableEntityHttpException('No Akeneo media attribute was provided for the ResourceSpace sync.');
        }

        if ($ensureLink) {
            $asset = $this->apiClient->getAsset($resourceRef, $tenantCode);
            $this->assetLinkRepository->upsertLink(
                $ownerType,
                (string) $owner['owner_id'],
                $asset,
                $this->userContext->getUser()?->getId(),
                false,
                $tenantCode
            );
            $warning = $this->combineWarnings($warning, $this->processWriteback($resourceRef, $tenantCode));
        }

        $locale = isset($payload['locale']) ? trim((string) $payload['locale']) : null;
        $scope = isset($payload['scope']) ? trim((string) $payload['scope']) : null;

        $result = OwnerType::PRODUCT === $ownerType
            ? $this->assetSyncService->syncProductAsset(
                (string) $owner['owner_id'],
                $resourceRef,
                $attributeCode,
                $locale,
                $scope,
                $tenantCode
            )
            : $this->assetSyncService->syncProductModelAsset(
                (string) $owner['owner_id'],
                $resourceRef,
                $attributeCode,
                $locale,
                $scope,
                $tenantCode
            );

        $this->assetLinkRepository->markSynced(
            $ownerType,
            (string) $owner['owner_id'],
            $resourceRef,
            $result['attribute_code'],
            $tenantCode
        );

        return $this->createSuccessResponse([
            'synced' => true,
            'attribute_code' => $result['attribute_code'],
            'file_key' => $result['file_key'],
        ], $warning);
    }

    private function assertGranted(string $acl): void
    {
        if (!$this->securityFacade->isGranted($acl)) {
            throw new AccessDeniedHttpException();
        }
    }

    /**
     * @param array<int, string> $acls
     */
    private function assertGrantedAny(array $acls): void
    {
        foreach ($acls as $acl) {
            if ($this->securityFacade->isGranted($acl)) {
                return;
            }
        }

        throw new AccessDeniedHttpException();
    }

    /**
     * @return array<string, mixed>
     */
    private function resolveOwner(string $ownerType, string $ownerId): array
    {
        return $this->ownerResolver->resolve($ownerType, $ownerId);
    }

    /**
     * @return array<string, mixed>
     */
    private function parsePayload(Request $request): array
    {
        if ('' === $request->getContent()) {
            return [];
        }

        try {
            $payload = json_decode($request->getContent(), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $exception) {
            throw new BadRequestHttpException('Invalid ResourceSpace request payload.', $exception);
        }

        return \is_array($payload) ? $payload : [];
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function getRequiredResourceRef(array $payload): int
    {
        $resourceRef = (int) ($payload['resourceRef'] ?? 0);
        if ($resourceRef <= 0) {
            throw new UnprocessableEntityHttpException('A valid ResourceSpace resource reference is required.');
        }

        return $resourceRef;
    }

    private function createErrorResponse(\RuntimeException $exception, int $fallbackStatus): JsonResponse
    {
        if (
            $exception instanceof AccessDeniedHttpException ||
            $exception instanceof BadRequestHttpException ||
            $exception instanceof NotFoundHttpException ||
            $exception instanceof UnprocessableEntityHttpException
        ) {
            throw $exception;
        }

        return new JsonResponse(['message' => $exception->getMessage()], $fallbackStatus);
    }

    /**
     * @param array<int, array<string, mixed>> $assets
     *
     * @return array<int, int>
     */
    private function collectResourceRefs(array $assets): array
    {
        return array_values(array_unique(array_filter(array_map(
            static fn (array $asset): int => (int) ($asset['resource_ref'] ?? 0),
            $assets
        ))));
    }

    /**
     * @param array<string, mixed> $asset
     * @param array<int, array<string, mixed>> $statusMap
     *
     * @return array<string, mixed>
     */
    private function attachWritebackStatus(array $asset, array $statusMap): array
    {
        $status = $statusMap[(int) ($asset['resource_ref'] ?? 0)] ?? null;

        return array_replace($asset, [
            'writeback_status' => $status['status'] ?? null,
            'writeback_error' => $status['error'] ?? null,
            'writeback_attempt_count' => $status['attempt_count'] ?? 0,
            'writeback_requested_at' => $status['requested_at'] ?? null,
            'writeback_attempted_at' => $status['attempted_at'] ?? null,
            'writeback_processed_at' => $status['processed_at'] ?? null,
        ]);
    }

    private function processWriteback(int $resourceRef, string $tenantCode): ?string
    {
        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantCode);
        $configuration = $this->configurationProvider->get($tenantCode);
        if (!$configuration->writebackEnabled()) {
            return null;
        }

        $this->metadataWritebackService->scheduleResource($resourceRef, $tenantCode);
        $result = $this->metadataWritebackService->processResource($resourceRef, $tenantCode);

        if ('failed' !== $result['status']) {
            return null;
        }

        return sprintf(
            'The Akeneo change was saved, but ResourceSpace metadata write-back failed and was queued for retry: %s',
            (string) ($result['message'] ?? 'Unknown error.')
        );
    }

    private function createSuccessResponse(array $payload, ?string $warning = null): JsonResponse
    {
        if (null !== $warning) {
            $payload['warning'] = $warning;
        }

        return new JsonResponse($payload);
    }

    private function combineWarnings(?string ...$warnings): ?string
    {
        $warnings = array_values(array_unique(array_filter(array_map(
            static fn (?string $warning): ?string => null !== $warning && '' !== trim($warning) ? trim($warning) : null,
            $warnings
        ))));

        return [] !== $warnings ? implode(' ', $warnings) : null;
    }
}
