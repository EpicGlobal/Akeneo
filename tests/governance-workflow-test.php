<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';

use Coppermind\Bundle\ResourceSpaceBundle\Application\GovernanceWorkflowService;
use Coppermind\Bundle\ResourceSpaceBundle\Domain\ApprovalStatus;

function assert_true(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$reflection = new ReflectionClass(GovernanceWorkflowService::class);
$service = $reflection->newInstanceWithoutConstructor();

$buildAssetComplianceIssues = $reflection->getMethod('buildAssetComplianceIssues');
$buildAssetComplianceIssues->setAccessible(true);

$flattenAttributes = $reflection->getMethod('flattenAttributes');
$flattenAttributes->setAccessible(true);

$resolveApprovalStatus = $reflection->getMethod('resolveApprovalStatus');
$resolveApprovalStatus->setAccessible(true);

$issues = $buildAssetComplianceIssues->invoke($service, [
    [
        'resource_ref' => 9,
        'rights_status' => 'restricted',
        'expires_at' => '2025-01-01T00:00:00+00:00',
    ],
    [
        'resource_ref' => 10,
        'rights_status' => 'approved',
        'expires_at' => '2999-01-01T00:00:00+00:00',
    ],
]);

assert_true(count($issues) === 2, 'Expected both a restricted-rights issue and an expired-license issue.');
assert_true($issues[0]['code'] === 'expired_asset_license' || $issues[1]['code'] === 'expired_asset_license', 'Expected expired asset blocker.');
assert_true($issues[0]['code'] === 'asset_rights_restricted' || $issues[1]['code'] === 'asset_rights_restricted', 'Expected restricted-rights blocker.');

$flattened = $flattenAttributes->invoke($service, [
    'name' => [
        '<all_channels>' => [
            '<all_locales>' => 'Trail Shoe',
        ],
    ],
    'description' => [
        '<all_channels>' => [
            '<all_locales>' => '',
        ],
    ],
    'enabled' => true,
]);

assert_true($flattened['name'] === 'Trail Shoe', 'Expected flattened product name.');
assert_true($flattened['enabled'] === true, 'Expected flattened boolean attribute.');
assert_true(!array_key_exists('description', $flattened), 'Expected empty description to be skipped.');

$pendingStatus = $resolveApprovalStatus->invoke($service, [
    ['stage_code' => 'catalog_review', 'status' => ApprovalStatus::APPROVED],
    ['stage_code' => 'launch_review', 'status' => ApprovalStatus::PENDING],
]);
assert_true($pendingStatus === 'pending', 'Expected pending approval status.');

$approvedStatus = $resolveApprovalStatus->invoke($service, [
    ['stage_code' => 'catalog_review', 'status' => ApprovalStatus::APPROVED],
    ['stage_code' => 'launch_review', 'status' => ApprovalStatus::APPROVED],
]);
assert_true($approvedStatus === 'approved', 'Expected approved approval status.');

$rejectedStatus = $resolveApprovalStatus->invoke($service, [
    ['stage_code' => 'catalog_review', 'status' => ApprovalStatus::APPROVED],
    ['stage_code' => 'launch_review', 'status' => ApprovalStatus::REJECTED],
]);
assert_true($rejectedStatus === 'rejected', 'Expected rejected approval status.');

fwrite(STDOUT, "Governance workflow assertions passed.\n");
