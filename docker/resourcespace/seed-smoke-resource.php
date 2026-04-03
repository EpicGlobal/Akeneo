<?php

declare(strict_types=1);

require '/var/www/html/include/boot.php';
require_once '/var/www/html/include/image_processing.php';

setup_command_line_user([
    'ref' => 1,
    'username' => (string) (getenv('RESOURCE_SPACE_ADMIN_USERNAME') ?: 'admin'),
    'fullname' => (string) (getenv('RESOURCE_SPACE_ADMIN_FULLNAME') ?: 'Coppermind Admin'),
]);

$resourceType = (int) (getenv('SMOKE_RESOURCE_TYPE') ?: 1);
$uploadUrl = trim((string) (getenv('SMOKE_UPLOAD_URL') ?: ''));

$resourceRef = create_resource($resourceType, 0);
if (!is_int($resourceRef) || $resourceRef <= 0) {
    fwrite(STDERR, "Unable to create ResourceSpace smoke-test resource.\n");
    exit(1);
}

if ('' !== $uploadUrl && false === upload_file_by_url($resourceRef, false, false, false, $uploadUrl)) {
    fwrite(STDERR, sprintf("Unable to upload smoke-test file for resource %d.\n", $resourceRef));
    exit(1);
}

$metadata = [
    'akeneo_identifier' => trim((string) (getenv('SMOKE_AKENEO_IDENTIFIER') ?: '')),
    'akeneo_product_uuid' => trim((string) (getenv('SMOKE_AKENEO_PRODUCT_UUID') ?: '')),
    'akeneo_owner_type' => trim((string) (getenv('SMOKE_AKENEO_OWNER_TYPE') ?: '')),
    'akeneo_links' => trim((string) (getenv('SMOKE_AKENEO_LINKS') ?: '')),
];

foreach ($metadata as $shortname => $value) {
    if ('' === $value) {
        continue;
    }

    $fieldRef = (int) ps_value(
        'SELECT ref value FROM resource_type_field WHERE name = ?',
        ['s', $shortname],
        0,
        'schema'
    );

    if ($fieldRef <= 0) {
        continue;
    }

    update_field($resourceRef, $fieldRef, $value);
}

echo json_encode([
    'resource_ref' => $resourceRef,
    'upload_url' => $uploadUrl,
], JSON_THROW_ON_ERROR), PHP_EOL;
