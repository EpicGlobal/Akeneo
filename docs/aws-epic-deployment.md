# Operator AWS Deployment

This repository deploys the Operator application stack into Epic Global AWS accounts with the existing Docker Compose runtime and the Epic-specific bootstrap wrapper.

The runtime still uses the current parameter prefix and bootstrap scripts:

- Parameter Store prefix: `/epic-global/akeneo-pim/prod`
- Deploy wrapper: `scripts/aws-epic-deploy.sh`
- EC2 bootstrap helper: `scripts/aws-ec2-bootstrap.sh`

The broader Operator control plane now lives in the separate suite workspace:

- Control plane app: `../Epic Commerce Platform/apps/operator-control-plane`
- Local compose packaging: `../Epic Commerce Platform/infra/docker-compose.operator-control-plane.yml`
- Akeneo-side runtime overlay: `docker-compose.operator-control-plane.yml`

## Production

From an EC2 instance in the target account:

```bash
export AWS_REGION=us-west-2
export DEPLOY_PARAMETER_PREFIX=/epic-global/akeneo-pim/prod
bash scripts/aws-epic-deploy.sh <public-ip-or-url>
```

## Development / Staging

For an isolated `epic-dev` environment in `us-west-2`, use the provisioning script from this workstation:

```powershell
powershell -ExecutionPolicy Bypass -File "scripts\aws-epic-stage-deploy.ps1"
```

That script provisions a dedicated dev EC2 instance, Elastic IP, security group, IAM role/profile, backup bucket, CloudWatch dashboard/alarms, and SSM parameter set under `/epic-global/akeneo-pim/dev`, then bootstraps the repo on the new host.

On reruns, the staging wrapper restores the server-side tracked `.env` to the repo baseline before overlaying the Parameter Store values, removes any stale `.env.local`, validates the Operator, DAM, and marketplace health endpoints, and ensures the default admin user exists.

It now also:

- bundles the local `Operator Control Plane` app from the sibling suite workspace,
- uploads that bundle to the dev backup bucket,
- deploys it on the EC2 host under `/home/ubuntu/operator-control-plane/app`,
- starts it through the shared Docker runtime,
- and validates the clean suite routes:
  - `/control-plane/`
  - `/market/`
  - `/assets/`

## Fresh Host Bootstrap

If the host does not already have Docker and the repo checked out:

```bash
export AWS_REGION=us-west-2
export DEPLOY_PARAMETER_PREFIX=/epic-global/akeneo-pim/prod
export BOOTSTRAP_SCRIPT=scripts/aws-epic-deploy.sh
bash scripts/aws-ec2-bootstrap.sh <public-ip-or-url>
```

## What The Epic Wrapper Does

- pulls secrets from AWS Systems Manager Parameter Store
- writes the required `.env` values for Akeneo, ResourceSpace, and object storage
- provisions and wires a managed media bucket for the staged S3/CDN cutover
- writes the shared control-plane/public route values used by the suite shell
- derives the ResourceSpace private API key for the bootstrap admin user from `RESOURCE_SPACE_API_SCRAMBLE_KEY`
- runs the existing `scripts/aws-first-run.sh` bootstrap
- replays the custom Operator platform migrations that Akeneo's installer marks as executed during a fresh catalog install
- runs Doctrine migrations
- starts ResourceSpace plus background workers
- installs the marketplace orchestrator Node dependencies once, then starts the orchestrator plus worker
- deploys the Operator control plane from the local suite bundle and starts it in the shared runtime
- installs the host backup/monitor cron baseline plus log rotation
- configures the default tenant-scoped ResourceSpace connection
- stops non-runtime Akeneo helper containers after the build completes
- validates the PIM, DAM, marketplace, and control-plane health endpoints before reporting success

## Current Epic Prod Footprint

Verified in `epic-prod` / `us-west-2` on April 8, 2026:

- EC2 instance: `i-0f11f729d8189d6a9` (`epic-akeneo-pim-prod`)
- Elastic IP: `184.32.65.221`
- VPC: `vpc-0b9e25c427bb6d0a3`
- Security group: `sg-06c8ff6aa947ca771`

The current public entrypoint is still the raw IP. The Operator hostname cutover plan lives in [docs/operator-dns-cutover.md](operator-dns-cutover.md).

## Required Parameter Store Keys

Under the chosen prefix:

- `app_secret`
- `app_database_password`
- `app_database_root_password`
- `backup_s3_uri`
- `media_bucket`
- `media_cdn_base_url` (optional)
- `object_storage_access_key`
- `object_storage_secret_key`
- `operator_control_plane_token`
- `resource_space_db_password`
- `resource_space_db_root_password`
- `resource_space_admin_password`
- `resource_space_scramble_key`
- `resource_space_api_scramble_key`

## Remaining Manual Follow-Ups

- point DNS at the host or Elastic IP
- add TLS in front of port 80
- put the Operator control plane behind its own hostname/TLS and make it the primary suite entry point
- configure a real mailer/SES path
- provide live Amazon and Epic AI credentials when ready
- create and map a real Akeneo media attribute if you want one-click binary sync from the DAM
- if using staging, optionally add a dev hostname and tighten the security group after smoke testing

## SaaS Hardening Follow-Up

For broader rollout beyond design-partner pilots:

- complete the live Akeneo/DAM media cutover to the provisioned managed object storage and CDN layer
- finish clean hostnames/TLS for DAM, marketplace, and AI
- keep backup, restore drill, and monitor signals flowing into the Operator control plane
