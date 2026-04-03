<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Akeneo\Pim\Enrichment\Component\FileStorage;
use Akeneo\Pim\Enrichment\Component\Product\Model\ProductInterface;
use Akeneo\Pim\Enrichment\Component\Product\Model\ProductModelInterface;
use Akeneo\Pim\Enrichment\Component\Product\Repository\ProductModelRepositoryInterface;
use Akeneo\Pim\Enrichment\Component\Product\Repository\ProductRepositoryInterface;
use Akeneo\Pim\Structure\Component\Model\AttributeInterface;
use Akeneo\Pim\Structure\Component\Repository\AttributeRepositoryInterface;
use Akeneo\Tool\Component\FileStorage\File\FileStorerInterface;
use Akeneo\Tool\Component\FileStorage\Model\FileInfoInterface;
use Akeneo\Tool\Component\StorageUtils\Exception\PropertyException;
use Akeneo\Tool\Component\StorageUtils\Remover\RemoverInterface;
use Akeneo\Tool\Component\StorageUtils\Saver\SaverInterface;
use Akeneo\Tool\Component\StorageUtils\Updater\ObjectUpdaterInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

final class ResourceSpaceAssetSyncService
{
    private const ALLOWED_ATTRIBUTE_TYPES = ['pim_catalog_file', 'pim_catalog_image'];

    public function __construct(
        private readonly ResourceSpaceApiClient $apiClient,
        private readonly ProductRepositoryInterface $productRepository,
        private readonly ProductModelRepositoryInterface $productModelRepository,
        private readonly AttributeRepositoryInterface $attributeRepository,
        private readonly ObjectUpdaterInterface $productUpdater,
        private readonly SaverInterface $productSaver,
        private readonly ObjectUpdaterInterface $productModelUpdater,
        private readonly SaverInterface $productModelSaver,
        private readonly SaverInterface $fileInfoSaver,
        private readonly FileStorerInterface $fileStorer,
        private readonly RemoverInterface $fileRemover,
        private readonly ValidatorInterface $validator,
    ) {
    }

    /**
     * @return array{attribute_code: string, file_key: string}
     */
    public function syncProductAsset(
        string $productUuid,
        int $resourceRef,
        string $attributeCode,
        ?string $locale,
        ?string $scope,
        ?string $tenantCode = null,
    ): array {
        $product = $this->productRepository->find($productUuid);
        if (!$product instanceof ProductInterface) {
            throw new \RuntimeException(sprintf('Product %s was not found.', $productUuid));
        }

        return $this->syncToEntity(
            $product,
            $resourceRef,
            $attributeCode,
            $locale,
            $scope,
            $tenantCode,
            $this->productUpdater,
            $this->productSaver,
        );
    }

    /**
     * @return array{attribute_code: string, file_key: string}
     */
    public function syncProductModelAsset(
        string $productModelCode,
        int $resourceRef,
        string $attributeCode,
        ?string $locale,
        ?string $scope,
        ?string $tenantCode = null,
    ): array {
        $productModel = $this->productModelRepository->findOneByIdentifier($productModelCode);
        if (!$productModel instanceof ProductModelInterface) {
            throw new \RuntimeException(sprintf('Product model %s was not found.', $productModelCode));
        }

        return $this->syncToEntity(
            $productModel,
            $resourceRef,
            $attributeCode,
            $locale,
            $scope,
            $tenantCode,
            $this->productModelUpdater,
            $this->productModelSaver,
        );
    }

    /**
     * @param ProductInterface|ProductModelInterface $entity
     *
     * @return array{attribute_code: string, file_key: string}
     */
    private function syncToEntity(
        object $entity,
        int $resourceRef,
        string $attributeCode,
        ?string $locale,
        ?string $scope,
        ?string $tenantCode,
        ObjectUpdaterInterface $updater,
        SaverInterface $saver,
    ): array {
        $attribute = $this->findMediaAttribute($attributeCode);
        $download = $this->apiClient->downloadAsset($resourceRef, $tenantCode);
        /** @var \SplFileInfo $downloadedFile */
        $downloadedFile = $download['file'];

        try {
            $fileInfo = $this->fileStorer->store($downloadedFile, FileStorage::CATALOG_STORAGE_ALIAS, true);

            try {
                $this->ensureIsValid($fileInfo);
            } catch (\RuntimeException $exception) {
                $this->fileRemover->remove($fileInfo);

                throw $exception;
            }

            $this->fileInfoSaver->save($fileInfo);

            $locale = $attribute->isLocalizable()
                ? $this->requireContextValue(
                    $locale,
                    sprintf('Akeneo attribute "%s" requires a locale for ResourceSpace syncing.', $attribute->getCode())
                )
                : null;
            $scope = $attribute->isScopable()
                ? $this->requireContextValue(
                    $scope,
                    sprintf('Akeneo attribute "%s" requires a channel for ResourceSpace syncing.', $attribute->getCode())
                )
                : null;

            try {
                $updater->update($entity, [
                    'values' => [
                        $attribute->getCode() => [[
                            'locale' => $locale,
                            'scope' => $scope,
                            'data' => $fileInfo->getKey(),
                        ]],
                    ],
                ]);
            } catch (PropertyException $exception) {
                $this->fileRemover->remove($fileInfo);

                throw new \RuntimeException($exception->getMessage(), previous: $exception);
            }

            $violations = $this->validator->validate($entity);
            if ($violations->count() > 0) {
                $this->fileRemover->remove($fileInfo);

                throw new \RuntimeException($violations[0]->getMessage());
            }

            $saver->save($entity);

            return [
                'attribute_code' => $attribute->getCode(),
                'file_key' => $fileInfo->getKey(),
            ];
        } finally {
            $this->removeTemporaryDownload($downloadedFile);
        }
    }

    private function findMediaAttribute(string $attributeCode): AttributeInterface
    {
        $attributeCode = trim($attributeCode);
        if ('' === $attributeCode) {
            throw new \RuntimeException('No Akeneo media attribute was configured for ResourceSpace syncing.');
        }

        $attribute = $this->attributeRepository->findOneByIdentifier($attributeCode);
        if (!$attribute instanceof AttributeInterface) {
            throw new \RuntimeException(sprintf('Akeneo attribute "%s" does not exist.', $attributeCode));
        }

        if (!\in_array($attribute->getType(), self::ALLOWED_ATTRIBUTE_TYPES, true)) {
            throw new \RuntimeException(
                sprintf('Akeneo attribute "%s" must be a file or image attribute.', $attributeCode)
            );
        }

        return $attribute;
    }

    private function ensureIsValid(FileInfoInterface $fileInfo): void
    {
        $violations = $this->validator->validate($fileInfo);
        if ($violations->count() > 0) {
            throw new \RuntimeException($violations[0]->getMessage());
        }
    }

    private function requireContextValue(?string $value, string $message): string
    {
        $value = trim((string) $value);
        if ('' === $value) {
            throw new \RuntimeException($message);
        }

        return $value;
    }

    private function removeTemporaryDownload(\SplFileInfo $downloadedFile): void
    {
        $path = $downloadedFile->getPathname();
        if (is_file($path)) {
            @unlink($path);
        }
    }
}
