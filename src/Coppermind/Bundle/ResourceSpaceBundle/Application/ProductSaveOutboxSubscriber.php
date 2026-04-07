<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Application;

use Akeneo\Pim\Enrichment\Component\Product\Model\ProductInterface;
use Akeneo\Pim\Enrichment\Component\Product\Model\ProductModelInterface;
use Akeneo\Tool\Component\StorageUtils\StorageEvents;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\EventDispatcher\GenericEvent;

final class ProductSaveOutboxSubscriber implements EventSubscriberInterface
{
    public function __construct(private readonly ProductLifecycleService $productLifecycleService)
    {
    }

    public static function getSubscribedEvents(): array
    {
        return [
            StorageEvents::POST_SAVE => ['onPostSave', -50],
        ];
    }

    public function onPostSave(GenericEvent $event): void
    {
        $subject = $event->getSubject();
        $options = $event->getArguments();

        try {
            if ($subject instanceof ProductInterface) {
                $this->productLifecycleService->syncOwnerStateAndQueueEvent(
                    'product',
                    (string) $subject->getUuid(),
                    'product.changed',
                    [
                        'source' => 'akeneo.storage.post_save',
                        'options' => $options,
                    ],
                    null,
                    'system:storage.post_save'
                );

                return;
            }

            if ($subject instanceof ProductModelInterface) {
                $this->productLifecycleService->syncOwnerStateAndQueueEvent(
                    'product_model',
                    (string) $subject->getCode(),
                    'product.changed',
                    [
                        'source' => 'akeneo.storage.post_save',
                        'options' => $options,
                    ],
                    null,
                    'system:storage.post_save'
                );
            }
        } catch (\Throwable) {
        }
    }
}
