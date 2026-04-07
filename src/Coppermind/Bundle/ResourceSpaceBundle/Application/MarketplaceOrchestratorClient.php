<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;

final class MarketplaceOrchestratorClient
{
    private readonly string $baseUri;

    public function __construct(
        private readonly ClientInterface $httpClient,
        ?string $baseUri = null,
    ) {
        $environmentBaseUri = $_SERVER['MARKETPLACE_ORCHESTRATOR_BASE_URI']
            ?? $_ENV['MARKETPLACE_ORCHESTRATOR_BASE_URI']
            ?? null;

        $resolvedBaseUri = trim((string) ($baseUri ?? $environmentBaseUri ?? 'http://localhost:8090'));
        $this->baseUri = '' !== $resolvedBaseUri ? rtrim($resolvedBaseUri, '/') : 'http://localhost:8090';
    }

    public function publishProductChanged(array $payload): void
    {
        $response = $this->request('POST', '/v1/events/product-changed', [
            'json' => $payload,
            'headers' => [
                'Content-Type' => 'application/json',
            ],
        ]);

        $statusCode = $response->getStatusCode();
        if ($statusCode >= 200 && $statusCode < 300) {
            return;
        }

        throw new \RuntimeException(sprintf(
            'Marketplace orchestrator returned HTTP %d: %s',
            $statusCode,
            trim((string) $response->getBody())
        ));
    }

    public function health(): array
    {
        $response = $this->request('GET', '/health');
        $statusCode = $response->getStatusCode();
        if ($statusCode < 200 || $statusCode >= 300) {
            throw new \RuntimeException(sprintf('Marketplace orchestrator health check returned HTTP %d.', $statusCode));
        }

        $decoded = json_decode((string) $response->getBody(), true);

        return \is_array($decoded) ? $decoded : [];
    }

    private function request(string $method, string $path, array $options = []): \Psr\Http\Message\ResponseInterface
    {
        $uri = sprintf('%s%s', $this->baseUri, $path);

        try {
            return $this->httpClient->request($method, $uri, array_merge([
                'timeout' => 20,
                'http_errors' => false,
            ], $options));
        } catch (GuzzleException $exception) {
            throw new \RuntimeException(
                sprintf('Marketplace orchestrator request failed for %s %s.', $method, $path),
                previous: $exception
            );
        }
    }
}
