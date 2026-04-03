<?php

declare(strict_types=1);

const RESOURCE_SPACE_ROOT = '/var/www/html';
const RESOURCE_SPACE_INCLUDE = RESOURCE_SPACE_ROOT . '/include';
const RESOURCE_SPACE_CONFIG = RESOURCE_SPACE_INCLUDE . '/config.php';
const RESOURCE_SPACE_DEFAULT_RESOURCE_TYPE = 1;
const RESOURCE_SPACE_SUPER_ADMIN_GROUP = 3;
const DEFAULT_WRITEBACK_FIELD_INDEX = true;

/**
 * Local dev bootstrap for the pinned ResourceSpace stack.
 *
 * This keeps the Docker recipe self-installing:
 * - writes an env-driven config.php
 * - waits for MariaDB
 * - creates core schema on first boot
 * - ensures a super-admin user exists
 * - ensures the Akeneo write-back metadata fields exist
 */

function env_string(string $name, string $default = ''): string
{
    $value = getenv($name);

    if (false === $value) {
        return $default;
    }

    $value = trim($value);

    return '' !== $value ? $value : $default;
}

function env_int(string $name, int $default): int
{
    $value = getenv($name);

    if (false === $value || '' === trim($value)) {
        return $default;
    }

    return (int) $value;
}

function export_php_value(mixed $value): string
{
    return var_export($value, true);
}

function build_config_contents(): string
{
    $values = [
        'mysql_server' => env_string('RESOURCE_SPACE_DB_HOST', 'mariadb'),
        'mysql_server_port' => env_int('RESOURCE_SPACE_DB_PORT', 3306),
        'mysql_username' => env_string('RESOURCE_SPACE_DB_USER', 'resourcespace_rw'),
        'mysql_password' => env_string('RESOURCE_SPACE_DB_PASSWORD', 'change-me'),
        'mysql_db' => env_string('RESOURCE_SPACE_DB_NAME', 'resourcespace'),
        'baseurl' => rtrim(env_string('RESOURCE_SPACE_BASE_URL', 'http://localhost:8081'), '/'),
        'email_from' => env_string('RESOURCE_SPACE_EMAIL_FROM', 'no-reply@example.com'),
        'email_notify' => env_string('RESOURCE_SPACE_EMAIL_NOTIFY', 'admin@example.com'),
        'applicationname' => env_string('RESOURCE_SPACE_APPLICATION_NAME', 'Coppermind DAM'),
        'scramble_key' => env_string('RESOURCE_SPACE_SCRAMBLE_KEY', 'coppermind-local-rs-scramble-key-2026'),
        'api_scramble_key' => env_string('RESOURCE_SPACE_API_SCRAMBLE_KEY', 'coppermind-local-rs-api-scramble-key-2026'),
    ];

    $config = [
        '<?php',
        '',
        "declare(strict_types=1);",
        '',
        '$mysql_server = ' . export_php_value($values['mysql_server']) . ';',
        '$mysql_server_port = ' . export_php_value($values['mysql_server_port']) . ';',
        '$mysql_username = ' . export_php_value($values['mysql_username']) . ';',
        '$mysql_password = ' . export_php_value($values['mysql_password']) . ';',
        '$mysql_db = ' . export_php_value($values['mysql_db']) . ';',
        "\$mysql_bin_path = '/usr/bin';",
        '',
        '$baseurl = ' . export_php_value($values['baseurl']) . ';',
        '$email_from = ' . export_php_value($values['email_from']) . ';',
        '$email_notify = ' . export_php_value($values['email_notify']) . ';',
        '$applicationname = ' . export_php_value($values['applicationname']) . ';',
        '',
        '$scramble_key = ' . export_php_value($values['scramble_key']) . ';',
        '$api_scramble_key = ' . export_php_value($values['api_scramble_key']) . ';',
        '',
        "\$imagemagick_path = '/usr/bin';",
        "\$ghostscript_path = '/usr/bin';",
        "\$ffmpeg_path = '/usr/bin';",
        "\$exiftool_path = '/usr/bin';",
        "\$pdftotext_path = '/usr/bin';",
        '',
        "eval((string) file_get_contents(__DIR__ . '/config.new_installs.php'));",
        '',
    ];

    return implode("\n", $config);
}

function ensure_config_file(): void
{
    $configContents = build_config_contents();
    $currentContents = is_file(RESOURCE_SPACE_CONFIG) ? (string) file_get_contents(RESOURCE_SPACE_CONFIG) : '';

    if ($currentContents === $configContents) {
        return;
    }

    file_put_contents(RESOURCE_SPACE_CONFIG, $configContents);
}

function wait_for_database(): void
{
    $host = env_string('RESOURCE_SPACE_DB_HOST', 'mariadb');
    $port = env_int('RESOURCE_SPACE_DB_PORT', 3306);
    $database = env_string('RESOURCE_SPACE_DB_NAME', 'resourcespace');
    $user = env_string('RESOURCE_SPACE_DB_USER', 'resourcespace_rw');
    $password = env_string('RESOURCE_SPACE_DB_PASSWORD', 'change-me');

    for ($attempt = 1; $attempt <= 60; ++$attempt) {
        $connection = @mysqli_connect($host, $user, $password, $database, $port);
        if (false !== $connection) {
            mysqli_close($connection);

            return;
        }

        sleep(2);
    }

    fwrite(STDERR, "ResourceSpace bootstrap timed out waiting for MariaDB.\n");
    exit(1);
}

function ensure_admin_user(string $username, string $password, string $fullname, string $email): void
{
    $passwordHash = rs_password_hash(sprintf('RS%s%s', $username, $password));
    $userCount = (int) ps_value(
        'SELECT count(*) value FROM user WHERE username = ?',
        ['s', $username],
        0
    );

    if (0 === $userCount) {
        ps_query(
            'INSERT INTO user (username, password, fullname, email, usergroup) VALUES (?, ?, ?, ?, ?)',
            ['s', $username, 's', $passwordHash, 's', $fullname, 's', $email, 'i', RESOURCE_SPACE_SUPER_ADMIN_GROUP]
        );

        return;
    }

    ps_query(
        'UPDATE user SET password = ?, fullname = ?, email = ?, usergroup = ? WHERE username = ?',
        ['s', $passwordHash, 's', $fullname, 's', $email, 'i', RESOURCE_SPACE_SUPER_ADMIN_GROUP, 's', $username]
    );
}

function ensure_writeback_field(string $title, string $shortname): void
{
    $fieldRef = (int) ps_value(
        'SELECT ref value FROM resource_type_field WHERE name = ?',
        ['s', $shortname],
        0,
        'schema'
    );

    if ($fieldRef > 0) {
        return;
    }

    create_resource_type_field(
        $title,
        RESOURCE_SPACE_DEFAULT_RESOURCE_TYPE,
        FIELD_TYPE_TEXT_BOX_SINGLE_LINE,
        $shortname,
        DEFAULT_WRITEBACK_FIELD_INDEX
    );
}

function ensure_writeback_fields(): void
{
    ensure_writeback_field('Akeneo Identifier', 'akeneo_identifier');
    ensure_writeback_field('Akeneo Product UUID', 'akeneo_product_uuid');
    ensure_writeback_field('Akeneo Owner Type', 'akeneo_owner_type');
    ensure_writeback_field('Akeneo Links', 'akeneo_links');
}

ensure_config_file();
wait_for_database();

$suppress_headers = true;
require RESOURCE_SPACE_INCLUDE . '/boot.php';

check_db_structs();

if (!get_sysvar(SYSVAR_CURRENT_UPGRADE_LEVEL)) {
    set_sysvar(SYSVAR_CURRENT_UPGRADE_LEVEL, SYSTEM_UPGRADE_LEVEL);
}

ensure_admin_user(
    env_string('RESOURCE_SPACE_ADMIN_USERNAME', 'admin'),
    env_string('RESOURCE_SPACE_ADMIN_PASSWORD', 'ShardplatePower13'),
    env_string('RESOURCE_SPACE_ADMIN_FULLNAME', 'Coppermind Admin'),
    env_string('RESOURCE_SPACE_ADMIN_EMAIL', 'admin@example.com')
);

ensure_writeback_fields();
