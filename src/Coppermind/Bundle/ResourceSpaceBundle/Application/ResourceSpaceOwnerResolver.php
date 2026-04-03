<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Akeneo\Pim\Enrichment\Component\Product\Query\FindIdentifier;
use Akeneo\Pim\Enrichment\Component\Product\Repository\ProductModelRepositoryInterface;
use Akeneo\Pim\Enrichment\Component\Product\Repository\ProductRepositoryInterface;
use Coppermind\Bundle\ResourceSpaceBundle\Domain\OwnerType;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

final class ResourceSpaceOwnerResolver
{
    public function __construct(
        private readonly ProductRepositoryInterface $productRepository,
        private readonly ProductModelRepositoryInterface $productModelRepository,
        private readonly FindIdentifier $findIdentifier,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function resolve(string $ownerType, string $ownerId): array
    {
        if (OwnerType::PRODUCT === $ownerType) {
            $product = $this->productRepository->find($ownerId);
            if (null === $product) {
                throw new NotFoundHttpException(sprintf('Product %s could not be found.', $ownerId));
            }

            $uuid = (string) $product->getUuid();
            $identifier = $this->findIdentifier->fromUuid($uuid) ?? '';
            $identifier = '' !== $identifier ? $identifier : $uuid;

            return [
                'type' => OwnerType::PRODUCT,
                'owner_id' => $ownerId,
                'label' => $identifier,
                'search_seed' => $identifier,
                'uuid' => $uuid,
            ];
        }

        if (OwnerType::PRODUCT_MODEL !== $ownerType) {
            throw new NotFoundHttpException(sprintf('Unsupported ResourceSpace owner type "%s".', $ownerType));
        }

        $productModel = $this->productModelRepository->findOneByIdentifier($ownerId);
        if (null === $productModel) {
            throw new NotFoundHttpException(sprintf('Product model %s could not be found.', $ownerId));
        }

        return [
            'type' => OwnerType::PRODUCT_MODEL,
            'owner_id' => $productModel->getCode(),
            'label' => $productModel->getCode(),
            'search_seed' => $productModel->getCode(),
            'uuid' => null,
        ];
    }
}
