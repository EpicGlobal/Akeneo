# SaaS Readiness

This pass hardens the current Akeneo + ResourceSpace integration, but it does not by itself turn the project into a production SaaS. The main gaps are architectural, not cosmetic.

## Commercialization

- This codebase is still based on Akeneo PIM Community Standard Edition under OSL-3.0.
- Selling services, hosting, and a SaaS offer is not automatically prohibited by that license, but external network deployment is treated as distribution under OSL-3.0, so commercialization needs a real license-compliance review before launch.
- Any SaaS plan should assume source-availability and attribution obligations for derivative works built from the OSL-covered code unless counsel concludes otherwise for a specific component boundary.
- Akeneo trademarks are not granted by the OSL license, so branding and go-to-market positioning need to avoid implying an official Akeneo offering.

## What is better now

- DAM link changes are resilient to transient ResourceSpace write-back failures.
- Write-back state is visible in the Akeneo UI.
- Operators can retry write-back directly from the DAM tab.
- A repeatable write-back worker now drains queued metadata updates outside the editor request cycle.
- The ResourceSpace connection model now has a tenant-scoped configuration seam instead of only one global env-bound connection.
- A standalone marketplace orchestration service now exists as the first cut of the proprietary workflow layer.
- The marketplace orchestration service now includes an Amazon-first automation layer for notification bootstrap, schema sync, listing validation preview, publish execution, account-health monitoring, brand-source watching, proposal generation, and alerting.
- DAM downloads no longer need to buffer the full asset in PHP memory before handing the file to Akeneo storage.

## What a world-class PIM/DAM still needs

- First-class product governance, not just asset linking: attribute lifecycle management, controlled vocabularies, reference data, validation policies, change approval flows, and publish blockers.
- First-class asset governance: versioning, renditions, rights/licensing, expiry dates, approvals, derivative tracking, and "where-used" visibility across products, channels, and campaigns.
- A rules engine that joins PIM and DAM: required assets by family, variant, locale, market, and channel; inheritance rules from product models; and completeness scoring that includes media readiness.
- Event-driven bidirectional sync: DAM webhooks, replayable jobs, reconciliation, idempotency, conflict handling, and drift detection.
- A much stronger editor experience: bulk link/unlink, bulk sync, drag-and-drop, side-by-side asset compare, usage graph, asset collections, and better variant inheritance UX.
- Better discovery: OCR, auto-tagging, duplicate detection, semantic search, visual similarity, and cross-search over product and asset metadata.
- Omnichannel delivery: channel-specific renditions, CDN-backed delivery, signed URLs, and export/publish flows that treat assets as channel-ready outputs, not just files.
- Marketplace automation workflows: automated enrichment, transformation, validation, and publish flows per marketplace, including marketplace-specific taxonomy mapping, required attributes, title and bullet generation rules, asset requirements, and submission feedback loops.

## Where to make it yours

- The strongest proprietary layer is likely not the OSS PIM core itself, but the workflow, governance, marketplace automation, and operating model you build around it.
- A separate orchestration service can make sense for marketplace automation if you want cleaner boundaries: it can consume PIM and DAM events, apply channel-specific enrichment rules, manage approvals, and publish to external marketplaces without forcing all of that logic into the Akeneo runtime.
- The more differentiated product surface is tenant control, governance policy, channel automation, analytics, workflow UX, and operational tooling, not just a thinner DAM connector.
- The current repository now documents that layer explicitly in `docs/coppermind-platform.md` and starts it in code under `services/marketplace-orchestrator`.

## What still blocks a real SaaS

- Tenant isolation: the current integration is globally configured with one `RESOURCE_SPACE_*` set. A SaaS needs tenant-scoped DAM credentials, tenant-scoped settings, and hard isolation boundaries in storage, jobs, and access control.
- Async media ingest: binary sync still runs inside the request cycle. Large files and bursts of activity should move to background workers with retries, dead-letter handling, and progress visibility.
- Marketplace orchestration: if marketplace-specific enrichment is part of the offer, it needs its own workflow engine, retry model, audit trail, and connector strategy rather than ad hoc per-channel scripts.
- Secrets and provisioning: tenant onboarding needs automated creation, rotation, and revocation of DAM credentials and application secrets.
- Object storage and CDN: synced media should live in durable shared storage with lifecycle policies, not only local container volumes.
- Observability: production SaaS needs structured logs, job metrics, alerting, health checks, and dashboards around DAM latency, failure rate, and queue depth.
- Rate limiting and backpressure: DAM-side throttling should not degrade PIM edits. Queue workers need bounded concurrency and retry policies.
- Auditability: user-visible link changes and background retries should emit durable audit events.
- Deployment model: this repo is still a customized Akeneo app. A SaaS rollout needs environment promotion, zero-downtime migrations, backup/restore procedures, and tenant-aware release controls.
- Platform lifecycle: the current stack is still on Symfony 5.4, whose maintenance and end-of-life windows have already passed. A SaaS launch should not stay on an EOL framework baseline.

## Recommended next implementation phases

1. Introduce a tenant configuration model for DAM credentials and move write-back / sync jobs onto background workers.
2. Add the PIM/DAM rules engine, product governance, asset governance, and marketplace automation capabilities that define a world-class operating model.
3. Decide whether marketplace automation lives inside the app or in a separate orchestration service, then build the event model and connector boundaries accordingly.
4. Move synced binaries to object storage and add queue metrics, alerting, and delivery controls.
5. Add provisioning APIs or admin flows for tenant onboarding, credential rotation, and per-tenant health checks.
6. Add audit trails, operator dashboards, and license-compliance review before exposing the platform to external customers.
