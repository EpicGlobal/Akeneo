<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Command;

use Coppermind\Bundle\ResourceSpaceBundle\Application\ResourceSpaceApiClient;
use Coppermind\Bundle\ResourceSpaceBundle\Application\ResourceSpaceAssetSyncService;
use Coppermind\Bundle\ResourceSpaceBundle\Application\ResourceSpaceMetadataWritebackService;
use Coppermind\Bundle\ResourceSpaceBundle\Application\ResourceSpaceOwnerResolver;
use Coppermind\Bundle\ResourceSpaceBundle\Application\TenantAwareResourceSpaceConfigurationProvider;
use Coppermind\Bundle\ResourceSpaceBundle\Domain\OwnerType;
use Coppermind\Bundle\ResourceSpaceBundle\Infrastructure\Persistence\AssetLinkRepository;
use Doctrine\DBAL\Connection;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

final class SmokeTestCommand extends Command
{
    protected static $defaultName = 'coppermind:resourcespace:smoke-test';

    private const DEFAULT_PRIMARY_UPLOAD_URL = 'https://dummyimage.com/960x640/0f5c8a/ffffff.jpg?text=Coppermind+Smoke+A';
    private const DEFAULT_SECONDARY_UPLOAD_URL = 'https://dummyimage.com/960x640/135c3f/ffffff.jpg?text=Coppermind+Smoke+B';

    public function __construct(
        private readonly TenantAwareResourceSpaceConfigurationProvider $configurationProvider,
        private readonly ResourceSpaceApiClient $apiClient,
        private readonly ResourceSpaceAssetSyncService $assetSyncService,
        private readonly ResourceSpaceMetadataWritebackService $metadataWritebackService,
        private readonly AssetLinkRepository $assetLinkRepository,
        private readonly ResourceSpaceOwnerResolver $ownerResolver,
        private readonly Connection $connection,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->setDescription('Creates smoke-test assets in ResourceSpace and verifies the Akeneo link/sync/write-back flow.')
            ->addOption('tenant', null, InputOption::VALUE_REQUIRED, 'Tenant code to test.', null)
            ->addOption('product-uuid', null, InputOption::VALUE_REQUIRED, 'Akeneo product UUID to use for the smoke test.', null)
            ->addOption('attribute', null, InputOption::VALUE_REQUIRED, 'Akeneo media attribute to sync into.', null)
            ->addOption('primary-resource-ref', null, InputOption::VALUE_REQUIRED, 'Existing primary ResourceSpace resource ref to use.', null)
            ->addOption('secondary-resource-ref', null, InputOption::VALUE_REQUIRED, 'Existing secondary ResourceSpace resource ref to use.', null)
            ->addOption('primary-upload-url', null, InputOption::VALUE_REQUIRED, 'Remote image URL for the first DAM asset.', self::DEFAULT_PRIMARY_UPLOAD_URL)
            ->addOption('secondary-upload-url', null, InputOption::VALUE_REQUIRED, 'Remote image URL for the second DAM asset.', self::DEFAULT_SECONDARY_UPLOAD_URL);
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $tenantCode = $this->configurationProvider->resolveTenantCode(
            null !== $input->getOption('tenant') ? (string) $input->getOption('tenant') : null
        );
        $configuration = $this->configurationProvider->get($tenantCode);
        if (!$configuration->isConfigured()) {
            $output->writeln(sprintf(
                '<error>ResourceSpace is not configured for tenant "%s".</error>',
                $tenantCode
            ));

            return Command::FAILURE;
        }

        $productUuid = trim((string) ($input->getOption('product-uuid') ?? ''));
        if ('' === $productUuid) {
            $productUuid = $this->findFirstProductUuid();
        }

        $owner = $this->ownerResolver->resolve(OwnerType::PRODUCT, $productUuid);
        $attributeCode = trim((string) ($input->getOption('attribute') ?? $configuration->defaultAttributeCode() ?? ''));
        if ('' === $attributeCode) {
            $output->writeln('<error>No Akeneo media attribute is configured for the smoke test.</error>');

            return Command::FAILURE;
        }

        $searchSeed = (string) $owner['search_seed'];
        $searchQuery = $configuration->buildSearchQuery($searchSeed);
        $metadata = [
            'akeneo_identifier' => $searchSeed,
            'akeneo_product_uuid' => (string) ($owner['uuid'] ?? ''),
            'akeneo_owner_type' => (string) $owner['type'],
            'akeneo_links' => $searchSeed,
        ];

        $output->writeln(sprintf('Tenant: <info>%s</info>', $tenantCode));
        $output->writeln(sprintf('Product UUID: <info>%s</info>', $productUuid));
        $output->writeln(sprintf('Product identifier: <info>%s</info>', $searchSeed));
        $output->writeln(sprintf('Sync attribute: <info>%s</info>', $attributeCode));

        $primaryRef = (int) ($input->getOption('primary-resource-ref') ?? 0);
        $secondaryRef = (int) ($input->getOption('secondary-resource-ref') ?? 0);
        $seededSmokeAssets = false;

        if ($primaryRef <= 0 && $secondaryRef <= 0) {
            $seededSmokeAssets = true;
            $primaryRef = $this->apiClient->createResource(
                1,
                (string) $input->getOption('primary-upload-url'),
                $metadata,
                $tenantCode
            );
            $secondaryRef = $this->apiClient->createResource(
                1,
                (string) $input->getOption('secondary-upload-url'),
                $metadata,
                $tenantCode
            );
        } elseif ($primaryRef <= 0 || $secondaryRef <= 0) {
            throw new \RuntimeException('Both --primary-resource-ref and --secondary-resource-ref are required when seeding smoke-test resources externally.');
        }

        $results = $this->apiClient->searchAssets($searchQuery, 50, $tenantCode);
        $resultRefs = array_map(static fn (array $asset): int => (int) $asset['resource_ref'], $results);
        if ($seededSmokeAssets && (!\in_array($primaryRef, $resultRefs, true) || !\in_array($secondaryRef, $resultRefs, true))) {
            $output->writeln('<error>The smoke-test assets were created, but the default search query did not find both of them.</error>');

            return Command::FAILURE;
        }

        if (!$seededSmokeAssets && \count($resultRefs) < 2) {
            $output->writeln('<error>The default search query did not return enough DAM results to exercise the smoke test.</error>');

            return Command::FAILURE;
        }

        $primaryAsset = $this->apiClient->getAsset($primaryRef, $tenantCode);
        $secondaryAsset = $this->apiClient->getAsset($secondaryRef, $tenantCode);

        $this->assetLinkRepository->upsertLink(
            OwnerType::PRODUCT,
            $productUuid,
            $primaryAsset,
            null,
            false,
            $tenantCode
        );
        $this->metadataWritebackService->processResource($primaryRef, $tenantCode);

        $this->assetLinkRepository->upsertLink(
            OwnerType::PRODUCT,
            $productUuid,
            $secondaryAsset,
            null,
            true,
            $tenantCode
        );
        $this->metadataWritebackService->processResource($secondaryRef, $tenantCode);

        $linkedAssets = $this->assetLinkRepository->findByOwner(OwnerType::PRODUCT, $productUuid, $tenantCode);
        if (!$this->isPrimary($linkedAssets, $secondaryRef)) {
            $output->writeln('<error>The secondary smoke-test asset did not become the primary link.</error>');

            return Command::FAILURE;
        }

        $syncResult = $this->assetSyncService->syncProductAsset(
            $productUuid,
            $secondaryRef,
            $attributeCode,
            null,
            null,
            $tenantCode
        );
        $this->assetLinkRepository->markSynced(
            OwnerType::PRODUCT,
            $productUuid,
            $secondaryRef,
            $syncResult['attribute_code'],
            $tenantCode
        );

        $this->assetLinkRepository->removeLink(OwnerType::PRODUCT, $productUuid, $secondaryRef, $tenantCode);
        $this->metadataWritebackService->scheduleResource($secondaryRef, $tenantCode);
        $queueSummary = $this->metadataWritebackService->processQueuedResources(10, true, $tenantCode);

        $linkedAssets = $this->assetLinkRepository->findByOwner(OwnerType::PRODUCT, $productUuid, $tenantCode);
        if (!$this->isPrimary($linkedAssets, $primaryRef)) {
            $output->writeln('<error>The first smoke-test asset was not promoted back to primary after unlinking the second asset.</error>');

            return Command::FAILURE;
        }

        $finalSync = $this->assetSyncService->syncProductAsset(
            $productUuid,
            $primaryRef,
            $attributeCode,
            null,
            null,
            $tenantCode
        );
        $this->assetLinkRepository->markSynced(
            OwnerType::PRODUCT,
            $productUuid,
            $primaryRef,
            $finalSync['attribute_code'],
            $tenantCode
        );
        $this->metadataWritebackService->processResource($primaryRef, $tenantCode);

        $output->writeln(sprintf('Primary resource: <info>%d</info>', $primaryRef));
        $output->writeln(sprintf('Secondary resource: <info>%d</info>', $secondaryRef));
        $output->writeln(sprintf('Search query: <info>%s</info>', $searchQuery));
        $output->writeln(sprintf(
            'Queued write-back processing: <info>%d processed / %d succeeded / %d failed / %d skipped</info>',
            $queueSummary['processed'],
            $queueSummary['succeeded'],
            $queueSummary['failed'],
            $queueSummary['skipped']
        ));
        $output->writeln(sprintf(
            'Final synced file key: <info>%s</info>',
            $finalSync['file_key']
        ));
        $output->writeln('<info>ResourceSpace smoke test completed successfully.</info>');

        return Command::SUCCESS;
    }

    private function findFirstProductUuid(): string
    {
        $uuid = $this->connection->fetchOne('SELECT BIN_TO_UUID(uuid) FROM pim_catalog_product ORDER BY identifier ASC LIMIT 1');
        if (false === $uuid || '' === trim((string) $uuid)) {
            throw new \RuntimeException('No Akeneo products were found for the smoke test.');
        }

        return (string) $uuid;
    }

    /**
     * @param array<int, array<string, mixed>> $linkedAssets
     */
    private function isPrimary(array $linkedAssets, int $resourceRef): bool
    {
        foreach ($linkedAssets as $linkedAsset) {
            if ((int) $linkedAsset['resource_ref'] !== $resourceRef) {
                continue;
            }

            return (bool) $linkedAsset['is_primary'];
        }

        return false;
    }
}
