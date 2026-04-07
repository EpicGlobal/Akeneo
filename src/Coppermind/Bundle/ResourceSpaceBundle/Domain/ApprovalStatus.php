<?php

declare(strict_types=1);

namespace Coppermind\Bundle\ResourceSpaceBundle\Domain;

final class ApprovalStatus
{
    public const NOT_REQUESTED = 'not_requested';
    public const PENDING = 'pending';
    public const APPROVED = 'approved';
    public const REJECTED = 'rejected';

    private function __construct()
    {
    }
}
