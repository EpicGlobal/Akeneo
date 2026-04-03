<?php

declare(strict_types=1);

$mysql_server = 'mariadb';
$mysql_server_port = 3306;
$mysql_username = 'resourcespace_rw';
$mysql_password = 'change-me';
$mysql_db = 'resourcespace';
$mysql_bin_path = '/usr/bin';

$baseurl = 'http://localhost:8081';
$email_from = 'no-reply@example.com';
$email_notify = 'admin@example.com';
$applicationname = 'Coppermind DAM';

$scramble_key = 'coppermind-local-rs-scramble-key-2026';
$api_scramble_key = 'coppermind-local-rs-api-scramble-key-2026';

$imagemagick_path = '/usr/bin';
$ghostscript_path = '/usr/bin';
$ffmpeg_path = '/usr/bin';
$exiftool_path = '/usr/bin';
$pdftotext_path = '/usr/bin';

eval((string) file_get_contents(__DIR__ . '/config.new_installs.php'));
