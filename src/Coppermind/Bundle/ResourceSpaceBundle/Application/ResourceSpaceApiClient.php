<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Coppermind\Bundle\ResourceSpaceBundle\Domain\ResourceSpaceConfiguration;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;
use Psr\Http\Message\ResponseInterface;

final class ResourceSpaceApiClient
{
    public function __construct(
        private readonly ClientInterface $httpClient,
        private readonly TenantAwareResourceSpaceConfigurationProvider $configurationProvider,
    ) {
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function searchAssets(string $query, ?int $limit = null, ?string $tenantCode = null): array
    {
        $query = trim($query);
        if ('' === $query) {
            return [];
        }

        $configuration = $this->configuration($tenantCode);
        $response = $this->call('search_get_previews', [
            'search' => $query,
            'fetchrows' => sprintf('0,%d', $limit ?? $configuration->searchLimit()),
            'archive' => 0,
            'getsizes' => 'thm,scr',
        ], $configuration);

        if (!\is_array($response)) {
            return [];
        }

        if (isset($response['data']) && \is_array($response['data'])) {
            $response = $response['data'];
        }

        return array_values(array_filter(array_map(function ($asset) use ($configuration): ?array {
            if (!\is_array($asset)) {
                return null;
            }

            return $this->normalizeAsset($asset, $configuration);
        }, $response)));
    }

    /**
     * @return array<string, mixed>
     */
    public function getAsset(int $resourceRef, ?string $tenantCode = null): array
    {
        $configuration = $this->configuration($tenantCode);
        $resourceData = $this->call('get_resource_data', ['resource' => $resourceRef], $configuration);
        if (!\is_array($resourceData) || !isset($resourceData['ref'])) {
            throw new \RuntimeException(sprintf('ResourceSpace asset %d was not found.', $resourceRef));
        }

        $previewUrl = $this->getResourcePath(
            $resourceRef,
            (string) ($resourceData['preview_extension'] ?? $resourceData['file_extension'] ?? ''),
            'scr',
            $configuration
        );

        $downloadUrl = $this->getResourcePath(
            $resourceRef,
            (string) ($resourceData['file_extension'] ?? ''),
            '',
            $configuration
        );

        return $this->normalizeAsset($resourceData, $configuration, $previewUrl, $downloadUrl);
    }

    /**
     * @return array{file: \SplFileInfo, asset: array<string, mixed>}
     */
    public function downloadAsset(int $resourceRef, ?string $tenantCode = null): array
    {
        $configuration = $this->configuration($tenantCode);
        $asset = $this->getAsset($resourceRef, $tenantCode);
        $downloadUrl = $this->internalizeUrl((string) ($asset['download_url'] ?? ''), $configuration);
        if ('' === $downloadUrl) {
            throw new \RuntimeException(sprintf('ResourceSpace asset %d has no downloadable URL.', $resourceRef));
        }

        $temporaryPath = $this->allocateTemporaryDownloadPath(
            $this->normalizeExtension((string) ($asset['file_extension'] ?? ''))
        );

        try {
            $response = $this->httpClient->request('GET', $downloadUrl, [
                'timeout' => $configuration->timeoutSeconds(),
                'sink' => $temporaryPath,
                'http_errors' => false,
            ]);
            $this->assertSuccessfulResponse(
                $response,
                sprintf('Unable to download ResourceSpace asset %d.', $resourceRef)
            );
        } catch (GuzzleException $exception) {
            @unlink($temporaryPath);

            throw new \RuntimeException(
                sprintf('Unable to download ResourceSpace asset %d.', $resourceRef),
                previous: $exception
            );
        } catch (\RuntimeException $exception) {
            @unlink($temporaryPath);

            throw $exception;
        }

        return [
            'file' => new \SplFileInfo($temporaryPath),
            'asset' => $asset,
        ];
    }

    public function ping(?string $tenantCode = null): void
    {
        $configuration = $this->configuration($tenantCode);

        $this->call('do_search', [
            'search' => '',
            'fetchrows' => '1',
            'archive' => 0,
        ], $configuration);
    }

    /**
     * @param array<string, scalar|scalar[]|null> $metadata
     */
    public function createResource(
        int $resourceType,
        ?string $uploadUrl = null,
        array $metadata = [],
        ?string $tenantCode = null,
    ): int {
        $configuration = $this->configuration($tenantCode);
        $metadata = array_filter(array_map(function (mixed $value): ?string {
            if (\is_array($value) || (!\is_scalar($value) && null !== $value)) {
                return null;
            }

            $value = trim((string) $value);

            return '' !== $value ? $value : null;
        }, $metadata));

        $parameters = [
            'resource_type' => $resourceType,
            'archive' => 0,
            'url' => null !== $uploadUrl ? trim($uploadUrl) : '',
            'metadata' => [] !== $metadata ? json_encode($metadata, JSON_THROW_ON_ERROR) : '',
        ];

        $response = $this->call('create_resource', $parameters, $configuration);
        if (\is_numeric($response) && (int) $response > 0) {
            return (int) $response;
        }

        if (\is_string($response) && '' !== trim($response)) {
            throw new \RuntimeException(trim($response));
        }

        throw new \RuntimeException('ResourceSpace did not create a resource for the requested smoke test asset.');
    }

    public function updateField(int $resourceRef, string $field, ?string $value, ?string $tenantCode = null): void
    {
        $field = trim($field);
        if ($resourceRef <= 0 || '' === $field) {
            return;
        }

        $configuration = $this->configuration($tenantCode);
        $response = $this->call('update_field', [
            'resource' => $resourceRef,
            'field' => $field,
            'value' => null !== $value ? trim($value) : '',
        ], $configuration);

        if (false === $response) {
            throw new \RuntimeException(
                sprintf('ResourceSpace rejected metadata update for resource %d and field "%s".', $resourceRef, $field)
            );
        }
    }

    /**
     * @param array<string, scalar|null> $parameters
     *
     * @return mixed
     */
    private function call(string $function, array $parameters, ResourceSpaceConfiguration $configuration): mixed
    {
        if (!$configuration->isConfigured()) {
            throw new \RuntimeException('ResourceSpace is not configured yet.');
        }

        $queryParameters = array_filter(
            array_merge(
                [
                    'user' => $configuration->apiUser(),
                    'function' => $function,
                ],
                array_map(
                    static fn ($value): string => \is_bool($value) ? ($value ? 'true' : 'false') : (string) $value,
                    $parameters
                )
            ),
            static fn ($value): bool => null !== $value && '' !== $value
        );

        $query = http_build_query($queryParameters, '', '&', PHP_QUERY_RFC3986);
        $signature = hash('sha256', $configuration->apiKey() . $query);
        $url = sprintf('%s?%s&sign=%s', $configuration->apiEndpoint(), $query, $signature);

        try {
            $response = $this->httpClient->request('GET', $url, [
                'timeout' => $configuration->timeoutSeconds(),
                'http_errors' => false,
            ]);
        } catch (GuzzleException $exception) {
            throw new \RuntimeException(
                sprintf('ResourceSpace API request failed for "%s".', $function),
                previous: $exception
            );
        }

        $this->assertSuccessfulResponse($response, sprintf('ResourceSpace API request failed for "%s".', $function));

        $content = (string) $response->getBody();
        $decoded = json_decode($content, true);
        if (JSON_ERROR_NONE !== json_last_error()) {
            throw new \RuntimeException(
                sprintf('ResourceSpace returned invalid JSON for "%s": %s', $function, json_last_error_msg())
            );
        }

        if (\is_array($decoded) && isset($decoded['error'])) {
            throw new \RuntimeException((string) $decoded['error']);
        }

        return $decoded;
    }

    private function getResourcePath(
        int $resourceRef,
        string $extension = '',
        string $size = '',
        ?ResourceSpaceConfiguration $configuration = null,
    ): string {
        $configuration ??= $this->configuration();
        $response = $this->call('get_resource_path', [
            'ref' => $resourceRef,
            'extension' => $extension,
            'size' => $size,
            'generate' => true,
        ], $configuration);

        return \is_string($response) ? $response : '';
    }

    /**
     * @param array<string, mixed> $asset
     *
     * @return array<string, mixed>
     */
    private function normalizeAsset(
        array $asset,
        ResourceSpaceConfiguration $configuration,
        ?string $previewUrl = null,
        ?string $downloadUrl = null,
    ): array {
        $resourceRef = (int) ($asset['ref'] ?? 0);
        if ($resourceRef <= 0) {
            throw new \RuntimeException('ResourceSpace returned an asset without a valid reference.');
        }

        $previewUrl ??= $this->firstString($asset, ['url_scr', 'url_pre', 'url_thm']);
        $downloadUrl ??= $this->firstString($asset, ['download_url']);

        $fileExtension = $this->normalizeExtension($this->firstString($asset, ['file_extension', 'extension']));
        if ('' === $fileExtension && '' !== $downloadUrl) {
            $fileExtension = $this->normalizeExtension(pathinfo((string) parse_url($downloadUrl, PHP_URL_PATH), PATHINFO_EXTENSION));
        }

        $previewExtension = $this->normalizeExtension($this->firstString($asset, ['preview_extension']));
        if ('' === $previewExtension && '' !== $previewUrl) {
            $previewExtension = $this->normalizeExtension(pathinfo((string) parse_url($previewUrl, PHP_URL_PATH), PATHINFO_EXTENSION));
        }

        $title = $this->firstString($asset, ['field8', 'title', 'resource_type_field', 'original_filename']);
        if ('' === $title) {
            $title = sprintf('Resource %d', $resourceRef);
        }

        return [
            'resource_ref' => $resourceRef,
            'title' => $title,
            'file_extension' => $fileExtension,
            'preview_extension' => $previewExtension,
            'preview_url' => $this->externalizeUrl($previewUrl, $configuration),
            'thumbnail_url' => $this->externalizeUrl($this->firstString($asset, ['url_thm', 'url_pre']) ?: $previewUrl, $configuration),
            'download_url' => $this->externalizeUrl($downloadUrl, $configuration),
            'ui_url' => $configuration->resourceUiUrl($resourceRef),
            'resource_type' => $this->firstString($asset, ['resource_type_name', 'resource_type']),
            'is_linked' => false,
            'is_primary' => false,
            'synced_attribute' => null,
        ];
    }

    /**
     * @param array<string, mixed> $asset
     */
    private function firstString(array $asset, array $keys): string
    {
        foreach ($keys as $key) {
            $value = $asset[$key] ?? null;
            if (\is_scalar($value)) {
                $value = trim((string) $value);
                if ('' !== $value) {
                    return $value;
                }
            }
        }

        return '';
    }

    private function normalizeExtension(string $extension): string
    {
        return strtolower(trim(ltrim($extension, '.')));
    }

    private function externalizeUrl(?string $url, ResourceSpaceConfiguration $configuration): string
    {
        $url = $this->normalizeAbsoluteUrl((string) $url, $configuration->internalBaseUri());
        if ('' === $url) {
            return '';
        }

        $internalBaseUri = $configuration->internalBaseUri();
        $publicBaseUri = $configuration->publicBaseUri();

        if ('' !== $internalBaseUri && str_starts_with($url, $internalBaseUri)) {
            return $publicBaseUri . substr($url, \strlen($internalBaseUri));
        }

        return $url;
    }

    private function internalizeUrl(?string $url, ResourceSpaceConfiguration $configuration): string
    {
        $url = trim((string) $url);
        if ('' === $url) {
            return '';
        }

        $publicBaseUri = $configuration->publicBaseUri();
        $internalBaseUri = $configuration->internalBaseUri();
        $baseUri = '' !== $publicBaseUri ? $publicBaseUri : $internalBaseUri;
        $url = $this->normalizeAbsoluteUrl($url, $baseUri);

        if ('' !== $publicBaseUri && str_starts_with($url, $publicBaseUri)) {
            return $internalBaseUri . substr($url, \strlen($publicBaseUri));
        }

        return $url;
    }

    private function normalizeAbsoluteUrl(string $url, string $baseUri): string
    {
        $url = trim($url);
        if ('' === $url) {
            return '';
        }

        if (str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) {
            return $url;
        }

        if (str_starts_with($url, '//')) {
            $scheme = (string) (parse_url($baseUri, PHP_URL_SCHEME) ?: 'https');

            return sprintf('%s:%s', $scheme, $url);
        }

        if ('' === $baseUri) {
            return $url;
        }

        if (str_starts_with($url, '/')) {
            return $baseUri . $url;
        }

        return sprintf('%s/%s', $baseUri, ltrim($url, '/'));
    }

    private function allocateTemporaryDownloadPath(string $extension): string
    {
        $temporaryPath = tempnam(sys_get_temp_dir(), 'rs_asset_');
        if (false === $temporaryPath) {
            throw new \RuntimeException('Unable to allocate temporary storage for ResourceSpace asset download.');
        }

        if ('' === $extension) {
            return $temporaryPath;
        }

        $finalPath = sprintf('%s.%s', $temporaryPath, $extension);
        if (!@rename($temporaryPath, $finalPath)) {
            @unlink($temporaryPath);
            throw new \RuntimeException('Unable to prepare a temporary file for ResourceSpace asset download.');
        }

        return $finalPath;
    }

    private function assertSuccessfulResponse(ResponseInterface $response, string $message): void
    {
        if ($response->getStatusCode() < 400) {
            return;
        }

        throw new \RuntimeException(sprintf('%s ResourceSpace responded with HTTP %d.', $message, $response->getStatusCode()));
    }

    private function configuration(?string $tenantCode = null): ResourceSpaceConfiguration
    {
        return $this->configurationProvider->get($tenantCode);
    }
}
