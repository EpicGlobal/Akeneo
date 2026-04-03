# Coppermind Platform Layer

This repo now has three distinct layers:

1. Akeneo Community Edition as the core product-information engine.
2. ResourceSpace as the core digital-asset system.
3. Coppermind-owned orchestration, governance, and tenant operations on top.

The third layer is where the product becomes meaningfully yours.

## What belongs in the Coppermind layer

- Governance: attribute lifecycle, reference data stewardship, validation policy, approval flows, and publish blockers.
- Marketplace orchestration: channel-specific enrichment, taxonomy mapping, listing generation, submission retries, and feedback loops.
- Workflow: human review queues, SLA tracking, exception handling, and escalation.
- Channel publishing: publish payload generation, signed asset delivery, publish scheduling, and rollback controls.
- Tenant operations: onboarding, configuration, metering, health checks, billing hooks, and tenant support tooling.
- Analytics and audit: completeness, media readiness, connector latency, operator actions, and customer-facing audit trails.

## Boundary rule

Akeneo should stay focused on product authoring, product modeling, catalog structure, and direct editor workflows.

ResourceSpace should stay focused on asset storage, previewing, metadata, and asset retrieval.

Coppermind-owned services should handle the differentiated logic that spans systems or external channels:

- policy evaluation,
- tenant-scoped connector settings,
- background orchestration,
- approval and publish workflow,
- marketplace and channel integrations.

That boundary keeps the open-source cores replaceable and makes the commercial surface easier to evolve.

## First services in that layer

### Tenant-scoped DAM configuration

Akeneo now has a tenant-aware ResourceSpace configuration seam backed by:

- `coppermind_tenant`
- `coppermind_resourcespace_tenant_configuration`

That is the start of tenant isolation for connector credentials and write-back policy.

### Marketplace orchestration service

The first standalone Coppermind service now lives in `services/marketplace-orchestrator`.

Its current role is to:

- ingest product-change events,
- evaluate marketplace-specific readiness rules,
- queue orchestration runs per tenant and marketplace,
- produce actionable enrichment and publish blockers,
- prepare listing payloads outside the Akeneo runtime,
- run Amazon-first automation for schema sync, validation preview, publish execution, listing health, account health, and alerting.

## Event model

The near-term event contract should be:

- `product.changed`
- `product.approval.requested`
- `product.approval.completed`
- `asset.linked`
- `asset.unlinked`
- `asset.synced`
- `publish.requested`
- `publish.completed`
- `publish.failed`

Akeneo should emit the authoring-side events.

The orchestration layer should own:

- rule evaluation,
- run creation,
- retries and dead-letter handling,
- external connector execution,
- operator-visible audit history.

## Short-term build order

1. Keep tenant connector config in Akeneo because the editor workflow lives there today.
2. Move marketplace logic and approval orchestration into the standalone service.
3. Introduce an event or outbox bridge from Akeneo to the orchestrator.
4. Split queueing, audit, and publish execution into durable infrastructure.
5. Add tenant provisioning and billing controls around those services.
