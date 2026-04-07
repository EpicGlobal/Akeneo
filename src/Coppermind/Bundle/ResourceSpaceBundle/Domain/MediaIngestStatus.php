<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Domain;

final class MediaIngestStatus
{
    public const PENDING = 'pending';
    public const SUCCEEDED = 'succeeded';
    public const FAILED = 'failed';
    public const SKIPPED = 'skipped';

    private function __construct()
    {
    }
}
