<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Command;

use Coppermind\Bundle\ResourceSpaceBundle\Application\AssetGovernanceService;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Lock\LockFactory;

final class MonitorAssetGovernanceCommand extends Command
{
    protected static $defaultName = 'coppermind:resourcespace:asset-governance:monitor';

    public function __construct(
        private readonly AssetGovernanceService $assetGovernanceService,
        private readonly LockFactory $lockFactory,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->setDescription('Monitors expiring or restricted DAM asset rights and refreshes linked owner governance state.')
            ->addOption('window-days', null, InputOption::VALUE_REQUIRED, 'Days before expiry that should trigger a warning.', '30')
            ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Maximum assets to inspect in one run.', '100')
            ->addOption('tenant', null, InputOption::VALUE_REQUIRED, 'Restrict processing to a single tenant.', null)
            ->addOption('quiet-when-idle', null, InputOption::VALUE_NONE, 'Suppress output when nothing requires processing.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $lock = $this->lockFactory->createLock('coppermind_asset_governance_monitor');
        if (!$lock->acquire()) {
            $output->writeln('<comment>Asset governance monitoring is already running elsewhere.</comment>');

            return Command::SUCCESS;
        }

        try {
            $summary = $this->assetGovernanceService->monitorComplianceQueue(
                max(0, (int) $input->getOption('window-days')),
                max(1, (int) $input->getOption('limit')),
                null !== $input->getOption('tenant') ? (string) $input->getOption('tenant') : null
            );
        } finally {
            $lock->release();
        }

        if (0 === $summary['processed_assets'] && (bool) $input->getOption('quiet-when-idle')) {
            return Command::SUCCESS;
        }

        $output->writeln(sprintf(
            'Processed %d asset-governance records and refreshed %d linked owner state(s).',
            $summary['processed_assets'],
            $summary['notified_links']
        ));

        return Command::SUCCESS;
    }
}
