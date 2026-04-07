<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Command;

use Coppermind\Bundle\ResourceSpaceBundle\Application\ResourceSpaceMediaIngestService;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Lock\LockFactory;

final class ProcessMediaIngestJobsCommand extends Command
{
    protected static $defaultName = 'coppermind:resourcespace:media-ingest:process';

    public function __construct(
        private readonly ResourceSpaceMediaIngestService $mediaIngestService,
        private readonly LockFactory $lockFactory,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->setDescription('Processes queued ResourceSpace binary media ingest jobs.')
            ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Maximum jobs to process in one run.', '10')
            ->addOption('retry-failed', null, InputOption::VALUE_NONE, 'Retry jobs currently marked as failed.')
            ->addOption('quiet-when-idle', null, InputOption::VALUE_NONE, 'Suppress output when no jobs are processed.')
            ->addOption('tenant', null, InputOption::VALUE_REQUIRED, 'Restrict processing to a single tenant.', null);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $lock = $this->lockFactory->createLock('coppermind_resourcespace_media_ingest_worker');
        if (!$lock->acquire()) {
            $output->writeln('<comment>ResourceSpace media ingest processing is already running elsewhere.</comment>');

            return Command::SUCCESS;
        }

        try {
            $summary = $this->mediaIngestService->processQueuedJobs(
                max(1, (int) $input->getOption('limit')),
                (bool) $input->getOption('retry-failed'),
                null !== $input->getOption('tenant') ? (string) $input->getOption('tenant') : null
            );
        } finally {
            $lock->release();
        }

        if (0 === $summary['processed'] && (bool) $input->getOption('quiet-when-idle')) {
            return Command::SUCCESS;
        }

        $output->writeln(sprintf(
            'Processed %d ResourceSpace media ingest job(s): %d succeeded, %d failed, %d skipped.',
            $summary['processed'],
            $summary['succeeded'],
            $summary['failed'],
            $summary['skipped']
        ));

        return 0 === $summary['failed'] ? Command::SUCCESS : Command::FAILURE;
    }
}
