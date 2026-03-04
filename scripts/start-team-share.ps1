param(
    [int]$Port = 8080,
    [string]$EnvFile = ".env",
    [switch]$SkipDockerStart,
    [switch]$NoBasicAuth,
    [string]$BasicAuthUser = "akeneo",
    [string]$BasicAuthPassword = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
    Write-Host "[share] $Message"
}

function Get-RandomPassword([int]$Length = 20) {
    $bytes = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $raw = [Convert]::ToBase64String($bytes).Replace("+", "A").Replace("/", "B").TrimEnd("=")
    if ($raw.Length -lt $Length) {
        return ($raw + "X" * ($Length - $raw.Length)).Substring(0, $Length)
    }
    return $raw.Substring(0, $Length)
}

function Set-EnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][string]$Value
    )

    if (!(Test-Path $Path)) {
        throw "Could not find env file: $Path"
    }

    $lines = [System.IO.File]::ReadAllLines($Path)
    $updated = $false
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i] -match "^\s*$([Regex]::Escape($Key))=") {
            $lines[$i] = "$Key=$Value"
            $updated = $true
            break
        }
    }

    if (-not $updated) {
        $newLines = New-Object System.Collections.Generic.List[string]
        $newLines.AddRange($lines)
        $newLines.Add("$Key=$Value")
        $lines = $newLines.ToArray()
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($Path, $lines, $utf8NoBom)
}

function Get-NgrokTunnelForPort([int]$TunnelPort) {
    try {
        $api = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 2
        if ($null -eq $api.tunnels) {
            return $null
        }
        $matching = $api.tunnels | Where-Object {
            $_.public_url -match "^https://" -and $_.config.addr -match ":$TunnelPort$"
        } | Select-Object -First 1
        if ($null -ne $matching) {
            return $matching
        }
        return ($api.tunnels | Where-Object { $_.public_url -match "^https://" } | Select-Object -First 1)
    } catch {
        return $null
    }
}

function Wait-ForLocalApp([int]$TunnelPort, [int]$MaxSeconds = 120) {
    $deadline = (Get-Date).AddSeconds($MaxSeconds)
    while ((Get-Date) -lt $deadline) {
        $status = & curl.exe -s -o NUL -w "%{http_code}" "http://localhost:$TunnelPort/user/login"
        if ($status -eq "200" -or $status -eq "302") {
            return
        }
        Start-Sleep -Seconds 2
    }
    throw "Akeneo did not become reachable on http://localhost:$TunnelPort within $MaxSeconds seconds."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot

try {
    $stateDir = Join-Path $projectRoot ".ngrok-share"
    $statePath = Join-Path $stateDir "state.json"
    if (!(Test-Path $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir | Out-Null
    }

    $ngrokCmd = Get-Command ngrok -ErrorAction Stop
    Write-Info "Using ngrok: $($ngrokCmd.Source)"

    if (-not $SkipDockerStart) {
        Write-Info "Ensuring Akeneo containers are up"
        docker compose up -d --remove-orphans | Out-Null
    }

    Write-Info "Waiting for local Akeneo at http://localhost:$Port/user/login"
    Wait-ForLocalApp -TunnelPort $Port

    $existingState = $null
    if (Test-Path $statePath) {
        try {
            $existingState = Get-Content $statePath -Raw | ConvertFrom-Json
        } catch {
            $existingState = $null
        }
    }

    $authEnabled = -not $NoBasicAuth
    $ngrokTunnel = Get-NgrokTunnelForPort -TunnelPort $Port
    $ngrokProcessId = $null

    if ($null -ne $ngrokTunnel) {
        if ($authEnabled) {
            $canReuseExisting = $false

            if ($null -ne $existingState `
                    -and $existingState.tunnel_url -eq $ngrokTunnel.public_url `
                    -and [bool]$existingState.basic_auth_enabled `
                    -and $existingState.basic_auth_user -eq $BasicAuthUser) {
                if ([string]::IsNullOrWhiteSpace($BasicAuthPassword)) {
                    if (-not [string]::IsNullOrWhiteSpace($existingState.basic_auth_password)) {
                        $BasicAuthPassword = [string]$existingState.basic_auth_password
                        $canReuseExisting = $true
                    }
                } elseif ($BasicAuthPassword -eq [string]$existingState.basic_auth_password) {
                    $canReuseExisting = $true
                }
            }

            if (-not $canReuseExisting) {
                Write-Info "Existing ngrok tunnel found but credentials are not verifiable. Restarting ngrok with managed credentials."
                Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
                Start-Sleep -Seconds 1
                $ngrokTunnel = $null
            }
        }
    }

    if ($null -eq $ngrokTunnel) {
        if ($authEnabled -and [string]::IsNullOrWhiteSpace($BasicAuthPassword)) {
            $BasicAuthPassword = Get-RandomPassword -Length 20
        }

        Write-Info "Starting ngrok tunnel on port $Port"
        $args = @("http", $Port.ToString())
        if ($authEnabled) {
            $args += "--basic-auth=$BasicAuthUser`:$BasicAuthPassword"
        }

        $proc = Start-Process -FilePath $ngrokCmd.Source -ArgumentList $args -PassThru -WindowStyle Hidden
        $ngrokProcessId = $proc.Id

        $deadline = (Get-Date).AddSeconds(40)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 1
            $ngrokTunnel = Get-NgrokTunnelForPort -TunnelPort $Port
            if ($null -ne $ngrokTunnel) {
                break
            }
        }
        if ($null -eq $ngrokTunnel) {
            throw "ngrok started but no HTTPS tunnel was found via http://127.0.0.1:4040/api/tunnels."
        }
    } else {
        Write-Info "Reusing existing ngrok tunnel: $($ngrokTunnel.public_url)"
    }

    $publicUrl = $ngrokTunnel.public_url
    Write-Info "Updating $EnvFile with AKENEO_PIM_URL=$publicUrl"
    Set-EnvValue -Path (Join-Path $projectRoot $EnvFile) -Key "AKENEO_PIM_URL" -Value $publicUrl

    Write-Info "Recreating web containers to pick up updated env"
    docker compose up -d --force-recreate fpm httpd php | Out-Null

    $state = [ordered]@{
        tunnel_url = $publicUrl
        tunnel_port = $Port
        basic_auth_enabled = $authEnabled
        basic_auth_user = if ($authEnabled) { $BasicAuthUser } else { "" }
        basic_auth_password = if ($authEnabled) { $BasicAuthPassword } else { "" }
        ngrok_pid = if ($null -ne $ngrokProcessId) { $ngrokProcessId } else { 0 }
        generated_at = (Get-Date).ToString("o")
    }

    $stateJson = $state | ConvertTo-Json -Depth 4
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($statePath, $stateJson, $utf8NoBom)

    Write-Host ""
    Write-Host "Team Share Is Ready"
    Write-Host "URL: $publicUrl"
    if ($authEnabled) {
        Write-Host "Basic auth username: $BasicAuthUser"
        Write-Host "Basic auth password: $BasicAuthPassword"
    }
    Write-Host "Akeneo login: admin / admin"
    Write-Host "State file: $statePath"
} finally {
    Pop-Location
}
