<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Symfony\Component\HttpFoundation\RequestStack;

final class TenantContext
{
    public function __construct(
        private readonly RequestStack $requestStack,
        private readonly string $defaultTenantCode,
    ) {
    }

    public function currentTenantCode(): string
    {
        $request = $this->requestStack->getCurrentRequest() ?? $this->requestStack->getMainRequest();
        if (null === $request) {
            return $this->defaultTenantCode();
        }

        $candidates = [
            $request->headers->get('X-Coppermind-Tenant'),
            $request->attributes->get('tenant_code'),
            $request->attributes->get('tenantCode'),
            $request->query->get('tenant_code'),
            $request->query->get('tenantCode'),
            $request->request->get('tenant_code'),
            $request->request->get('tenantCode'),
        ];

        foreach ($candidates as $candidate) {
            $tenantCode = $this->normalizeTenantCode($candidate);
            if ($tenantCode !== $this->defaultTenantCode()) {
                return $tenantCode;
            }
        }

        return $this->defaultTenantCode();
    }

    public function defaultTenantCode(): string
    {
        return $this->normalizeTenantCode($this->defaultTenantCode);
    }

    public function normalizeTenantCode(mixed $tenantCode): string
    {
        $tenantCode = strtolower(trim((string) $tenantCode));
        if ('' === $tenantCode) {
            return strtolower(trim($this->defaultTenantCode));
        }

        $tenantCode = preg_replace('/[^a-z0-9._-]+/', '-', $tenantCode) ?? '';
        $tenantCode = trim($tenantCode, '-.');

        return '' !== $tenantCode ? substr($tenantCode, 0, 64) : strtolower(trim($this->defaultTenantCode));
    }
}
