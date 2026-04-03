<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Command;

use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\TenantConfigurationRepository;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Helper\Table;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

final class ListTenantConfigurationsCommand extends Command
{
    protected static $defaultName = 'coppermind:resourcespace:tenant:list';

    public function __construct(private readonly TenantConfigurationRepository $tenantConfigurationRepository)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->setDescription('Lists tenant-scoped ResourceSpace connection settings.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $rows = $this->tenantConfigurationRepository->all();
        if ([] === $rows) {
            $output->writeln('<comment>No tenant-scoped ResourceSpace configurations were found.</comment>');

            return Command::SUCCESS;
        }

        $table = new Table($output);
        $table->setHeaders([
            'Tenant',
            'Label',
            'Status',
            'DAM Enabled',
            'Write-back',
            'API User',
            'Base URI',
            'Attribute',
            'Updated',
        ]);

        foreach ($rows as $row) {
            $table->addRow([
                (string) ($row['tenant_code'] ?? ''),
                (string) ($row['label'] ?? ''),
                (string) ($row['tenant_status'] ?? ''),
                ((bool) ($row['enabled'] ?? false)) ? 'yes' : 'no',
                ((bool) ($row['writeback_enabled'] ?? false)) ? 'yes' : 'no',
                (string) ($row['api_user'] ?? ''),
                (string) ($row['base_uri'] ?? ''),
                (string) ($row['default_attribute_code'] ?? ''),
                (string) ($row['updated_at'] ?? ''),
            ]);
        }

        $table->render();

        return Command::SUCCESS;
    }
}
