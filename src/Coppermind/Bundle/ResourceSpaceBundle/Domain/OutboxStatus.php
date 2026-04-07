<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Domain;

final class OutboxStatus
{
    public const PENDING = 'pending';
    public const SUCCEEDED = 'succeeded';
    public const FAILED = 'failed';

    private function __construct()
    {
    }
}
