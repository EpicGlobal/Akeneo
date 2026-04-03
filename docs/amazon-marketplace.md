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

All mock state is stored in `var/marketplace-orchestrator/`.

## Going live

To move from mock mode to live mode, update the tenant Amazon config with:

- `mode: "live"`
- Login with Amazon credentials
- seller refresh token
- AWS signing credentials
- seller ID
- notification destination configuration
- alert routing configuration

The service already supports `put`, `patch`, and `feed` listing submission modes at the connector layer.

## Next hardening steps

1. Move from file-backed state to durable database and queue storage.
2. Add idempotency keys for publish submissions and notification ingest.
3. Add real Seller Central app-notification template management.
4. Add richer Amazon attribute mapping per product type.
5. Add webhook signing or gateway validation for external notification ingest.
