param(
  [string]$BaseUrl = 'http://52.42.20.221',
  [switch]$IncludeExtraTenant = $true,
  [switch]$ForceProductRefresh
)

$ErrorActionPreference = 'Stop'

$seedTag = 'demo-seed-20260415'
$normalizedBaseUrl = $BaseUrl.TrimEnd('/')
$controlPlaneBase = "$normalizedBaseUrl/control-plane/api"
$marketBase = "$normalizedBaseUrl/market/v1"

function Write-Section([string]$Message) {
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Get-ExceptionResponseText($Exception) {
  $response = $Exception.Response
  if ($null -eq $response) {
    return ''
  }

  try {
    $stream = $response.GetResponseStream()
    if ($null -eq $stream) {
      return ''
    }

    $reader = New-Object System.IO.StreamReader($stream)
    try {
      return $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
  } catch {
    return ''
  }
}

function Get-StatusCode($Exception) {
  $response = $Exception.Response
  if ($null -eq $response -or $null -eq $response.StatusCode) {
    return $null
  }

  try {
    return [int]$response.StatusCode.value__
  } catch {
    try {
      return [int]$response.StatusCode
    } catch {
      return $null
    }
  }
}

function Invoke-JsonApi {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST', 'PUT')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    $Body = $null,
    [int[]]$AllowedStatusCodes = @(200, 201, 202)
  )

  try {
    if ($null -ne $Body) {
      $json = $Body | ConvertTo-Json -Depth 25 -Compress
      return Invoke-RestMethod -Uri $Uri -Method $Method -TimeoutSec 120 -ContentType 'application/json' -Body $json
    }

    return Invoke-RestMethod -Uri $Uri -Method $Method -TimeoutSec 120
  } catch {
    $statusCode = Get-StatusCode $_.Exception
    if ($null -ne $statusCode -and $AllowedStatusCodes -contains $statusCode) {
      return $null
    }

    $body = Get-ExceptionResponseText $_.Exception
    if ($body) {
      throw "HTTP $statusCode $Method $Uri failed.`n$body"
    }

    throw
  }
}

function Get-Collection($Object, [string]$PropertyName) {
  if ($null -eq $Object) {
    return @()
  }

  $value = $Object.$PropertyName
  if ($null -eq $value) {
    return @()
  }

  return @($value)
}

function Get-ControlPlaneOverview {
  return Invoke-JsonApi -Method GET -Uri "$controlPlaneBase/overview"
}

function Get-ControlPlaneWorkspace([string]$TenantCode) {
  $encodedTenant = [uri]::EscapeDataString($TenantCode)
  return Invoke-JsonApi -Method GET -Uri "$controlPlaneBase/workspace?tenant=$encodedTenant"
}

function Get-MarketDashboard([string]$TenantCode = '') {
  if ([string]::IsNullOrWhiteSpace($TenantCode)) {
    return Invoke-JsonApi -Method GET -Uri "$marketBase/dashboard"
  }

  $encodedTenant = [uri]::EscapeDataString($TenantCode)
  return Invoke-JsonApi -Method GET -Uri "$marketBase/dashboard?tenant=$encodedTenant"
}

function Get-MarketAlerts([string]$TenantCode) {
  $encodedTenant = [uri]::EscapeDataString($TenantCode)
  $payload = Invoke-JsonApi -Method GET -Uri "$marketBase/alerts?tenant=$encodedTenant"
  return Get-Collection $payload 'alerts'
}

function Get-MarketInbox([string]$TenantCode) {
  $encodedTenant = [uri]::EscapeDataString($TenantCode)
  return Invoke-JsonApi -Method GET -Uri "$marketBase/review/inbox?tenant=$encodedTenant"
}

function Get-MarketCatalogProduct([string]$TenantCode, [string]$Sku) {
  $encodedTenant = [uri]::EscapeDataString($TenantCode)
  $encodedSku = [uri]::EscapeDataString($Sku)
  return Invoke-JsonApi -Method GET -Uri "$marketBase/catalog/$encodedTenant/products/$encodedSku" -AllowedStatusCodes @(404)
}

function Wait-Until {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Condition,
    [Parameter(Mandatory = $true)][string]$Label,
    [int]$TimeoutSeconds = 40,
    [int]$IntervalSeconds = 2
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) {
      Write-Host "Ready: $Label" -ForegroundColor Green
      return $true
    }

    Start-Sleep -Seconds $IntervalSeconds
  }

  Write-Host "Timed out waiting for $Label" -ForegroundColor Yellow
  return $false
}

function Ensure-Tenant {
  param([hashtable]$Spec)

  $overview = Get-ControlPlaneOverview
  $tenant = @(Get-Collection $overview 'tenants' | Where-Object { $_.code -eq $Spec.code }) | Select-Object -First 1
  if ($null -eq $tenant) {
    Write-Host "Creating tenant $($Spec.code)..." -ForegroundColor Yellow
    $createPayload = @{
      code = $Spec.code
      label = $Spec.label
      planCode = $Spec.planCode
      ownerEmail = $Spec.ownerEmail
      ownerName = $Spec.ownerName
      billingEmail = $Spec.billingEmail
      paymentProcessor = $Spec.paymentProcessor
      status = $Spec.status
      lifecycle = $Spec.lifecycle
      password = $Spec.password
      amazonMode = $Spec.amazonMode
      pilotFamilyCodes = $Spec.pilotFamilyCodes
      alertEmails = $Spec.alertEmails
      aiProviders = $Spec.aiProviders
      notes = $Spec.notes
    }

    $result = Invoke-JsonApi -Method POST -Uri "$controlPlaneBase/tenants" -Body $createPayload
    $tenant = $result.tenant
  } else {
    Write-Host "Tenant $($Spec.code) already exists." -ForegroundColor DarkGray
  }

  if ($Spec.updatePayload) {
    $tenant = Invoke-JsonApi -Method PUT -Uri "$controlPlaneBase/tenants/$($Spec.code)" -Body $Spec.updatePayload
  }

  return $tenant
}

function Ensure-User {
  param(
    [string]$TenantCode,
    [hashtable]$Spec
  )

  $workspace = Get-ControlPlaneWorkspace $TenantCode
  $existing = @(Get-Collection $workspace 'users' | Where-Object { $_.email -eq $Spec.email }) | Select-Object -First 1
  if ($null -eq $existing) {
    Write-Host "Creating user $($Spec.email)..." -ForegroundColor Yellow
    $payload = @{
      email = $Spec.email
      name = $Spec.name
      role = $Spec.role
      status = $Spec.status
      password = $Spec.password
    }
    $existing = Invoke-JsonApi -Method POST -Uri "$controlPlaneBase/tenants/$TenantCode/users" -Body $payload
  } else {
    $update = @{}
    if ($existing.name -ne $Spec.name) {
      $update.name = $Spec.name
    }
    if ($existing.role -ne $Spec.role) {
      $update.role = $Spec.role
    }
    if ($existing.status -ne $Spec.status) {
      $update.status = $Spec.status
    }
    if ($Spec.password) {
      $update.password = $Spec.password
    }

    if ($update.Count -gt 0) {
      Write-Host "Updating user $($Spec.email)..." -ForegroundColor Yellow
      $existing = Invoke-JsonApi -Method PUT -Uri "$controlPlaneBase/users/$($existing.id)" -Body $update
    } else {
      Write-Host "User $($Spec.email) already seeded." -ForegroundColor DarkGray
    }
  }

  if ($Spec.passwordReset) {
    $workspace = Get-ControlPlaneWorkspace $TenantCode
    $openReset = @(Get-Collection $workspace 'passwordResets' | Where-Object {
        $_.userId -eq $existing.id -and $_.status -eq 'open'
      }) | Select-Object -First 1
    if ($null -eq $openReset) {
      Write-Host "Queueing password reset for $($Spec.email)..." -ForegroundColor Yellow
      Invoke-JsonApi -Method POST -Uri "$controlPlaneBase/users/$($existing.id)/password-reset" -Body @{} | Out-Null
    }
  }

  return $existing
}

function Ensure-SupportTicket {
  param(
    [string]$TenantCode,
    [hashtable]$Spec
  )

  $workspace = Get-ControlPlaneWorkspace $TenantCode
  $ticket = @(Get-Collection $workspace 'supportTickets' | Where-Object { $_.subject -eq $Spec.subject }) | Select-Object -First 1
  if ($null -eq $ticket) {
    Write-Host "Creating support ticket $($Spec.subject)..." -ForegroundColor Yellow
    $ticket = Invoke-JsonApi -Method POST -Uri "$controlPlaneBase/tenants/$TenantCode/support-tickets" -Body @{
      type = $Spec.type
      priority = $Spec.priority
      status = $Spec.status
      requesterEmail = $Spec.requesterEmail
      subject = $Spec.subject
      description = $Spec.description
      assignee = $Spec.assignee
    }
  } else {
    $ticket = Invoke-JsonApi -Method PUT -Uri "$controlPlaneBase/support-tickets/$($ticket.id)" -Body @{
      priority = $Spec.priority
      status = $Spec.status
      description = $Spec.description
      assignee = $Spec.assignee
    }
  }

  foreach ($comment in $Spec.comments) {
    $exists = @(Get-Collection $ticket 'comments' | Where-Object { $_.body -eq $comment.body }) | Select-Object -First 1
    if ($null -eq $exists) {
      Write-Host "Adding ticket comment on $($Spec.subject)..." -ForegroundColor Yellow
      $ticket = Invoke-JsonApi -Method POST -Uri "$controlPlaneBase/support-tickets/$($ticket.id)/comments" -Body @{
        author = $comment.author
        body = $comment.body
      }
    }
  }

  return $ticket
}

function Ensure-BackupRun {
  param([hashtable]$Spec)

  $workspace = Get-ControlPlaneWorkspace $Spec.tenantCode
  $existing = @(Get-Collection $workspace 'backups' | Where-Object { $_.location -eq $Spec.location }) | Select-Object -First 1
  if ($null -ne $existing) {
    Write-Host "Backup record already exists for $($Spec.location)." -ForegroundColor DarkGray
    return $existing
  }

  Write-Host "Recording backup $($Spec.location)..." -ForegroundColor Yellow
  return Invoke-JsonApi -Method POST -Uri "$controlPlaneBase/ops/backups" -Body $Spec
}

function Ensure-MonitorSnapshot {
  param([hashtable]$Spec)

  $workspace = Get-ControlPlaneWorkspace $Spec.tenantCode
  $existing = @(Get-Collection $workspace 'monitorSnapshots' | Where-Object {
      $_.service -eq $Spec.service -and $_.details -eq $Spec.details
    }) | Select-Object -First 1
  if ($null -ne $existing) {
    Write-Host "Monitor snapshot already exists for $($Spec.service)." -ForegroundColor DarkGray
    return $existing
  }

  Write-Host "Recording monitor snapshot for $($Spec.service)..." -ForegroundColor Yellow
  return Invoke-JsonApi -Method POST -Uri "$controlPlaneBase/ops/monitor-snapshots" -Body $Spec
}

function Ensure-Incident {
  param([hashtable]$Spec)

  $workspace = Get-ControlPlaneWorkspace $Spec.tenantCode
  $existing = @(Get-Collection $workspace 'incidents' | Where-Object { $_.title -eq $Spec.title }) | Select-Object -First 1
  if ($null -eq $existing) {
    Write-Host "Recording incident $($Spec.title)..." -ForegroundColor Yellow
    return Invoke-JsonApi -Method POST -Uri "$controlPlaneBase/ops/incidents" -Body $Spec
  }

  Write-Host "Updating incident $($Spec.title)..." -ForegroundColor Yellow
  return Invoke-JsonApi -Method PUT -Uri "$controlPlaneBase/incidents/$($existing.id)" -Body @{
    severity = $Spec.severity
    status = $Spec.status
    summary = $Spec.summary
    services = $Spec.services
    runbookUrl = $Spec.runbookUrl
    assignee = $Spec.assignee
  }
}

function Set-OnboardingState {
  param(
    [string]$TenantCode,
    [hashtable]$Spec
  )

  Write-Host "Updating onboarding state for $TenantCode..." -ForegroundColor Yellow
  return Invoke-JsonApi -Method PUT -Uri "$controlPlaneBase/tenants/$TenantCode/onboarding" -Body $Spec
}

function Set-AdminSettings {
  param(
    [string]$TenantCode,
    [hashtable]$Spec
  )

  Write-Host "Updating admin settings for $TenantCode..." -ForegroundColor Yellow
  return Invoke-JsonApi -Method PUT -Uri "$controlPlaneBase/tenants/$TenantCode/admin-settings" -Body $Spec
}

function Ensure-MarketProduct {
  param(
    [string]$TenantCode,
    [hashtable]$Spec
  )

  $sku = [string]$Spec.product.identifier
  $existing = Get-MarketCatalogProduct -TenantCode $TenantCode -Sku $sku
  if ($null -ne $existing -and -not $ForceProductRefresh) {
    Write-Host "Marketplace catalog product $sku already exists." -ForegroundColor DarkGray
    return $existing
  }

  Write-Host "Queueing marketplace product seed for $sku..." -ForegroundColor Yellow
  Invoke-JsonApi -Method POST -Uri "$marketBase/events/product-changed" -Body @{
    tenantCode = $TenantCode
    marketplaces = $Spec.marketplaces
    product = $Spec.product
  } | Out-Null

  return $true
}

function Ensure-MarketPublishAction {
  param(
    [string]$TenantCode,
    [string]$MarketplaceCode,
    [string]$Sku,
    [string]$ExpectedAlertTitle
  )

  $alerts = Get-MarketAlerts $TenantCode
  $existing = @($alerts | Where-Object { $_.title -eq $ExpectedAlertTitle }) | Select-Object -First 1
  if ($null -ne $existing) {
    Write-Host "Publish action already reflected by alert: $ExpectedAlertTitle" -ForegroundColor DarkGray
    return $existing
  }

  Write-Host "Queueing publish action for $Sku..." -ForegroundColor Yellow
  return Invoke-JsonApi -Method POST -Uri "$marketBase/tenants/$TenantCode/marketplaces/$MarketplaceCode/amazon/publish" -Body @{
    sku = $Sku
    autoApprovedOnly = $true
    submissionMode = 'put'
  }
}

function Ensure-MarketNotification {
  param(
    [string]$TenantCode,
    [string]$ExpectedAlertTitle,
    [hashtable]$Payload
  )

  $alerts = Get-MarketAlerts $TenantCode
  $existing = @($alerts | Where-Object { $_.title -eq $ExpectedAlertTitle }) | Select-Object -First 1
  if ($null -ne $existing) {
    Write-Host "Notification already reflected by alert: $ExpectedAlertTitle" -ForegroundColor DarkGray
    return $existing
  }

  Write-Host "Ingesting notification for alert: $ExpectedAlertTitle" -ForegroundColor Yellow
  return Invoke-JsonApi -Method POST -Uri "$marketBase/amazon/notifications/ingest" -Body $Payload
}

$now = Get-Date
$defaultTenantCode = 'default'
$northstarTenantCode = 'northstar-demo'

$defaultTenantSpec = @{
  code = $defaultTenantCode
  label = 'Default Tenant'
  updatePayload = @{
    status = 'active'
    lifecycle = 'design_partner'
    notes = "Seeded on $($now.ToString('yyyy-MM-dd')) by $seedTag for Operator staging demos."
    billing = @{
      customerStatus = 'active'
      subscriptionStatus = 'trial'
      paymentProcessor = 'pending'
      trialEndsAt = $now.AddDays(14).ToString('o')
    }
    infrastructure = @{
      media = @{
        storageProvider = 's3_preview'
        bucket = 'epic-operator-dev-media-167781470853-us-west-2'
        cdnStatus = 'planned'
        signedUrlsEnabled = $false
      }
    }
  }
}

$northstarTenantSpec = @{
  code = $northstarTenantCode
  label = 'Northstar Outfitters'
  planCode = 'operator_growth'
  ownerEmail = 'owner@northstar-demo.example.com'
  ownerName = 'Northstar Demo Owner'
  billingEmail = 'finance@northstar-demo.example.com'
  paymentProcessor = 'stripe_demo'
  status = 'active'
  lifecycle = 'hybrid_self_serve'
  password = 'NorthstarDemo13!'
  amazonMode = 'mock'
  pilotFamilyCodes = @('shoes')
  alertEmails = @('alerts@northstar-demo.example.com')
  aiProviders = @('openai', 'anthropic')
  notes = "Provisioned by $seedTag for multi-tenant demos."
  updatePayload = @{
    status = 'active'
    lifecycle = 'hybrid_self_serve'
    notes = "Provisioned by $seedTag for multi-tenant demos."
    billing = @{
      customerStatus = 'active'
      subscriptionStatus = 'trial'
      paymentProcessor = 'stripe_demo'
      trialEndsAt = $now.AddDays(21).ToString('o')
    }
    infrastructure = @{
      media = @{
        storageProvider = 's3_preview'
        bucket = 'epic-operator-dev-media-167781470853-us-west-2'
        cdnStatus = 'planned'
        signedUrlsEnabled = $false
      }
    }
  }
}

$defaultUsers = @(
  @{
    email = 'emma.catalog@operator-demo.example.com'
    name = 'Emma Catalog'
    role = 'merchandiser'
    status = 'active'
    password = 'DemoPlay123!'
  },
  @{
    email = 'marcus.market@operator-demo.example.com'
    name = 'Marcus Market'
    role = 'approver'
    status = 'active'
    password = 'DemoPlay123!'
  },
  @{
    email = 'chris.ops@operator-demo.example.com'
    name = 'Chris Ops'
    role = 'operator_admin'
    status = 'active'
    password = 'DemoPlay123!'
  },
  @{
    email = 'olivia.support@operator-demo.example.com'
    name = 'Olivia Support'
    role = 'support'
    status = 'invited'
    passwordReset = $true
  }
)

$northstarUsers = @(
  @{
    email = 'merch@northstar-demo.example.com'
    name = 'Northstar Merch'
    role = 'merchandiser'
    status = 'invited'
    passwordReset = $true
  }
)

$defaultSupportTickets = @(
  @{
    type = 'technical'
    priority = 'high'
    status = 'triaged'
    requesterEmail = 'emma.catalog@operator-demo.example.com'
    subject = '[Demo] Bulk image upload stalled before spring launch'
    description = 'The creative team reported a stalled media upload during the spring hiking launch prep. Initial retry succeeded, but they want monitoring reviewed.'
    assignee = 'Olivia Support'
    comments = @(
      @{ author = 'Olivia Support'; body = 'Reproduced once in staging and confirmed the queue recovered after a retry.' },
      @{ author = 'Chris Ops'; body = 'Added this case to the demo queue so the team can review how support notes and ops handoff look.' }
    )
  },
  @{
    type = 'marketplace'
    priority = 'high'
    status = 'waiting_customer'
    requesterEmail = 'marcus.market@operator-demo.example.com'
    subject = '[Demo] Amazon suppression review for hiking shoe family'
    description = 'Several SKUs in the hiking shoe family need marketplace copy review before the next Amazon push.'
    assignee = 'Marcus Market'
    comments = @(
      @{ author = 'Marcus Market'; body = 'Waiting on brand copy confirmation for the final bullet hierarchy.' }
    )
  },
  @{
    type = 'access'
    priority = 'medium'
    status = 'open'
    requesterEmail = 'jorgen@epicglobalinc.com'
    subject = '[Demo] Add an approver for private label accessories'
    description = 'Need one more approver on the accessories program before the next listing review cycle.'
    assignee = 'Chris Ops'
    comments = @(
      @{ author = 'Chris Ops'; body = 'Queued in the demo environment to show user-admin and approval routing together.' }
    )
  }
)

$northstarSupportTickets = @(
  @{
    type = 'onboarding'
    priority = 'medium'
    status = 'investigating'
    requesterEmail = 'owner@northstar-demo.example.com'
    subject = '[Demo] Need help mapping apparel taxonomy'
    description = 'Northstar wants help mapping apparel-specific taxonomy and size charts before their first marketplace batch.'
    assignee = 'Emma Catalog'
    comments = @(
      @{ author = 'Emma Catalog'; body = 'Captured as a demo onboarding ticket so taxonomy support is visible in the control plane.' }
    )
  }
)

$defaultBackups = @(
  @{
    environment = 'dev'
    tenantCode = $defaultTenantCode
    scope = 'full_stack'
    status = 'success'
    location = 's3://epic-operator-dev-backups-167781470853-us-west-2/demo-seed/full-stack-20260414-0100.sql.gz'
    startedAt = $now.AddHours(-30).ToString('o')
    completedAt = $now.AddHours(-29.8).ToString('o')
    restoreDrillAt = $now.AddHours(-12).ToString('o')
    notes = "Seeded backup history for $seedTag."
  },
  @{
    environment = 'dev'
    tenantCode = $defaultTenantCode
    scope = 'control_plane'
    status = 'success'
    location = 's3://epic-operator-dev-backups-167781470853-us-west-2/demo-seed/control-plane-20260415-0100.sql.gz'
    startedAt = $now.AddHours(-6).ToString('o')
    completedAt = $now.AddHours(-5.9).ToString('o')
    restoreDrillAt = $null
    notes = "Control-plane snapshot recorded by $seedTag."
  }
)

$northstarBackups = @(
  @{
    environment = 'dev'
    tenantCode = $northstarTenantCode
    scope = 'tenant_seed'
    status = 'success'
    location = 's3://epic-operator-dev-backups-167781470853-us-west-2/demo-seed/northstar-20260415-0200.sql.gz'
    startedAt = $now.AddHours(-4).ToString('o')
    completedAt = $now.AddHours(-3.95).ToString('o')
    restoreDrillAt = $null
    notes = "Northstar demo tenant seed backup for $seedTag."
  }
)

$defaultMonitors = @(
  @{
    environment = 'dev'
    tenantCode = $defaultTenantCode
    service = 'catalog'
    url = "$normalizedBaseUrl/"
    ok = $true
    statusCode = 200
    responseTimeMs = 128
    details = "$seedTag catalog healthy via public edge"
  },
  @{
    environment = 'dev'
    tenantCode = $defaultTenantCode
    service = 'assets'
    url = "$normalizedBaseUrl/assets/"
    ok = $true
    statusCode = 200
    responseTimeMs = 103
    details = "$seedTag dam healthy via public edge"
  },
  @{
    environment = 'dev'
    tenantCode = $defaultTenantCode
    service = 'market'
    url = "$normalizedBaseUrl/market/dashboard"
    ok = $true
    statusCode = 200
    responseTimeMs = 97
    details = "$seedTag marketplace dashboard healthy"
  },
  @{
    environment = 'dev'
    tenantCode = $defaultTenantCode
    service = 'ai'
    url = 'http://localhost:3005'
    ok = $false
    statusCode = 0
    responseTimeMs = 0
    details = "$seedTag Epic AI is intentionally offline in dev until provider credentials are added"
  }
)

$defaultIncidents = @(
  @{
    environment = 'dev'
    tenantCode = $defaultTenantCode
    severity = 'warning'
    status = 'monitoring'
    title = '[Demo] Marketplace alert fan-out lag'
    summary = 'Alert dispatch briefly lagged after a batch of Amazon notifications. Queue is stable again, but monitoring remains active for demo purposes.'
    services = @('market', 'control-plane')
    runbookUrl = 'https://operator.example.invalid/runbooks/alert-fanout'
    assignee = 'Chris Ops'
  },
  @{
    environment = 'dev'
    tenantCode = $defaultTenantCode
    severity = 'info'
    status = 'resolved'
    title = '[Demo] DAM thumbnail worker restarted'
    summary = 'Thumbnail processing was restarted during a maintenance window and is now healthy.'
    services = @('assets')
    runbookUrl = 'https://operator.example.invalid/runbooks/dam-workers'
    assignee = 'Olivia Support'
  }
)

$defaultProducts = @(
  @{
    marketplaces = @('amazon_us')
    product = @{
      uuid = 'demo-100121-operator'
      identifier = '100121'
      family = 'shoes'
      locales = @('en_US')
      markets = @('US')
      governance = @{
        publishStatus = 'ready'
        completenessScore = 96
      }
      attributes = @{
        name = 'Operator Alpine Storm Hiker'
        marketplace_title = 'Operator Alpine Storm Hiker - Legacy Draft'
        description = 'Legacy product draft that understates the waterproof membrane and terrain grip.'
        brand = 'Operator'
        bullet_1 = 'Legacy draft: coated upper for wet trails'
        bullet_2 = 'Legacy draft: dependable grip on loose rock'
        bullet_3 = 'Legacy draft: everyday cushioning package'
        short_description = 'Weatherproof hiking shoe built for sharp elevation changes.'
      }
      assets = @(
        @{ ref = 101; role = 'hero_image'; type = 'image'; locale = 'en_US'; market = 'US'; isPrimary = $true },
        @{ ref = 102; role = 'angle_left'; type = 'image'; locale = 'en_US'; market = 'US' },
        @{ ref = 103; role = 'angle_right'; type = 'image'; locale = 'en_US'; market = 'US' },
        @{ ref = 104; role = 'detail'; type = 'image'; locale = 'en_US'; market = 'US' }
      )
      approvals = @('catalog_review', 'brand_review')
    }
  },
  @{
    marketplaces = @('amazon_us')
    product = @{
      uuid = 'demo-200210-operator'
      identifier = '200210'
      family = 'shoes'
      locales = @('en_US')
      markets = @('US')
      governance = @{
        publishStatus = 'blocked'
        completenessScore = 58
      }
      attributes = @{
        name = 'Operator Canyon Run Mid'
        description = 'Mid-cut hiking shoe waiting on final compliance review.'
        brand = 'Operator'
        bullet_1 = 'Supportive ankle collar'
        bullet_2 = 'Lightweight foam midsole'
      }
      assets = @(
        @{ ref = 201; role = 'hero_image'; type = 'image'; locale = 'en_US'; market = 'US'; isPrimary = $true },
        @{ ref = 202; role = 'angle_left'; type = 'image'; locale = 'en_US'; market = 'US' }
      )
      approvals = @('catalog_review')
    }
  },
  @{
    marketplaces = @('amazon_us')
    product = @{
      uuid = 'demo-300330-operator'
      identifier = '300330'
      family = 'boots'
      locales = @('en_US')
      markets = @('US')
      governance = @{
        publishStatus = 'ready'
        completenessScore = 92
      }
      attributes = @{
        name = 'Operator Ridgecrest Boot'
        marketplace_title = 'Operator Ridgecrest Boot'
        description = 'Protective mid-height boot designed for rocky terrain and colder morning starts.'
        brand = 'Operator'
        bullet_1 = 'Reinforced toe cap'
        bullet_2 = 'Cold-weather traction compound'
        bullet_3 = 'Mid-height support for uneven surfaces'
      }
      assets = @(
        @{ ref = 301; role = 'hero_image'; type = 'image'; locale = 'en_US'; market = 'US'; isPrimary = $true },
        @{ ref = 302; role = 'angle_left'; type = 'image'; locale = 'en_US'; market = 'US' },
        @{ ref = 303; role = 'angle_right'; type = 'image'; locale = 'en_US'; market = 'US' },
        @{ ref = 304; role = 'detail'; type = 'image'; locale = 'en_US'; market = 'US' }
      )
      approvals = @('catalog_review', 'brand_review')
    }
  },
  @{
    marketplaces = @('amazon_us', 'walmart_us', 'shopify_b2c')
    product = @{
      uuid = 'demo-400440-operator'
      identifier = '400440'
      family = 'shoes'
      locales = @('en_US')
      markets = @('US')
      governance = @{
        publishStatus = 'ready'
        completenessScore = 89
      }
      attributes = @{
        name = 'Operator Mesa Sprint'
        marketplace_title = 'Operator Mesa Sprint'
        description = 'Lightweight day-hike shoe with quick-drain mesh and aggressive forefoot grip.'
        brand = 'Operator'
        bullet_1 = 'Breathable quick-drain upper'
        bullet_2 = 'Aggressive forefoot lugs'
        bullet_3 = 'Packable for travel kits'
      }
      assets = @(
        @{ ref = 401; role = 'hero_image'; type = 'image'; locale = 'en_US'; market = 'US'; isPrimary = $true },
        @{ ref = 402; role = 'angle_left'; type = 'image'; locale = 'en_US'; market = 'US' },
        @{ ref = 403; role = 'angle_right'; type = 'image'; locale = 'en_US'; market = 'US' },
        @{ ref = 404; role = 'detail'; type = 'image'; locale = 'en_US'; market = 'US' }
      )
      approvals = @('catalog_review', 'brand_review')
    }
  }
)

Write-Section 'Seeding tenants and control plane'

Ensure-Tenant -Spec $defaultTenantSpec | Out-Null
if ($IncludeExtraTenant) {
  Ensure-Tenant -Spec $northstarTenantSpec | Out-Null
}

Set-OnboardingState -TenantCode $defaultTenantCode -Spec @{
  tenantCode = $defaultTenantCode
  status = 'in_progress'
  currentStep = 'launch'
  completedSteps = @('workspace', 'catalog', 'dam', 'approval_inbox')
  notes = "Demo walkthrough seeded by $seedTag."
} | Out-Null

Set-AdminSettings -TenantCode $defaultTenantCode -Spec @{
  amazon = @{
    mode = 'mock'
    pilotFamilyCodes = @('shoes')
    notificationTypes = @(
      'LISTINGS_ITEM_STATUS_CHANGE',
      'LISTINGS_ITEM_ISSUES_CHANGE',
      'ITEM_PRODUCT_TYPE_CHANGE',
      'PRODUCT_TYPE_DEFINITIONS_CHANGE',
      'ACCOUNT_STATUS_CHANGED'
    )
    alerts = @{
      email = @{
        enabled = $true
        to = @('jorgen@epicglobalinc.com', 'ops@operator-demo.example.com')
      }
    }
  }
  ai = @{
    listingWriter = @{
      enabled = $true
      providerIds = @('openai', 'xai', 'anthropic', 'gemini')
    }
  }
} | Out-Null

foreach ($user in $defaultUsers) {
  Ensure-User -TenantCode $defaultTenantCode -Spec $user | Out-Null
}

if ($IncludeExtraTenant) {
  foreach ($user in $northstarUsers) {
    Ensure-User -TenantCode $northstarTenantCode -Spec $user | Out-Null
  }
}

foreach ($ticket in $defaultSupportTickets) {
  Ensure-SupportTicket -TenantCode $defaultTenantCode -Spec $ticket | Out-Null
}

if ($IncludeExtraTenant) {
  foreach ($ticket in $northstarSupportTickets) {
    Ensure-SupportTicket -TenantCode $northstarTenantCode -Spec $ticket | Out-Null
  }
}

foreach ($backup in $defaultBackups) {
  Ensure-BackupRun -Spec $backup | Out-Null
}

if ($IncludeExtraTenant) {
  foreach ($backup in $northstarBackups) {
    Ensure-BackupRun -Spec $backup | Out-Null
  }
}

foreach ($snapshot in $defaultMonitors) {
  Ensure-MonitorSnapshot -Spec $snapshot | Out-Null
}

foreach ($incident in $defaultIncidents) {
  Ensure-Incident -Spec $incident | Out-Null
}

Write-Section 'Seeding marketplace catalog and alerts'

foreach ($product in $defaultProducts) {
  Ensure-MarketProduct -TenantCode $defaultTenantCode -Spec $product | Out-Null
}

Wait-Until -Label 'marketplace catalog records' -TimeoutSeconds 40 -Condition {
  foreach ($seededProduct in $defaultProducts) {
    $sku = [string]$seededProduct.product.identifier
    if ($null -eq (Get-MarketCatalogProduct -TenantCode $defaultTenantCode -Sku $sku)) {
      return $false
    }
  }
  return $true
} | Out-Null

Ensure-MarketPublishAction -TenantCode $defaultTenantCode -MarketplaceCode 'amazon_us' -Sku '300330' -ExpectedAlertTitle 'Amazon live cutover gated for 300330' | Out-Null

Ensure-MarketNotification -TenantCode $defaultTenantCode -ExpectedAlertTitle 'Amazon LISTINGS_ITEM_ISSUES_CHANGE for 400440' -Payload @{
  tenantCode = $defaultTenantCode
  marketplaceCode = 'amazon_us'
  notificationType = 'LISTINGS_ITEM_ISSUES_CHANGE'
  sku = '400440'
  payloadVersion = '1.0'
  issues = @(
    @{
      code = 'IMAGE_MAIN_MISSING'
      severity = 'ERROR'
      message = 'Main image quality issue detected in demo seed.'
    }
  )
} | Out-Null

Ensure-MarketNotification -TenantCode $defaultTenantCode -ExpectedAlertTitle 'Amazon PRODUCT_TYPE_DEFINITIONS_CHANGE detected' -Payload @{
  tenantCode = $defaultTenantCode
  marketplaceCode = 'amazon_us'
  notificationType = 'PRODUCT_TYPE_DEFINITIONS_CHANGE'
  productType = 'SHOES'
} | Out-Null

Ensure-MarketNotification -TenantCode $defaultTenantCode -ExpectedAlertTitle 'Amazon account status changed' -Payload @{
  tenantCode = $defaultTenantCode
  notificationType = 'ACCOUNT_STATUS_CHANGED'
  marketplaceId = 'ATVPDKIKX0DER'
  status = 'AT_RISK'
} | Out-Null

Wait-Until -Label 'review inbox population' -TimeoutSeconds 90 -Condition {
  $inbox = Get-MarketInbox $defaultTenantCode
  $openAlerts = (Get-Collection $inbox 'alerts').Count
  $openProposals = (Get-Collection $inbox 'proposals').Count
  return ($openAlerts -ge 3) -and ($openProposals -ge 1)
} | Out-Null

Write-Section 'Summary'

$overview = Get-ControlPlaneOverview
$defaultWorkspace = Get-ControlPlaneWorkspace $defaultTenantCode
$defaultInbox = Get-MarketInbox $defaultTenantCode
$defaultAlerts = Get-MarketAlerts $defaultTenantCode
$defaultProposals = Get-Collection (Invoke-JsonApi -Method GET -Uri "$marketBase/proposals?tenant=$defaultTenantCode") 'proposals'
$seededCatalogProducts = 0
foreach ($seededProduct in $defaultProducts) {
  $sku = [string]$seededProduct.product.identifier
  if ($null -ne (Get-MarketCatalogProduct -TenantCode $defaultTenantCode -Sku $sku)) {
    $seededCatalogProducts += 1
  }
}

Write-Host ("Tenants: {0}" -f $overview.totals.tenants) -ForegroundColor Green
Write-Host ("Queued emails: {0}" -f $overview.totals.queuedEmails) -ForegroundColor Green
Write-Host ("Open tickets: {0}" -f $overview.totals.openTickets) -ForegroundColor Green
Write-Host ("Active incidents: {0}" -f $overview.totals.activeIncidents) -ForegroundColor Green
Write-Host ("Healthy backups: {0}" -f $overview.totals.healthyBackups) -ForegroundColor Green
Write-Host ("Failing monitors: {0}" -f $overview.totals.failingMonitors) -ForegroundColor Green
Write-Host ("Default tenant users: {0}" -f (Get-Collection $defaultWorkspace 'users').Count) -ForegroundColor Green
Write-Host ("Default tenant support tickets: {0}" -f (Get-Collection $defaultWorkspace 'supportTickets').Count) -ForegroundColor Green
Write-Host ("Seeded marketplace catalog products: {0}" -f $seededCatalogProducts) -ForegroundColor Green
Write-Host ("Marketplace active alerts: {0}" -f $defaultAlerts.Count) -ForegroundColor Green
Write-Host ("Marketplace proposals: {0}" -f $defaultProposals.Count) -ForegroundColor Green
Write-Host ("Review inbox alerts: {0}" -f (Get-Collection $defaultInbox 'alerts').Count) -ForegroundColor Green
Write-Host ("Review inbox proposals: {0}" -f (Get-Collection $defaultInbox 'proposals').Count) -ForegroundColor Green

Write-Host ""
Write-Host "Seed complete. Browse:" -ForegroundColor Cyan
Write-Host "  $normalizedBaseUrl/control-plane/"
Write-Host "  $normalizedBaseUrl/market/dashboard"
Write-Host "  $normalizedBaseUrl/"
