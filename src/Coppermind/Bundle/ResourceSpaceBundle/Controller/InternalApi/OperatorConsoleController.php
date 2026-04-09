<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Controller\InternalApi;

use Akeneo\UserManagement\Bundle\Context\UserContext;
use Coppermind\Bundle\ResourceSpaceBundle\Application\AssetGovernanceService;
use Coppermind\Bundle\ResourceSpaceBundle\Application\OperatorConsoleService;
use Coppermind\Bundle\ResourceSpaceBundle\Application\TenantContext;
use Oro\Bundle\SecurityBundle\SecurityFacade;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

final class OperatorConsoleController
{
    public function __construct(
        private readonly OperatorConsoleService $operatorConsoleService,
        private readonly AssetGovernanceService $assetGovernanceService,
        private readonly TenantContext $tenantContext,
        private readonly SecurityFacade $securityFacade,
        private readonly UserContext $userContext,
        private readonly string $controlPlaneToken = '',
    ) {
    }

    public function dashboardAction(Request $request): JsonResponse
    {
        $this->assertOperatorAccess($request);

        return new JsonResponse($this->operatorConsoleService->dashboard(
            $request->query->get('tenant'),
            max(0, (int) $request->query->get('windowDays', 30)),
            max(1, (int) $request->query->get('limit', 12))
        ));
    }

    public function approvalsAction(Request $request): JsonResponse
    {
        $this->assertOperatorAccess($request);
        $statuses = array_values(array_filter(array_map(
            static fn (string $status): string => trim($status),
            explode(',', (string) $request->query->get('statuses', 'pending,rejected'))
        )));

        return new JsonResponse([
            'tenant_code' => $this->tenantContext->normalizeTenantCode($request->query->get('tenant')),
            'items' => $this->operatorConsoleService->approvals(
                $request->query->get('tenant'),
                max(1, (int) $request->query->get('limit', 50)),
                $statuses
            ),
        ]);
    }

    public function exceptionsAction(Request $request): JsonResponse
    {
        $this->assertOperatorAccess($request);

        return new JsonResponse([
            'tenant_code' => $this->tenantContext->normalizeTenantCode($request->query->get('tenant')),
            'exceptions' => $this->operatorConsoleService->exceptions(
                $request->query->get('tenant'),
                max(1, (int) $request->query->get('limit', 25))
            ),
        ]);
    }

    public function rightsAction(Request $request): JsonResponse
    {
        $this->assertOperatorAccess($request);

        return new JsonResponse([
            'tenant_code' => $this->tenantContext->normalizeTenantCode($request->query->get('tenant')),
            'items' => $this->assetGovernanceService->listComplianceItems(
                max(0, (int) $request->query->get('windowDays', 30)),
                max(1, (int) $request->query->get('limit', 50)),
                $request->query->get('tenant')
            ),
        ]);
    }

    public function updateAssetMetadataAction(Request $request, int $resourceRef): JsonResponse
    {
        $this->assertOperatorAccess($request);
        $payload = $this->parsePayload($request);

        return new JsonResponse([
            'updated' => true,
            'asset' => $this->assetGovernanceService->updateAssetMetadata(
                $resourceRef,
                $payload,
                $this->userContext->getUser()?->getId(),
                null,
                $request->query->get('tenant')
            ),
        ]);
    }

    public function auditAction(Request $request): JsonResponse
    {
        $this->assertOperatorAccess($request);

        return new JsonResponse([
            'tenant_code' => $this->tenantContext->normalizeTenantCode($request->query->get('tenant')),
            'items' => $this->operatorConsoleService->audit(
                $request->query->get('tenant'),
                max(1, (int) $request->query->get('limit', 50))
            ),
        ]);
    }

    private function assertOperatorAccess(Request $request): void
    {
        if ($this->hasValidControlPlaneToken($request)) {
            return;
        }

        if (
            $this->securityFacade->isGranted('pim_enrich_product_edit_attributes')
            || $this->securityFacade->isGranted('pim_enrich_product_model_edit_attributes')
        ) {
            return;
        }

        throw new AccessDeniedHttpException();
    }

    private function hasValidControlPlaneToken(Request $request): bool
    {
        $configuredToken = trim($this->controlPlaneToken);
        if ('' === $configuredToken) {
            return false;
        }

        $header = trim((string) $request->headers->get('Authorization', ''));
        if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
            return false;
        }

        return hash_equals($configuredToken, trim((string) ($matches[1] ?? '')));
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
            throw new BadRequestHttpException('Invalid Operator Console request payload.', $exception);
        }

        if (!\is_array($payload)) {
            throw new BadRequestHttpException('The Operator Console payload must be a JSON object.');
        }

        return $payload;
    }
}
