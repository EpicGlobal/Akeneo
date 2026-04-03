<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Domain;

final class WritebackStatus
{
    public const PENDING = 'pending';
    public const SUCCEEDED = 'succeeded';
    public const FAILED = 'failed';
    public const SKIPPED = 'skipped';
}
