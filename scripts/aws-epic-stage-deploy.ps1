[CmdletBinding()]
param(
    [string]$Profile = "epic-dev",
    [string]$Region = "us-west-2",
    [string]$Environment = "dev",
    [string]$InstanceType = "t3a.xlarge",
    [int]$RootVolumeSize = 150
)

$ErrorActionPreference = "Stop"
if ($null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Invoke-AwsRaw {
    param(
        [string[]]$Arguments,
        [string]$OutputFormat = $null,
        [switch]$CaptureOutput
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    try {
        $allArguments = @($Arguments)
        if ($Profile) {
            $allArguments += @("--profile", $Profile)
        }
        if ($Region) {
            $allArguments += @("--region", $Region)
        }
        if ($OutputFormat) {
            $allArguments += @("--output", $OutputFormat)
        }

        if ($CaptureOutput) {
            $output = & aws @allArguments 2>&1
            return @{
                ExitCode = $LASTEXITCODE
                Output = ($output | Out-String).Trim()
            }
        }

        & aws @allArguments 1>$null 2>$null
        return @{
            ExitCode = $LASTEXITCODE
            Output = ""
        }
    } finally {
        $ErrorActionPreference = $previousPreference
    }
}

function Invoke-AwsText {
    param([string[]]$Arguments)

    $result = Invoke-AwsRaw -Arguments $Arguments -OutputFormat "text" -CaptureOutput
    if ($result.ExitCode -ne 0) {
        throw "AWS CLI failed: aws $($Arguments -join ' ')`n$($result.Output)"
    }

    return $result.Output
}

function Invoke-AwsJson {
    param([string[]]$Arguments)

    $result = Invoke-AwsRaw -Arguments $Arguments -OutputFormat "json" -CaptureOutput
    if ($result.ExitCode -ne 0) {
        throw "AWS CLI failed: aws $($Arguments -join ' ')`n$($result.Output)"
    }

    return ($result.Output | ConvertFrom-Json)
}

function Invoke-AwsNoOutput {
    param(
        [string[]]$Arguments,
        [string]$FailureMessage
    )

    $result = Invoke-AwsRaw -Arguments $Arguments
    if ($result.ExitCode -ne 0) {
        if ($FailureMessage) {
            throw "$FailureMessage`n$($result.Output)"
        }

        throw "AWS CLI failed: aws $($Arguments -join ' ')`n$($result.Output)"
    }
}

function Test-AwsCommand {
    param([string[]]$Arguments)

    $result = Invoke-AwsRaw -Arguments $Arguments -OutputFormat "json"
    return $result.ExitCode -eq 0
}

function New-RandomHex {
    param([int]$Bytes = 24)

    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    } finally {
        $rng.Dispose()
    }
    return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function Write-Utf8NoBomFile {
    param(
        [string]$Path,
        [string]$Content
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Ensure-Parameter {
    param(
        [string]$Name,
        [string]$Value,
        [string]$Type = "SecureString"
    )

    if (Test-AwsCommand @("ssm", "get-parameter", "--name", $Name)) {
        return
    }

    Invoke-AwsNoOutput -Arguments @("ssm", "put-parameter", "--name", $Name, "--type", $Type, "--value", $Value) -FailureMessage "Failed to create parameter $Name"
}

function Ensure-RoleAndProfile {
    param(
        [string]$RoleName,
        [string]$InstanceProfileName,
        [string]$BucketName
    )

    if (-not (Test-AwsCommand @("iam", "get-role", "--role-name", $RoleName))) {
        $trustPolicyPath = Join-Path $env:TEMP "$RoleName-trust.json"
        $trustPolicy = @'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
'@
        Write-Utf8NoBomFile -Path $trustPolicyPath -Content $trustPolicy

        Invoke-AwsNoOutput -Arguments @("iam", "create-role", "--role-name", $RoleName, "--assume-role-policy-document", "file://$trustPolicyPath") -FailureMessage "Failed to create IAM role $RoleName"
    }

    foreach ($policyArn in @(
        "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
        "arn:aws:iam::aws:policy/AmazonSSMReadOnlyAccess",
        "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
    )) {
        $null = Invoke-AwsRaw -Arguments @("iam", "attach-role-policy", "--role-name", $RoleName, "--policy-arn", $policyArn)
    }

    $policyPath = Join-Path $env:TEMP "$RoleName-backup-policy.json"
    $backupPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::$BucketName/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::$BucketName"
    }
  ]
}
"@
    Write-Utf8NoBomFile -Path $policyPath -Content $backupPolicy

    Invoke-AwsNoOutput -Arguments @("iam", "put-role-policy", "--role-name", $RoleName, "--policy-name", "$RoleName-backups", "--policy-document", "file://$policyPath") -FailureMessage "Failed to attach backup access policy to $RoleName"

    if (-not (Test-AwsCommand @("iam", "get-instance-profile", "--instance-profile-name", $InstanceProfileName))) {
        Invoke-AwsNoOutput -Arguments @("iam", "create-instance-profile", "--instance-profile-name", $InstanceProfileName) -FailureMessage "Failed to create instance profile $InstanceProfileName"
        Start-Sleep -Seconds 5
    }

    $attachedRole = Invoke-AwsText @(
        "iam", "get-instance-profile",
        "--instance-profile-name", $InstanceProfileName,
        "--query", "InstanceProfile.Roles[?RoleName=='$RoleName'] | [0].RoleName"
    )

    if (-not $attachedRole -or $attachedRole -eq "None") {
        Invoke-AwsNoOutput -Arguments @("iam", "add-role-to-instance-profile", "--instance-profile-name", $InstanceProfileName, "--role-name", $RoleName) -FailureMessage "Failed to add role $RoleName to instance profile $InstanceProfileName"
        Start-Sleep -Seconds 10
    }
}

function Ensure-SecurityGroup {
    param([string]$VpcId, [string]$GroupName)

    $groupId = Invoke-AwsText @("ec2", "describe-security-groups", "--filters", "Name=vpc-id,Values=$VpcId", "Name=group-name,Values=$GroupName", "--query", "SecurityGroups[0].GroupId")
    if (-not $groupId -or $groupId -eq "None") {
        $groupId = Invoke-AwsText @("ec2", "create-security-group", "--group-name", $GroupName, "--description", "Operator staging security group", "--vpc-id", $VpcId, "--query", "GroupId")
    }

    foreach ($port in @(80, 443, 8081)) {
        $null = Invoke-AwsRaw -Arguments @("ec2", "authorize-security-group-ingress", "--group-id", $groupId, "--ip-permissions", "IpProtocol=tcp,FromPort=$port,ToPort=$port,IpRanges=[{CidrIp=0.0.0.0/0,Description='Operator staging'}]")
    }

    return $groupId
}

function Ensure-BackupBucket {
    param([string]$BucketName)

    if (-not (Test-AwsCommand @("s3api", "head-bucket", "--bucket", $BucketName))) {
        Invoke-AwsNoOutput -Arguments @("s3api", "create-bucket", "--bucket", $BucketName, "--create-bucket-configuration", "LocationConstraint=$Region") -FailureMessage "Failed to create bucket $BucketName"
    }

    $lifecyclePath = Join-Path $env:TEMP "$BucketName-lifecycle.json"
    $lifecycle = @"
{
  "Rules": [
    {
      "ID": "expire-old-backups",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "Expiration": { "Days": 14 }
    }
  ]
}
"@
    Write-Utf8NoBomFile -Path $lifecyclePath -Content $lifecycle

    Invoke-AwsNoOutput -Arguments @("s3api", "put-bucket-lifecycle-configuration", "--bucket", $BucketName, "--lifecycle-configuration", "file://$lifecyclePath")
    Invoke-AwsNoOutput -Arguments @("s3api", "put-public-access-block", "--bucket", $BucketName, "--public-access-block-configuration", "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true")
}

function Ensure-MediaBucket {
    param([string]$BucketName)

    if (-not (Test-AwsCommand @("s3api", "head-bucket", "--bucket", $BucketName))) {
        Invoke-AwsNoOutput -Arguments @("s3api", "create-bucket", "--bucket", $BucketName, "--create-bucket-configuration", "LocationConstraint=$Region") -FailureMessage "Failed to create media bucket $BucketName"
    }

    Invoke-AwsNoOutput -Arguments @("s3api", "put-public-access-block", "--bucket", $BucketName, "--public-access-block-configuration", "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true")
    Invoke-AwsNoOutput -Arguments @("s3api", "put-bucket-versioning", "--bucket", $BucketName, "--versioning-configuration", "Status=Enabled")

    $encryptionPath = Join-Path $env:TEMP "$BucketName-encryption.json"
    $encryption = @'
{
  "Rules": [
    {
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }
  ]
}
'@
    Write-Utf8NoBomFile -Path $encryptionPath -Content $encryption
    Invoke-AwsNoOutput -Arguments @("s3api", "put-bucket-encryption", "--bucket", $BucketName, "--server-side-encryption-configuration", "file://$encryptionPath")
}

function Ensure-RoleBucketAccess {
    param(
        [string]$RoleName,
        [string]$BucketName,
        [string]$PolicyName
    )

    $policyPath = Join-Path $env:TEMP "$RoleName-$PolicyName.json"
    $policy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::$BucketName/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::$BucketName"
    }
  ]
}
"@
    Write-Utf8NoBomFile -Path $policyPath -Content $policy
    Invoke-AwsNoOutput -Arguments @("iam", "put-role-policy", "--role-name", $RoleName, "--policy-name", $PolicyName, "--policy-document", "file://$policyPath") -FailureMessage "Failed to attach bucket access policy $PolicyName to $RoleName"
}

function New-ControlPlaneBundle {
    param([string]$SourcePath)

    if (-not (Test-Path (Join-Path $SourcePath "package.json"))) {
        throw "Operator control-plane package.json was not found at $SourcePath"
    }

    $stagingRoot = Join-Path $env:TEMP "operator-control-plane-bundle-$Environment"
    if (Test-Path $stagingRoot) {
        Remove-Item -Recurse -Force $stagingRoot
    }

    New-Item -ItemType Directory -Path $stagingRoot | Out-Null
    $null = & robocopy $SourcePath $stagingRoot /MIR /XD node_modules .git var /XF .env .env.local .env.production
    if ($LASTEXITCODE -gt 7) {
        throw "Failed to stage the Operator control-plane bundle from $SourcePath"
    }

    $bundlePath = Join-Path $env:TEMP "operator-control-plane-$Environment.tar.gz"
    if (Test-Path $bundlePath) {
        Remove-Item -Force $bundlePath
    }

    & tar -czf $bundlePath -C $stagingRoot .
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create control-plane bundle $bundlePath"
    }

    return $bundlePath
}

function Ensure-Instance {
    param(
        [string]$AmiId,
        [string]$SubnetId,
        [string]$SecurityGroupId,
        [string]$InstanceProfileName,
        [string]$NameTag
    )

    $existingId = Invoke-AwsText @("ec2", "describe-instances", "--filters", "Name=tag:Name,Values=$NameTag", "Name=instance-state-name,Values=pending,running,stopping,stopped", "--query", "Reservations[0].Instances[0].InstanceId")
    if ($existingId -and $existingId -ne "None") {
        return $existingId
    }

    $blockDeviceMappings = "DeviceName=/dev/sda1,Ebs={VolumeSize=$RootVolumeSize,VolumeType=gp3,Encrypted=true}"

    $tags = "ResourceType=instance,Tags=[{Key=Name,Value=$NameTag},{Key=Environment,Value=$Environment},{Key=App,Value=Operator}]"
    $instanceId = Invoke-AwsText @(
        "ec2", "run-instances",
        "--image-id", $AmiId,
        "--instance-type", $InstanceType,
        "--iam-instance-profile", "Name=$InstanceProfileName",
        "--security-group-ids", $SecurityGroupId,
        "--subnet-id", $SubnetId,
        "--metadata-options", "HttpTokens=required,HttpEndpoint=enabled",
        "--block-device-mappings", $blockDeviceMappings,
        "--tag-specifications", $tags,
        "--query", "Instances[0].InstanceId"
    )

    return $instanceId
}

function Ensure-ElasticIp {
    param([string]$InstanceId, [string]$NameTag)

    $allocationId = Invoke-AwsText @("ec2", "describe-addresses", "--filters", "Name=tag:Name,Values=$NameTag", "--query", "Addresses[0].AllocationId")
    if (-not $allocationId -or $allocationId -eq "None") {
        $address = Invoke-AwsJson @("ec2", "allocate-address", "--domain", "vpc")
        $allocationId = $address.AllocationId
        Invoke-AwsNoOutput -Arguments @("ec2", "create-tags", "--resources", $allocationId, "--tags", "Key=Name,Value=$NameTag", "Key=Environment,Value=$Environment", "Key=App,Value=Operator")
    }

    $null = Invoke-AwsRaw -Arguments @("ec2", "associate-address", "--allocation-id", $allocationId, "--instance-id", $InstanceId, "--allow-reassociation")
    $publicIp = Invoke-AwsText @("ec2", "describe-addresses", "--allocation-ids", $allocationId, "--query", "Addresses[0].PublicIp")

    return $publicIp
}

function Wait-ForSsm {
    param([string]$InstanceId)

    for ($i = 0; $i -lt 60; $i++) {
        $ping = Invoke-AwsText @("ssm", "describe-instance-information", "--filters", "Key=InstanceIds,Values=$InstanceId", "--query", "InstanceInformationList[0].PingStatus")
        if ($ping -eq "Online") {
            return
        }

        Start-Sleep -Seconds 10
    }

    throw "Instance $InstanceId did not come online in SSM."
}

function Wait-ForCommandInvocation {
    param(
        [string]$CommandId,
        [string]$InstanceId,
        [int]$TimeoutMinutes = 45
    )

    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)

    while ((Get-Date) -lt $deadline) {
        $status = Invoke-AwsText @("ssm", "get-command-invocation", "--command-id", $CommandId, "--instance-id", $InstanceId, "--query", "Status")
        switch ($status.Trim()) {
            "Pending" { Start-Sleep -Seconds 15; continue }
            "Delayed" { Start-Sleep -Seconds 15; continue }
            "InProgress" { Start-Sleep -Seconds 15; continue }
            "Success" {
                return [pscustomobject]@{
                    Status = "Success"
                }
            }
            default {
                $stderr = Invoke-AwsText @("ssm", "get-command-invocation", "--command-id", $CommandId, "--instance-id", $InstanceId, "--query", "StandardErrorContent")
                throw "SSM command $CommandId failed with status $($status.Trim()): $stderr"
            }
        }
    }

    throw "Timed out waiting for SSM command $CommandId on $InstanceId to complete."
}

function Invoke-PostBootstrapValidation {
    param(
        [string]$InstanceId,
        [string]$PublicIp
    )

    $validationCommands = @(
        "set -eu",
        "grep -q '^AKENEO_PIM_URL=""http://$PublicIp""' /home/ubuntu/akeneo-pim/.env",
        "grep -q '^RESOURCE_SPACE_BASE_URI=""http://$($PublicIp)/assets""' /home/ubuntu/akeneo-pim/.env",
        "grep -q '^OPERATOR_MEDIA_STORAGE_BUCKET=""' /home/ubuntu/akeneo-pim/.env",
        "grep -q '^OPERATOR_CONTROL_PLANE_TOKEN=""' /home/ubuntu/akeneo-pim/.env",
        'success=0; for attempt in $(seq 1 60); do if curl -fsS http://127.0.0.1/ >/dev/null; then success=1; break; fi; sleep 5; done; [ "$success" -eq 1 ]',
        'success=0; for attempt in $(seq 1 60); do if curl -fsS http://127.0.0.1/assets/ >/dev/null; then success=1; break; fi; sleep 5; done; [ "$success" -eq 1 ]',
        'success=0; for attempt in $(seq 1 60); do if curl -fsS http://127.0.0.1/market/health >/dev/null; then success=1; break; fi; sleep 5; done; [ "$success" -eq 1 ]',
        'success=0; for attempt in $(seq 1 60); do if curl -fsS http://127.0.0.1/control-plane/health >/dev/null; then success=1; break; fi; sleep 5; done; [ "$success" -eq 1 ]',
        "cd /home/ubuntu/akeneo-pim",
        "sg docker -c ""cd '/home/ubuntu/akeneo-pim' && docker compose run -u www-data --rm php php bin/console pim:user:create jorgen ShardplatePower13 jorgen@epicglobalinc.com Jorgen Jensen en_US --admin -n || true"""
    )

    $validationPayload = @{ commands = $validationCommands } | ConvertTo-Json -Compress
    $validationPayloadPath = Join-Path $env:TEMP "operator-$Environment-validation.json"
    Write-Utf8NoBomFile -Path $validationPayloadPath -Content $validationPayload

    $validationSend = Invoke-AwsJson @(
        "ssm", "send-command",
        "--instance-ids", $InstanceId,
        "--document-name", "AWS-RunShellScript",
        "--comment", "Validate Operator staging bootstrap",
        "--parameters", "file://$validationPayloadPath"
    )

    $validationCommandId = $validationSend.Command.CommandId
    return Wait-ForCommandInvocation -CommandId $validationCommandId -InstanceId $InstanceId -TimeoutMinutes 10
}

function Write-Monitoring {
    param([string]$InstanceId, [string]$DashboardName)

    $dashboardPath = Join-Path $env:TEMP "$DashboardName-dashboard.json"
    $dashboardBody = @"
{
  "widgets": [
    {
      "type": "metric",
      "x": 0,
      "y": 0,
      "width": 12,
      "height": 6,
      "properties": {
        "metrics": [["AWS/EC2", "CPUUtilization", "InstanceId", "$InstanceId"]],
        "region": "$Region",
        "title": "Operator CPU Utilization"
      }
    },
    {
      "type": "metric",
      "x": 12,
      "y": 0,
      "width": 12,
      "height": 6,
      "properties": {
        "metrics": [["AWS/EC2", "StatusCheckFailed", "InstanceId", "$InstanceId"]],
        "region": "$Region",
        "title": "Operator Status Checks"
      }
    }
  ]
}
"@
    Write-Utf8NoBomFile -Path $dashboardPath -Content $dashboardBody

    Invoke-AwsNoOutput -Arguments @("cloudwatch", "put-dashboard", "--dashboard-name", $DashboardName, "--dashboard-body", "file://$dashboardPath")
    Invoke-AwsNoOutput -Arguments @("cloudwatch", "put-metric-alarm", "--alarm-name", "$DashboardName-HighCPU", "--metric-name", "CPUUtilization", "--namespace", "AWS/EC2", "--statistic", "Average", "--period", "300", "--evaluation-periods", "3", "--threshold", "80", "--comparison-operator", "GreaterThanThreshold", "--dimensions", "Name=InstanceId,Value=$InstanceId")
    Invoke-AwsNoOutput -Arguments @("cloudwatch", "put-metric-alarm", "--alarm-name", "$DashboardName-StatusCheckFailed", "--metric-name", "StatusCheckFailed", "--namespace", "AWS/EC2", "--statistic", "Maximum", "--period", "300", "--evaluation-periods", "2", "--threshold", "0", "--comparison-operator", "GreaterThanThreshold", "--dimensions", "Name=InstanceId,Value=$InstanceId")
}

$caller = Invoke-AwsJson @("sts", "get-caller-identity")
$accountId = $caller.Account
$namePrefix = "operator-akeneo-pim-$Environment"
$parameterPrefix = "/epic-global/akeneo-pim/$Environment"
$roleName = "$namePrefix-role"
$instanceProfileName = "$namePrefix-instance-profile"
$securityGroupName = "$namePrefix-sg"
$dashboardName = "Operator-$Environment"
$backupBucket = "epic-operator-$Environment-backups-$accountId-$Region"
$mediaBucket = "epic-operator-$Environment-media-$accountId-$Region"
$vpcId = Invoke-AwsText @("ec2", "describe-vpcs", "--filters", "Name=isDefault,Values=true", "--query", "Vpcs[0].VpcId")
$subnetId = Invoke-AwsText @("ec2", "describe-subnets", "--filters", "Name=default-for-az,Values=true", "Name=vpc-id,Values=$vpcId", "--query", "Subnets[0].SubnetId")
$amiId = Invoke-AwsText @("ssm", "get-parameter", "--name", "/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id", "--query", "Parameter.Value")
$repoRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $repoRoot
$controlPlaneSource = Join-Path $workspaceRoot "Epic Commerce Platform\apps\operator-control-plane"

Ensure-BackupBucket -BucketName $backupBucket
Ensure-MediaBucket -BucketName $mediaBucket
Ensure-RoleAndProfile -RoleName $roleName -InstanceProfileName $instanceProfileName -BucketName $backupBucket
Ensure-RoleBucketAccess -RoleName $roleName -BucketName $mediaBucket -PolicyName "$roleName-media"
$securityGroupId = Ensure-SecurityGroup -VpcId $vpcId -GroupName $securityGroupName

$parameterValues = @{
    "app_secret" = New-RandomHex 32
    "app_database_password" = New-RandomHex 16
    "app_database_root_password" = New-RandomHex 16
    "backup_s3_uri" = "s3://$backupBucket"
    "media_bucket" = $mediaBucket
    "media_cdn_base_url" = ""
    "object_storage_access_key" = "operator$Environment"
    "object_storage_secret_key" = New-RandomHex 24
    "operator_control_plane_token" = New-RandomHex 24
    "resource_space_db_password" = New-RandomHex 16
    "resource_space_db_root_password" = New-RandomHex 16
    "resource_space_admin_password" = New-RandomHex 12
    "resource_space_scramble_key" = New-RandomHex 24
    "resource_space_api_scramble_key" = New-RandomHex 24
}

if ([string]::IsNullOrWhiteSpace($parameterValues["media_cdn_base_url"])) {
    $parameterValues.Remove("media_cdn_base_url")
}

foreach ($entry in $parameterValues.GetEnumerator()) {
    Ensure-Parameter -Name "$parameterPrefix/$($entry.Key)" -Value "$($entry.Value)"
}

$controlPlaneBundlePath = New-ControlPlaneBundle -SourcePath $controlPlaneSource
$controlPlaneBundleKey = "artifacts/operator-control-plane/$Environment/operator-control-plane-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss')).tar.gz"
$controlPlaneBundleUri = "s3://$backupBucket/$controlPlaneBundleKey"
Invoke-AwsNoOutput -Arguments @("s3", "cp", $controlPlaneBundlePath, $controlPlaneBundleUri) -FailureMessage "Failed to upload control-plane bundle to $controlPlaneBundleUri"

$instanceId = Ensure-Instance -AmiId $amiId -SubnetId $subnetId -SecurityGroupId $securityGroupId -InstanceProfileName $instanceProfileName -NameTag $namePrefix
Invoke-AwsNoOutput -Arguments @("ec2", "wait", "instance-running", "--instance-ids", $instanceId)
$publicIp = Ensure-ElasticIp -InstanceId $instanceId -NameTag "$namePrefix-eip"
Wait-ForSsm -InstanceId $instanceId
Write-Monitoring -InstanceId $instanceId -DashboardName $dashboardName

$commands = @(
    "set -eu",
    "BOOTSTRAP_USER=ubuntu",
    "cd /home/ubuntu",
    "if [ ! -d /home/ubuntu/akeneo-pim ]; then sudo -u ubuntu -H git clone https://github.com/EpicGlobal/Akeneo.git /home/ubuntu/akeneo-pim; fi",
    "chown -R ubuntu:ubuntu /home/ubuntu/akeneo-pim || true",
    "rm -f /home/ubuntu/akeneo-pim/.env.local",
    "sudo -u ubuntu -H git -C /home/ubuntu/akeneo-pim checkout -- .env || true",
    "sudo -u ubuntu -H git -C /home/ubuntu/akeneo-pim fetch origin master",
    "sudo -u ubuntu -H git -C /home/ubuntu/akeneo-pim checkout master",
    "sudo -u ubuntu -H git -C /home/ubuntu/akeneo-pim pull --ff-only origin master",
    "cd /home/ubuntu/akeneo-pim",
    "export PROJECT_DIR=/home/ubuntu/akeneo-pim",
    "export REPO_URL=https://github.com/EpicGlobal/Akeneo.git",
    "export BOOTSTRAP_SCRIPT=scripts/aws-epic-deploy.sh",
    "export AWS_REGION=$Region",
    "export DEPLOY_PARAMETER_PREFIX=$parameterPrefix",
    "export BOOTSTRAP_USER=$BOOTSTRAP_USER",
    "export RESOURCE_SPACE_BASE_URI_VALUE=http://$publicIp/assets",
    "export MARKETPLACE_ORCHESTRATOR_PUBLIC_BASE_URL_VALUE=http://$publicIp/market",
    "export OPERATOR_CONTROL_PLANE_BUNDLE_URI=$controlPlaneBundleUri",
    "export OPERATOR_CONTROL_PLANE_ENVIRONMENT_VALUE=$Environment",
    "export OPERATOR_CONTROL_PLANE_PUBLIC_BASE_URL_VALUE=http://$publicIp/control-plane",
    "export OPERATOR_CONTROL_PLANE_CATALOG_PUBLIC_URL_VALUE=http://$publicIp",
    "export OPERATOR_CONTROL_PLANE_DAM_PUBLIC_URL_VALUE=http://$publicIp/assets",
    "export OPERATOR_CONTROL_PLANE_MARKETPLACE_PUBLIC_URL_VALUE=http://$publicIp/market/dashboard",
    "export OPERATOR_CONTROL_PLANE_OPS_BASE_URL_VALUE=http://127.0.0.1/control-plane",
    "export OPERATOR_CONTROL_PLANE_OPS_TENANT_VALUE=default",
    "export LOCAL_RESOURCE_SPACE_HEALTH_URI=http://127.0.0.1/assets/",
    "export LOCAL_MARKETPLACE_HEALTH_URI=http://127.0.0.1/market/health",
    "export LOCAL_CONTROL_PLANE_HEALTH_URI=http://127.0.0.1/control-plane/health",
    "export OPERATOR_MEDIA_STORAGE_BUCKET_VALUE=$mediaBucket",
    "export OPERATOR_MEDIA_STORAGE_REGION_VALUE=$Region",
    "export OPERATOR_MEDIA_STORAGE_ENDPOINT_VALUE=",
    "export OPERATOR_MEDIA_STORAGE_USE_PATH_STYLE_ENDPOINT_VALUE=0",
    "export OPERATOR_MEDIA_STORAGE_ACCESS_KEY_VALUE=",
    "export OPERATOR_MEDIA_STORAGE_SECRET_KEY_VALUE=",
    "bash scripts/aws-ec2-bootstrap.sh http://$publicIp",
    "cd /home/ubuntu/akeneo-pim",
    "grep -q '^AKENEO_PIM_URL=""http://$publicIp""' /home/ubuntu/akeneo-pim/.env",
    "grep -q '^RESOURCE_SPACE_BASE_URI=""http://$($publicIp)/assets""' /home/ubuntu/akeneo-pim/.env",
    "grep -q '^OPERATOR_MEDIA_STORAGE_BUCKET=""$mediaBucket""' /home/ubuntu/akeneo-pim/.env",
    "grep -q '^OPERATOR_CONTROL_PLANE_TOKEN=""' /home/ubuntu/akeneo-pim/.env",
    "sg docker -c ""cd '/home/ubuntu/akeneo-pim' && docker compose run -u www-data --rm php php bin/console pim:user:create jorgen ShardplatePower13 jorgen@epicglobalinc.com Jorgen Jensen en_US --admin -n || true"""
)

$commandPayload = @{ commands = $commands } | ConvertTo-Json -Compress
$commandPayloadPath = Join-Path $env:TEMP "$namePrefix-ssm-commands.json"
Write-Utf8NoBomFile -Path $commandPayloadPath -Content $commandPayload
$send = Invoke-AwsJson @(
    "ssm", "send-command",
    "--instance-ids", $instanceId,
    "--document-name", "AWS-RunShellScript",
    "--comment", "Bootstrap Operator staging in epic-dev",
    "--parameters", "file://$commandPayloadPath"
)

$commandId = $send.Command.CommandId
Write-Host "Waiting for bootstrap command $commandId on $instanceId..."
try {
    $invocation = Wait-ForCommandInvocation -CommandId $commandId -InstanceId $instanceId
} catch {
    Write-Warning $_
    Write-Host "Running post-bootstrap validation on $instanceId..."
    $null = Invoke-PostBootstrapValidation -InstanceId $instanceId -PublicIp $publicIp
    $invocation = [pscustomobject]@{
        Status = "RecoveredAfterValidation"
    }
}

Write-Host ""
Write-Host "Operator staging deployment complete."
Write-Host "Profile: $Profile"
Write-Host "Region: $Region"
Write-Host "InstanceId: $instanceId"
Write-Host "PublicIp: $publicIp"
Write-Host "URL: http://$publicIp/"
Write-Host "Control plane URL: http://$publicIp/control-plane/"
Write-Host "Assets URL: http://$($publicIp)/assets/"
Write-Host "Marketplace URL: http://$($publicIp)/market/dashboard"
Write-Host "Backup bucket: s3://$backupBucket"
Write-Host "Media bucket: s3://$mediaBucket"
Write-Host "Dashboard: $dashboardName"
Write-Host "SSM command status: $($invocation.Status)"
Write-Host "Operator admin username: jorgen"
Write-Host "Operator admin email: jorgen@epicglobalinc.com"
Write-Host "Operator admin password: ShardplatePower13"
