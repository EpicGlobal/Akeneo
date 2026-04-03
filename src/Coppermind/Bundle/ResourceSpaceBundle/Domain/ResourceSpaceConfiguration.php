<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Domain;

final class ResourceSpaceConfiguration
{
    public function __construct(
        private readonly string $baseUri,
        private readonly string $internalBaseUri,
        private readonly string $apiUser,
        private readonly string $apiKey,
        private readonly string $searchTemplate,
        private readonly string $defaultAttributeCode,
        private readonly int $searchLimit,
        private readonly int $timeoutSeconds,
        private readonly bool $writebackEnabled,
        private readonly string $writebackIdentifierField,
        private readonly string $writebackUuidField,
        private readonly string $writebackOwnerTypeField,
        private readonly string $writebackLinksField,
    ) {
    }

    public function isConfigured(): bool
    {
        return '' !== $this->internalBaseUri() && '' !== $this->apiUser() && '' !== $this->apiKey();
    }

    public function baseUri(): string
    {
        return $this->publicBaseUri();
    }

    public function publicBaseUri(): string
    {
        $baseUri = rtrim(trim($this->baseUri), '/');

        return '' !== $baseUri ? $baseUri : rtrim(trim($this->internalBaseUri), '/');
    }

    public function internalBaseUri(): string
    {
        $baseUri = rtrim(trim($this->internalBaseUri), '/');

        return '' !== $baseUri ? $baseUri : $this->publicBaseUri();
    }

    public function apiUser(): string
    {
        return trim($this->apiUser);
    }

    public function apiKey(): string
    {
        return trim($this->apiKey);
    }

    public function apiEndpoint(): string
    {
        return sprintf('%s/api/', $this->internalBaseUri());
    }

    public function searchTemplate(): string
    {
        $template = trim($this->searchTemplate);

        return '' !== $template ? $template : '%s';
    }

    public function buildSearchQuery(string $seed): string
    {
        $seed = trim($seed);
        if ('' === $seed) {
            return '';
        }

        $template = $this->searchTemplate();

        return str_contains($template, '%s') ? sprintf($template, $seed) : trim(sprintf('%s %s', $template, $seed));
    }

    public function defaultAttributeCode(): ?string
    {
        $attributeCode = trim($this->defaultAttributeCode);

        return '' !== $attributeCode ? $attributeCode : null;
    }

    public function searchLimit(): int
    {
        return max(1, $this->searchLimit);
    }

    public function timeoutSeconds(): int
    {
        return max(1, $this->timeoutSeconds);
    }

    public function resourceUiUrl(int $resourceRef): string
    {
        return sprintf('%s/pages/view.php?ref=%d', $this->publicBaseUri(), $resourceRef);
    }

    public function writebackEnabled(): bool
    {
        return $this->isConfigured() && $this->writebackEnabled && [] !== $this->writebackFields();
    }

    /**
     * @return array<string, string>
     */
    public function writebackFields(): array
    {
        $fields = [
            'identifier' => $this->normalizeFieldName($this->writebackIdentifierField),
            'uuid' => $this->normalizeFieldName($this->writebackUuidField),
            'owner_type' => $this->normalizeFieldName($this->writebackOwnerTypeField),
            'links' => $this->normalizeFieldName($this->writebackLinksField),
        ];

        return array_filter($fields, static fn (?string $field): bool => null !== $field);
    }

    public function writebackIdentifierField(): ?string
    {
        return $this->normalizeFieldName($this->writebackIdentifierField);
    }

    public function writebackUuidField(): ?string
    {
        return $this->normalizeFieldName($this->writebackUuidField);
    }

    public function writebackOwnerTypeField(): ?string
    {
        return $this->normalizeFieldName($this->writebackOwnerTypeField);
    }

    public function writebackLinksField(): ?string
    {
        return $this->normalizeFieldName($this->writebackLinksField);
    }

    private function normalizeFieldName(string $field): ?string
    {
        $field = trim($field);

        return '' !== $field ? $field : null;
    }
}
