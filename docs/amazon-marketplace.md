# Amazon Marketplace Automation

The standalone marketplace orchestration service now contains an Amazon-first workflow layer.

## What exists now

- Notification bootstrap job for Amazon notification subscriptions.
- Product Type Definitions schema-sync job.
- Listing health worker that snapshots Amazon listing status and issues.
- Account health worker that snapshots seller performance and marketplace participation.
- Brand-source watcher for approved first-party product pages.
- Proposal engine that compares brand evidence to current catalog content.
- Auto-apply policy that only applies low-risk changes automatically.
- Validation-preview job before publish.
- Publish executor that submits listing updates after validation preview passes.
- Alert dispatchers for Slack, PagerDuty, Seller Central app notifications, and a local email outbox.

## Safety policy

The service treats these fields as human-review-only:

- title
- brand
- product type
- category
- safety and compliance content

The service treats these fields as low-risk and eligible for auto-apply:

- description
- bullet copy
- keywords and search terms

## Local test mode

The sample tenant in `services/marketplace-orchestrator/config/tenants.json` runs in `mock` mode.

That lets you test:

- Amazon subscription bootstrap,
- schema snapshots,
- listing validation preview,
- publish execution,
- notification ingest,
- issue alerting,
- proposal generation,
- auto-applied catalog updates.

The orchestrator persists runs, jobs, alerts, proposals, notifications, snapshots, catalog state, and email outbox records in MySQL-backed Operator platform tables.

## Going live

To move from mock mode to live mode, update the tenant Amazon config with:

- `mode: "live"`
- optional `pilotFamilyCodes` to restrict live execution to one SKU family while the rest of the catalog stays in preview-only behavior
- Login with Amazon credentials
- seller refresh token
- AWS signing credentials
- seller ID
- notification destination configuration
- alert routing configuration

The service already supports `put`, `patch`, and `feed` listing submission modes at the connector layer.

## Operator visibility

- `GET /dashboard` renders a lightweight operator dashboard.
- `GET /v1/dashboard` returns queue, alert, proposal, run, and tenant readiness summary JSON.
- `GET /v1/reports/overview` returns a readiness-first summary for the control plane.
- `GET /v1/review/inbox` returns open alerts, pending proposals, and failed jobs together.
- `GET /v1/proposals/{proposalId}` returns the proposal detail.
- `POST /v1/proposals/{proposalId}/approve`
- `POST /v1/proposals/{proposalId}/reject`
- `POST /v1/proposals/{proposalId}/apply`
- `POST /v1/alerts/{alertId}/acknowledge`
- `POST /v1/alerts/{alertId}/resolve`

## Tenant admin and onboarding

The orchestrator now stores lightweight operator-facing tenant state alongside the marketplace runtime:

- `GET /v1/tenants/{tenantCode}/admin-settings`
- `PUT /v1/tenants/{tenantCode}/admin-settings`
- `GET /v1/tenants/{tenantCode}/onboarding`
- `PUT /v1/tenants/{tenantCode}/onboarding`

This keeps first-pilot settings like live mode, pilot SKU families, alert routing, and onboarding step completion close to the operator workflow.

## Next hardening steps

1. Add richer Amazon attribute mapping per product type.
2. Add real Seller Central app-notification template management.
3. Add webhook signing or gateway validation for external notification ingest.
4. Add true connector coverage beyond Amazon for live tenants.
5. Add tenant provisioning, billing, and retention controls around the orchestration layer.
