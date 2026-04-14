# Operator World-Class Software Roadmap

This document defines what is still left for Operator to become world-class software rather than a strong pilot platform.

For this document, **world-class** means:

- multi-tenant,
- broadly customer-facing,
- enterprise-ready,
- operationally mature,
- opinionated and differentiated in workflow, governance, marketplace automation, and AI.

It assumes the MVP work is already complete.

## Starting point

Operator already has important foundation pieces:

- a real PIM core,
- a real DAM core,
- an emerging control plane,
- tenant-aware seams,
- governance workflow scaffolding,
- marketplace orchestration,
- backup and monitoring hooks,
- staged AWS deployment paths.

That foundation matters, but it is not enough by itself to be called world-class.

## What world-class still requires

### 1. Product governance that is deep, not just present

- Attribute lifecycle management with ownership, review, deprecation, and policy history.
- Controlled vocabularies and reference data stewardship UI.
- Market-, channel-, and family-specific validation policies.
- Multi-step approvals with SLAs, delegation, escalation, and audit.
- Publish gating that is enforced consistently across authoring, approvals, and channel execution.
- Rich diff views so reviewers can see exactly what changed before approving.

### 2. Asset governance that can stand on its own

- Asset versioning and rollback.
- Rendition generation and derivative tracking.
- Rights and licensing workflows with owner, territory, and expiry logic.
- Where-used visibility across products, listings, channels, and campaigns.
- Expiration automation that can block publish or trigger replacement workflows.
- Better asset search:
  - OCR,
  - duplicate detection,
  - visual similarity,
  - semantic retrieval.

### 3. A stronger rules engine between PIM and DAM

- Required attribute logic by family, category, channel, and market.
- Required asset-role logic by family, market, and publish target.
- Variant and inheritance rules that operators can understand and change safely.
- Completeness scoring that reflects both metadata and media readiness.
- Drift detection when catalog state, DAM state, and channel state disagree.

### 4. Marketplace orchestration beyond a first pilot

- Production-grade Amazon support across more than one family and one tenant.
- Additional live connectors such as Walmart, Shopify, Target Plus, or retailer-specific feeds.
- Connector-specific taxonomy mapping, transformation, and validation layers.
- Strong reconciliation:
  - outbound publish state,
  - channel-side status,
  - issue sync,
  - retry and dead-letter handling,
  - rollback or operator requeue.
- Account-health monitoring that can move from alerting to guided remediation workflows.

### 5. AI that is operationally trustworthy

- AI-assisted enrichment tied to evidence and review, not just freeform generation.
- Prompt, model, and policy versioning per workflow.
- Evaluation harnesses for title, bullets, attributes, and compliance-sensitive copy.
- Human-review thresholds for risky fields like brand, safety, compliance, and category.
- Proposal quality analytics:
  - acceptance rate,
  - edit distance after review,
  - publish success,
  - issue reduction.

### 6. A true suite control plane

- Shared identity and single sign-on across catalog, assets, marketplace, and AI.
- Mature tenant provisioning.
- Real plan and entitlement enforcement.
- Customer-facing admin workflows for users, roles, modules, and support.
- In-app suite navigation that feels native rather than linked together.
- Unified dashboarding for:
  - readiness,
  - approvals,
  - listing health,
  - asset health,
  - incidents,
  - account health.

### 7. Enterprise-grade infrastructure and SRE

- Managed object storage for media as the default, not local volume fallbacks.
- CDN-backed media delivery and signed URLs where needed.
- Durable queueing and job orchestration.
- Structured logs, centralized log aggregation, metrics, tracing, and alerting.
- Zero-downtime deployment posture where possible.
- Recovery objectives with tested disaster recovery, not just scripts.
- Capacity management, autoscaling, and service-level objectives.

### 8. Security, compliance, and trust

- Strong RBAC and tenant isolation.
- Secrets rotation and credential lifecycle automation.
- Full audit history for user and system actions.
- Data retention and deletion workflows.
- Security reviews around marketplace credentials, AI usage, and public delivery.
- Compliance posture appropriate to your customers, potentially including SOC 2, DPAs, and vendor review readiness.

### 9. UX polish that feels premium

- A polished control plane and onboarding experience.
- Better bulk actions for editors and operators.
- Faster exception resolution flows.
- Strong reporting views for completeness, readiness, and backlog.
- Consistent design system usage across every module.
- Better guidance, inline help, and context-aware workflows so the suite is learnable without operator hand-holding.

### 10. Delivery discipline

- CI for the Akeneo customization layer and the control plane.
- Remote version control for every live codebase.
- Automated regression coverage for governance, orchestration, ops, and control-plane workflows.
- Environment promotion discipline between dev, staging, and prod.
- Safer schema migration discipline for the shared control-plane data model.

## Practical maturity ladder

### Stage 1: Strong pilot platform

- One live marketplace path.
- Operator-led onboarding.
- High-touch support.
- Manual billing acceptable.
- Limited tenant count.

### Stage 2: Strong commercial SaaS

- Multiple live tenants.
- Shared control plane is the primary front door.
- Email, billing, provisioning, and alerts are live.
- Recovery, backups, and monitoring are proven.
- Multiple environments and repeatable releases are normal.

### Stage 3: World-class platform

- Multiple channels and multiple tenant segments.
- Customer admins can self-manage without engineering help.
- AI suggestions are measurable and trusted.
- Assets, catalog, workflow, and channel operations feel like one product.
- Reliability, governance, and visibility are strong enough that large customers can depend on the system daily.

## What should define "world-class" for Operator specifically

Operator should not try to win by being "Akeneo with a new skin."

It should win through:

- stronger workflow,
- stronger governance,
- better marketplace automation,
- better operator tooling,
- better cross-system visibility,
- better AI-assisted enrichment with review discipline,
- a cleaner suite experience than disconnected PIM, DAM, and listing tools.

That is the proprietary surface worth building.

## World-class exit criteria

Operator is approaching world-class only when all of these are true:

- new tenants can be provisioned safely and repeatedly,
- users can operate through a unified suite shell,
- multiple connectors run live with stable reconciliation,
- media is managed through durable shared storage and delivery infrastructure,
- governance and asset policy are first-class product features,
- AI proposals improve throughput without reducing trust,
- incidents, logs, metrics, and restores are routine operations instead of emergency improvisation,
- customers can use the platform without daily engineering intervention.

