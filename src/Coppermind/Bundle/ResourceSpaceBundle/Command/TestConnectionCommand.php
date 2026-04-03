<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Command;

use Coppermind\Bundle\ResourceSpaceBundle\Application\ResourceSpaceApiClient;
use Coppermind\Bundle\ResourceSpaceBundle\Application\TenantAwareResourceSpaceConfigurationProvider;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

final class TestConnectionCommand extends Command
{
    protected static $defaultName = 'coppermind:resourcespace:test-connection';

    public function __construct(
        private readonly TenantAwareResourceSpaceConfigurationProvider $configurationProvider,
        private readonly ResourceSpaceApiClient $apiClient,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->setDescription('Verifies that the configured ResourceSpace API is reachable from Akeneo.')
            ->addOption('tenant', null, InputOption::VALUE_REQUIRED, 'Tenant code to test.', null);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $tenantCode = $this->configurationProvider->resolveTenantCode(
            null !== $input->getOption('tenant') ? (string) $input->getOption('tenant') : null
        );
        $configuration = $this->configurationProvider->get($tenantCode);

        if (!$configuration->isConfigured()) {
            $output->writeln(sprintf(
                '<error>ResourceSpace is not configured for tenant "%s". Set the tenant configuration or RESOURCE_SPACE_* env vars first.</error>',
                $tenantCode
            ));

            return Command::FAILURE;
        }

        try {
            $this->apiClient->ping($tenantCode);
        } catch (\RuntimeException $exception) {
            $output->writeln(sprintf('<error>%s</error>', $exception->getMessage()));

            return Command::FAILURE;
        }

        $output->writeln(sprintf('<info>ResourceSpace API connection succeeded for tenant "%s".</info>', $tenantCode));

        return Command::SUCCESS;
    }
}
