param(
    [int]$Port = 8080,
    [string]$EnvFile = ".env",
    [switch]$KeepNgrokRunning
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
    Write-Host "[share] $Message"
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

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot

try {
    $statePath = Join-Path $projectRoot ".ngrok-share\state.json"

    if (-not $KeepNgrokRunning) {
        $stopped = $false

        if (Test-Path $statePath) {
            try {
                $state = Get-Content $statePath -Raw | ConvertFrom-Json
                if ($state.ngrok_pid -gt 0) {
                    $proc = Get-Process -Id ([int]$state.ngrok_pid) -ErrorAction SilentlyContinue
                    if ($null -ne $proc) {
                        Stop-Process -Id $proc.Id -Force
                        Write-Info "Stopped ngrok process id $($proc.Id)"
                        $stopped = $true
                    }
                }
            } catch {
                Write-Info "State file exists but could not parse it, continuing."
            }
        }

        if (-not $stopped) {
            $procs = Get-Process ngrok -ErrorAction SilentlyContinue
            if ($null -ne $procs) {
                $procs | Stop-Process -Force
                Write-Info "Stopped running ngrok process(es)."
                $stopped = $true
            }
        }

        if (-not $stopped) {
            Write-Info "No running ngrok process found."
        }
    } else {
        Write-Info "Keeping ngrok process running as requested."
    }

    Set-EnvValue -Path (Join-Path $projectRoot $EnvFile) -Key "AKENEO_PIM_URL" -Value "http://localhost:$Port"
    Write-Info "Reset AKENEO_PIM_URL=http://localhost:$Port in $EnvFile"

    docker compose up -d --force-recreate fpm httpd php | Out-Null
    Write-Info "Recreated web containers."

    if (Test-Path $statePath) {
        Remove-Item $statePath -Force
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Team share stopped."
Write-Host "Local URL: http://localhost:$Port"
