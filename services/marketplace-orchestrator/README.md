# Marketplace Orchestrator

This service is the Coppermind-owned orchestration layer on top of Akeneo and ResourceSpace.

It now does more than marketplace readiness checks:

- ingests tenant-scoped product-change events,
- stores a local catalog working set per tenant and SKU,
- syncs Amazon notification subscriptions,
- snapshots Amazon product-type schemas,
- watches approved brand sources,
- generates enrichment proposals,
- auto-applies low-risk changes,
- runs Amazon validation preview before publish,
- submits listing updates in mock or live mode,
- monitors listing health and account health,
- raises operator alerts and writes email notifications to a local outbox.

## Local run

Start the API and worker from the repo root:

```powershell
make marketplace-up
```

The API is exposed at `http://localhost:8090`.

## Data model

The worker stores state under `var/marketplace-orchestrator/`:

- `catalog/`
- `jobs/`
- `alerts/`
- `proposals/`
- `notifications/`
- `snapshots/`
- `outbox/email/`

## Configuration

Tenant and marketplace settings live in `config/tenants.json`.

The sample tenant is configured in `mock` Amazon mode so the full worker stack is testable without credentials.

Switch to `live` mode when you provide:

- Login with Amazon client ID and client secret,
- seller refresh token,
- AWS access key ID and secret access key for SP-API request signing,
- Amazon seller ID,
- notification destination configuration,
- alert routing configuration.

## Endpoints

- `GET /health`
- `GET /v1/tenants`
- `GET /v1/tenants/{tenantCode}/marketplaces`
- `GET /v1/tenants/{tenantCode}/amazon-config`
- `GET /v1/runs`
- `GET /v1/jobs`
- `GET /v1/alerts`
- `GET /v1/proposals`
- `GET /v1/notifications`
- `GET /v1/snapshots`
- `GET /v1/catalog/{tenantCode}/products/{sku}`
- `POST /v1/tenants/{tenantCode}/workflows/{marketplaceCode}/preview`
- `POST /v1/events/product-changed`
- `POST /v1/tenants/{tenantCode}/amazon`
- `POST /v1/tenants/{tenantCode}/marketplaces/{marketplaceCode}/amazon/schema-sync`
- `POST /v1/tenants/{tenantCode}/marketplaces/{marketplaceCode}/amazon/brand-watch`
- `POST /v1/tenants/{tenantCode}/marketplaces/{marketplaceCode}/amazon/account-health`
- `POST /v1/tenants/{tenantCode}/marketplaces/{marketplaceCode}/amazon/validate`
- `POST /v1/tenants/{tenantCode}/marketplaces/{marketplaceCode}/amazon/publish`
- `POST /v1/amazon/notifications/ingest`

## Example flow

1. Send a product-change event:

```powershell
$body = Get-Content services/marketplace-orchestrator/fixtures/sample-product.json -Raw
Invoke-RestMethod -Method Post -Uri http://localhost:8090/v1/events/product-changed -ContentType 'application/json' -Body $body
```

2. Check generated proposals:

```powershell
Invoke-RestMethod -Uri "http://localhost:8090/v1/proposals?tenant=default&marketplace=amazon_us"
```

3. Check publish execution jobs:

```powershell
Invoke-RestMethod -Uri "http://localhost:8090/v1/jobs?tenant=default&type=amazon_publish_execution"
```

4. Send a synthetic Amazon issue notification:

```powershell
$payload = '{"tenantCode":"default","marketplaceCode":"amazon_us","notificationType":"LISTINGS_ITEM_ISSUES_CHANGE","sku":"100121","issues":[{"code":"MISSING_BULLET","message":"Bullet content is incomplete"}]}'
Invoke-RestMethod -Method Post -Uri http://localhost:8090/v1/amazon/notifications/ingest -ContentType 'application/json' -Body $payload
```
