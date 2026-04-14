# Operator MVP Remaining Work

This document defines what is still left before Operator is ready for an MVP launch.

For this repo, **MVP** means:

- a limited, operator-led rollout for `1-3` design partners,
- one live marketplace path, starting with Amazon,
- manual support and assisted onboarding are acceptable,
- self-serve sign-up, self-serve billing, and world-class automation are **not** required yet.

It does **not** mean a broad self-serve SaaS launch.

## Current baseline

The current stack already includes:

- Akeneo as the catalog core,
- ResourceSpace as the DAM core,
- a routed Operator shell with `/`, `/control-plane/`, `/market/`, and `/assets/` in `epic-dev`,
- governance workflow state, approvals, and publish blockers,
- async write-back, async media-ingest job plumbing, and marketplace orchestration workers,
- a control plane app with tenant records, onboarding state, user admin, support workflow, and ops views,
- backup, restore, and monitoring scripts with cron installation support,
- isolated AWS dev and prod environments,
- an Amazon-first orchestration layer with pilot gating.

That is enough foundation for a serious design-partner pilot, but not enough for a broad external launch.

## Hard MVP blockers

- Make Amazon live for one real tenant and one real SKU family.
- Wire real Amazon credentials, notifications, validation-preview flow, and operator alert routing.
- Put the Operator control plane in front of the pilot workflow so onboarding, approvals, exceptions, and launch links feel like one suite.
- Wire real email delivery for invite, password reset, and support notifications.
- Finish one repeatable tenant bootstrap flow:
  - create tenant,
  - create owner user,
  - assign plan/entitlements,
  - configure marketplace tenant settings,
  - configure DAM tenant settings,
  - land the user in onboarding.
- Run and document one real restore drill in staging and one in production.
- Lock down the pilot service entrypoints so customers are not relying on raw ports or ad hoc URLs.
- Push the `Epic Commerce Platform` control-plane workspace to a real remote repository and treat it as a first-class codebase.

## MVP product work still left

### Control plane and onboarding

- Make the control plane the default operator entry point for staging and production.
- Tighten the onboarding wizard so it captures only what is needed for a first tenant:
  - organization basics,
  - contact/admin user,
  - marketplace selection,
  - catalog readiness checklist,
  - DAM readiness checklist.
- Add a simple "next action" home state so a pilot user can see:
  - onboarding progress,
  - products waiting for approval,
  - listing issues,
  - asset-rights issues,
  - publish readiness.

### Tenant and user basics

- Finish password reset end to end with a real mail provider.
- Support at least:
  - owner,
  - operator admin,
  - merchandising/editor,
  - reviewer/approver.
- Add basic tenant-level settings screens for:
  - contact info,
  - enabled modules,
  - marketplace pilot family settings,
  - alert destinations.

### Governance and workflow

- Confirm the approval model is usable in real operations:
  - request approval,
  - approve/reject,
  - view blockers,
  - resolve blockers,
  - requeue publish.
- Add a stronger operator inbox for:
  - approvals,
  - exceptions,
  - expired or missing rights,
  - failed publish runs,
  - listing issues.
- Validate that the current completeness and blocker logic works for one real family, not just synthetic tests.

### Marketplace

- Move one tenant from mock to live Amazon mode.
- Restrict live execution to one family with pilot gating.
- Verify one full real workflow:
  - product changes,
  - readiness evaluation,
  - approval,
  - validation preview,
  - publish,
  - status/issue monitoring,
  - alert handling.
- Add operator-facing error messages that are clear enough for support use.

### DAM and media

- Keep DAM reachable behind `/assets/` or a clean hostname in every customer-facing environment.
- Confirm that asset link, sync, primary selection, rights review, and expiration monitoring work on real pilot assets.
- Decide and document the pilot stance for binary storage:
  - either finish managed object storage cutover,
  - or explicitly accept local-volume media for MVP with backups and recovery in place.

## MVP platform and ops work still left

- Put the control plane under remote version control with CI on push.
- Add one automated deploy validation job that runs the current test suite plus a health-check smoke test.
- Make monitoring operational, not just installed:
  - define alert thresholds,
  - define who receives alerts,
  - confirm incidents appear in the control plane,
  - confirm logs are retained.
- Run scheduled backups in production and confirm artifacts land in S3.
- Record at least one restore drill event in the control plane.
- Add a production runbook for:
  - Akeneo unavailable,
  - DAM unavailable,
  - marketplace backlog,
  - Amazon validation failure,
  - backup failure.

## What can stay manual for MVP

- Billing can remain manual or invoice-based for the first design partners.
- Tenant creation can remain operator-assisted.
- Marketplace connector rollout can stay limited to Amazon first.
- Customer support can remain high-touch and operator-led.
- AI-assisted enrichment can remain review-first instead of fully automatic.
- Advanced analytics can remain operator-facing rather than customer-self-serve.

## What can wait until after MVP

- Full self-serve sign-up and credit-card checkout.
- Multi-marketplace live rollout beyond the first Amazon pilot.
- Full DAM search/discovery improvements like OCR, duplicate detection, and semantic search.
- Full object-storage/CDN media delivery if the pilot scale is small and recovery is proven.
- Framework modernization off Symfony `5.4`, as long as there is a committed upgrade plan and the pilot window is short.
- Deep multi-tenant isolation beyond the current pilot architecture.

## MVP exit criteria

Operator is MVP-ready when all of these are true:

- One design-partner tenant can log in through the Operator shell and complete onboarding with operator assistance.
- The tenant can manage products and linked assets in one coherent workflow.
- One SKU family can publish to Amazon in live mode.
- Listing issues and approval exceptions show up in the operator workflow and can be resolved.
- Backups run automatically and one restore drill has been executed successfully.
- The dev and prod stacks are repeatable through the scripted AWS deployment path.
- The control plane code is under proper remote version control.

