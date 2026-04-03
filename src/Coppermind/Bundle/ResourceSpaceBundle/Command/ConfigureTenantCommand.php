<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Command;

use Coppermind\Bundle\ResourceSpaceBundle\Application\TenantAwareResourceSpaceConfigurationProvider;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\TenantConfigurationRepository;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Helper\Table;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

final class ConfigureTenantCommand extends Command
{
    protected static $defaultName = 'coppermind:resourcespace:tenant:configure';

    public function __construct(
        private readonly TenantConfigurationRepository $tenantConfigurationRepository,
        private readonly TenantAwareResourceSpaceConfigurationProvider $configurationProvider,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->setDescription('Creates or updates a tenant-scoped ResourceSpace configuration.')
            ->addOption('tenant', null, InputOption::VALUE_REQUIRED, 'Tenant code to create or update.')
            ->addOption('label', null, InputOption::VALUE_REQUIRED, 'Human-readable tenant label.', null)
            ->addOption('status', null, InputOption::VALUE_REQUIRED, 'Tenant status (for example: active, disabled).', null)
            ->addOption('enabled', null, InputOption::VALUE_REQUIRED, 'Enable the DAM connection for this tenant (1/0, true/false).', null)
            ->addOption('base-uri', null, InputOption::VALUE_REQUIRED, 'Browser-facing ResourceSpace base URI.', null)
            ->addOption('internal-base-uri', null, InputOption::VALUE_REQUIRED, 'Internal ResourceSpace base URI used by Akeneo workers.', null)
            ->addOption('api-user', null, InputOption::VALUE_REQUIRED, 'ResourceSpace API username.', null)
            ->addOption('api-key', null, InputOption::VALUE_REQUIRED, 'ResourceSpace API key.', null)
            ->addOption('search-template', null, InputOption::VALUE_REQUIRED, 'ResourceSpace search template.', null)
            ->addOption('default-attribute', null, InputOption::VALUE_REQUIRED, 'Default Akeneo media attribute code.', null)
            ->addOption('search-limit', null, InputOption::VALUE_REQUIRED, 'Default ResourceSpace search result limit.', null)
            ->addOption('timeout', null, InputOption::VALUE_REQUIRED, 'API timeout in seconds.', null)
            ->addOption('writeback-enabled', null, InputOption::VALUE_REQUIRED, 'Enable write-back for this tenant (1/0, true/false).', null)
            ->addOption('writeback-identifier-field', null, InputOption::VALUE_REQUIRED, 'Identifier field shortname or field ID.', null)
            ->addOption('writeback-uuid-field', null, InputOption::VALUE_REQUIRED, 'UUID field shortname or field ID.', null)
            ->addOption('writeback-owner-type-field', null, InputOption::VALUE_REQUIRED, 'Owner type field shortname or field ID.', null)
            ->addOption('writeback-links-field', null, InputOption::VALUE_REQUIRED, 'Links field shortname or field ID.', null);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $tenantOption = $this->optionValue($input, 'tenant');
        if (null === $tenantOption || '' === $tenantOption) {
            $output->writeln('<error>Provide --tenant.</error>');

            return Command::FAILURE;
        }

        $tenantCode = $this->configurationProvider->resolveTenantCode($tenantOption);
        $existing = $this->tenantConfigurationRepository->find($tenantCode) ?? [];
        $defaults = $this->configurationProvider->get($this->configurationProvider->defaultTenantCode());

        try {
            $configuration = [
                'enabled' => $this->boolOption($input, 'enabled', (bool) ($existing['enabled'] ?? true)),
                'base_uri' => $this->fallback(
                    $this->optionValue($input, 'base-uri'),
                    $existing['base_uri'] ?? null,
                    $defaults->baseUri()
                ),
                'internal_base_uri' => $this->fallback(
                    $this->optionValue($input, 'internal-base-uri'),
                    $existing['internal_base_uri'] ?? null,
                    $defaults->internalBaseUri()
                ),
                'api_user' => $this->fallback(
                    $this->optionValue($input, 'api-user'),
                    $existing['api_user'] ?? null,
                    $defaults->apiUser()
                ),
                'api_key' => $this->fallback(
                    $this->optionValue($input, 'api-key'),
                    $existing['api_key'] ?? null,
                    $defaults->apiKey()
                ),
                'search_template' => $this->fallback(
                    $this->optionValue($input, 'search-template'),
                    $existing['search_template'] ?? null,
                    $defaults->searchTemplate()
                ),
                'default_attribute_code' => $this->fallback(
                    $this->optionValue($input, 'default-attribute'),
                    $existing['default_attribute_code'] ?? null,
                    $defaults->defaultAttributeCode() ?? ''
                ),
                'search_limit' => $this->intOption($input, 'search-limit', (int) ($existing['search_limit'] ?? $defaults->searchLimit())),
                'timeout_seconds' => $this->intOption($input, 'timeout', (int) ($existing['timeout_seconds'] ?? $defaults->timeoutSeconds())),
                'writeback_enabled' => $this->boolOption(
                    $input,
                    'writeback-enabled',
                    (bool) ($existing['writeback_enabled'] ?? $defaults->writebackEnabled())
                ),
                'writeback_identifier_field' => $this->fallback(
                    $this->optionValue($input, 'writeback-identifier-field'),
                    $existing['writeback_identifier_field'] ?? null,
                    $defaults->writebackIdentifierField()
                ),
                'writeback_uuid_field' => $this->fallback(
                    $this->optionValue($input, 'writeback-uuid-field'),
                    $existing['writeback_uuid_field'] ?? null,
                    $defaults->writebackUuidField()
                ),
                'writeback_owner_type_field' => $this->fallback(
                    $this->optionValue($input, 'writeback-owner-type-field'),
                    $existing['writeback_owner_type_field'] ?? null,
                    $defaults->writebackOwnerTypeField()
                ),
                'writeback_links_field' => $this->fallback(
                    $this->optionValue($input, 'writeback-links-field'),
                    $existing['writeback_links_field'] ?? null,
                    $defaults->writebackLinksField()
                ),
            ];
        } catch (\InvalidArgumentException $exception) {
            $output->writeln(sprintf('<error>%s</error>', $exception->getMessage()));

            return Command::FAILURE;
        }

        $label = $this->fallback(
            $this->optionValue($input, 'label'),
            $existing['label'] ?? null,
            ucwords(str_replace(['-', '_', '.'], ' ', $tenantCode))
        );
        $status = $this->fallback($this->optionValue($input, 'status'), $existing['tenant_status'] ?? null, 'active');

        try {
            $this->tenantConfigurationRepository->upsert($tenantCode, $label, $status, $configuration);
        } catch (\Throwable $throwable) {
            $output->writeln(sprintf('<error>%s</error>', $throwable->getMessage()));

            return Command::FAILURE;
        }

        if ($configuration['enabled'] && ('' === $configuration['api_user'] || '' === $configuration['api_key'])) {
            $output->writeln('<comment>The tenant configuration was saved, but the connection is still incomplete because the API user or API key is blank.</comment>');
        }

        $table = new Table($output);
        $table->setHeaders(['Setting', 'Value']);
        $table->setRows([
            ['tenant', $tenantCode],
            ['label', $label],
            ['status', $status],
            ['enabled', $configuration['enabled'] ? 'yes' : 'no'],
            ['base_uri', $configuration['base_uri']],
            ['internal_base_uri', $configuration['internal_base_uri']],
            ['api_user', $configuration['api_user']],
            ['default_attribute_code', $configuration['default_attribute_code']],
            ['writeback_enabled', $configuration['writeback_enabled'] ? 'yes' : 'no'],
        ]);

        $output->writeln(sprintf('<info>Saved ResourceSpace settings for tenant "%s".</info>', $tenantCode));
        $table->render();

        return Command::SUCCESS;
    }

    private function optionValue(InputInterface $input, string $name): ?string
    {
        $value = $input->getOption($name);
        if (null === $value) {
            return null;
        }

        return trim((string) $value);
    }

    private function fallback(?string $first, mixed $second, string $third): string
    {
        if (null !== $first && '' !== $first) {
            return $first;
        }

        $second = trim((string) $second);
        if ('' !== $second) {
            return $second;
        }

        return $third;
    }

    private function boolOption(InputInterface $input, string $name, bool $fallback): bool
    {
        $value = $input->getOption($name);
        if (null === $value) {
            return $fallback;
        }

        $parsed = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if (null === $parsed) {
            throw new \InvalidArgumentException(sprintf('Option --%s expects a boolean value.', $name));
        }

        return $parsed;
    }

    private function intOption(InputInterface $input, string $name, int $fallback): int
    {
        $value = $input->getOption($name);
        if (null === $value) {
            return $fallback;
        }

        if (!is_numeric($value)) {
            throw new \InvalidArgumentException(sprintf('Option --%s expects an integer value.', $name));
        }

        return max(1, (int) $value);
    }
}
