param(
  [string]$Profile = 'epic-dev',
  [string]$Region = 'us-west-2',
  [string]$InstanceId = 'i-0a457f3403b354c4a',
  [string]$AkeneoUser = 'jorgen',
  [string]$FixtureRoot = '/srv/pim/vendor/akeneo/pim-community-dev/src/Akeneo/Platform/Bundle/InstallerBundle/Resources/fixtures/icecat_demo_dev'
)

$ErrorActionPreference = 'Stop'

function Write-Section([string]$Message) {
  Write-Host ''
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Invoke-SsmShellScript {
  param(
    [Parameter(Mandatory = $true)][string[]]$Commands,
    [int]$PollAttempts = 300,
    [int]$PollIntervalSeconds = 2
  )

  $paramPath = Join-Path $env:TEMP ('ssm-params-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    @{ commands = $Commands } | ConvertTo-Json -Compress | Set-Content -NoNewline $paramPath

    $send = aws ssm send-command `
      --profile $Profile `
      --region $Region `
      --instance-ids $InstanceId `
      --document-name AWS-RunShellScript `
      --parameters "file://$paramPath" | ConvertFrom-Json

    $commandId = $send.Command.CommandId
    if ([string]::IsNullOrWhiteSpace($commandId)) {
      throw 'SSM command did not return a command id.'
    }

    for ($attempt = 0; $attempt -lt $PollAttempts; $attempt++) {
      Start-Sleep -Seconds $PollIntervalSeconds
      $invocation = aws ssm get-command-invocation `
        --profile $Profile `
        --region $Region `
        --command-id $commandId `
        --instance-id $InstanceId | ConvertFrom-Json

      if ($invocation.Status -in @('Success', 'Failed', 'Cancelled', 'TimedOut')) {
        return $invocation
      }
    }

    throw "Timed out waiting for SSM command $commandId."
  } finally {
    Remove-Item -LiteralPath $paramPath -ErrorAction SilentlyContinue
  }
}

Write-Section 'Checking AWS access'
$identity = aws sts get-caller-identity --profile $Profile --region $Region | ConvertFrom-Json
Write-Host "Using AWS account $($identity.Account) as $($identity.Arn)" -ForegroundColor Green

$importSequence = @(
  @{ Code = 'csv_currency_import'; Job = 'csv_currency_import'; File = 'currencies.csv' },
  @{ Code = 'csv_locale_import'; Job = 'csv_locale_import'; File = 'locales.csv' },
  @{ Code = 'csv_channel_import'; Job = 'csv_channel_import'; File = 'channels.csv' },
  @{ Code = 'csv_association_type_import'; Job = 'csv_association_type_import'; File = 'association_types.csv' },
  @{ Code = 'csv_group_type_import'; Job = 'csv_group_type_import'; File = 'group_types.csv' },
  @{ Code = 'csv_attribute_group_import'; Job = 'csv_attribute_group_import'; File = 'attribute_groups.csv' },
  @{ Code = 'csv_attribute_import'; Job = 'csv_attribute_import'; File = 'attributes.csv' },
  @{ Code = 'csv_attribute_option_import'; Job = 'csv_attribute_option_import'; File = 'attribute_options.csv' },
  @{ Code = 'csv_category_import'; Job = 'csv_category_import'; File = 'categories.csv' },
  @{ Code = 'csv_family_import'; Job = 'csv_family_import'; File = 'families.csv' },
  @{ Code = 'csv_family_variant_import'; Job = 'csv_family_variant_import'; File = 'family_variants.csv' },
  @{ Code = 'csv_group_import'; Job = 'csv_group_import'; File = 'groups.csv' },
  @{ Code = 'csv_product_model_import'; Job = 'csv_product_model_import'; File = 'product_models.csv' },
  @{ Code = 'csv_product_import'; Job = 'csv_product_import'; File = 'products.csv' }
)

$sequenceEntries = $importSequence | ForEach-Object {
  '{0}|{1}|{2}' -f $_.Code, $_.Job, $_.File
}

$remoteCommands = @(
  'set -e',
  'cd /home/ubuntu/akeneo-pim',
  'export HOME=/root',
  "fixture_root='$FixtureRoot'",
  "akeneo_user='$AkeneoUser'",
  'create_job() {',
  '  code="$1"',
  '  job="$2"',
  '  if sudo docker compose run -u www-data --rm php php bin/console akeneo:batch:list-jobs | grep -Eq "[[:space:]]${code}[[:space:]]*$"; then',
  '    echo "Job ${code} already exists."',
  '  else',
  '    echo "Creating job ${code}..."',
  '    sudo docker compose run -u www-data --rm php php bin/console akeneo:batch:create-job "Akeneo CSV Connector" "${job}" import "${code}"',
  '  fi',
  '}',
  'run_import() {',
  '  code="$1"',
  '  file="$2"',
  '  file_path="${fixture_root}/${file}"',
  '  config=$(printf ''{"storage":{"type":"local","file_path":"%s"}}'' "${file_path}")',
  '  echo "Running ${code} from ${file_path}..."',
  '  sudo docker compose run -u www-data --rm php php bin/console akeneo:batch:job "${code}" --config "${config}" --username="${akeneo_user}"',
  '}'
)

foreach ($entry in $sequenceEntries) {
  $parts = $entry.Split('|')
  $code = $parts[0]
  $job = $parts[1]
  $file = $parts[2]
  $remoteCommands += "create_job '$code' '$job'"
  $remoteCommands += "run_import '$code' '$file'"
}

$remoteCommands += @(
  'echo "Rebuilding product model index..."',
  'sudo docker compose run -u www-data --rm php php bin/console pim:product-model:index --all --env=prod',
  'echo "Rebuilding product index..."',
  'sudo docker compose run -u www-data --rm php php bin/console pim:product:index --all --env=prod',
  'APP_DB_PASS=$(grep "^APP_DATABASE_PASSWORD=" .env | sed -E ''s/^[^=]+=//; s/^"//; s/"$//'')',
  'product_count=$(sg docker -c "cd /home/ubuntu/akeneo-pim && docker compose exec -T mysql mysql -N -uakeneo_pim -p\"$APP_DB_PASS\" akeneo_pim -e \"SELECT COUNT(*) FROM pim_catalog_product\"")',
  'product_model_count=$(sg docker -c "cd /home/ubuntu/akeneo-pim && docker compose exec -T mysql mysql -N -uakeneo_pim -p\"$APP_DB_PASS\" akeneo_pim -e \"SELECT COUNT(*) FROM pim_catalog_product_model\"")',
  'category_count=$(sg docker -c "cd /home/ubuntu/akeneo-pim && docker compose exec -T mysql mysql -N -uakeneo_pim -p\"$APP_DB_PASS\" akeneo_pim -e \"SELECT COUNT(*) FROM pim_catalog_category\"")',
  'family_count=$(sg docker -c "cd /home/ubuntu/akeneo-pim && docker compose exec -T mysql mysql -N -uakeneo_pim -p\"$APP_DB_PASS\" akeneo_pim -e \"SELECT COUNT(*) FROM pim_catalog_family\"")',
  'attribute_count=$(sg docker -c "cd /home/ubuntu/akeneo-pim && docker compose exec -T mysql mysql -N -uakeneo_pim -p\"$APP_DB_PASS\" akeneo_pim -e \"SELECT COUNT(*) FROM pim_catalog_attribute\"")',
  'echo "Seed verification counts: products=${product_count}, product_models=${product_model_count}, categories=${category_count}, families=${family_count}, attributes=${attribute_count}"',
  'if [ "${product_count}" -lt 500 ]; then echo "Expected at least 500 seeded products but found ${product_count}." >&2; exit 1; fi',
  'if [ "${product_model_count}" -lt 50 ]; then echo "Expected at least 50 seeded product models but found ${product_model_count}." >&2; exit 1; fi',
  'if [ "${category_count}" -lt 50 ]; then echo "Expected at least 50 seeded categories but found ${category_count}." >&2; exit 1; fi',
  'if [ "${family_count}" -lt 5 ]; then echo "Expected at least 5 seeded families but found ${family_count}." >&2; exit 1; fi',
  'if [ "${attribute_count}" -lt 20 ]; then echo "Expected at least 20 seeded attributes but found ${attribute_count}." >&2; exit 1; fi',
  'echo "Import complete."'
)

Write-Section 'Running Akeneo demo fixture imports on the remote host'
$result = Invoke-SsmShellScript -Commands $remoteCommands

Write-Host $result.Status -ForegroundColor Green
if ($result.StandardOutputContent) {
  Write-Host $result.StandardOutputContent
}

if ($result.Status -ne 'Success') {
  if ($result.StandardErrorContent) {
    Write-Error $result.StandardErrorContent
  }
  throw "Akeneo demo seeding failed with status $($result.Status)."
}
