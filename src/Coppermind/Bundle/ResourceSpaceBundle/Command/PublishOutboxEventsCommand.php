<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Command;

use Coppermind\Bundle\ResourceSpaceBundle\Application\MarketplaceOrchestratorClient;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\OutboxEventRepository;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Lock\LockFactory;

final class PublishOutboxEventsCommand extends Command
{
    protected static $defaultName = 'coppermind:marketplace:outbox:publish';

    public function __construct(
        private readonly OutboxEventRepository $outboxEventRepository,
        private readonly MarketplaceOrchestratorClient $marketplaceOrchestratorClient,
        private readonly LockFactory $lockFactory,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->setDescription('Publishes queued Coppermind outbox events into the marketplace orchestrator.')
            ->addOption('limit', null, InputOption::VALUE_REQUIRED, 'Maximum events to publish in one run.', '25')
            ->addOption('retry-failed', null, InputOption::VALUE_NONE, 'Retry events currently marked as failed.')
            ->addOption('quiet-when-idle', null, InputOption::VALUE_NONE, 'Suppress output when no events are published.')
            ->addOption('tenant', null, InputOption::VALUE_REQUIRED, 'Restrict publishing to a single tenant.', null);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $lock = $this->lockFactory->createLock('coppermind_marketplace_outbox_publisher');
        if (!$lock->acquire()) {
            $output->writeln('<comment>Marketplace outbox publishing is already running elsewhere.</comment>');

            return Command::SUCCESS;
        }

        $processed = 0;
        $failed = 0;

        try {
            $events = $this->outboxEventRepository->findEventsToPublish(
                max(1, (int) $input->getOption('limit')),
                (bool) $input->getOption('retry-failed'),
                null !== $input->getOption('tenant') ? (string) $input->getOption('tenant') : null
            );

            foreach ($events as $event) {
                ++$processed;
                $this->outboxEventRepository->markAttempted((int) $event['id']);

                try {
                    $payload = \is_array($event['payload']) ? $event['payload'] : [];
                    $payload['eventType'] ??= $event['event_type'];
                    $payload['eventContext']['outboxEventId'] = $event['id'];
                    $this->marketplaceOrchestratorClient->publishProductChanged($payload);
                    $this->outboxEventRepository->markSucceeded((int) $event['id']);
                } catch (\Throwable $exception) {
                    ++$failed;
                    $this->outboxEventRepository->markFailed((int) $event['id'], $exception->getMessage());
                }
            }
        } finally {
            $lock->release();
        }

        if (0 === $processed && (bool) $input->getOption('quiet-when-idle')) {
            return Command::SUCCESS;
        }

        $output->writeln(sprintf(
            'Published %d marketplace outbox event(s); %d failed.',
            $processed,
            $failed
        ));

        return 0 === $failed ? Command::SUCCESS : Command::FAILURE;
    }
}
